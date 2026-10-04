begin;

update public.solar_shared
set data = jsonb_set(
      jsonb_set(
        jsonb_set(coalesce(data, '{}'::jsonb), '{jobGroups}', coalesce(data->'jobGroups', '["Team Leads","Technicians","Mechanics"]'::jsonb), true),
        '{archivedJobGroups}', coalesce(data->'archivedJobGroups', '[]'::jsonb), true
      ),
      '{people}',
      coalesce((select jsonb_agg(person
        || case when person ? 'jobGroup' then '{}'::jsonb else '{"jobGroup":""}'::jsonb end
        || case when person ? 'photoPath' then '{}'::jsonb else '{"photoPath":""}'::jsonb end order by ord)
        from jsonb_array_elements(coalesce(data->'people', '[]'::jsonb)) with ordinality as people(person, ord)), '[]'::jsonb),
      true
    ), version = version + 1, updated_at = now()
where id = 1;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('employee-photos', 'employee-photos', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists solar_employee_photos_read on storage.objects;
drop policy if exists solar_employee_photos_insert on storage.objects;
drop policy if exists solar_employee_photos_update on storage.objects;
drop policy if exists solar_employee_photos_delete on storage.objects;
create policy solar_employee_photos_read on storage.objects for select to authenticated
using (bucket_id = 'employee-photos' and (select solar_private.is_member()));
create policy solar_employee_photos_insert on storage.objects for insert to authenticated
with check (bucket_id = 'employee-photos' and (select solar_private.is_member()));
create policy solar_employee_photos_update on storage.objects for update to authenticated
using (bucket_id = 'employee-photos' and (select solar_private.is_member()))
with check (bucket_id = 'employee-photos' and (select solar_private.is_member()));
create policy solar_employee_photos_delete on storage.objects for delete to authenticated
using (bucket_id = 'employee-photos' and (select solar_private.is_member()));

create or replace function public.solar_change(kind text, item jsonb, expected jsonb default '{}'::jsonb)
returns public.solar_shared language plpgsql security invoker set search_path = '' as $$
declare
  current_row public.solar_shared; entries jsonb; entry jsonb; target text; idx integer;
  next_number integer; field_name text; merged jsonb; old_name text; new_name text;
  allow_reassign boolean := false;
begin
  select * into current_row from public.solar_shared where id = 1 for update;
  if not found then raise exception 'Access to Solar Team is by invitation only' using errcode = '42501'; end if;
  if kind = 'initialize' then
    if current_row.initialized then return current_row; end if;
    if jsonb_typeof(item->'people') <> 'array' or jsonb_typeof(item->'teams') <> 'array'
      or jsonb_typeof(item->'fields') <> 'array' or jsonb_typeof(item->'workTypes') <> 'array'
      or not (item ?& array['people','teams','fields','workTypes']) then raise exception 'Invalid workspace'; end if;
    current_row.data := item
      || jsonb_build_object('jobGroups', coalesce(item->'jobGroups', '["Team Leads","Technicians","Mechanics"]'::jsonb))
      || jsonb_build_object('archivedJobGroups', coalesce(item->'archivedJobGroups', '[]'::jsonb));
  elsif kind in ('add_person', 'add_team') then
    target := case when kind = 'add_person' then 'people' else 'teams' end;
    if coalesce(item->>'id', '') = '' then raise exception 'ID required'; end if;
    entries := current_row.data->target;
    if exists(select 1 from jsonb_array_elements(entries) e where e->>'id' = item->>'id') then return current_row; end if;
    if kind = 'add_person' then
      if length(trim(coalesce(item->>'name',''))) = 0 or length(trim(coalesce(item->>'role',''))) = 0
        or length(coalesce(item->>'photoPath','')) > 500
        or (coalesce(item->>'jobGroup','') <> '' and not (current_row.data->'jobGroups' ? (item->>'jobGroup'))) then raise exception 'Invalid person'; end if;
    else
      allow_reassign := coalesce((item->>'reassign')::boolean, false);
      item := item - 'reassign';
      if jsonb_typeof(item->'members') <> 'array' or jsonb_array_length(item->'members') < 1
        or coalesce(item->>'from','') !~ '^\d+$'
        or (item->>'to' is not null and ((item->>'to') !~ '^\d+$' or (item->>'to')::int < (item->>'from')::int)) then raise exception 'Invalid team'; end if;
      select coalesce(max((e->>'number')::int), 0) + 1 into next_number from jsonb_array_elements(entries) e where e->>'date' = item->>'date';
      item := item || jsonb_build_object('number', next_number);
      if exists(
        select 1 from jsonb_array_elements(entries) team_entry
        where team_entry->>'date' = item->>'date'
          and coalesce((team_entry->>'closed')::boolean, false) = false
          and exists(select 1 from jsonb_array_elements_text(team_entry->'members') member where item->'members' ? member)
      ) and not allow_reassign then raise exception 'Employee already assigned'; end if;
      if allow_reassign then
        select coalesce(jsonb_agg(
          case when team_entry->>'date' = item->>'date' and coalesce((team_entry->>'closed')::boolean, false) = false
            then jsonb_set(team_entry, '{members}', coalesce((select jsonb_agg(to_jsonb(member)) from jsonb_array_elements_text(team_entry->'members') member where not (item->'members' ? member)), '[]'::jsonb))
            else team_entry end order by ordinality
        ), '[]'::jsonb) into entries from jsonb_array_elements(entries) with ordinality as teams(team_entry, ordinality);
      end if;
    end if;
    current_row.data := jsonb_set(current_row.data, array[target], entries || jsonb_build_array(item));
  elsif kind in ('person_patch', 'team_patch') then
    target := case when kind = 'person_patch' then 'people' else 'teams' end;
    if kind = 'team_patch' then allow_reassign := coalesce((item->>'reassign')::boolean, false); item := item - 'reassign'; end if;
    select (ordinality - 1)::int, value into idx, entry from jsonb_array_elements(current_row.data->target) with ordinality where value->>'id' = item->>'id';
    if idx is null then raise exception 'Record no longer exists'; end if;
    for field_name in select jsonb_object_keys(item - 'id') loop
      if (target = 'people' and field_name not in ('name','role','jobGroup','photoPath','availability','active'))
        or (target = 'teams' and field_name not in ('date','members','field','work','from','to','status','note','closed')) then raise exception 'Invalid field'; end if;
      if not (expected ? field_name) or (entry->field_name is distinct from expected->field_name and entry->field_name is distinct from item->field_name)
        then raise exception 'This record was changed by a colleague. Refresh before saving.' using errcode = '40001'; end if;
    end loop;
    merged := entry || (item - 'id');
    if target = 'people' and (length(trim(coalesce(merged->>'name',''))) = 0 or length(trim(coalesce(merged->>'role',''))) = 0
      or length(coalesce(merged->>'photoPath','')) > 500
      or (coalesce(merged->>'jobGroup','') <> '' and not (current_row.data->'jobGroups' ? (merged->>'jobGroup')))) then raise exception 'Invalid person'; end if;
    if target = 'teams' and (jsonb_typeof(merged->'members') <> 'array' or jsonb_array_length(merged->'members') < 1
      or coalesce(merged->>'from','') !~ '^\d+$'
      or (merged->>'to' is not null and ((merged->>'to') !~ '^\d+$' or (merged->>'to')::int < (merged->>'from')::int))) then raise exception 'Invalid team'; end if;
    if target = 'teams' then
      if exists(
        select 1 from jsonb_array_elements(current_row.data->'teams') team_entry
        where team_entry->>'id' <> merged->>'id' and team_entry->>'date' = merged->>'date'
          and coalesce((team_entry->>'closed')::boolean, false) = false
          and exists(select 1 from jsonb_array_elements_text(team_entry->'members') member where merged->'members' ? member)
      ) and not allow_reassign then raise exception 'Employee already assigned'; end if;
      if allow_reassign then
        current_row.data := jsonb_set(current_row.data, '{teams}', coalesce((select jsonb_agg(
          case when team_entry->>'id' <> merged->>'id' and team_entry->>'date' = merged->>'date' and coalesce((team_entry->>'closed')::boolean, false) = false
            then jsonb_set(team_entry, '{members}', coalesce((select jsonb_agg(to_jsonb(member)) from jsonb_array_elements_text(team_entry->'members') member where not (merged->'members' ? member)), '[]'::jsonb))
            else team_entry end order by ordinality
        ) from jsonb_array_elements(current_row.data->'teams') with ordinality as teams(team_entry, ordinality)), '[]'::jsonb));
      end if;
    end if;
    current_row.data := jsonb_set(current_row.data, array[target, idx::text], merged);
  elsif kind = 'settings_patch' then
    for field_name in select jsonb_object_keys(item) loop
      if field_name not in ('fields','workTypes','jobGroups','archivedJobGroups') or jsonb_typeof(item->field_name) <> 'array'
        or (field_name in ('fields','workTypes') and jsonb_array_length(item->field_name) < 1) then raise exception 'Invalid setting'; end if;
      if not (expected ? field_name) or (current_row.data->field_name is distinct from expected->field_name and current_row.data->field_name is distinct from item->field_name)
        then raise exception 'This setting was changed by a colleague. Refresh before saving.' using errcode = '40001'; end if;
      current_row.data := jsonb_set(current_row.data, array[field_name], item->field_name);
    end loop;
  elsif kind = 'job_group_rename' then
    old_name := trim(coalesce(item->>'old','')); new_name := trim(coalesce(item->>'name',''));
    if current_row.data->'jobGroups' is distinct from expected->'jobGroups' then raise exception 'Employee groups changed on another device. Refresh before saving.' using errcode = '40001'; end if;
    if old_name = '' or new_name = '' or not (current_row.data->'jobGroups' ? old_name)
      or exists(select 1 from jsonb_array_elements_text((current_row.data->'jobGroups') || (current_row.data->'archivedJobGroups')) g where lower(g) = lower(new_name) and g <> old_name)
      then raise exception 'Invalid employee group'; end if;
    current_row.data := jsonb_set(current_row.data, '{jobGroups}', (select jsonb_agg(case when value = old_name then new_name else value end order by ordinality) from jsonb_array_elements_text(current_row.data->'jobGroups') with ordinality));
    current_row.data := jsonb_set(current_row.data, '{people}', coalesce((select jsonb_agg(case when person->>'jobGroup' = old_name then jsonb_set(person, '{jobGroup}', to_jsonb(new_name)) else person end order by ordinality) from jsonb_array_elements(current_row.data->'people') with ordinality as p(person, ordinality)), '[]'::jsonb));
  elsif kind = 'job_group_archive' then
    old_name := trim(coalesce(item->>'name',''));
    if current_row.data->'jobGroups' is distinct from expected->'jobGroups' or current_row.data->'archivedJobGroups' is distinct from expected->'archivedJobGroups'
      then raise exception 'Employee groups changed on another device. Refresh before saving.' using errcode = '40001'; end if;
    if old_name = '' or not (current_row.data->'jobGroups' ? old_name) then raise exception 'Invalid employee group'; end if;
    current_row.data := jsonb_set(current_row.data, '{jobGroups}', coalesce((select jsonb_agg(value order by ordinality) from jsonb_array_elements_text(current_row.data->'jobGroups') with ordinality where value <> old_name), '[]'::jsonb));
    current_row.data := jsonb_set(current_row.data, '{archivedJobGroups}', (current_row.data->'archivedJobGroups') || to_jsonb(old_name));
    current_row.data := jsonb_set(current_row.data, '{people}', coalesce((select jsonb_agg(case when person->>'jobGroup' = old_name then jsonb_set(person, '{jobGroup}', '""'::jsonb) else person end order by ordinality) from jsonb_array_elements(current_row.data->'people') with ordinality as p(person, ordinality)), '[]'::jsonb));
  elsif kind = 'job_group_restore' then
    old_name := trim(coalesce(item->>'name',''));
    if current_row.data->'jobGroups' is distinct from expected->'jobGroups' or current_row.data->'archivedJobGroups' is distinct from expected->'archivedJobGroups'
      then raise exception 'Employee groups changed on another device. Refresh before saving.' using errcode = '40001'; end if;
    if old_name = '' or not (current_row.data->'archivedJobGroups' ? old_name) then raise exception 'Invalid employee group'; end if;
    current_row.data := jsonb_set(current_row.data, '{archivedJobGroups}', coalesce((select jsonb_agg(value order by ordinality) from jsonb_array_elements_text(current_row.data->'archivedJobGroups') with ordinality where value <> old_name), '[]'::jsonb));
    current_row.data := jsonb_set(current_row.data, '{jobGroups}', (current_row.data->'jobGroups') || to_jsonb(old_name));
  else raise exception 'Unknown change';
  end if;
  update public.solar_shared set data = current_row.data, initialized = true, version = version + 1, updated_at = now()
  where id = 1 returning * into current_row;
  return current_row;
end; $$;
revoke all on function public.solar_change(text, jsonb, jsonb) from public, anon;
grant execute on function public.solar_change(text, jsonb, jsonb) to authenticated;
commit;
