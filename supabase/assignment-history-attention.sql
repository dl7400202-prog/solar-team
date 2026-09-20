-- Apply once in the Supabase SQL Editor after the existing shared-data,
-- people/groups/photos, and birthdays upgrades. This backfills intervals
-- without fabricating historical timestamps and updates the shared RPC.
begin;

-- Preserve all existing team members as historical assignments without
-- inventing times that were never recorded. Active teams are backfilled too,
-- so the first later transfer can close the correct interval.
update public.solar_shared as shared
set data = jsonb_set(
  jsonb_set(
    shared.data,
    '{teams}',
    coalesce((
      select jsonb_agg(
        case when team ? 'issueResolved' then team else team || '{"issueResolved":false}'::jsonb end
        order by ordinality
      )
      from jsonb_array_elements(coalesce(shared.data->'teams', '[]'::jsonb)) with ordinality as t(team, ordinality)
    ), '[]'::jsonb),
    true
  ),
  '{assignmentHistory}',
  coalesce(
    shared.data->'assignmentHistory',
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', 'legacy:' || (team->>'id') || ':' || member,
        'employeeId', member,
        'teamId', team->>'id',
        'teamNumber', team->'number',
        'date', team->>'date',
        'field', team->>'field',
        'work', team->>'work',
        'from', team->'from',
        'startedAt', null,
        'endedAt', null,
        'endReason', 'LEGACY',
        'active', not coalesce((team->>'closed')::boolean, false),
        'legacy', true
      ))
      from jsonb_array_elements(coalesce(shared.data->'teams', '[]'::jsonb)) as teams(team)
      cross join lateral jsonb_array_elements_text(coalesce(team->'members', '[]'::jsonb)) as members(member)
    ), '[]'::jsonb)
  ),
  true
), version = version + 1, updated_at = now()
where shared.id = 1
  and (
    not (shared.data ? 'assignmentHistory')
    or exists (
      select 1 from jsonb_array_elements(coalesce(shared.data->'teams', '[]'::jsonb)) t(team)
      where not (team ? 'issueResolved')
    )
  );

-- Assignment intervals remain in the shared JSON document and are updated by
-- the same row-locked RPC as teams. This keeps moves atomic for all accounts.
create or replace function solar_private.sync_assignment_history(
  history jsonb,
  previous_team jsonb,
  next_team jsonb,
  allow_reassign boolean
)
returns jsonb
language sql volatile security invoker set search_path = '' as $$
  with closed_or_updated as (
    select coalesce(jsonb_agg(
      case
        when coalesce((event->>'active')::boolean, false) and (
          (
            previous_team is not null
            and event->>'teamId' = previous_team->>'id'
            and (
              coalesce((next_team->>'closed')::boolean, false)
              or event->>'date' is distinct from next_team->>'date'
              or not (coalesce(next_team->'members', '[]'::jsonb) ? (event->>'employeeId'))
            )
          )
          or (
            (previous_team is null or allow_reassign)
            and event->>'teamId' is distinct from next_team->>'id'
            and coalesce(next_team->'members', '[]'::jsonb) ? (event->>'employeeId')
          )
        ) then event || jsonb_build_object(
          'active', false,
          'endedAt', clock_timestamp(),
          'endReason', case
            when event->>'teamId' is distinct from next_team->>'id' then 'TRANSFERRED'
            when coalesce((next_team->>'closed')::boolean, false) then 'TEAM_CLOSED'
            else 'REMOVED'
          end
        )
        when coalesce((event->>'active')::boolean, false)
          and event->>'teamId' = next_team->>'id'
          and not coalesce((next_team->>'closed')::boolean, false)
          and event->>'date' = next_team->>'date'
          and coalesce(next_team->'members', '[]'::jsonb) ? (event->>'employeeId')
        then event || jsonb_build_object(
          'teamNumber', next_team->'number',
          'field', next_team->'field',
          'work', next_team->'work',
          'from', next_team->'from'
        )
        else event
      end order by ordinality
    ), '[]'::jsonb) as events
    from jsonb_array_elements(coalesce(history, '[]'::jsonb)) with ordinality as h(event, ordinality)
  ),
  newly_assigned as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', gen_random_uuid()::text,
      'employeeId', member,
      'teamId', next_team->>'id',
      'teamNumber', next_team->'number',
      'date', next_team->>'date',
      'field', next_team->'field',
      'work', next_team->'work',
      'from', next_team->'from',
      'startedAt', clock_timestamp(),
      'endedAt', null,
      'endReason', null,
      'active', true
    )), '[]'::jsonb) as events
    from jsonb_array_elements_text(coalesce(next_team->'members', '[]'::jsonb)) as members(member)
    cross join closed_or_updated
    where not coalesce((next_team->>'closed')::boolean, false)
      and not exists (
        select 1
        from jsonb_array_elements(closed_or_updated.events) as h(event)
        where coalesce((event->>'active')::boolean, false)
          and event->>'teamId' = next_team->>'id'
          and event->>'employeeId' = member
          and event->>'date' = next_team->>'date'
      )
  )
  select closed_or_updated.events || newly_assigned.events
  from closed_or_updated, newly_assigned;
$$;
revoke all on function solar_private.sync_assignment_history(jsonb, jsonb, jsonb, boolean) from public, anon;
grant execute on function solar_private.sync_assignment_history(jsonb, jsonb, jsonb, boolean) to authenticated;

do $migration$
declare
  definition text;
  previous text;
begin
  select pg_get_functiondef('public.solar_change(text,jsonb,jsonb)'::regprocedure) into definition;
  previous := definition;

  definition := replace(
    definition,
    $$if (target = 'people' and field_name not in ('name','role','jobGroup','photoPath','birthDate','availability','active'))
        or (target = 'teams' and field_name not in ('date','members','field','work','from','to','status','note','closed')) then raise exception 'Invalid field'; end if;$$,
    $$if (target = 'people' and field_name not in ('name','role','jobGroup','photoPath','birthDate','availability','active'))
        or (target = 'teams' and field_name not in ('date','members','field','work','from','to','status','note','closed','issueResolved')) then raise exception 'Invalid field'; end if;$$
  );
  definition := replace(
    definition,
    $$    current_row.data := jsonb_set(current_row.data, array[target], entries || jsonb_build_array(item));$$,
    $$    if kind = 'add_team' then
      current_row.data := jsonb_set(current_row.data, '{assignmentHistory}', solar_private.sync_assignment_history(current_row.data->'assignmentHistory', null, item, allow_reassign), true);
    end if;
    current_row.data := jsonb_set(current_row.data, array[target], entries || jsonb_build_array(item));$$
  );
  definition := replace(
    definition,
    $$    current_row.data := jsonb_set(current_row.data, array[target, idx::text], merged);$$,
    $$    if target = 'teams' then
      current_row.data := jsonb_set(current_row.data, '{assignmentHistory}', solar_private.sync_assignment_history(current_row.data->'assignmentHistory', entry, merged, allow_reassign), true);
    end if;
    current_row.data := jsonb_set(current_row.data, array[target, idx::text], merged);$$
  );

  if definition = previous
    or position('solar_private.sync_assignment_history(current_row.data->''assignmentHistory'', null, item, allow_reassign)' in definition) = 0
    or position('solar_private.sync_assignment_history(current_row.data->''assignmentHistory'', entry, merged, allow_reassign)' in definition) = 0
    or position('issueResolved' in definition) = 0 then
    raise exception 'solar_change definition did not match the expected birthday/group/photo revision';
  end if;
  execute definition;
end $migration$;

revoke all on function public.solar_change(text, jsonb, jsonb) from public, anon;
grant execute on function public.solar_change(text, jsonb, jsonb) to authenticated;
commit;
