# 2F Overtime Dungeon

一个 8bit 风格的加班记录、统计和排行小应用。

## 项目结构

- 前端静态页面：\`index.html\`、\`app.js\`、\`app-data.js\`
- Vercel 后端：\`api/store.js\`
- Cloudflare Pages 后端：\`functions/api/store.js\`
- 数据库：飞书多维表格

前端统一通过 \`/api/store\` 调用后端。部署到 Vercel 时使用 \`api/store.js\`；部署到 Cloudflare Pages 时使用 \`functions/api/store.js\`。两种后端共用相同的飞书数据结构和环境变量名称。

## 飞书表结构

需要一个多维表格文件，里面有两张数据表。

\`users\`

| 字段名 | 类型 |
| --- | --- |
| username | 文本 |
| password | 文本 |
| role | 单选，建议有 \`admin\` 和 \`user\` |
| active | 复选框 |

\`records\`

| 字段名 | 类型 |
| --- | --- |
| username | 文本 |
| date | 日期 |
| startTime | 文本 |
| endTime | 文本 |
| hours | 数字 |
| type | 单选 |
| note | 文本 |

## Cloudflare Pages 部署（推荐用于当前 Cloudflare 网站）

1. Cloudflare Pages 项目连接 GitHub 仓库 \`owenlu2024/overtime-dungeon\`，生产分支使用 \`main\`。
2. 项目根目录设为仓库根目录。
3. 这是纯静态页面，不需要构建命令；构建输出目录使用项目静态文件所在目录（仓库根目录）。
4. 仓库中的 \`functions/api/store.js\` 会将 \`POST /api/store\` 路由到 Cloudflare Pages Function。
5. 在 Cloudflare 控制台进入 **Workers & Pages → 你的 Pages 项目 → Settings → Variables and Secrets**，分别为 Production 和 Preview 环境配置下列变量：

| 变量名 | 用途 | 建议类型 |
| --- | --- | --- |
| \`FEISHU_APP_ID\` | 飞书应用 App ID | Text |
| \`FEISHU_APP_SECRET\` | 飞书应用 App Secret | Secret（Encrypt） |
| \`FEISHU_APP_TOKEN\` | 多维表格 app_token | Text |
| \`FEISHU_USERS_TABLE_ID\` | users 表 table_id | Text |
| \`FEISHU_RECORDS_TABLE_ID\` | records 表 table_id | Text |

6. 保存变量后，重新部署最新的 \`main\` 分支提交。Cloudflare Pages Function 运行时从 \`context.env\` 读取这些值，不要把密钥写入前端文件。

## Vercel 部署

Vercel 使用 \`api/store.js\`。在 Vercel 项目的 \`Settings -> Environment Variables\` 中配置同名的五个变量：

\`\`\`txt
FEISHU_APP_ID=你的飞书 App ID
FEISHU_APP_SECRET=你的飞书 App Secret
FEISHU_APP_TOKEN=多维表格 app_token
FEISHU_USERS_TABLE_ID=users 表 table_id
FEISHU_RECORDS_TABLE_ID=records 表 table_id
\`\`\`

这些变量不要加 \`NEXT_PUBLIC_\`。

## 本地预览

纯前端页面可以直接打开 \`index.html\`，但飞书同步接口需要对应的平台函数运行环境。Cloudflare Pages Functions 可使用 Wrangler Pages 本地开发环境测试；Vercel 后端可使用 Vercel 本地开发环境测试。

## 说明

当前密码仍是明文保存在飞书多维表格里，适合内部轻量使用。不要把 \`FEISHU_APP_SECRET\` 写进前端代码或公开仓库。
