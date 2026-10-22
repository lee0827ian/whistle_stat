-- 운영진 관리 화면(admin.html) 개편에 필요한 설정. Supabase SQL Editor에서 한 번 실행(여러 번 실행해도 안전).

-- 1) 용병 담당(rsvp_managers): 운영진 로그인 상태에서만 지정·해제
grant insert, delete on public.rsvp_managers to authenticated;
drop policy if exists rsvp_managers_admin_insert on public.rsvp_managers;
drop policy if exists rsvp_managers_admin_delete on public.rsvp_managers;
create policy rsvp_managers_admin_insert on public.rsvp_managers
  for insert to authenticated with check (true);
create policy rsvp_managers_admin_delete on public.rsvp_managers
  for delete to authenticated using (true);

-- 2) 시즌 MVP 가림 표: 여기에 있는 시즌은 홈 화면에서 시즌 MVP를 가린다(누구나 읽기, 운영진만 바꾸기)
create table if not exists public.mvp_hidden_seasons (
  season int primary key
);
insert into public.mvp_hidden_seasons (season) values (2026) on conflict do nothing;   -- 지금처럼 2026 가림으로 시작

alter table public.mvp_hidden_seasons enable row level security;
grant select on public.mvp_hidden_seasons to anon, authenticated;
grant insert, delete on public.mvp_hidden_seasons to authenticated;
drop policy if exists mvp_hidden_read on public.mvp_hidden_seasons;
drop policy if exists mvp_hidden_insert on public.mvp_hidden_seasons;
drop policy if exists mvp_hidden_delete on public.mvp_hidden_seasons;
create policy mvp_hidden_read on public.mvp_hidden_seasons for select to anon, authenticated using (true);
create policy mvp_hidden_insert on public.mvp_hidden_seasons for insert to authenticated with check (true);
create policy mvp_hidden_delete on public.mvp_hidden_seasons for delete to authenticated using (true);

-- 3) 참석 명단 직접 지정: 참석 투표 기본 명단 = 자동(최근 3시즌 2경기 이상 출전) + show=true − show=false
--    자동 기준과 같은 값이면 행을 두지 않는다(관리 화면이 알아서 지움). 누구나 읽기, 운영진만 바꾸기.
create table if not exists public.rsvp_roster (
  player_id bigint primary key references public.players(id) on delete cascade,
  show      boolean not null
);

alter table public.rsvp_roster enable row level security;
grant select on public.rsvp_roster to anon, authenticated;
grant insert, update, delete on public.rsvp_roster to authenticated;
drop policy if exists rsvp_roster_read   on public.rsvp_roster;
drop policy if exists rsvp_roster_insert on public.rsvp_roster;
drop policy if exists rsvp_roster_update on public.rsvp_roster;
drop policy if exists rsvp_roster_delete on public.rsvp_roster;
create policy rsvp_roster_read   on public.rsvp_roster for select to anon, authenticated using (true);
create policy rsvp_roster_insert on public.rsvp_roster for insert to authenticated with check (true);
create policy rsvp_roster_update on public.rsvp_roster for update to authenticated using (true) with check (true);
create policy rsvp_roster_delete on public.rsvp_roster for delete to authenticated using (true);
