# x402 API — Render 部署清单

> 生成时间：2026-10-01  
> 仓库：`onchain-shadow/onchain-x402-api`（main 分支，私有仓库）  
> 服务端口：由 Render 自动分配（内部 `PORT` 环境变量）

---

## 部署前确认（已完成 ✅）

| 检查项 | 状态 | 说明 |
|--------|------|------|
| `npm test` 37/37 全过 | ✅ | 含 facilitator 模式、onchain 模式、PDF 下载、重放防护 |
| `GET /health` → 200 | ✅ | 返回 `{"status":"ok",...}` |
| `GET /api/status` → 200 | ✅ | 返回定价、钱包地址、支付模式 |
| 无 payment 头 → 402 | ✅ | 返回 x402 支付要求 JSON |
| 伪造 X-PAYMENT → 402 | ✅ | fail-closed：`"X-PAYMENT is not valid base64 JSON"` |
| `private-products/` 未跟踪 | ✅ | `.gitignore` 已排除，`git ls-files` 为空 |
| `render.yaml` 就绪 | ✅ | 免费 plan，healthCheckPath=/health |

---

## 分步部署操作

### Step 1 — 推送代码到 GitHub（如尚未推送）

```bash
cd /Coze/Drive/扣子/所有对话/主对话/x402-api
git add -A
git commit -m "deploy: x402 API v1.2.0 ready for Render"
git push origin main
```

> ⚠️ 推送前再次确认 `git ls-files private-products/` 为空，PDF 文件绝不能进入仓库。

### Step 2 — 登录 Render Dashboard

1. 打开 https://dashboard.render.com
2. 使用 GitHub 账号登录（确保能看到私有仓库 `onchain-shadow/onchain-x402-api`）

### Step 3 — 创建 Blueprint 服务

1. 点击 **「New +」** → **「Blueprint」**
2. 选择仓库 **`onchain-shadow/onchain-x402-api`**，点击 **Connect**
3. Render 会自动读取 `render.yaml`，识别为 Node.js 免费 Web 服务

### Step 4 — 填写环境变量

Render 会提示你填写 `render.yaml` 中标记为 `sync: false` 的变量：

| 环境变量 | 值 | 必填 |
|----------|-----|------|
| `WALLET_ADDRESS` | `0x801B27e126d91D99A70cd31ffc8BC867B329023D` | ✅ **必填** — Base 主网 USDC 收款地址 |
| `PAYMENT_MODE` | `onchain` | ✅ 已默认，确认即可 |
| `FACILITATOR_URL` | 留空 | 可选，仅 facilitator 模式需要 |
| `BASE_RPC_URLS` | 留空 | 可选，默认使用公共 RPC |
| `COINGECKO_API_KEY` | 留空 | 可选，提高速率限制 |
| `ETHERSCAN_API_KEY` | 留空 | 可选，增强分析功能 |

> `INTERNAL_SECRET` 由 Render 自动生成（`generateValue: true`），无需手动填写。  
> `NODE_VERSION` 已设为 `22`。

### Step 5 — 部署

1. 点击 **「Create Web Service」**（或 「Apply」）
2. 等待构建完成（`npm install` → 启动 `node server.js`）
3. Render 会自动检测 `/health` 端点返回 200 作为健康检查

### Step 6 — 获取服务地址

部署成功后，Render 会分配一个 HTTPS 地址，格式如：

```
https://onchain-shadow-x402-api.onrender.com
```

在 Dashboard → 服务页面顶部的 URL 处可找到。

---

## 部署后验证（拿到地址后执行）

将 `<BASE_URL>` 替换为实际 Render 地址，执行以下验证：

```bash
# 1. 健康检查
curl -s https://<BASE_URL>/health
# 预期: {"status":"ok","timestamp":...,"uptime":...}

# 2. API 状态
curl -s https://<BASE_URL>/api/status
# 预期: 返回 pricing/wallet/mode 信息

# 3. 付费端点无 payment → 402
curl -s -w "\n%{http_code}" https://<BASE_URL>/api/crypto/price/ETH
# 预期: HTTP 402 + x402 支付要求 JSON

# 4. 付费端点伪造 payment → 402（不得放行）
curl -s -w "\n%{http_code}" -H "X-PAYMENT: fake" https://<BASE_URL>/api/crypto/price/ETH
# 预期: HTTP 402（fail-closed）
```

> ⚠️ 免费实例在 ~15 分钟无流量后会休眠，首次请求可能需要 30-60 秒冷启动。

---

## 回传给主 Agent 的信息

部署成功并完成验证后，请将以下信息回传：

1. **Render 服务地址**：`https://onchain-shadow-x402-api.onrender.com`（实际 URL）
2. **`/health` 实测结果**：HTTP 状态码 + 响应体摘要
3. **`/api/crypto/price/ETH` 402 实测结果**：确认无 payment 头时返回 402
4. **PAYMENT_MODE 确认**：`onchain`
5. **WALLET_ADDRESS 确认**：`0x801B27e126d91D99A70cd31ffc8BC867B329023D`

---

## 注意事项

- **不要推送 `private-products/`**：已在 `.gitignore` 排除，PDF 文件仅存在于本地
- **不要泄露 `INTERNAL_SECRET`**：Render 自动生成，用于 CROO provider 内部通信
- **不要泄露钱包私钥**：只用到公开地址，服务器上无私钥
- **免费实例限制**：每月 750 小时，休眠后冷启动 ~30-60s
- **DNS/域名**：Render 默认提供 `.onrender.com` 子域名，可后续绑定自定义域名
