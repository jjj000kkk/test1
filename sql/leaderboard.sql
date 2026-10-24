-- 小朋友下樓梯 · 排行榜（全新建立用）
-- 貼到 Supabase 後台 → SQL Editor → Run。可重複執行。
-- 已經用舊版建過表的話，改執行 sql/migrate-add-track-input.sql。

create table if not exists public.leaderboard (
  id          uuid primary key default gen_random_uuid(),
  player_name text        not null check (char_length(btrim(player_name)) between 1 and 12),
  score       integer     not null check (score between 1 and 9999),
  mode        text        not null check (mode in ('standard', 'turbo', 'nightmare')),   -- 遊戲模式
  track_id    text        not null check (track_id in ('standard', 'nightmare')),        -- 排行榜賽道
  input_type  text        not null default 'button' check (input_type in ('button', 'gyro')), -- 操控方式標籤
  created_at  timestamptz not null default now(),
  -- 標準與極速共用 standard 賽道；地獄獨佔 nightmare 賽道
  constraint leaderboard_track_matches_mode check ((mode = 'nightmare') = (track_id = 'nightmare'))
);

-- Top 100 與「比我高的有幾人」都走 (track_id, score desc)；created_at 讓同分時先到的排前面
create index if not exists leaderboard_track_score_idx
  on public.leaderboard (track_id, score desc, created_at);

alter table public.leaderboard enable row level security;

-- 所有人可讀、可新增；沒有 UPDATE / DELETE 政策，所以任何人都不能改或刪既有紀錄
drop policy if exists "leaderboard_select_all" on public.leaderboard;
create policy "leaderboard_select_all"
  on public.leaderboard for select
  to anon, authenticated
  using (true);

drop policy if exists "leaderboard_insert_all" on public.leaderboard;
create policy "leaderboard_insert_all"
  on public.leaderboard for insert
  to anon, authenticated
  with check (true);

-- 重要：RLS 只決定「哪些列」能看；anon 角色還要有資料表本身的權限。
-- 少了這行，新專案會回 401（"permission denied for table leaderboard"），即使 RLS 政策都建好了。
grant usage on schema public to anon, authenticated;
grant select, insert on public.leaderboard to anon, authenticated;
