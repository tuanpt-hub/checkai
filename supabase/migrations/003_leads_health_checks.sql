-- Đợt A: khách tiềm năng từ brand.ai.vn và AI Health Check tự phục vụ. Chạy một lần trong Supabase → SQL Editor.
-- Mọi bảng bật RLS và không có policy: chỉ máy chủ Vercel (secret key) đọc/ghi được.

create table if not exists public.leads (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  source        text not null check (source in ('form', 'health_check')),
  status        text not null default 'new' check (status in ('new', 'contacted', 'health_check', 'audit', 'transformation', 'intelligence', 'lost')),
  name          text,
  title         text,
  company       text,
  brand         text,
  website       text,
  email         text not null,
  phone         text,
  industry      text,
  package       text,
  note          text,
  consent_at    timestamptz not null,
  consent_text  text not null,
  utm           jsonb not null default '{}'::jsonb,
  referrer      text,
  ai_referrer   text,
  ip_hash       text,
  audit_id      text,
  staff_note    text,
  updated_by    text
);
create index if not exists leads_created_idx on public.leads (created_at desc);
create index if not exists leads_email_idx on public.leads (lower(email));
alter table public.leads enable row level security;

create table if not exists public.health_checks (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  lead_id            uuid references public.leads(id) on delete set null,
  brand              text not null,
  website            text not null,
  domain             text not null,
  email              text not null,
  status             text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  verify_hash        text unique,
  verify_expires_at  timestamptz,
  session_hash       text unique,
  session_expires_at timestamptz,
  verified_at        timestamptz,
  verified_day       date,
  engines            text[] not null default '{}',
  calls_used         integer not null default 0,
  calls_limit        integer not null default 0,
  scan               jsonb,
  report             jsonb,
  report_token       text unique,
  finished_at        timestamptz,
  ip_hash            text
);
create index if not exists health_checks_domain_idx on public.health_checks (domain, created_at desc);
create index if not exists health_checks_day_idx on public.health_checks (verified_day);
alter table public.health_checks enable row level security;

create table if not exists public.health_check_answers (
  id          uuid primary key default gen_random_uuid(),
  hc_id       uuid not null references public.health_checks(id) on delete cascade,
  qid         text not null,
  engine      text not null,
  model       text,
  text        text,
  sources     jsonb not null default '[]'::jsonb,
  error       text,
  created_at  timestamptz not null default now(),
  unique (hc_id, qid, engine)
);
alter table public.health_check_answers enable row level security;

-- Trừ một lượt gọi AI một cách nguyên tử: trả về số lượt đã dùng, hoặc null nếu hết lượt / phiên không còn chạy.
create or replace function public.hc_take_call(p_id uuid)
returns integer language sql security definer set search_path = public as $$
  update public.health_checks
     set calls_used = calls_used + 1
   where id = p_id and status = 'running' and calls_used < calls_limit and session_expires_at > now()
  returning calls_used;
$$;
revoke all on function public.hc_take_call(uuid) from public, anon, authenticated;
grant execute on function public.hc_take_call(uuid) to service_role;
