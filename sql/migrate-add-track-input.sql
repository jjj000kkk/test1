-- 把「舊版排行榜」升級成：賽道 track_id、操控標籤 input_type、遊戲模式 mode
-- 在 Supabase → SQL Editor 貼上執行一次即可（可重複執行，已有的紀錄會保留）。
--
-- 舊資料怎麼對應：
--   舊 mode = tap / buttons / joystick → 標準模式、標準賽道、input_type = 'button'
--   舊 mode = gyro                     → 標準模式、標準賽道、input_type = 'gyro'（📱 體感標章）

begin;

-- 1) 新欄位
alter table public.leaderboard add column if not exists track_id   text;
alter table public.leaderboard add column if not exists input_type text not null default 'button';

-- 2) 舊的 mode 檢查只允許四種操控方式，必須先拿掉才能改寫成遊戲模式
alter table public.leaderboard drop constraint if exists leaderboard_mode_check;

-- 3) 回填舊資料（只處理還沒有 track_id 的列）
update public.leaderboard
set input_type = case when mode = 'gyro' then 'gyro' else 'button' end,
    mode       = 'standard',
    track_id   = 'standard'
where track_id is null;

-- 4) 新的檢查
alter table public.leaderboard alter column track_id set not null;

alter table public.leaderboard drop constraint if exists leaderboard_mode_check;
alter table public.leaderboard add  constraint leaderboard_mode_check
  check (mode in ('standard', 'turbo', 'nightmare'));

alter table public.leaderboard drop constraint if exists leaderboard_track_id_check;
alter table public.leaderboard add  constraint leaderboard_track_id_check
  check (track_id in ('standard', 'nightmare'));

alter table public.leaderboard drop constraint if exists leaderboard_input_type_check;
alter table public.leaderboard add  constraint leaderboard_input_type_check
  check (input_type in ('button', 'gyro'));

alter table public.leaderboard drop constraint if exists leaderboard_track_matches_mode;
alter table public.leaderboard add  constraint leaderboard_track_matches_mode
  check ((mode = 'nightmare') = (track_id = 'nightmare'));

-- 5) 索引改成以賽道查詢
drop index if exists public.leaderboard_mode_score_idx;
create index if not exists leaderboard_track_score_idx
  on public.leaderboard (track_id, score desc, created_at);

-- 6) 權限（新欄位會跟著資料表的權限，這裡只是保險）
grant usage on schema public to anon, authenticated;
grant select, insert on public.leaderboard to anon, authenticated;

commit;

-- 檢查：每個賽道、操控標籤各幾筆
select track_id, input_type, count(*) from public.leaderboard group by 1, 2 order by 1, 2;
