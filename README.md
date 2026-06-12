# 饮酒记录器

这是一个饮酒记录器项目，包含两个前端：

- `index.html`：GitHub Pages 网页版。
- `miniapp/`：微信小程序原生版。

多人实时同步和微信身份登录通过 `worker/` 里的 Cloudflare Workers API 完成。小程序版本采用木桌酒单拟物风格，使用 WXSS 渐变、阴影、内阴影、边框、高光和 active 按压状态表现实体质感。

## 使用方式

直接用浏览器打开 `index.html` 即可运行本地模式。

也可以部署到 GitHub Pages。没有配置 `config.js` 的 `apiBase` 时，应用会自动保持本地模式；配置后端地址后，会开启房间同步、分享链接和微信授权入口。

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
- 后端可用时：微信授权登录后同步微信昵称和头像到当前用户身份

杯数内部使用 `quarters` 计量，`1 quarter = 0.25 杯`，避免浮点数累积误差。

## 微信小程序版

小程序工程在：

```text
miniapp/
```

用微信开发者工具导入 `miniapp` 文件夹即可。导入时使用你的小程序 AppID，或者先把 `miniapp/project.config.json` 里的：

```json
"appid": "touristappid"
```

改成你自己的小程序 AppID。

### 小程序登录后端配置

小程序不能把 AppSecret 放在前端，所以需要 Cloudflare Worker 帮它用 `wx.login()` 的 code 换 openid。请在 `worker` 目录设置这些 secret：

```bash
cd worker
npx wrangler secret put WECHAT_MINI_APP_ID
npx wrangler secret put WECHAT_MINI_APP_SECRET
npx wrangler secret put STATE_SECRET
npx wrangler secret put IDENTITY_TOKEN_SECRET
npx wrangler deploy
```

`WECHAT_MINI_APP_ID` 填小程序 AppID，`WECHAT_MINI_APP_SECRET` 填小程序 AppSecret。`STATE_SECRET` 和 `IDENTITY_TOKEN_SECRET` 用两段不同随机字符串，例如：

```bash
openssl rand -base64 32
```

### 小程序服务器域名

进入微信公众平台小程序后台：

```text
开发管理 → 开发设置 → 服务器域名
```

添加：

```text
request 合法域名：https://drink-recorder-api.holenn.workers.dev
socket 合法域名：wss://drink-recorder-api.holenn.workers.dev
```

如果微信后台不接受 `workers.dev`，需要给 Worker 绑定自定义域名，然后把 `miniapp/app.js` 的 `apiBase` 改成自定义域名。

### 小程序昵称和头像

小程序不能静默读取用户微信昵称和头像。当前实现使用：

- `wx.login()`：获得可验证身份令牌。
- `input type="nickname"`：用户主动填写/选择昵称。
- `button open-type="chooseAvatar"`：用户主动选择头像。

多人同步时，操作记录会带上当前用户保存的昵称。

## 开启多人同步

前端仍然可以放在 GitHub Pages，后端推荐部署 `worker/` 到 Cloudflare Workers。

1. 登录 Wrangler：

```bash
npx wrangler login
```

2. 检查 `worker/wrangler.toml`：

```toml
[vars]
ALLOWED_ORIGINS = "https://holenn-sketch.github.io,https://servicewechat.com,http://localhost:8787,http://127.0.0.1:5500"
WECHAT_MODE = "mp"
```

3. 设置线上 secret，不要写进代码仓库：

```bash
cd worker
npx wrangler secret put WECHAT_APP_ID
npx wrangler secret put WECHAT_APP_SECRET
npx wrangler secret put STATE_SECRET
npx wrangler secret put IDENTITY_TOKEN_SECRET
```

`STATE_SECRET` 和 `IDENTITY_TOKEN_SECRET` 建议使用两段不同的高强度随机字符串。

4. 部署 Worker：

```bash
cd worker
npx wrangler deploy
```

部署完成后会得到类似 `https://drink-recorder-api.<你的账号>.workers.dev` 的地址。

5. 修改前端 `config.js`：

```js
window.DRINK_CONFIG = {
  apiBase: 'https://drink-recorder-api.<你的账号>.workers.dev',
  wechatMode: 'mp'
};
```

然后提交并推送到 GitHub Pages 仓库，网页会自动切换到在线同步模式。

## 微信授权配置

微信授权不能只靠 GitHub Pages 完成，因为 `appsecret` 不能暴露在前端。当前实现的安全边界是：

- 前端点击“微信授权”后跳转到 Worker。
- Worker 使用微信 `code` 和服务端保存的 `WECHAT_APP_SECRET` 换取微信用户信息。
- Worker 只把签名后的临时身份令牌、昵称和头像返回给前端。
- 前端将昵称显示为当前身份，多人同步时操作记录会带上这个身份。

如果使用公众号网页授权，`wechatMode` 保持 `mp`，并在微信公众平台把 Worker 或绑定到 Worker 的自定义域名配置为网页授权域名。如果使用开放平台网页扫码登录，把 `wechatMode` 改为 `open`，并使用开放平台应用的 AppID/AppSecret。

微信昵称和头像必须由用户主动授权后才能读取，不能静默读取。

### 公众号网页授权模式

适合用户从微信内打开这个网站。配置项保持：

```js
window.DRINK_CONFIG = {
  apiBase: 'https://drink-recorder-api.holenn.workers.dev',
  wechatMode: 'mp'
};
```

微信后台需要配置的网页授权域名是 Worker 域名，不是 GitHub Pages 域名：

```text
drink-recorder-api.holenn.workers.dev
```

授权回调地址由 Worker 自动生成：

```text
https://drink-recorder-api.holenn.workers.dev/api/auth/wechat/callback
```

如果微信后台要求上传 `MP_verify_xxx.txt`，把文件名和文件内容分别写入 Cloudflare secrets：

```bash
cd worker
npx wrangler secret put WECHAT_VERIFY_FILENAME
npx wrangler secret put WECHAT_VERIFY_CONTENT
npx wrangler deploy
```

例如文件名是 `MP_verify_abc123.txt`，`WECHAT_VERIFY_FILENAME` 就填 `MP_verify_abc123.txt`，`WECHAT_VERIFY_CONTENT` 填文件里的那一整行内容。

### 开放平台扫码登录模式

适合用户从普通浏览器扫码登录。需要微信开放平台的网站应用已经通过审核。把前端 `config.js` 改为：

```js
window.DRINK_CONFIG = {
  apiBase: 'https://drink-recorder-api.holenn.workers.dev',
  wechatMode: 'open'
};
```

同时把 `worker/wrangler.toml` 的 `WECHAT_MODE` 改为 `open`，然后重新部署 Worker 和 GitHub Pages。
