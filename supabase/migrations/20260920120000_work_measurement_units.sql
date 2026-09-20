begin;

-- Make the per-work measurement settings available to both clients.
update public.solar_shared as shared
set data = jsonb_set(
  jsonb_set(
    shared.data,
    '{workTypes}',
    case
      when coalesce(shared.data->'workTypes', '[]'::jsonb) ? 'Truck unloading'
        then coalesce(shared.data->'workTypes', '[]'::jsonb)
      else coalesce(shared.data->'workTypes', '[]'::jsonb) || '"Truck unloading"'::jsonb
    end,
    true
  ),
  '{workUnits}',
  coalesce(shared.data->'workUnits', '{}'::jsonb) || '{"Truck unloading":"loads"}'::jsonb,
  true
), version = version + 1, updated_at = now()
where shared.id = 1
  and (
    not coalesce(shared.data->'workTypes', '[]'::jsonb) ? 'Truck unloading'
    or coalesce(shared.data->'workUnits', '{}'::jsonb)->>'Truck unloading' is distinct from 'loads'
  );

-- Extend the existing row-locked shared-data RPC; retain its grants and other
-- validation logic, adding only measurement-aware team and setting checks.
create or replace function solar_private.valid_work_measurement(record jsonb, unit_name text)
returns boolean
language sql immutable set search_path = '' as $$
  select case when unit_name = 'rows' then
    coalesce(record->>'from','') ~ '^\d+$'
    and case when coalesce(record->>'from','') ~ '^\d+$' then (record->>'from')::numeric <= 2147483647 else false end
    and (record->>'to' is null or (
      coalesce(record->>'to','') ~ '^\d+$'
      and case when coalesce(record->>'to','') ~ '^\d+$' then (record->>'to')::numeric <= 2147483647 else false end
      and case when coalesce(record->>'to','') ~ '^\d+$' and coalesce(record->>'from','') ~ '^\d+$' then (record->>'to')::numeric >= (record->>'from')::numeric else false end
    ))
  else
    (not (record ? 'from') or record->'from' = 'null'::jsonb)
    and (not (record ? 'to') or record->'to' = 'null'::jsonb)
    and (record->>'quantity' is null or case when record->>'quantity' ~ '^\d+(\.\d+)?$' then (record->>'quantity')::numeric <= 1000000000 else false end)
  end
$$;
revoke all on function solar_private.valid_work_measurement(jsonb, text) from public, anon;
grant execute on function solar_private.valid_work_measurement(jsonb, text) to authenticated;

do $migration$
declare
  definition text;
  previous text;
  old_check text;
  new_check text;
begin
  select pg_get_functiondef('public.solar_change(text,jsonb,jsonb)'::regprocedure) into definition;
  definition := replace(definition, E'\r\n', E'\n');
  previous := definition;

  old_check := $$if jsonb_typeof(item->'members') <> 'array' or jsonb_array_length(item->'members') < 1
        or coalesce(item->>'from','') !~ '^\d+$'
        or (item->>'to' is not null and ((item->>'to') !~ '^\d+$' or (item->>'to')::int < (item->>'from')::int)) then raise exception 'Invalid team'; end if;$$;
  new_check := $$if jsonb_typeof(item->'members') <> 'array' or jsonb_array_length(item->'members') < 1
        or coalesce(item->>'unit', coalesce(current_row.data->'workUnits'->>(item->>'work'), 'rows')) is distinct from coalesce(current_row.data->'workUnits'->>(item->>'work'), 'rows')
        or not solar_private.valid_work_measurement(item, coalesce(item->>'unit', coalesce(current_row.data->'workUnits'->>(item->>'work'), 'rows'))) then raise exception 'Invalid team'; end if;$$;
  definition := replace(definition, old_check, new_check);

  old_check := $$if target = 'teams' and (jsonb_typeof(merged->'members') <> 'array' or jsonb_array_length(merged->'members') < 1
      or coalesce(merged->>'from','') !~ '^\d+$'
      or (merged->>'to' is not null and ((merged->>'to') !~ '^\d+$' or (merged->>'to')::int < (merged->>'from')::int))) then raise exception 'Invalid team'; end if;$$;
  new_check := $$if target = 'teams' and (jsonb_typeof(merged->'members') <> 'array' or jsonb_array_length(merged->'members') < 1
      or not solar_private.valid_work_measurement(merged, coalesce(merged->>'unit', current_row.data->'workUnits'->>(merged->>'work'), 'rows'))) then raise exception 'Invalid team'; end if;$$;
  definition := replace(definition, old_check, new_check);

  old_check := $$if field_name not in ('fields','workTypes','jobGroups','archivedJobGroups') or jsonb_typeof(item->field_name) <> 'array'
        or (field_name in ('fields','workTypes') and jsonb_array_length(item->field_name) < 1) then raise exception 'Invalid setting'; end if;$$;
  new_check := $$if (field_name = 'workUnits' and (jsonb_typeof(item->field_name) <> 'object'
          or exists(select 1 from jsonb_each_text(item->field_name) unit where length(trim(unit.value)) < 1 or length(unit.value) > 24)))
        or (field_name <> 'workUnits' and (field_name not in ('fields','workTypes','jobGroups','archivedJobGroups') or jsonb_typeof(item->field_name) <> 'array'
          or (field_name in ('fields','workTypes') and jsonb_array_length(item->field_name) < 1))) then raise exception 'Invalid setting'; end if;$$;
  definition := replace(definition, old_check, new_check);

  definition := replace(definition,
    $$not in ('date','members','field','work','from','to','status','note','closed','issueResolved')$$,
    $$not in ('date','members','field','work','from','to','status','note','closed','issueResolved','quantity','unit')$$);

  if definition = previous
    or position('workUnits' in definition) = 0
    or position('quantity' in definition) = 0
    or position('solar_private.valid_work_measurement' in definition) = 0
    then raise exception 'solar_change definition did not match the expected current revision'; end if;
  execute definition;
end $migration$;

revoke all on function public.solar_change(text, jsonb, jsonb) from public, anon;
grant execute on function public.solar_change(text, jsonb, jsonb) to authenticated;
commit;

