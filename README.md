# 饮酒记录器

这是一个饮酒记录器网页项目。

- `index.html`：GitHub Pages 网页版。
- `worker/`：Cloudflare Workers API，用于多人实时同步。

## 使用方式

直接用浏览器打开 `index.html` 即可运行本地模式。

也可以部署到 GitHub Pages。没有配置 `config.js` 的 `apiBase` 时，应用会自动保持本地模式；配置后端地址后，会开启房间同步和分享链接。

数据会保存在当前浏览器的 `localStorage` 中：

- `drink_people_records`
- `drink_quick_amounts`
- `drink_user_profile`
- `drink_sync_client_id`

## 功能

- 添加任意数量参与者
- 按快捷酒量增加或减少杯数
- 自定义、编辑、删除、恢复默认快捷酒量
- 单人清零、删除
- 全部清零、清空全部
- 总人数、总杯数、最高酒量统计
- 添加顺序 / 酒量从高到低排序
- 后端可用时：多人房间同步、WebSocket 实时更新、最近操作显示“谁改了谁的杯数”

杯数内部使用 `quarters` 计量，`1 quarter = 0.25 杯`，避免浮点数累积误差。

## 开启多人同步

前端仍然可以放在 GitHub Pages，后端推荐部署 `worker/` 到 Cloudflare Workers。

1. 登录 Wrangler：

```bash
npx wrangler login
```

2. 检查 `worker/wrangler.toml`：

```toml
[vars]
ALLOWED_ORIGINS = "https://holenn-sketch.github.io,http://localhost:8787,http://127.0.0.1:5500"
```

3. 部署 Worker：

```bash
cd worker
npx wrangler deploy
```

部署完成后会得到类似 `https://drink-recorder-api.<你的账号>.workers.dev` 的地址。

4. 修改前端 `config.js`：

```js
window.DRINK_CONFIG = {
  apiBase: 'https://drink-recorder-api.<你的账号>.workers.dev'
};
```

然后提交并推送到 GitHub Pages 仓库，网页会自动切换到在线同步模式。

如果浏览器一直显示“同步断开”，先直接访问 Worker 的 `/api/health`。如果 `workers.dev` 域名在当前网络下超时，需要给 Worker 绑定一个可访问的自定义域名，然后把 `config.js` 的 `apiBase` 改成这个自定义域名。
