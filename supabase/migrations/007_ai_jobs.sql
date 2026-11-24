-- Hàng đợi việc AI chạy nền (đóng tab vẫn chạy). Chạy một lần sau 006.

create table if not exists public.ai_jobs (
  id            uuid primary key default gen_random_uuid(),
  audit_id      text not null,
  kind          text not null,
  status        text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'canceled')),
  stage         text not null default 'ask',
  created_by    text not null,
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  heartbeat_at  timestamptz,
  lock_until    timestamptz,
  params        jsonb not null default '{}'::jsonb,
  total         integer not null default 0,
  done          integer not null default 0,
  summary       jsonb not null default '{}'::jsonb,
  error         text,
  applied_at    timestamptz,
  applied_by    text
);
create index if not exists ai_jobs_audit_idx on public.ai_jobs (audit_id, created_at desc);
create index if not exists ai_jobs_active_idx on public.ai_jobs (status) where status in ('queued', 'running');
-- Mỗi audit chỉ một việc cùng loại đang chạy
create unique index if not exists ai_jobs_one_active on public.ai_jobs (audit_id, kind) where status in ('queued', 'running');
alter table public.ai_jobs enable row level security;

create table if not exists public.ai_job_items (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.ai_jobs(id) on delete cascade,
  stage       text not null,
  key         text not null,
  payload     jsonb not null,
  status      text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'skipped')),
  attempts    integer not null default 0,
  result      jsonb,
  error       text,
  updated_at  timestamptz not null default now(),
  unique (job_id, stage, key)
);
create index if not exists ai_job_items_job_idx on public.ai_job_items (job_id, stage, status);
alter table public.ai_job_items enable row level security;

-- Nhận một việc đang chờ/đang chạy mà khóa đã hết hạn (chống hai máy chủ cùng chạy một việc).
create or replace function public.job_claim(p_lock_seconds integer)
returns setof public.ai_jobs language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from public.ai_jobs
   where status in ('queued', 'running') and (lock_until is null or lock_until < now())
   order by created_at limit 1 for update skip locked;
  if v_id is null then return; end if;
  return query update public.ai_jobs
     set status = 'running', lock_until = now() + make_interval(secs => p_lock_seconds),
         started_at = coalesce(started_at, now()), heartbeat_at = now()
   where id = v_id returning *;
end $$;
revoke all on function public.job_claim(integer) from public, anon, authenticated;
grant execute on function public.job_claim(integer) to service_role;
