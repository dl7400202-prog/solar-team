begin;

-- Keep the existing shared document and invitation-based RLS. Every function
-- runs with the caller's privileges; no service credentials or policy bypass.
create or replace function solar_private.plan_integer(value jsonb, minimum bigint default 0)
returns boolean language sql immutable security invoker set search_path = ''
as $function$
  select case when jsonb_typeof(value) = 'number'
    then (value::text)::numeric between minimum and 2147483647
      and trunc((value::text)::numeric) = (value::text)::numeric
    else false end;
$function$;

create or replace function solar_private.assert_panel_types(types jsonb)
returns void language plpgsql security invoker set search_path = ''
as $function$
declare panel_type jsonb;
begin
  if jsonb_typeof(types) is distinct from 'array' then raise exception 'Invalid panel types'; end if;
  if jsonb_array_length(types) <> 7 then raise exception 'Exactly seven panel type slots are required'; end if;
  for panel_type in select value from jsonb_array_elements(types) loop
    if jsonb_typeof(panel_type) is distinct from 'object'
      or coalesce(panel_type->>'id','') not in ('yellow','type-2','type-3','type-4','type-5','type-6','type-7')
      or jsonb_typeof(panel_type->'name') is distinct from 'string'
      or trim(panel_type->>'name') = '' or length(panel_type->>'name') > 120
      or jsonb_typeof(panel_type->'configured') is distinct from 'boolean'
      or jsonb_typeof(panel_type->'description') is distinct from 'string'
      or jsonb_typeof(panel_type->'currentClass') is distinct from 'string'
      or length(panel_type->>'description') > 160 or length(panel_type->>'currentClass') > 32
      or not (panel_type ? 'color') then raise exception 'Invalid panel type'; end if;
    if panel_type->'color' <> 'null'::jsonb and
      (jsonb_typeof(panel_type->'color') is distinct from 'string' or panel_type->>'color' !~ '^#[0-9a-fA-F]{6}$')
      then raise exception 'Panel type color must be a six-digit hex color'; end if;
    if (panel_type->>'configured')::boolean and
      (trim(panel_type->>'description') = '' or trim(panel_type->>'currentClass') = '' or panel_type->'color' = 'null'::jsonb)
      then raise exception 'A configured panel type requires Description, Current Class and color'; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(types) t group by t->>'id' having count(*) > 1)
    then raise exception 'Duplicate panel type slot'; end if;
  if exists(select 1 from jsonb_array_elements(types) t where (t->>'configured')::boolean
    group by lower(trim(t->>'description')), lower(trim(t->>'currentClass')) having count(*) > 1)
    then raise exception 'Description and Current Class already identify another panel type'; end if;
end;
$function$;

create or replace function solar_private.assert_row_plan(plan jsonb, workspace_data jsonb)
returns void language plpgsql security invoker set search_path = ''
as $function$
declare group_entry jsonb; damper jsonb; pallet jsonb; quantity_total bigint := 0; type_id text;
begin
  perform solar_private.assert_panel_types(workspace_data->'panelTypes');
  if jsonb_typeof(plan) is distinct from 'object'
    or not (plan ?& array['id','field','rowNumber','rowType','panelTypeId','panelCount','panelsKnown','panelGroups','dampersKnown','damperCount','dampers','slope','lowerBearingSide','motorAfterPanel','pallets','status','notes','source','revision'])
    or jsonb_typeof(plan->'id') is distinct from 'string'
    or length(trim(coalesce(plan->>'id',''))) not between 1 and 160
    or not solar_private.plan_integer(plan->'rowNumber', 0)
    or not solar_private.plan_integer(plan->'revision', 0)
    or jsonb_typeof(plan->'field') is distinct from 'string'
    or not (workspace_data->'fields' ? (plan->>'field'))
    or coalesce(plan->>'status','') not in ('verified','partial','needs_review')
    or jsonb_typeof(plan->'panelsKnown') is distinct from 'boolean'
    or jsonb_typeof(plan->'dampersKnown') is distinct from 'boolean'
    or jsonb_typeof(plan->'panelGroups') is distinct from 'array'
    or jsonb_typeof(plan->'dampers') is distinct from 'array'
    or jsonb_typeof(plan->'pallets') is distinct from 'array'
    then raise exception 'Invalid row installation plan'; end if;
  if jsonb_array_length(plan->'panelGroups') > 100 or jsonb_array_length(plan->'dampers') > 100
    or jsonb_array_length(plan->'pallets') > 100 then raise exception 'Use at most 100 items in each plan section'; end if;
  if plan->'panelCount' <> 'null'::jsonb and
    (not solar_private.plan_integer(plan->'panelCount', 0) or (plan->>'panelCount')::numeric > 10000)
    then raise exception 'Panel count must be a whole number up to 10000 or unknown'; end if;
  if plan->'damperCount' <> 'null'::jsonb and
    (not solar_private.plan_integer(plan->'damperCount', 0) or (plan->>'damperCount')::numeric > 100)
    then raise exception 'Damper count must be a whole number up to 100 or unknown'; end if;
  if plan->>'status' = 'verified' and (not (plan->>'panelsKnown')::boolean or not (plan->>'dampersKnown')::boolean)
    then raise exception 'Verified plans require both panel and damper information'; end if;
  if plan->>'status' = 'partial' and (plan->>'panelsKnown')::boolean and (plan->>'dampersKnown')::boolean
    then raise exception 'Complete plans should be verified or marked for review'; end if;
  if jsonb_typeof(plan->'panelTypeId') is distinct from 'string' or not exists(
    select 1 from jsonb_array_elements(workspace_data->'panelTypes') t where t->>'id' = plan->>'panelTypeId')
    then raise exception 'Select one of the seven panel type slots'; end if;
  if plan->>'status' = 'verified' and not exists(select 1 from jsonb_array_elements(workspace_data->'panelTypes') t
    where t->>'id' = plan->>'panelTypeId' and t->'configured' = 'true'::jsonb)
    then raise exception 'Verified plans require a configured default panel type'; end if;
  if (plan->>'panelsKnown')::boolean then
    if not solar_private.plan_integer(plan->'panelCount', 0)
      then raise exception 'Known panels require a count matching their ordered groups'; end if;
    for group_entry in select value from jsonb_array_elements(plan->'panelGroups') loop
      if jsonb_typeof(group_entry) is distinct from 'object'
        or not solar_private.plan_integer(group_entry->'quantity', 1) or (group_entry->>'quantity')::numeric > 10000
        or jsonb_typeof(group_entry->'sourceToken') is distinct from 'string' or length(group_entry->>'sourceToken') > 160
        or not (group_entry ? 'positiveSide')
        or (group_entry->'positiveSide' <> 'null'::jsonb and group_entry->>'positiveSide' not in ('N','S'))
        or (group_entry->'positiveSide' = 'null'::jsonb and plan->>'status' <> 'needs_review')
        then raise exception 'Invalid panel group or polarity'; end if;
      type_id := group_entry->>'typeId';
      if jsonb_typeof(group_entry->'typeId') is distinct from 'string' or not exists(
        select 1 from jsonb_array_elements(workspace_data->'panelTypes') t where t->>'id' = type_id)
        then raise exception 'Every panel group requires one of the seven panel type slots'; end if;
      if plan->>'status' <> 'needs_review' and not exists(select 1 from jsonb_array_elements(workspace_data->'panelTypes') t
        where t->>'id' = type_id and t->'configured' = 'true'::jsonb)
        then raise exception 'Confirmed panel groups require a configured panel type'; end if;
      quantity_total := quantity_total + (group_entry->>'quantity')::numeric::bigint;
    end loop;
    if quantity_total > 10000 or quantity_total <> (plan->>'panelCount')::numeric::bigint then raise exception 'Panel group quantities do not match the row count'; end if;
  elsif plan->'panelCount' <> 'null'::jsonb or jsonb_array_length(plan->'panelGroups') <> 0 then
    raise exception 'Unknown panels must retain a null count and no invented groups';
  end if;
  if (plan->>'dampersKnown')::boolean then
    if not solar_private.plan_integer(plan->'damperCount', 0)
      or (plan->>'damperCount')::numeric::integer <> jsonb_array_length(plan->'dampers')
      then raise exception 'Damper count does not match the positions'; end if;
    for damper in select value from jsonb_array_elements(plan->'dampers') loop
      if jsonb_typeof(damper) is distinct from 'object' or not solar_private.plan_integer(damper->'post', 1)
        or coalesce(damper->>'side','') not in ('E','W') then raise exception 'Invalid damper post or East/West side'; end if;
    end loop;
    if exists(select 1 from jsonb_array_elements(plan->'dampers') d
      group by d->'post', d->>'side' having count(*) > 1) then raise exception 'Duplicate damper position and side'; end if;
  elsif plan->'damperCount' <> 'null'::jsonb or jsonb_array_length(plan->'dampers') <> 0 then
    raise exception 'Unknown dampers must retain a null count and no invented positions';
  end if;
  if plan->'slope' <> 'null'::jsonb then
    if jsonb_typeof(plan->'slope') is distinct from 'number' then raise exception 'Inclination must be numeric or unknown'; end if;
    if (plan->>'slope')::numeric not between -90 and 90 then raise exception 'Inclination must be between -90 and 90 degrees'; end if;
  end if;
  if plan->'lowerBearingSide' <> 'null'::jsonb and
    (jsonb_typeof(plan->'lowerBearingSide') is distinct from 'string' or length(plan->>'lowerBearingSide') > 80)
    then raise exception 'Invalid lower bearing side'; end if;
  if plan->'motorAfterPanel' <> 'null'::jsonb then
    if not solar_private.plan_integer(plan->'motorAfterPanel', 1)
      or not (plan->>'panelsKnown')::boolean or (plan->>'motorAfterPanel')::numeric > (plan->>'panelCount')::numeric
      then raise exception 'Motor position requires a known panel position'; end if;
  end if;
  for pallet in select value from jsonb_array_elements(plan->'pallets') loop
    if jsonb_typeof(pallet) is distinct from 'object' or not solar_private.plan_integer(pallet->'panels', 1)
      or (pallet->>'panels')::numeric > 10000
      or not solar_private.plan_integer(pallet->'afterPanel', 1) or not solar_private.plan_integer(pallet->'adjacentRow', 0)
      or pallet->'adjacentRow' = plan->'rowNumber'
      or not (plan->>'panelsKnown')::boolean or (pallet->>'afterPanel')::numeric > (plan->>'panelCount')::numeric
      then raise exception 'Invalid pallet placement'; end if;
  end loop;
  if jsonb_typeof(plan->'notes') is distinct from 'string' or length(plan->>'notes') > 5000
    or jsonb_typeof(plan->'rowType') is distinct from 'string' or length(plan->>'rowType') > 40
    or jsonb_typeof(plan->'source') is distinct from 'object'
    or jsonb_typeof(plan->'source'->'panels') is distinct from 'string' or length(plan->'source'->>'panels') > 1000
    or jsonb_typeof(plan->'source'->'dampers') is distinct from 'string' or length(plan->'source'->>'dampers') > 1000
    then raise exception 'Invalid row plan details'; end if;
end;
$function$;

create or replace function solar_private.default_leader_snapshot(workspace_data jsonb)
returns jsonb language sql stable security invoker set search_path = ''
as $function$
  select coalesce((select jsonb_build_object('leaderId', p->>'id', 'leaderName', p->>'name')
    from jsonb_array_elements(workspace_data->'people') p
    where p->>'id' = workspace_data->>'defaultTeamLeaderId'
      and coalesce((p->>'active')::boolean, true) limit 1),
    jsonb_build_object('leaderId', null, 'leaderName', null));
$function$;

create or replace function public.solar_plan_change(kind text, item jsonb, expected jsonb default '{}'::jsonb)
returns public.solar_shared language plpgsql security invoker set search_path = ''
as $function$
declare
  current_row public.solar_shared; entries jsonb; history jsonb; incoming jsonb;
  plan jsonb; previous jsonb; idx integer; previous_revision jsonb; leader jsonb; leader_person jsonb;
begin
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

-- Amend the existing RPC at narrow, checked seams. Its validation, conflict
-- detection, measurements and assignment history stay in the existing body.
do $migration$
declare definition text; old_text text; new_text text;
begin
  select pg_get_functiondef('public.solar_change(text,jsonb,jsonb)'::regprocedure) into definition;
  definition := replace(definition, E'\r\n', E'\n');
  if position('solar_private.default_leader_snapshot' in definition) = 0 then
    old_text := $$if kind = 'initialize' then$$;
    new_text := $$if kind in ('add_team','team_patch') then item := item - 'leaderId' - 'leaderName'; end if;
  if kind = 'initialize' then$$;
    if position(old_text in definition) = 0 then raise exception 'solar_change initialization seam changed'; end if;
    definition := replace(definition, old_text, new_text);
    old_text := $$item := item || jsonb_build_object('number', next_number);$$;
    new_text := $$item := item || jsonb_build_object('number', next_number) || solar_private.default_leader_snapshot(current_row.data);$$;
    if position(old_text in definition) = 0 then raise exception 'solar_change team creation seam changed'; end if;
    definition := replace(definition, old_text, new_text);
    old_text := $$merged := entry || (item - 'id');$$;
    new_text := $$merged := entry || (item - 'id');
    if target = 'teams' and coalesce((entry->>'closed')::boolean, false) and not coalesce((merged->>'closed')::boolean, false) then
      merged := merged || solar_private.default_leader_snapshot(current_row.data);
    end if;
    if target = 'people' and merged->>'id' = current_row.data->>'defaultTeamLeaderId' and not coalesce((merged->>'active')::boolean, true) then
      raise exception 'Select another common team leader before archiving this employee';
    end if;$$;
    if position(old_text in definition) = 0 then raise exception 'solar_change patch seam changed'; end if;
    definition := replace(definition, old_text, new_text);
    execute definition;
  end if;
end;
$migration$;

revoke all on function solar_private.plan_integer(jsonb, bigint) from public, anon;
revoke all on function solar_private.assert_panel_types(jsonb) from public, anon;
revoke all on function solar_private.assert_row_plan(jsonb, jsonb) from public, anon;
revoke all on function solar_private.default_leader_snapshot(jsonb) from public, anon;
grant usage on schema solar_private to authenticated;
grant execute on function solar_private.plan_integer(jsonb, bigint), solar_private.assert_panel_types(jsonb),
  solar_private.assert_row_plan(jsonb, jsonb), solar_private.default_leader_snapshot(jsonb) to authenticated;
revoke all on function public.solar_plan_change(text, jsonb, jsonb) from public, anon;
grant execute on function public.solar_plan_change(text, jsonb, jsonb) to authenticated;
-- CREATE OR REPLACE above preserves the legacy function's existing ACL.
notify pgrst, 'reload schema';
commit;
