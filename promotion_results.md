# x402-Crypto-API MCP 市场注册结果报告

## 任务概述

为 x402-Crypto-API 提交到 Smithery 和 AgenticMarket 等 MCP 市场目录。

## API 基本信息

- **线上地址**: https://spectacular-strength-production-0494.up.railway.app
- **GitHub仓库**: https://github.com/qanzhi111/x402-crypto-api
- **x402Scout已注册**: ID 24655a6d-3a75-473f-b8ed-ac8823b4e045
- **收款钱包**: 0x801B27e126d91D99A70cd31ffc8BC867B329023D (Base链)
- **价格**: 每次请求 $0.001

---

## 一、Smithery 注册

### 1.1 注册方式

Smithery 提供两种发布方式：

#### 方式 A：URL 方式（推荐）

1. 访问 https://smithery.ai/new
2. 使用 GitHub 账号登录
3. 输入 MCP 服务器的公共 HTTPS URL
4. 完成发布流程

#### 方式 B：CLI 方式

```bash
# 安装 CLI
npm install -g @smithery/cli@latest

# 登录
smithery auth login

# 发布 URL-based 服务器
smithery mcp publish "https://your-mcp-server.com/mcp" -n @yourname/x402-crypto-api
```

### 1.2 Smithery 要求

- ✅ Streamable HTTP transport
- ✅ OAuth 支持（如果需要认证）
- ✅ 无需客户端注册（Smithery 通过 Client ID Metadata Documents 自动处理）
- 需要实现标准的 MCP 协议端点

### 1.3 当前问题

**x402 API 不符合 MCP 协议规范**。当前端点：
- `GET /health` - 免费健康检查
- `GET /402` - 返回 x402 支付信息
- `GET /status` - 需付费
- `GET /api/crypto/btc/price` - 需付费

这些是 REST API 端点，不是 MCP 协议。需要创建 MCP 适配器。

### 1.4 解决方案

#### 方案 A：创建 MCP 适配器（已提供代码）

已在 `./x402-api/mcp-adapter.js` 创建完整的 MCP 适配器：

**工具列表**：
1. `btc_price` - 获取比特币价格
2. `eth_price` - 获取以太坊价格
3. `market_data` - 获取市场数据
4. `trending_coins` - 获取热门币种
5. `api_status` - 检查 API 状态
6. `coin_price` - 获取任意币种价格

**部署后可用**：
```bash
smithery mcp publish "https://your-mcp-adapter.railway.app/mcp" -n @yourname/x402-crypto-api
```

#### 方案 B：静态 Server Card

如果无法快速部署 MCP 适配器，可以添加静态 Server Card 让 Smithery 扫描：

已在 `./x402-api/server-card.json` 提供完整的 server card JSON。

### 1.5 Smithery 注册待办

- [ ] **部署 MCP 适配器**到 Railway 或其他平台
- [ ] **GitHub 登录** Smithery (https://smithery.ai/new)
- [ ] **提交服务器 URL**
- [ ] **完成发布流程**

---

## 二、AgenticMarket 注册

### 2.1 注册流程

AgenticMarket 是付费 MCP 服务器市场，用户安装后付费使用。

#### Step 1: 创建账户
访问 https://agenticmarket.dev 并注册账号，验证邮箱。

#### Step 2: 生成 API Key
1. Dashboard → API Key
2. 点击 Generate Key
3. 复制保存（只显示一次）

#### Step 3: 提交服务器
访问 https://agenticmarket.dev/dashboard/submit

**必填字段**：
- **Name**: 服务器唯一标识符（小写，无空格）
  - 推荐：`x402-crypto-api`
- **Description**: 一两句话描述
  - 推荐：`Cryptocurrency price API with x402 payment protocol. Get real-time BTC, ETH prices and market data.`
- **Long description**: 完整的 Markdown 文档
- **MCP server URL**: MCP 服务器的公共 HTTPS 端点
- **Category**: FinTech 或 API
- **Price per call**: 最低 $0.03（注意：AgenticMarket 最低价 $0.03，我们当前 $0.001 可能太低）

#### Step 4: 等待审核
- 审核周期：通常 24 小时内
- 状态会在 Dashboard 显示为 Pending → Approved

#### Step 5: 获取 Proxy Secret
审核通过后，获取 `x-agenticmarket-secret` 并在服务器端验证。

#### Step 6: 测试
```bash
npm install -g agenticmarket
agenticmarket auth am_live_xxxxxxxxxxxxxxxxxxxx
agenticmarket install yourusername/your-server-name
```

### 2.2 AgenticMarket 要求

- ✅ 部署并可通过公共 HTTPS URL 访问
- ✅ 遵循 MCP 规范
- ✅ 暴露至少一个工具
- ✅ 正确响应 `tools/list` 请求
- ✅ 验证 `x-agenticmarket-secret` 请求头

### 2.3 重要提示

**价格差异**：
- 我们的 x402 API：$0.001/请求
- AgenticMarket 最低价：$0.03/请求
- **建议**：在 AgenticMarket 单独定价为 $0.03 或更高

### 2.4 AgenticMarket 注册待办

- [ ] **创建账户** at https://agenticmarket.dev
- [ ] **部署 MCP 适配器**（AgenticMarket 需要真正的 MCP 协议）
- [ ] **提交服务器** at https://agenticmarket.dev/dashboard/submit
- [ ] **等待审核**（24小时内）
- [ ] **添加 secret 验证** 到 MCP 适配器
- [ ] **测试并上线**

---

## 三、其他 MCP 市场

### 3.1 主要 MCP 市场列表

| 市场 | URL | 特点 |
|------|-----|------|
| **Smithery** | smithery.ai | 最大市场，4000+ 服务器 |
| **AgenticMarket** | agenticmarket.dev | 付费服务器市场 |
| **PulseMCP** | pulsemcp.com | 3000+ 服务器，追踪趋势 |
| **MCP.so** | mcp.so | 5000+ 服务器 |
| **mcpservers.org** | mcpservers.org | 从 npm/PyPI/GitHub 聚合 |
| **Glama** | glama.dev | 质量审核，安全性检查 |
| **EveryMCP** | everymcp.com | 600+ 服务器 |
| **Official Registry** | registry.modelcontextprotocol.io | 官方注册表 |

### 3.2 建议优先注册

1. **Smithery** - 最大市场，用户最多
2. **AgenticMarket** - 付费收入，适合货币化
3. **PulseMCP** - 社区驱动，免费提交
4. **mcpservers.org** - 聚合平台，自动收录 npm 包

---

## 四、产出文件

| 文件 | 说明 |
|------|------|
| `./x402-api/mcp-adapter.js` | Node.js MCP 适配器代码 |
| `./x402-api/mcp-adapter.py` | Python MCP 适配器代码 |
| `./x402-api/server-card.json` | MCP Server Card JSON |
| `./x402-api/mcp-adapter-guide.md` | 详细适配器指南 |
| `./x402-api/promotion_results.md` | 本报告 |

---

## 五、部署指南

### 5.1 部署 MCP 适配器到 Railway

1. **Fork 或创建新项目**
2. **添加依赖**：
   ```json
   {
     "dependencies": {
       "@modelcontextprotocol/sdk": "^1.0.0",
       "zod": "^3.22.0"
     }
   }
   ```
3. **添加启动脚本**：
   ```json
   {
     "scripts": {
       "start": "node mcp-adapter.js"
     }
   }
   ```
4. **部署到 Railway**
5. **获取 URL**: `https://your-app.up.railway.app/mcp`

### 5.2 验证部署

```bash
# 发送 MCP tools/list 请求
curl -X POST https://your-app.up.railway.app/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

应该返回：
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [
      {"name": "btc_price", ...},
      {"name": "eth_price", ...},
      ...
    ]
  }
}
```

---

## 六、后续步骤总结

### 立即执行

1. [ ] **部署 MCP 适配器**到 Railway
2. [ ] **注册 Smithery** (smithery.ai/new)
3. [ ] **注册 AgenticMarket** (agenticmarket.dev/dashboard/submit)
4. [ ] **同步调整价格**：AgenticMarket 最低 $0.03

### 邮箱
联系邮箱: kaitongkouzi@coze.email

---

## 七、快速操作指南

### 7.1 立即可用的 Server Card

已将 `server-card.json` 保存到 `./x402-api/server-card.json`

### 7.2 快速部署 MCP 适配器

```bash
cd ./x402-api

# Node.js 版本
npm install
node mcp-adapter.js

# 或 Python 版本
pip install mcp httpx
python mcp-adapter.py
```

### 7.3 一键提交到市场

**Smithery**:
```bash
smithery mcp publish "https://your-mcp-adapter.railway.app/mcp" -n @yourname/x402-crypto-api
```

**AgenticMarket**: 
访问 https://agenticmarket.dev/dashboard/submit

### 7.4 其他市场快速提交

- **PulseMCP**: https://www.pulsemcp.com/submit
- **mcpservers.org**: 通过 GitHub PR 提交
- **MCP.so**: https://mcp.so/submit

---

## 八、MCP 市场注册清单

### Smithery ✅ 已研究
- [ ] 部署 MCP 适配器
- [ ] 访问 https://smithery.ai/new
- [ ] GitHub 登录
- [ ] 提交 URL

### AgenticMarket ✅ 已研究
- [ ] 创建账户 https://agenticmarket.dev
- [ ] 部署 MCP 适配器
- [ ] 提交服务器 https://agenticmarket.dev/dashboard/submit
- [ ] 等待审核
- [ ] 添加 secret 验证

### PulseMCP ⭐ 推荐
- [ ] 访问 https://www.pulsemcp.com/submit
- [ ] 填写表单

### MCP.so ⭐ 推荐
- [ ] 访问 https://mcp.so/submit
- [ ] 填写表单
