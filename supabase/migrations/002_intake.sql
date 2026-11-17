-- Link cho thương hiệu tự nhập hồ sơ + hàng chờ duyệt. Chạy một lần trong Supabase → SQL Editor.
-- Cả hai bảng bật RLS và không có policy: chỉ máy chủ Vercel (secret key) truy cập được.
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
