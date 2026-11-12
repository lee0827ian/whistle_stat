-- 선수 카드 사진: 본인이 사이트에서 직접 올림(승인 없음, IAN 11-12 결정)
-- Supabase SQL Editor에서 한 번 실행. 다시 실행해도 안전(있으면 건너뜀).
-- 사진 파일 = Storage 'player-photos' 버킷의 <선수id>/<시각>.webp|png (올릴 때마다 새 파일, 옛 파일은 남아 되돌리기 가능)
-- 지금 쓰는 사진 = player_photos 표(선수당 1행)

-- 1) 사진 저장 공간(공개 읽기, 2MB·webp/png만)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('player-photos', 'player-photos', true, 2097152, array['image/webp', 'image/png'])
on conflict (id) do nothing;

drop policy if exists player_photos_obj_read on storage.objects;
create policy player_photos_obj_read on storage.objects
  for select using (bucket_id = 'player-photos');

drop policy if exists player_photos_obj_insert on storage.objects;
create policy player_photos_obj_insert on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'player-photos' and name ~ '^[0-9]+/[0-9]+\.(webp|png)$');

-- 2) 선수별 현재 사진
create table if not exists public.player_photos (
  player_id  bigint primary key references public.players(id) on delete cascade,
  path       text not null,
  updated_at timestamptz not null default now()
);
alter table public.player_photos enable row level security;

drop policy if exists player_photos_read   on public.player_photos;
drop policy if exists player_photos_insert on public.player_photos;
drop policy if exists player_photos_update on public.player_photos;
create policy player_photos_read on public.player_photos for select using (true);
create policy player_photos_insert on public.player_photos for insert to anon, authenticated
  with check (path ~ '^[0-9]+/[0-9]+\.(webp|png)$' and split_part(path, '/', 1)::bigint = player_id);
create policy player_photos_update on public.player_photos for update to anon, authenticated
  using (true)
  with check (path ~ '^[0-9]+/[0-9]+\.(webp|png)$' and split_part(path, '/', 1)::bigint = player_id);
grant select, insert, update on public.player_photos to anon, authenticated;
