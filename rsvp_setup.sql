-- WHISTLE FC STAT: 참석 투표 테이블 설치 (Supabase SQL Editor에서 한 번 실행)
-- 여러 번 실행해도 안전하다(이미 있으면 건너뛰거나 새로 만든다).
--
-- 규칙
--   1) 누구나 읽을 수 있다.
--   2) 쓰기는 "오늘 이후 경기"의 행만 가능하다. 선수는 선수 표에 등록된 사람이면 된다(등번호 없어도 됨).
--   3) 용병 수(guests)는 rsvp_managers에 등록된 선수의 행에만 붙일 수 있다.
--   4) updated_at은 서버가 채운다(화면에서 보낸 값은 무시).

-- ── 용병 담당자(주장·팀장). 바뀌면 이 표의 행만 넣고 빼면 된다. ──
create table if not exists public.rsvp_managers (
  player_id bigint primary key references public.players(id) on delete cascade
);

insert into public.rsvp_managers (player_id)
select id from public.players
where name in ('박지성', '이항규', '이정호') and number is not null
on conflict do nothing;

-- ── 참석 투표: 경기 × 선수당 한 행 ──
create table if not exists public.schedule_rsvps (
  schedule_id bigint not null references public.schedules(id) on delete cascade,
  player_id   bigint not null references public.players(id)   on delete cascade,
  status      text check (status in ('attend', 'maybe', 'absent')),
  guests      smallint not null default 0 check (guests between 0 and 10),
  updated_at  timestamptz not null default now(),
  primary key (schedule_id, player_id),
  check (status is not null or guests > 0)
);

create or replace function public.rsvp_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists rsvp_touch on public.schedule_rsvps;
create trigger rsvp_touch before insert or update on public.schedule_rsvps
for each row execute function public.rsvp_touch();

-- ── 권한 ──
alter table public.rsvp_managers  enable row level security;
alter table public.schedule_rsvps enable row level security;

grant select on public.rsvp_managers to anon, authenticated;
grant select, insert, update, delete on public.schedule_rsvps to anon, authenticated;

drop policy if exists rsvp_managers_read on public.rsvp_managers;
create policy rsvp_managers_read on public.rsvp_managers
for select to anon, authenticated using (true);

drop policy if exists rsvp_read   on public.schedule_rsvps;
drop policy if exists rsvp_insert on public.schedule_rsvps;
drop policy if exists rsvp_update on public.schedule_rsvps;
drop policy if exists rsvp_delete on public.schedule_rsvps;

create policy rsvp_read on public.schedule_rsvps
for select to anon, authenticated using (true);

create policy rsvp_insert on public.schedule_rsvps
for insert to anon, authenticated
with check (
  exists (select 1 from public.schedules s where s.id = schedule_id
          and s.date::date >= (now() at time zone 'Asia/Seoul')::date)
  and (guests = 0 or exists (select 1 from public.rsvp_managers m where m.player_id = schedule_rsvps.player_id))
);

create policy rsvp_update on public.schedule_rsvps
for update to anon, authenticated
using (
  exists (select 1 from public.schedules s where s.id = schedule_id
          and s.date::date >= (now() at time zone 'Asia/Seoul')::date)
)
with check (
  exists (select 1 from public.schedules s where s.id = schedule_id
          and s.date::date >= (now() at time zone 'Asia/Seoul')::date)
  and (guests = 0 or exists (select 1 from public.rsvp_managers m where m.player_id = schedule_rsvps.player_id))
);

create policy rsvp_delete on public.schedule_rsvps
for delete to anon, authenticated
using (
  exists (select 1 from public.schedules s where s.id = schedule_id
          and s.date::date >= (now() at time zone 'Asia/Seoul')::date)
);

-- 확인: 담당자 3명이 보이면 정상
select m.player_id, p.name from public.rsvp_managers m join public.players p on p.id = m.player_id;
