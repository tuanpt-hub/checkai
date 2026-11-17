-- Chạy toàn bộ file này một lần trong Supabase → SQL Editor.
-- Cả hai bảng bật RLS và KHÔNG có policy: trình duyệt không thể đọc/ghi trực tiếp,
-- chỉ máy chủ Vercel (dùng secret key) truy cập được.

create table if not exists public.audits (
  id          text primary key,
  brand       text not null default '',
  score       integer not null default -1,
  level       text not null default '',
  data        jsonb not null,
  version     integer not null default 1,
  updated_at  timestamptz not null default now(),
  updated_by  text not null default ''
);
create index if not exists audits_updated_idx on public.audits (updated_at desc);
alter table public.audits enable row level security;

create table if not exists public.usage (
  email  text not null,
  day    date not null,
  calls  integer not null default 0,
  primary key (email, day)
);
alter table public.usage enable row level security;

create or replace function public.bump_usage(p_email text, p_day date, p_n integer)
returns integer
language sql
security definer
set search_path = public
as $$
  insert into public.usage (email, day, calls) values (lower(p_email), p_day, p_n)
  on conflict (email, day) do update set calls = public.usage.calls + p_n
  returning calls;
$$;

revoke all on function public.bump_usage(text, date, integer) from public, anon, authenticated;
grant execute on function public.bump_usage(text, date, integer) to service_role;
create table if not exists public.intake_links (
  id            uuid primary key default gen_random_uuid(),
  token_hash    text not null unique,
  audit_id      text not null references public.audits(id) on delete cascade,
  created_by    text not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked       boolean not null default false,
  ai_calls      integer not null default 0,
  submissions   integer not null default 0,
  last_used_at  timestamptz
);
create index if not exists intake_links_audit_idx on public.intake_links (audit_id, created_at desc);
alter table public.intake_links enable row level security;

create table if not exists public.intake_submissions (
  id            uuid primary key default gen_random_uuid(),
  audit_id      text not null references public.audits(id) on delete cascade,
  link_id       uuid references public.intake_links(id) on delete set null,
  data          jsonb not null,
  status        text not null default 'pending' check (status in ('pending', 'applied', 'rejected')),
  submitted_at  timestamptz not null default now(),
  reviewed_by   text,
  reviewed_at   timestamptz
);
create index if not exists intake_submissions_audit_idx on public.intake_submissions (audit_id, status, submitted_at desc);
alter table public.intake_submissions enable row level security;
