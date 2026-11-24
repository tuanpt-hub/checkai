-- Giới hạn tần suất dùng chung cho mọi phiên bản máy chủ + người phụ trách khách tiềm năng. Chạy một lần sau 005.

create table if not exists public.rate_limits (
  key          text not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (key, window_start)
);
alter table public.rate_limits enable row level security;

-- Ghi một lượt và trả về true nếu còn trong giới hạn (cửa sổ cố định p_window_seconds giây).
create or replace function public.rl_hit(p_key text, p_window_seconds integer, p_max integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  insert into public.rate_limits (key, window_start, hits) values (p_key, v_start, 1)
  on conflict (key, window_start) do update set hits = public.rate_limits.hits + 1
  returning hits into v_hits;
  if random() < 0.02 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;
  return v_hits <= p_max;
end $$;
revoke all on function public.rl_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rl_hit(text, integer, integer) to service_role;

-- Người phụ trách khách tiềm năng (email nhân viên)
alter table public.leads add column if not exists assigned_to text;
create index if not exists leads_assigned_idx on public.leads (assigned_to);
