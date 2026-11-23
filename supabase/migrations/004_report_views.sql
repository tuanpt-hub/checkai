-- Đợt B: hạn dùng, thu hồi và lượt xem của báo cáo AI Health Check. Chạy một lần sau 003.
alter table public.health_checks
  add column if not exists report_expires_at timestamptz,
  add column if not exists report_revoked    boolean not null default false,
  add column if not exists view_count        integer not null default 0,
  add column if not exists first_viewed_at   timestamptz,
  add column if not exists last_viewed_at    timestamptz;

create table if not exists public.report_views (
  id       uuid primary key default gen_random_uuid(),
  hc_id    uuid not null references public.health_checks(id) on delete cascade,
  at       timestamptz not null default now(),
  device   text,
  ip_hash  text
);
create index if not exists report_views_hc_idx on public.report_views (hc_id, at desc);
alter table public.report_views enable row level security;

-- Ghi một lượt xem; cùng người xem (ip_hash) mở lại trong 30 phút không tính thêm.
-- Trả về: o_counted (có tính lượt này không), o_views (tổng lượt xem sau khi ghi).
create or replace function public.hc_report_view(p_token text, p_device text, p_ip text)
returns table (o_counted boolean, o_views integer)
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select h.id into v_id from public.health_checks h where h.report_token = p_token and h.status = 'done';
  if v_id is null then return; end if;
  if exists (select 1 from public.report_views r where r.hc_id = v_id and r.ip_hash = p_ip and r.at > now() - interval '30 minutes') then
    return query select false, h.view_count from public.health_checks h where h.id = v_id;
    return;
  end if;
  insert into public.report_views (hc_id, device, ip_hash) values (v_id, left(p_device, 20), left(p_ip, 64));
  return query
    update public.health_checks h
       set view_count = h.view_count + 1, last_viewed_at = now(), first_viewed_at = coalesce(h.first_viewed_at, now())
     where h.id = v_id
    returning true, h.view_count;
end $$;
revoke all on function public.hc_report_view(text, text, text) from public, anon, authenticated;
grant execute on function public.hc_report_view(text, text, text) to service_role;
