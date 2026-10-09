-- Existing workspace members retain edit access; viewers may read but never write.
alter table public.solar_members add column access_role text not null default 'editor' check (access_role in ('editor','viewer'));

create or replace function solar_private.can_edit()
returns boolean language sql stable security definer set search_path=''
as $function$
  select auth.uid() is not null and exists (
    select 1 from public.solar_members m
    join auth.users u on lower(u.email)=m.email
    where u.id=auth.uid() and u.email_confirmed_at is not null and m.access_role='editor'
  );
$function$;
revoke all on function solar_private.can_edit() from public, anon;
grant execute on function solar_private.can_edit() to authenticated, service_role;

create or replace function public.solar_access()
returns text language sql stable security invoker set search_path=''
as $function$
  select case when solar_private.can_edit() then 'editor'
    when solar_private.is_member() then 'viewer' else null end;
$function$;
revoke all on function public.solar_access() from public, anon;
grant execute on function public.solar_access() to authenticated, service_role;

alter policy shared_write on public.solar_shared
  using ((select solar_private.can_edit())) with check ((select solar_private.can_edit()));
alter policy members_invite on public.solar_members
  with check ((select solar_private.can_edit()));
alter policy solar_employee_photos_insert on storage.objects
  with check (bucket_id='employee-photos' and (select solar_private.can_edit()));
alter policy solar_employee_photos_update on storage.objects
  using (bucket_id='employee-photos' and (select solar_private.can_edit()))
  with check (bucket_id='employee-photos' and (select solar_private.can_edit()));
alter policy solar_employee_photos_delete on storage.objects
  using (bucket_id='employee-photos' and (select solar_private.can_edit()));

CREATE OR REPLACE FUNCTION public.solar_change(kind text, item jsonb, expected jsonb DEFAULT '{}'::jsonb)
 RETURNS solar_shared
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  current_row public.solar_shared; entries jsonb; entry jsonb; target text; idx integer;
  next_number integer; field_name text; merged jsonb; old_name text; new_name text;
  allow_reassign boolean := false;
begin
  if current_user not in ('postgres','service_role') and not solar_private.can_edit() then
    raise exception 'This account has read-only access' using errcode='42501';
  end if;
  select * into current_row from public.solar_shared where id = 1 for update;
  if not found then raise exception 'Access to Solar Team is by invitation only' using errcode = '42501'; end if;
  if kind in ('add_team','team_patch') then item := item - 'leaderId' - 'leaderName'; end if;
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
        or length(coalesce(item->>'photoPath','')) > 500 or (coalesce(item->>'birthDate','') <> '' and (item->>'birthDate' !~ '^\d{4}-\d{2}-\d{2}$' or (item->>'birthDate')::date > current_date))
        or (coalesce(item->>'jobGroup','') <> '' and not (current_row.data->'jobGroups' ? (item->>'jobGroup'))) then raise exception 'Invalid person'; end if;
    else
      allow_reassign := coalesce((item->>'reassign')::boolean, false);
      item := item - 'reassign';
      if jsonb_typeof(item->'members') <> 'array' or jsonb_array_length(item->'members') < 1
        or jsonb_typeof(coalesce(item->'memberRoles','{}'::jsonb)) <> 'object'
        or exists(select 1 from jsonb_object_keys(coalesce(item->'memberRoles','{}'::jsonb)) role_id where not (item->'members' ? role_id))
        or coalesce(item->>'unit', coalesce(current_row.data->'workUnits'->>(item->>'work'), 'rows')) is distinct from coalesce(current_row.data->'workUnits'->>(item->>'work'), 'rows')
        or not solar_private.valid_work_measurement(item, coalesce(item->>'unit', coalesce(current_row.data->'workUnits'->>(item->>'work'), 'rows'))) then raise exception 'Invalid team'; end if;
      select coalesce(max((e->>'number')::int), 0) + 1 into next_number from jsonb_array_elements(entries) e where e->>'date' = item->>'date';
      item := item || jsonb_build_object('number', next_number) || solar_private.default_leader_snapshot(current_row.data);
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
    if kind = 'add_team' then
      current_row.data := jsonb_set(current_row.data, '{assignmentHistory}', solar_private.sync_assignment_history(current_row.data->'assignmentHistory', null, item, allow_reassign), true);
    end if;
    current_row.data := jsonb_set(current_row.data, array[target], entries || jsonb_build_array(item));
  elsif kind in ('person_patch', 'team_patch') then
    target := case when kind = 'person_patch' then 'people' else 'teams' end;
    if kind = 'team_patch' then allow_reassign := coalesce((item->>'reassign')::boolean, false); item := item - 'reassign'; end if;
    select (ordinality - 1)::int, value into idx, entry from jsonb_array_elements(current_row.data->target) with ordinality where value->>'id' = item->>'id';
    if idx is null then raise exception 'Record no longer exists'; end if;
    for field_name in select jsonb_object_keys(item - 'id') loop
      if (target = 'people' and field_name not in ('name','role','jobGroup','photoPath','birthDate','availability','active'))
        or (target = 'teams' and field_name not in ('date','members','memberRoles','field','work','from','to','status','note','closed','issueResolved','quantity','unit')) then raise exception 'Invalid field'; end if;
      if not (expected ? field_name) or (entry->field_name is distinct from expected->field_name and entry->field_name is distinct from item->field_name)
        then raise exception 'This record was changed by a colleague. Refresh before saving.' using errcode = '40001'; end if;
    end loop;
    merged := entry || (item - 'id');
    if target = 'teams' and coalesce((entry->>'closed')::boolean, false) and not coalesce((merged->>'closed')::boolean, false) then
      merged := merged || solar_private.default_leader_snapshot(current_row.data);
    end if;
    if target = 'people' and merged->>'id' = current_row.data->>'defaultTeamLeaderId' and not coalesce((merged->>'active')::boolean, true) then
      raise exception 'Select another common team leader before archiving this employee';
    end if;
    if target = 'people' and (length(trim(coalesce(merged->>'name',''))) = 0 or length(trim(coalesce(merged->>'role',''))) = 0
      or length(coalesce(merged->>'photoPath','')) > 500 or (coalesce(merged->>'birthDate','') <> '' and (merged->>'birthDate' !~ '^\d{4}-\d{2}-\d{2}$' or (merged->>'birthDate')::date > current_date))
      or (coalesce(merged->>'jobGroup','') <> '' and not (current_row.data->'jobGroups' ? (merged->>'jobGroup')))) then raise exception 'Invalid person'; end if;
    if target = 'teams' and (jsonb_typeof(merged->'members') <> 'array' or jsonb_array_length(merged->'members') < 1
      or jsonb_typeof(coalesce(merged->'memberRoles','{}'::jsonb)) <> 'object'
      or exists(select 1 from jsonb_object_keys(coalesce(merged->'memberRoles','{}'::jsonb)) role_id where not (merged->'members' ? role_id))
      or not solar_private.valid_work_measurement(merged, coalesce(merged->>'unit', current_row.data->'workUnits'->>(merged->>'work'), 'rows'))) then raise exception 'Invalid team'; end if;
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
    if target = 'teams' then
      current_row.data := jsonb_set(current_row.data, '{assignmentHistory}', solar_private.sync_assignment_history(current_row.data->'assignmentHistory', entry, merged, allow_reassign), true);
    end if;
    current_row.data := jsonb_set(current_row.data, array[target, idx::text], merged);
  elsif kind = 'settings_patch' then
    for field_name in select jsonb_object_keys(item) loop
      if (field_name = 'workUnits' and (jsonb_typeof(item->field_name) <> 'object'
          or exists(select 1 from jsonb_each_text(item->field_name) unit where length(trim(unit.value)) < 1 or length(unit.value) > 24)))
        or (field_name <> 'workUnits' and (field_name not in ('fields','workTypes','jobGroups','archivedJobGroups') or jsonb_typeof(item->field_name) <> 'array'
          or (field_name in ('fields','workTypes') and jsonb_array_length(item->field_name) < 1))) then raise exception 'Invalid setting'; end if;
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
end; $function$;


CREATE OR REPLACE FUNCTION public.solar_plan_change(kind text, item jsonb, expected jsonb DEFAULT '{}'::jsonb)
 RETURNS solar_shared
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  current_row public.solar_shared; entries jsonb; history jsonb; incoming jsonb;
  plan jsonb; previous jsonb; idx integer; previous_revision jsonb; leader jsonb; leader_person jsonb;
begin
  if current_user not in ('postgres','service_role') and not solar_private.can_edit() then
    raise exception 'This account has read-only access' using errcode='42501';
  end if;
  select * into current_row from public.solar_shared where id = 1 for update;
  if not found then raise exception 'Access to Solar Team is by invitation only' using errcode = '42501'; end if;
  if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(expected) is distinct from 'object'
    then raise exception 'Invalid change payload'; end if;
  if kind in ('row_plan_save','row_plan_import') then
    entries := coalesce(current_row.data->'rowPlans', '[]'::jsonb);
    history := coalesce(current_row.data->'rowPlanHistory', '[]'::jsonb);
    if kind = 'row_plan_save' then
      incoming := jsonb_build_array(item);
      if not (expected ? 'revision') then raise exception 'Expected row plan revision required'; end if;
    else
      incoming := item->'plans';
      if jsonb_typeof(incoming) is distinct from 'array' or jsonb_typeof(expected->'revisions') is distinct from 'object'
        then raise exception 'Import requires plans and expected revisions'; end if;
      if jsonb_array_length(incoming) = 0 then raise exception 'Import contains no row plans'; end if;
    end if;
    -- Validate the whole import before any shared write. A row lock serializes
    -- mutations; each expected revision also rejects edits from stale devices.
    for plan in select value from jsonb_array_elements(incoming) loop
      perform solar_private.assert_row_plan(plan, current_row.data);
      if exists(select 1 from jsonb_array_elements(incoming) p where p <> plan and
        (p->>'id' = plan->>'id' or (p->>'field' = plan->>'field' and p->'rowNumber' = plan->'rowNumber')))
        or (select count(*) from jsonb_array_elements(incoming) p where p->>'id' = plan->>'id') > 1
        then raise exception 'Import contains duplicate row plans'; end if;
      idx := null; previous := null;
      select (ordinality - 1)::integer, value into idx, previous
        from jsonb_array_elements(entries) with ordinality where value->>'id' = plan->>'id';
      if kind = 'row_plan_save' then previous_revision := expected->'revision';
      else
        if not (expected->'revisions' ? (plan->>'id')) then raise exception 'Expected imported row plan revision required'; end if;
        previous_revision := expected->'revisions'->(plan->>'id');
      end if;
      if previous_revision is distinct from coalesce(previous->'revision', 'null'::jsonb)
        then raise exception 'This row plan was changed by a colleague. Refresh before saving.' using errcode = '40001'; end if;
      if exists(select 1 from jsonb_array_elements(entries) p where p->>'id' <> plan->>'id'
        and p->>'field' = plan->>'field' and p->'rowNumber' = plan->'rowNumber')
        then raise exception 'An installation plan already exists for this field and row'; end if;
    end loop;
    for plan in select value from jsonb_array_elements(incoming) loop
      idx := null; previous := null;
      select (ordinality - 1)::integer, value into idx, previous
        from jsonb_array_elements(entries) with ordinality where value->>'id' = plan->>'id';
      plan := (plan - 'revision') || jsonb_build_object('revision', coalesce((previous->>'revision')::integer, 0) + 1);
      if idx is null then entries := entries || jsonb_build_array(plan);
      else
        history := history || jsonb_build_array(previous || jsonb_build_object('archivedAt', now(), 'archivedBy', auth.uid()));
        entries := jsonb_set(entries, array[idx::text], plan);
      end if;
    end loop;
    current_row.data := jsonb_set(jsonb_set(current_row.data, '{rowPlans}', entries, true), '{rowPlanHistory}', history, true);
  elsif kind = 'panel_type_save' then
    entries := current_row.data->'panelTypes'; idx := null; previous := null;
    select (ordinality - 1)::integer, value into idx, previous
      from jsonb_array_elements(entries) with ordinality where value->>'id' = item->>'id';
    if idx is null then raise exception 'Select an existing panel type slot'; end if;
    if not (expected ? 'previous') or previous is distinct from expected->'previous'
      then raise exception 'This panel type was changed by a colleague. Refresh before saving.' using errcode = '40001'; end if;
    entries := jsonb_set(entries, array[idx::text], item);
    perform solar_private.assert_panel_types(entries);
    if item->'configured' = 'false'::jsonb and exists(
      select 1 from jsonb_array_elements(coalesce(current_row.data->'rowPlans','[]'::jsonb)) p
      where p->>'status' <> 'needs_review' and (p->>'panelTypeId' = item->>'id' or exists(
        select 1 from jsonb_array_elements(p->'panelGroups') g where g->>'typeId' = item->>'id')))
      then raise exception 'Mark every affected plan for review before unconfiguring this panel type'; end if;
    current_row.data := jsonb_set(current_row.data, '{panelTypes}', entries, true);
    -- Unconfigured markings are allowed only where uncertainty is explicit.
    for plan in select value from jsonb_array_elements(coalesce(current_row.data->'rowPlans','[]'::jsonb)) loop
      perform solar_private.assert_row_plan(plan, current_row.data);
    end loop;
  elsif kind = 'default_leader_save' then
    if not (expected ? 'employeeId') or coalesce(current_row.data->'defaultTeamLeaderId', 'null'::jsonb) is distinct from expected->'employeeId'
      then raise exception 'The common team leader was changed by a colleague. Refresh before saving.' using errcode = '40001'; end if;
    select value into leader_person from jsonb_array_elements(current_row.data->'people')
      where value->>'id' = item->>'employeeId' and coalesce((value->>'active')::boolean, true);
    if leader_person is null then raise exception 'Select an active employee as the common team leader'; end if;
    current_row.data := jsonb_set(current_row.data, '{defaultTeamLeaderId}', to_jsonb(leader_person->>'id'), true);
    leader := solar_private.default_leader_snapshot(current_row.data);
    current_row.data := jsonb_set(current_row.data, '{teams}', coalesce((select jsonb_agg(
      case when coalesce((t->>'closed')::boolean, false) then t else t || leader end order by ordinality)
      from jsonb_array_elements(current_row.data->'teams') with ordinality as teams(t, ordinality)), '[]'::jsonb));
  else raise exception 'Unknown row plan change';
  end if;
  update public.solar_shared set data = current_row.data, initialized = true, version = version + 1, updated_at = now()
    where id = 1 returning * into current_row;
  if not found then raise exception 'Access to Solar Team is by invitation only' using errcode = '42501'; end if;
  return current_row;
end;
$function$;

