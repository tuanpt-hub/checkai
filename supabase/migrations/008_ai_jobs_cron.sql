-- Đồng hồ đánh thức bộ chạy việc AI nền mỗi phút (phòng khi chuỗi tự gọi giữa các đợt bị đứt).
-- Chỉ gọi khi có việc đang chờ và không máy chủ nào giữ khóa. Khóa bí mật đọc từ Supabase Vault (tên 'jobs_secret'),
-- tạo riêng một lần, KHÔNG ghi vào tệp này:  select vault.create_secret('<JOBS_SECRET>', 'jobs_secret');
create extension if not exists pg_net;
create extension if not exists pg_cron;

select cron.unschedule('ai-jobs-tick') where exists (select 1 from cron.job where jobname = 'ai-jobs-tick');
select cron.schedule('ai-jobs-tick', '* * * * *', $cron$
  select net.http_post(
    url := 'https://app.brand.ai.vn/api/probe?op=tick',
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-jobs-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'jobs_secret' limit 1)),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000)
  where exists (select 1 from public.ai_jobs where status in ('queued', 'running') and (lock_until is null or lock_until < now()))
    and exists (select 1 from vault.decrypted_secrets where name = 'jobs_secret');
$cron$);
