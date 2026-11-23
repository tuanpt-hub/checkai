-- Quản lý người dùng của công cụ (app.brand.ai.vn): vai trò, khóa tài khoản, bắt đổi mật khẩu tạm. Chạy một lần sau 004.
create table if not exists public.staff (
  email        text primary key check (email = lower(email)),
  name         text,
  role         text not null default 'member' check (role in ('admin', 'member')),
  disabled     boolean not null default false,
  must_change  boolean not null default false,
  invited_at   timestamptz,
  created_at   timestamptz not null default now(),
  created_by   text,
  updated_at   timestamptz not null default now(),
  updated_by   text
);
alter table public.staff enable row level security;
