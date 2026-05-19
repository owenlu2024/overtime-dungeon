create extension if not exists pgcrypto;

create table if not exists public.overtime_users (
  id text primary key,
  username text not null unique,
  password text not null,
  role text,
  role_key text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  exp_override numeric
);

create table if not exists public.overtime_records (
  id text primary key,
  user_id text not null references public.overtime_users(id) on delete cascade,
  date date not null,
  start_time text not null,
  end_time text not null,
  duration numeric not null default 0,
  type text,
  remark text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.overtime_sessions (
  token text primary key,
  user_id text not null references public.overtime_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);

alter table public.overtime_users enable row level security;
alter table public.overtime_records enable row level security;
alter table public.overtime_sessions enable row level security;

revoke all on table public.overtime_users from anon, authenticated;
revoke all on table public.overtime_records from anon, authenticated;
revoke all on table public.overtime_sessions from anon, authenticated;

create or replace function public.app_level(p_exp numeric)
returns integer
language sql
immutable
as $$
  select case
    when coalesce(p_exp, 0) < 50 then 1
    when p_exp < 100 then 2
    when p_exp < 200 then 3
    when p_exp < 400 then 4
    when p_exp < 600 then 5
    when p_exp < 900 then 6
    when p_exp < 1200 then 7
    when p_exp < 1600 then 8
    when p_exp < 2000 then 9
    when p_exp < 2500 then 10
    when p_exp < 3200 then 11
    else 12
  end;
$$;

create or replace function public.app_title(p_exp numeric)
returns text
language sql
immutable
as $$
  select case public.app_level(p_exp)
    when 1 then '摸鱼见习生'
    when 2 then '工位巡逻员'
    when 3 then '咖啡续命师'
    when 4 then '表格搬砖侠'
    when 5 then '键盘小怪兽'
    when 6 then '会议幸存者'
    when 7 then '需求驯兽师'
    when 8 then '深夜副本王'
    when 9 then '方案爆改侠'
    when 10 then '甲方终结者'
    when 11 then '通宵守门人'
    else '加班大魔王'
  end;
$$;

create or replace function public.app_user_from_token(p_token text)
returns public.overtime_users
language sql
security definer
set search_path = public
as $$
  select u.*
  from public.overtime_sessions s
  join public.overtime_users u on u.id = s.user_id
  where s.token = p_token
    and s.expires_at > now()
  limit 1;
$$;

create or replace function public.app_new_session(p_user_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
begin
  v_token := encode(gen_random_bytes(32), 'hex');
  insert into public.overtime_sessions(token, user_id)
  values (v_token, p_user_id);
  return v_token;
end;
$$;

create or replace function public.app_user_json(p_user public.overtime_users)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', p_user.id,
    'username', p_user.username,
    'role', p_user.role,
    'role_key', p_user.role_key,
    'is_admin', p_user.is_admin,
    'created_at', p_user.created_at,
    'exp_override', p_user.exp_override
  );
$$;

create or replace function public.app_ensure_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.overtime_users(id, username, password, role, role_key, is_admin, created_at)
  values ('admin_owenlu', 'owenlu', '110110', '管理员', 'demon', true, now())
  on conflict (id) do update set
    username = excluded.username,
    password = excluded.password,
    role = excluded.role,
    role_key = excluded.role_key,
    is_admin = true;
end;
$$;

create or replace function public.app_current_user(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.overtime_users;
begin
  select * into v_user from public.app_user_from_token(p_token);
  if v_user.id is null then
    raise exception '登录已过期，请重新登录';
  end if;
  return public.app_user_json(v_user);
end;
$$;

create or replace function public.app_login(p_username text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.overtime_users;
  v_token text;
begin
  select * into v_user
  from public.overtime_users
  where username = p_username and password = p_password
  limit 1;

  if v_user.id is null then
    raise exception '账号或密码错误';
  end if;

  v_token := public.app_new_session(v_user.id);
  return jsonb_build_object('session_token', v_token, 'user', public.app_user_json(v_user));
end;
$$;

create or replace function public.app_register(
  p_id text,
  p_username text,
  p_password text,
  p_role text,
  p_role_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.overtime_users;
  v_token text;
begin
  if exists (select 1 from public.overtime_users where username = p_username) then
    raise exception '用户名已存在';
  end if;

  insert into public.overtime_users(id, username, password, role, role_key, is_admin, created_at)
  values (p_id, p_username, p_password, p_role, p_role_key, false, now())
  returning * into v_user;

  v_token := public.app_new_session(v_user.id);
  return jsonb_build_object('session_token', v_token, 'user', public.app_user_json(v_user));
end;
$$;

create or replace function public.app_my_records(p_token text)
returns table (
  id text,
  user_id text,
  date date,
  start_time text,
  end_time text,
  duration numeric,
  type text,
  remark text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.overtime_users;
begin
  select * into v_user from public.app_user_from_token(p_token);
  if v_user.id is null then
    raise exception '登录已过期，请重新登录';
  end if;

  return query
  select r.id, r.user_id, r.date, r.start_time, r.end_time, r.duration, r.type, r.remark, r.created_at, r.updated_at
  from public.overtime_records r
  where r.user_id = v_user.id
  order by r.date desc, r.start_time desc;
end;
$$;

create or replace function public.app_save_record(p_token text, p_record jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.overtime_users;
  v_record public.overtime_records;
begin
  select * into v_user from public.app_user_from_token(p_token);
  if v_user.id is null then
    raise exception '登录已过期，请重新登录';
  end if;

  if coalesce(p_record->>'user_id', v_user.id) <> v_user.id and not v_user.is_admin then
    raise exception '不能保存他人的记录';
  end if;

  if exists (
    select 1
    from public.overtime_records r
    where r.id = p_record->>'id'
      and r.user_id <> v_user.id
      and not v_user.is_admin
  ) then
    raise exception '不能修改他人的记录';
  end if;

  insert into public.overtime_records(id, user_id, date, start_time, end_time, duration, type, remark, created_at, updated_at)
  values (
    p_record->>'id',
    coalesce(p_record->>'user_id', v_user.id),
    (p_record->>'date')::date,
    p_record->>'start_time',
    p_record->>'end_time',
    coalesce((p_record->>'duration')::numeric, 0),
    coalesce(p_record->>'type', ''),
    coalesce(p_record->>'remark', ''),
    coalesce((p_record->>'created_at')::timestamptz, now()),
    now()
  )
  on conflict (id) do update set
    date = excluded.date,
    start_time = excluded.start_time,
    end_time = excluded.end_time,
    duration = excluded.duration,
    type = excluded.type,
    remark = excluded.remark,
    updated_at = now()
  returning * into v_record;

  return to_jsonb(v_record);
end;
$$;

create or replace function public.app_delete_record(p_token text, p_record_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.overtime_users;
begin
  select * into v_user from public.app_user_from_token(p_token);
  if v_user.id is null then
    raise exception '登录已过期，请重新登录';
  end if;

  delete from public.overtime_records
  where id = p_record_id
    and (user_id = v_user.id or v_user.is_admin);
end;
$$;

create or replace function public.app_clear_records(p_token text, p_user_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.overtime_users;
begin
  select * into v_user from public.app_user_from_token(p_token);
  if v_user.id is null then
    raise exception '登录已过期，请重新登录';
  end if;
  if p_user_id <> v_user.id and not v_user.is_admin then
    raise exception '不能清空他人的记录';
  end if;
  delete from public.overtime_records where user_id = p_user_id;
end;
$$;

create or replace function public.app_save_user(p_token text, p_user jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.overtime_users;
  v_user public.overtime_users;
  v_target_id text;
begin
  select * into v_actor from public.app_user_from_token(p_token);
  if v_actor.id is null then
    raise exception '登录已过期，请重新登录';
  end if;

  v_target_id := p_user->>'id';
  if v_target_id <> v_actor.id and not v_actor.is_admin then
    raise exception '没有管理员权限';
  end if;

  update public.overtime_users
  set exp_override = case
        when v_actor.is_admin and p_user ? 'expOverride' then nullif(p_user->>'expOverride', '')::numeric
        else exp_override
      end,
      role = coalesce(p_user->>'role', role),
      role_key = coalesce(p_user->>'roleKey', p_user->>'role_key', role_key)
  where id = v_target_id
  returning * into v_user;

  return public.app_user_json(v_user);
end;
$$;

create or replace function public.app_delete_user(p_token text, p_user_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.overtime_users;
begin
  select * into v_actor from public.app_user_from_token(p_token);
  if v_actor.id is null or not v_actor.is_admin then
    raise exception '没有管理员权限';
  end if;
  if p_user_id = v_actor.id then
    raise exception '不能删除当前管理员';
  end if;
  delete from public.overtime_users where id = p_user_id;
end;
$$;

create or replace function public.app_leaderboard(p_token text, p_mode text default 'week')
returns table (
  id text,
  username text,
  role text,
  role_key text,
  is_admin boolean,
  exp_override numeric,
  today_hours numeric,
  week_hours numeric,
  month_hours numeric,
  year_hours numeric,
  total_hours numeric,
  total_exp numeric,
  level integer,
  title text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.overtime_users;
begin
  select * into v_user from public.app_user_from_token(p_token);
  if v_user.id is null then
    raise exception '登录已过期，请重新登录';
  end if;

  return query
  with sums as (
    select
      u.id,
      coalesce(sum(r.duration) filter (where r.date = current_date), 0) as today_hours,
      coalesce(sum(r.duration) filter (where r.date >= date_trunc('week', current_date)::date and r.date < (date_trunc('week', current_date)::date + 7)), 0) as week_hours,
      coalesce(sum(r.duration) filter (where date_trunc('month', r.date::timestamp) = date_trunc('month', current_date::timestamp)), 0) as month_hours,
      coalesce(sum(r.duration) filter (where date_trunc('year', r.date::timestamp) = date_trunc('year', current_date::timestamp)), 0) as year_hours,
      coalesce(sum(r.duration), 0) as total_hours
    from public.overtime_users u
    left join public.overtime_records r on r.user_id = u.id
    group by u.id
  )
  select
    u.id,
    u.username,
    u.role,
    u.role_key,
    u.is_admin,
    u.exp_override,
    s.today_hours,
    s.week_hours,
    s.month_hours,
    s.year_hours,
    s.total_hours,
    coalesce(u.exp_override, round(s.total_hours * 10)) as total_exp,
    public.app_level(coalesce(u.exp_override, round(s.total_hours * 10))) as level,
    public.app_title(coalesce(u.exp_override, round(s.total_hours * 10))) as title
  from public.overtime_users u
  join sums s on s.id = u.id
  order by case coalesce(p_mode, 'week')
    when 'day' then s.today_hours
    when 'week' then s.week_hours
    when 'month' then s.month_hours
    when 'year' then s.year_hours
    when 'level' then public.app_level(coalesce(u.exp_override, round(s.total_hours * 10)))
    else s.total_hours
  end desc,
  coalesce(u.exp_override, round(s.total_hours * 10)) desc,
  u.username asc;
end;
$$;

grant execute on function public.app_ensure_admin() to anon, authenticated;
grant execute on function public.app_current_user(text) to anon, authenticated;
grant execute on function public.app_login(text, text) to anon, authenticated;
grant execute on function public.app_register(text, text, text, text, text) to anon, authenticated;
grant execute on function public.app_my_records(text) to anon, authenticated;
grant execute on function public.app_save_record(text, jsonb) to anon, authenticated;
grant execute on function public.app_delete_record(text, text) to anon, authenticated;
grant execute on function public.app_clear_records(text, text) to anon, authenticated;
grant execute on function public.app_save_user(text, jsonb) to anon, authenticated;
grant execute on function public.app_delete_user(text, text) to anon, authenticated;
grant execute on function public.app_leaderboard(text, text) to anon, authenticated;
