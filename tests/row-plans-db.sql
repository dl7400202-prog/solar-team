-- Run after row-plans-upgrade.sql as an administrative SQL connection.
-- All fixture writes, versions and history additions are rolled back.
begin;

do $test$
begin
  if has_function_privilege('anon','public.solar_plan_change(text,jsonb,jsonb)','EXECUTE')
    or not has_function_privilege('authenticated','public.solar_plan_change(text,jsonb,jsonb)','EXECUTE')
    then raise exception 'FAIL: RPC grants'; end if;
  if (select prosecdef from pg_proc where oid = 'public.solar_plan_change(text,jsonb,jsonb)'::regprocedure)
    then raise exception 'FAIL: RPC must use SECURITY INVOKER'; end if;
end;
$test$;

-- Exercise the real invitation predicate without displaying account details.
select set_config('solar_test.authorized_uid', (select u.id::text
  from public.solar_members m join auth.users u on lower(u.email) = m.email
  where u.email_confirmed_at is not null order by u.id limit 1), true);
do $test$
begin
  if coalesce(current_setting('solar_test.authorized_uid',true),'') = ''
    then raise exception 'FAIL: no confirmed invited test account'; end if;
end;
$test$;

set local role anon;
do $test$
begin
  begin
    perform public.solar_plan_change('row_plan_save','{}'::jsonb,'{}'::jsonb);
    raise exception 'FAIL: anonymous RPC call was allowed';
  exception when insufficient_privilege then null;
  end;
end;
$test$;
reset role;

select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
select set_config('request.jwt.claims', jsonb_build_object('sub',current_setting('request.jwt.claim.sub'),'role','authenticated')::text,true);
set local role authenticated;
do $test$
begin
  if exists(select 1 from public.solar_shared where id = 1) then raise exception 'FAIL: uninvited RLS read'; end if;
  begin
    perform public.solar_plan_change('row_plan_save','{}'::jsonb,'{}'::jsonb);
    raise exception 'FAIL: uninvited RPC call was allowed';
  exception when insufficient_privilege then null;
  end;
end;
$test$;
reset role;

-- Deterministic fixture, preserving the actual invitation table and people.
do $test$
declare shared public.solar_shared; active_people jsonb; panel_types jsonb; person_a text; person_c text;
begin
  select * into shared from public.solar_shared where id = 1 for update;
  select jsonb_agg(p order by ordinality) into active_people
    from jsonb_array_elements(shared.data->'people') with ordinality as people(p,ordinality)
    where coalesce((p->>'active')::boolean,true);
  if jsonb_array_length(active_people) < 3 then raise exception 'FAIL: fixture needs three active people'; end if;
  person_a := active_people->0->>'id'; person_c := active_people->2->>'id';
  panel_types := '[{"id":"yellow","name":"Yellow","color":"#f3cf35","description":"LR8-66HYD-650M","currentClass":"H","configured":true}]'::jsonb
    || (select jsonb_agg(jsonb_build_object('id','type-' || n,'name','Type ' || n,'color',null,'description','','currentClass','','configured',false)) from generate_series(2,7) n);
  update public.solar_shared set data = shared.data || jsonb_build_object(
    'fields',jsonb_build_array('North','South'),'panelTypes',panel_types,
    'workUnits',coalesce(shared.data->'workUnits','{}'::jsonb) || '{"Truck unloading":"trucks"}'::jsonb,
    'rowPlans','[]'::jsonb,'rowPlanHistory','[]'::jsonb,'defaultTeamLeaderId',null,'assignmentHistory','[]'::jsonb,
    'people',(shared.data->'people') || '[{"id":"fixture-inactive","name":"Inactive test employee","role":"Mechanic","active":false}]'::jsonb,
    'teams',jsonb_build_array(
      jsonb_build_object('id','fixture-open','number',1,'date','2020-01-01','field','South','work','Solar panel installation',
        'from',100,'to',null,'unit','rows','members',jsonb_build_array(person_c),'memberRoles','{}'::jsonb,'closed',false,'status','NOT_STARTED'),
      jsonb_build_object('id','fixture-closed','number',2,'date','2020-01-01','field','South','work','Solar panel installation',
        'from',101,'to',101,'unit','rows','members',jsonb_build_array(person_a),'memberRoles','{}'::jsonb,'closed',true,'status','COMPLETED',
        'leaderId','historical-leader','leaderName','Historical leader'))
  ) where id = 1;
end;
$test$;

select set_config('request.jwt.claim.sub', current_setting('solar_test.authorized_uid'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub',current_setting('solar_test.authorized_uid'),'role','authenticated')::text,true);
set local role authenticated;

do $test$
declare
  shared public.solar_shared; baseline_teams jsonb; plan jsonb; stored jsonb; other_plan jsonb;
  previous_type jsonb; changed_type jsonb; first_leader text; second_leader text; person_a text; person_c text;
  before_version bigint; before_count integer;
begin
  select * into shared from public.solar_shared where id = 1;
  if not found then raise exception 'FAIL: invited RLS read'; end if;
  baseline_teams := shared.data->'teams';
  plan := '{"id":"fixture-plan","field":"South","rowNumber":900001,"rowType":"A","panelTypeId":"yellow","panelCount":100,"panelsKnown":true,"panelGroups":[{"quantity":25,"positiveSide":"S","typeId":"yellow"},{"quantity":25,"positiveSide":"S","typeId":"yellow"},{"quantity":25,"positiveSide":"N","typeId":"yellow"},{"quantity":25,"positiveSide":"N","typeId":"yellow"}],"dampersKnown":true,"damperCount":4,"dampers":[{"post":2,"side":"E"},{"post":4,"side":"W"},{"post":12,"side":"E"},{"post":13,"side":"W"}],"slope":0.01,"lowerBearingSide":null,"motorAfterPanel":null,"pallets":[],"status":"verified","notes":"Original","source":{}}'::jsonb;
  plan := plan || '{"revision":0,"source":{"panels":"Panel fixture","dampers":"Damper fixture"}}'::jsonb;
  plan := jsonb_set(plan,'{panelGroups}',(select jsonb_agg(g || '{"sourceToken":"650H"}'::jsonb order by ordinality)
    from jsonb_array_elements(plan->'panelGroups') with ordinality as groups(g,ordinality)));
  shared := public.solar_plan_change('row_plan_save',plan,'{"revision":null}'::jsonb);
  stored := shared.data->'rowPlans'->0;
  if stored->>'revision' <> '1' or stored->'panelGroups' is distinct from plan->'panelGroups'
    or stored->'dampers' is distinct from plan->'dampers' then raise exception 'FAIL: ordered groups / damper positions / initial revision'; end if;
  plan := plan || '{"notes":"Changed","revision":999}'::jsonb;
  shared := public.solar_plan_change('row_plan_save',plan,'{"revision":1}'::jsonb);
  if shared.data->'rowPlans'->0->>'revision' <> '2' or jsonb_array_length(shared.data->'rowPlanHistory') <> 1
    or shared.data->'rowPlanHistory'->0->>'notes' <> 'Original' then raise exception 'FAIL: revision or previous snapshot'; end if;
  begin
    perform public.solar_plan_change('row_plan_save',plan,'{"revision":1}'::jsonb);
    raise exception 'FAIL: stale concurrent editor was accepted';
  exception when serialization_failure then null;
  end;
  before_version := shared.version;
  begin
    perform public.solar_plan_change('row_plan_save',plan || '{"panelCount":75}'::jsonb,'{"revision":2}'::jsonb);
    raise exception 'FAIL: group/count mismatch was accepted';
  exception when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  begin
    perform public.solar_plan_change('row_plan_save',jsonb_set(plan,'{panelGroups,0,positiveSide}','null'::jsonb),' {"revision":2}'::jsonb);
    raise exception 'FAIL: unknown polarity was verified';
  exception when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  begin
    perform public.solar_plan_change('row_plan_save',plan || '{"field":"Unknown"}'::jsonb,'{"revision":2}'::jsonb);
    raise exception 'FAIL: unknown field was accepted';
  exception when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  begin
    perform public.solar_plan_change('row_plan_save',jsonb_set(plan,'{dampers,0,side}','"N"'::jsonb),' {"revision":2}'::jsonb);
    raise exception 'FAIL: North was accepted as a damper side';
  exception when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  begin
    perform public.solar_plan_change('row_plan_save',plan || '{"status":null}'::jsonb,'{"revision":2}'::jsonb);
    raise exception 'FAIL: null status was accepted';
  exception when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  if (select version from public.solar_shared where id = 1) <> before_version then raise exception 'FAIL: rejected edits changed shared version'; end if;
  plan := jsonb_set(plan,'{panelGroups,0,positiveSide}','null'::jsonb) || '{"status":"needs_review"}'::jsonb;
  shared := public.solar_plan_change('row_plan_save',plan,'{"revision":2}'::jsonb);
  if shared.data->'rowPlans'->0->'panelGroups'->0->'positiveSide' <> 'null'::jsonb then raise exception 'FAIL: review ambiguity was invented'; end if;
  other_plan := plan || '{"id":"fixture-partial","rowNumber":900002,"panelsKnown":false,"panelCount":null,"panelGroups":[],"status":"partial"}'::jsonb;
  shared := public.solar_plan_change('row_plan_save',other_plan,'{"revision":null}'::jsonb);
  if shared.data->'rowPlans'->1->'panelCount' <> 'null'::jsonb or shared.data->'rowPlans'->1->>'damperCount' <> '4'
    then raise exception 'FAIL: partial plan invented unknown panels'; end if;
  begin
    perform public.solar_plan_change('row_plan_save',other_plan || '{"panelCount":0}'::jsonb,'{"revision":1}'::jsonb);
    raise exception 'FAIL: zero substituted for unknown panels';
  exception when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  begin
    perform public.solar_plan_change('row_plan_save',other_plan || '{"status":"verified"}'::jsonb,'{"revision":1}'::jsonb);
    raise exception 'FAIL: partial plan labeled verified';
  exception when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  begin
    perform public.solar_plan_change('row_plan_save',plan || '{"id":"fixture-duplicate"}'::jsonb,'{"revision":null}'::jsonb);
    raise exception 'FAIL: duplicate field/row accepted';
  exception when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  before_version := shared.version; before_count := jsonb_array_length(shared.data->'rowPlans');
  begin
    perform public.solar_plan_change('row_plan_import',jsonb_build_object('plans',jsonb_build_array(
      other_plan || '{"id":"fixture-import-a","rowNumber":900003}'::jsonb,
      other_plan || '{"id":"fixture-import-b","rowNumber":900004,"damperCount":3}'::jsonb)),
      '{"revisions":{"fixture-import-a":null,"fixture-import-b":null}}'::jsonb);
    raise exception 'FAIL: invalid import accepted';
  exception when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  select * into shared from public.solar_shared where id = 1;
  if shared.version <> before_version or jsonb_array_length(shared.data->'rowPlans') <> before_count
    then raise exception 'FAIL: import partially applied'; end if;
  shared := public.solar_plan_change('row_plan_import',jsonb_build_object('plans',jsonb_build_array(
    other_plan || '{"id":"fixture-import-a","rowNumber":900003,"damperCount":3,"dampers":[{"post":2,"side":"E"},{"post":4,"side":"W"},{"post":9,"side":"E"}]}'::jsonb,
    other_plan || '{"id":"fixture-import-b","rowNumber":900004,"damperCount":2,"dampers":[{"post":1,"side":"E"},{"post":3,"side":"W"}]}'::jsonb)),
    '{"revisions":{"fixture-import-a":null,"fixture-import-b":null}}'::jsonb);
  if jsonb_array_length(shared.data->'rowPlans') <> before_count + 2
    or shared.data->'rowPlans'->2->>'damperCount' <> '3' or shared.data->'rowPlans'->3->>'damperCount' <> '2'
    then raise exception 'FAIL: valid import or variable damper counts'; end if;
  if shared.data->'teams' is distinct from baseline_teams then raise exception 'FAIL: installation plan altered recorded work'; end if;

  -- Boundary checks use the same public RPC as constructor and JSON import.
  for stored in select value from jsonb_array_elements(jsonb_build_array(
    plan || jsonb_build_object('id',repeat('x',161)), plan || '{"rowNumber":-1}'::jsonb,
    plan || '{"revision":-1}'::jsonb, plan || '{"slope":91}'::jsonb,
    plan || '{"motorAfterPanel":0}'::jsonb, plan || '{"panelTypeId":null}'::jsonb,
    plan || jsonb_build_object('rowType',repeat('x',41)), plan || jsonb_build_object('notes',repeat('x',5001)),
    jsonb_set(plan,'{source,panels}',to_jsonb(repeat('x',1001))),
    jsonb_set(plan,'{panelGroups,0,sourceToken}',to_jsonb(repeat('x',161))),
    plan || '{"panelCount":10001,"panelGroups":[{"quantity":10001,"positiveSide":"N","typeId":"yellow","sourceToken":""}]}'::jsonb,
    plan || '{"damperCount":101}'::jsonb,
    plan || jsonb_build_object('panelGroups',(select jsonb_agg(jsonb_build_object('quantity',1,'positiveSide','N','typeId','yellow','sourceToken','')) from generate_series(1,101))),
    plan || '{"pallets":[{"panels":36,"afterPanel":0,"adjacentRow":0}]}'::jsonb,
    plan || jsonb_build_object('pallets',jsonb_build_array(jsonb_build_object('panels',36,'afterPanel',50,'adjacentRow',900001)))
  )) loop
    begin
      perform public.solar_plan_change('row_plan_save',stored,'{"revision":3}'::jsonb);
      raise exception 'FAIL: an out-of-range constructor/import value was accepted';
    exception when raise_exception then
      if sqlerrm like 'FAIL:%' then raise; end if;
    end;
  end loop;
  shared := public.solar_plan_change('row_plan_save',plan || '{"id":"fixture-row-zero","field":"North","rowNumber":0,"motorAfterPanel":1,"pallets":[{"panels":36,"afterPanel":1,"adjacentRow":1}]}'::jsonb,'{"revision":null}'::jsonb);
  shared := public.solar_plan_change('row_plan_save',plan || '{"id":"fixture-explicit-zero","rowNumber":900005,"panelCount":0,"panelGroups":[],"status":"verified"}'::jsonb,'{"revision":null}'::jsonb);
  stored := (select p from jsonb_array_elements(shared.data->'rowPlans') p where p->>'id' = 'fixture-explicit-zero');
  if stored->'panelCount' <> '0'::jsonb or stored->'panelsKnown' <> 'true'::jsonb then raise exception 'FAIL: explicit no panels confused with unknown'; end if;
  other_plan := plan || '{"id":"fixture-placeholder","rowNumber":900006,"panelTypeId":"type-2"}'::jsonb;
  other_plan := jsonb_set(other_plan,'{panelGroups}',(select jsonb_agg(g || '{"typeId":"type-2"}'::jsonb order by ordinality)
    from jsonb_array_elements(other_plan->'panelGroups') with ordinality as groups(g,ordinality)));
  shared := public.solar_plan_change('row_plan_save',other_plan,'{"revision":null}'::jsonb);
  begin
    perform public.solar_plan_change('row_plan_save',other_plan || '{"dampersKnown":false,"damperCount":null,"dampers":[],"status":"partial"}'::jsonb,'{"revision":1}'::jsonb);
    raise exception 'FAIL: unconfigured type was treated as confirmed';
  exception when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  previous_type := shared.data->'panelTypes'->1;
  for changed_type in select value from jsonb_array_elements(jsonb_build_array(
    previous_type || jsonb_build_object('name',repeat('x',121)),
    previous_type || jsonb_build_object('currentClass',repeat('x',33)),
    previous_type || '{"id":"type-8"}'::jsonb
  )) loop
    begin
      perform public.solar_plan_change('panel_type_save',changed_type,jsonb_build_object('previous',previous_type));
      raise exception 'FAIL: invalid panel type boundary was accepted';
    exception when raise_exception then
      if sqlerrm like 'FAIL:%' then raise; end if;
    end;
  end loop;
  changed_type := previous_type || '{"color":"#112233","description":"LR8-66HYD-650M","currentClass":"H","configured":true}'::jsonb;
  begin
    perform public.solar_plan_change('panel_type_save',changed_type,jsonb_build_object('previous',previous_type));
    raise exception 'FAIL: duplicate Description + Current Class accepted';
  exception when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  changed_type := changed_type || '{"currentClass":"M"}'::jsonb;
  shared := public.solar_plan_change('panel_type_save',changed_type,jsonb_build_object('previous',previous_type));
  if jsonb_array_length(shared.data->'panelTypes') <> 7 then raise exception 'FAIL: panel type slots changed'; end if;
  begin
    perform public.solar_plan_change('panel_type_save',changed_type,jsonb_build_object('previous',previous_type));
    raise exception 'FAIL: stale panel type accepted';
  exception when serialization_failure then null;
  end;
  previous_type := shared.data->'panelTypes'->0;
  begin
    perform public.solar_plan_change('panel_type_save',previous_type || '{"configured":false}'::jsonb,jsonb_build_object('previous',previous_type));
    raise exception 'FAIL: panel type in use was unconfigured';
  exception when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  select p->>'id' into first_leader from jsonb_array_elements(shared.data->'people') p where coalesce((p->>'active')::boolean,true) limit 1;
  select p->>'id' into second_leader from jsonb_array_elements(shared.data->'people') p where coalesce((p->>'active')::boolean,true) and p->>'id' <> first_leader limit 1;
  person_a := first_leader;
  select p->>'id' into person_c from jsonb_array_elements(shared.data->'people') p where coalesce((p->>'active')::boolean,true) and p->>'id' not in (first_leader,second_leader) limit 1;
  shared := public.solar_plan_change('default_leader_save',jsonb_build_object('employeeId',first_leader),'{"employeeId":null}'::jsonb);
  if shared.data->'teams'->0->>'leaderId' <> first_leader or shared.data->'teams'->1->>'leaderId' <> 'historical-leader'
    then raise exception 'FAIL: common leader/open team/closed history'; end if;
  begin
    perform public.solar_plan_change('default_leader_save','{"employeeId":"fixture-inactive"}'::jsonb,jsonb_build_object('employeeId',first_leader));
    raise exception 'FAIL: inactive common leader accepted';
  exception when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  shared := public.solar_plan_change('default_leader_save',jsonb_build_object('employeeId',second_leader),jsonb_build_object('employeeId',first_leader));
  begin
    perform public.solar_plan_change('default_leader_save',jsonb_build_object('employeeId',first_leader),jsonb_build_object('employeeId',first_leader));
    raise exception 'FAIL: stale leader setting accepted';
  exception when serialization_failure then null;
  end;
  shared := public.solar_change('add_team',jsonb_build_object('id','fixture-new-a','date','2020-01-02','field','South','work','Solar panel installation',
    'from',103,'to',null,'unit','rows','members',jsonb_build_array(person_a),'memberRoles','{}'::jsonb,'closed',false,'status','NOT_STARTED',
    'leaderId','spoof','leaderName','Spoof'), '{}'::jsonb);
  stored := (select t from jsonb_array_elements(shared.data->'teams') t where t->>'id' = 'fixture-new-a');
  if stored->>'leaderId' <> second_leader or stored->'members' ? second_leader then raise exception 'FAIL: leader injection / crew independence'; end if;
  shared := public.solar_change('add_team',jsonb_build_object('id','fixture-new-b','date','2020-01-02','field','South','work','Truck unloading',
    'from',null,'to',null,'quantity',null,'unit','trucks','members',jsonb_build_array(person_c),'memberRoles','{}'::jsonb,'closed',false,'status','NOT_STARTED'), '{}'::jsonb);
  stored := (select t from jsonb_array_elements(shared.data->'teams') t where t->>'id' = 'fixture-new-b');
  if stored->>'leaderId' <> second_leader then raise exception 'FAIL: default leader missing on non-row work'; end if;
  shared := public.solar_change('team_patch','{"id":"fixture-closed","closed":false,"leaderId":"spoof"}'::jsonb,'{"closed":true}'::jsonb);
  stored := (select t from jsonb_array_elements(shared.data->'teams') t where t->>'id' = 'fixture-closed');
  if stored->>'leaderId' <> second_leader then raise exception 'FAIL: reopened team did not inherit current leader'; end if;
  begin
    perform public.solar_change('person_patch',jsonb_build_object('id',second_leader,'active',false),'{"active":true}'::jsonb);
    raise exception 'FAIL: current leader archived without replacement';
  exception when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end;
$test$;
reset role;
rollback;
select 'Row plan storage, imports, optimistic conflicts, RLS, types and common leader checks passed; fixture rolled back' as result;
