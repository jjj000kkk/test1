-- 排行榜一直 401？已經建好表與政策的話，只要補這兩行（可重複執行）。
grant usage on schema public to anon, authenticated;
grant select, insert on public.leaderboard to anon, authenticated;

-- 檢查 anon 到底有沒有權限（應該看到 INSERT 與 SELECT 兩列）：
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'leaderboard' and grantee in ('anon', 'authenticated')
order by grantee, privilege_type;
