# 2F Overtime Dungeon

一个 8bit 风格的加班记录、统计和排行小应用。项目为纯静态页面，数据保存在浏览器本地 `localStorage` 中。

## 文件结构

- `index.html`：网站入口文件，GitHub Pages 和 Vercel 都会默认识别。
- `README.md`：项目说明和部署说明。
- `README_v8.txt`：历史说明文件，可保留作归档。
- `加班排名等级计算表.xlsx`：历史等级计算表，可按需要保留或删除。

## 本地预览

直接用浏览器打开 `index.html` 即可运行。

也可以用任意静态服务器预览，站点根目录指向当前文件夹即可。

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

这是纯前端本地应用，没有后端数据库。不同浏览器、不同设备之间的数据不会自动同步。
