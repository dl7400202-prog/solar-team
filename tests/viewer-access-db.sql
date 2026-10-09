-- Administrative integration check. Every fixture/change is rolled back.
begin;
select set_config('viewer_test.uid',(select u.id::text from auth.users u join public.solar_members m on lower(u.email)=m.email where u.email_confirmed_at is not null and m.access_role='editor' order by u.id limit 1),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('viewer_test.uid'),'role','authenticated','user_metadata',jsonb_build_object('access_role','editor'))::text,true);
set local role authenticated;
do $test$
declare n integer;
begin
  if public.solar_access() is distinct from 'editor' then raise exception 'FAIL: editor access'; end if;
  select count(*) into n from public.solar_shared where id=1;
  if n<>1 then raise exception 'FAIL: editor read'; end if;
  perform public.solar_change('initialize','{}'::jsonb,'{}'::jsonb);
end;
$test$;
reset role;
update public.solar_members set access_role='viewer' where email=(select lower(email) from auth.users where id=current_setting('viewer_test.uid')::uuid);
set local role authenticated;
do $test$
declare n integer;
begin
  if public.solar_access() is distinct from 'viewer' or solar_private.can_edit() then raise exception 'FAIL: trusted viewer access'; end if;
  select count(*) into n from public.solar_shared where id=1;
  if n<>1 then raise exception 'FAIL: viewer read'; end if;
  begin perform public.solar_change('initialize','{}'::jsonb,'{}'::jsonb);raise exception 'FAIL: viewer legacy RPC';
  exception when insufficient_privilege then null;end;
  begin perform public.solar_plan_change('row_plan_import','{"plans":[]}'::jsonb,'{}'::jsonb);raise exception 'FAIL: viewer plans RPC';
  exception when insufficient_privilege then null;end;
  update public.solar_shared set data=data where id=1;
  get diagnostics n=row_count;if n<>0 then raise exception 'FAIL: direct workspace update';end if;
  begin insert into public.solar_members(email,access_role) values('permission-fixture@solar-team.test','editor');raise exception 'FAIL: viewer invite';
  exception when insufficient_privilege then null;end;
  begin update public.solar_members set access_role='editor';raise exception 'FAIL: privilege escalation';
  exception when insufficient_privilege then null;end;
  begin insert into storage.objects(bucket_id,name) values('employee-photos','viewer-permission-fixture.jpg');raise exception 'FAIL: viewer photo upload';
  exception when insufficient_privilege then null;end;
  update storage.objects set metadata=metadata where bucket_id='employee-photos';
  get diagnostics n=row_count;if n<>0 then raise exception 'FAIL: viewer photo update';end if;
  begin delete from storage.objects where bucket_id='employee-photos';
  get diagnostics n=row_count;if n<>0 then raise exception 'FAIL: viewer photo delete';end if;
  exception when insufficient_privilege then null;end;
end;
$test$;
reset role;
select set_config('request.jwt.claims','{}',true);
set local role anon;
do $test$
declare n integer;
begin
  begin select count(*) into n from public.solar_shared;
  exception when insufficient_privilege then n=0;end;
  if n<>0 then raise exception 'FAIL: anonymous read';end if;
  begin perform public.solar_access();raise exception 'FAIL: anonymous access RPC';
  exception when insufficient_privilege then null;end;
end;
$test$;
reset role;
rollback;
select 'PASS: editor preserved; viewer reads; both RPCs/direct writes/invites/escalation/photos denied; anonymous denied; fixtures rolled back' as result;
