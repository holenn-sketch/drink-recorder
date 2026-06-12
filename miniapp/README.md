# 饮酒记录器小程序

这是微信小程序原生版本，直接用微信开发者工具导入当前 `miniapp` 目录即可。

## 导入前

1. 将 `project.config.json` 里的 `appid` 改成你的小程序 AppID，或在微信开发者工具导入时填写。
2. 确认 `app.js` 里的 `apiBase` 是你的 Worker 地址：

```js
apiBase: 'https://drink-recorder-api.holenn.workers.dev'
```

## 小程序后台配置

在微信公众平台小程序后台配置服务器域名：

```text
request 合法域名：https://drink-recorder-api.holenn.workers.dev
socket 合法域名：wss://drink-recorder-api.holenn.workers.dev
```

## Cloudflare secrets

在仓库根目录的 `worker` 文件夹执行：

```bash
npx wrangler secret put WECHAT_MINI_APP_ID
npx wrangler secret put WECHAT_MINI_APP_SECRET
npx wrangler secret put STATE_SECRET
npx wrangler secret put IDENTITY_TOKEN_SECRET
npx wrangler deploy
```

AppSecret 只填到 Cloudflare secret，不要写入小程序代码或 GitHub。
