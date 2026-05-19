# 2F Overtime Dungeon

一个 8bit 风格的加班记录、统计和排行小应用。

当前版本使用：

- 前端静态页面：`index.html`、`app.js`、`app-data.js`
- Vercel 中转接口：`api/store.js`
- 数据库：飞书多维表格

## 飞书表结构

需要一个多维表格文件，里面有两张数据表。

`users`

| 字段名 | 类型 |
| --- | --- |
| username | 文本 |
| password | 文本 |
| role | 单选，建议有 `admin` 和 `user` |
| active | 复选框 |

`records`

| 字段名 | 类型 |
| --- | --- |
| username | 文本 |
| date | 日期 |
| startTime | 文本 |
| endTime | 文本 |
| hours | 数字 |
| type | 单选 |
| note | 文本 |

## Vercel 环境变量

在 Vercel 项目的 `Settings -> Environment Variables` 里配置：

```txt
FEISHU_APP_ID=你的飞书 App ID
FEISHU_APP_SECRET=你的飞书 App Secret
FEISHU_APP_TOKEN=多维表格 app_token
FEISHU_USERS_TABLE_ID=users 表 table_id
FEISHU_RECORDS_TABLE_ID=records 表 table_id
```

这些变量不要加 `NEXT_PUBLIC_`。

## 本地预览

纯前端页面可以直接打开 `index.html`，但飞书同步接口需要 Vercel Serverless Function 环境。要完整测试读写，请部署到 Vercel 或用 Vercel 本地开发环境运行。

## 说明

当前密码仍是明文保存在飞书多维表格里，适合内部轻量使用。不要把 `FEISHU_APP_SECRET` 写进前端代码或公开仓库。
