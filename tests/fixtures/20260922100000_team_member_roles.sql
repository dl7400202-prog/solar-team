begin;

-- Team member roles are stored on the team record so a Manitou operator is
-- visible without changing the person's global job role or work type.
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

  definition := replace(
    definition,
    $$not in ('date','members','field','work','from','to','status','note','closed','issueResolved','quantity','unit')$$,
    $$not in ('date','members','memberRoles','field','work','from','to','status','note','closed','issueResolved','quantity','unit')$$
  );

  old_check := $$if jsonb_typeof(item->'members') <> 'array' or jsonb_array_length(item->'members') < 1
        or coalesce(item->>'unit', coalesce(current_row.data->'workUnits'->>(item->>'work'), 'rows')) is distinct from coalesce(current_row.data->'workUnits'->>(item->>'work'), 'rows')
        or not solar_private.valid_work_measurement(item, coalesce(item->>'unit', coalesce(current_row.data->'workUnits'->>(item->>'work'), 'rows'))) then raise exception 'Invalid team'; end if;$$;
  new_check := $$if jsonb_typeof(item->'members') <> 'array' or jsonb_array_length(item->'members') < 1
        or jsonb_typeof(coalesce(item->'memberRoles','{}'::jsonb)) <> 'object'
        or exists(select 1 from jsonb_object_keys(coalesce(item->'memberRoles','{}'::jsonb)) role_id where not (item->'members' ? role_id))
        or coalesce(item->>'unit', coalesce(current_row.data->'workUnits'->>(item->>'work'), 'rows')) is distinct from coalesce(current_row.data->'workUnits'->>(item->>'work'), 'rows')
        or not solar_private.valid_work_measurement(item, coalesce(item->>'unit', coalesce(current_row.data->'workUnits'->>(item->>'work'), 'rows'))) then raise exception 'Invalid team'; end if;$$;
  definition := replace(definition, old_check, new_check);

  old_check := $$if target = 'teams' and (jsonb_typeof(merged->'members') <> 'array' or jsonb_array_length(merged->'members') < 1
      or not solar_private.valid_work_measurement(merged, coalesce(merged->>'unit', current_row.data->'workUnits'->>(merged->>'work'), 'rows'))) then raise exception 'Invalid team'; end if;$$;
  new_check := $$if target = 'teams' and (jsonb_typeof(merged->'members') <> 'array' or jsonb_array_length(merged->'members') < 1
      or jsonb_typeof(coalesce(merged->'memberRoles','{}'::jsonb)) <> 'object'
      or exists(select 1 from jsonb_object_keys(coalesce(merged->'memberRoles','{}'::jsonb)) role_id where not (merged->'members' ? role_id))
      or not solar_private.valid_work_measurement(merged, coalesce(merged->>'unit', current_row.data->'workUnits'->>(merged->>'work'), 'rows'))) then raise exception 'Invalid team'; end if;$$;
  definition := replace(definition, old_check, new_check);

  if definition = previous or position('memberRoles' in definition) = 0 then
    raise exception 'solar_change definition did not match the expected work-measurement revision';
  end if;
  execute definition;
end $migration$;

revoke all on function public.solar_change(text, jsonb, jsonb) from public, anon;
grant execute on function public.solar_change(text, jsonb, jsonb) to authenticated;
commit;
