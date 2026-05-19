# 2F Overtime Dungeon

一个 8bit 风格的加班记录、统计和排行小应用。项目是纯静态页面，账号和加班记录通过 Supabase 保存，所以换浏览器、换电脑后也能看到同一套数据。

## 文件结构

- `index.html`：网站入口文件，GitHub Pages 和 Vercel 都会默认识别。
- `app-data.js`：统一管理 Supabase 数据同步、本地缓存、当前登录状态和页面偏好。
- `app.js`：应用交互和页面渲染逻辑。
- `README.md`：项目说明和部署说明。

## Supabase 建表

如果要使用“排行榜显示用户名和汇总，个人明细记录私密”的版本，优先执行仓库里的 `supabase-private-rpc.sql`。这份 SQL 会创建表、登录会话、RPC 函数，并开启 RLS，前端只通过函数读取允许公开的数据。

旧的简单建表方式只适合临时测试，不适合多人隐私使用。

在 Supabase 项目里进入 `SQL Editor`，执行下面的 SQL：

```sql
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
```

如果这是内部小工具，最简单的方式是在 Supabase 的 `Authentication -> Policies` 里给这两张表开放 anon 读写，或者先关闭 RLS。更安全的生产做法是接入 Supabase Auth，再按登录用户配置策略。

## 页面配置

推荐先打开 `app-config.js`，把 Supabase 信息填进去：

```js
window.SUPABASE_CONFIG = {
  url: "https://xxxx.supabase.co",
  anonKey: "你的 anon public key"
};
```

这样部署后，所有浏览器打开页面都会自动连接同一个 Supabase。

也可以不改文件，首次打开页面时在登录页填写：

- `Supabase URL`：Supabase 项目设置里的 Project URL。
- `Supabase anon key`：Supabase 项目设置里的 anon public key。

保存配置后，注册账号、添加加班、删除记录都会写入 Supabase。旧浏览器里如果已经有本地缓存，而 Supabase 还是空库，首次同步会自动把本地账号和记录上传到 Supabase。

## 本地预览

直接用浏览器打开 `index.html` 即可运行。

如果后续拆成多个页面，建议用同一个静态服务器地址预览，站点根目录指向当前文件夹即可。

## GitHub Pages 部署

1. 新建 GitHub 仓库。
2. 上传本文件夹内容，确保 `index.html` 位于仓库根目录。
3. 进入仓库 `Settings` -> `Pages`。
4. Source 选择 `Deploy from a branch`，分支选择 `main`，目录选择 `/root`。
5. 保存后等待 GitHub Pages 生成访问地址。

## Vercel 部署

1. 在 Vercel 导入这个 GitHub 仓库。
2. Framework Preset 选择 `Other`。
3. Build Command 留空。
4. Output Directory 留空或填写 `.`。
5. 部署即可。

## 注意

当前密码仍是明文保存在 Supabase 表里，适合内部轻量使用。要做成公开或长期生产系统，建议改为 Supabase Auth 登录，不再自己保存密码字段。
