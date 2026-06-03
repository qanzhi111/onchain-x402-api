# x402-Crypto-API MCP Adapter

本目录包含将 x402-Crypto-API 转换为标准 MCP 协议的适配器代码。

## 问题分析

当前 x402-Crypto-API 的端点结构：
- `GET /health` - 免费健康检查
- `GET /402` - 返回 x402 支付信息
- `GET /status` - 需付费
- `GET /api/crypto/btc/price` - 需付费
- `GET /api/crypto/eth/price` - 需付费
- `GET /api/crypto/market` - 需付费
- `GET /api/crypto/trending` - 需付费

**问题**：这些端点不符合 MCP (Model Context Protocol) 规范。MCP 需要：
1. 支持 `POST /mcp` 或 `POST /` 端点接收 JSON-RPC 2.0 请求
2. 实现标准方法：`tools/list`、`tools/call`
3. 返回标准 MCP 响应格式

## 解决方案

### 方案 A：创建 MCP 适配器服务（推荐）

创建一个独立的 MCP 适配器，将标准 MCP 请求转换为 x402 API 调用。

### 方案 B：静态 Server Card（简单）

在 API 服务器上添加 `/.well-known/mcp/server-card.json` 端点，让 Smithery 可以扫描到元数据。

---

## MCP 适配器代码 (mcp-adapter.js)

```javascript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamable-http.js";

const server = new McpServer({
  name: "x402-crypto-api",
  version: "1.0.0",
  description: "Cryptocurrency price API with x402 payment protocol. Get real-time BTC, ETH prices, market data, and trending coins."
});

const X402_API_BASE = "https://spectacular-strength-production-0494.up.railway.app";

// Tool 1: Get Bitcoin Price
server.tool(
  "btc_price",
  "Get current Bitcoin (BTC) price",
  {
    currency: z.string().optional().describe("Target currency (default: USD)")
  },
  async ({ currency = "USD" }) => {
    const response = await fetch(`${X402_API_BASE}/api/crypto/btc/price?currency=${currency}`);
    const data = await response.json();
    return {
      content: [{
        type: "text",
        text: JSON.stringify(data, null, 2)
      }]
    };
  }
);

// Tool 2: Get Ethereum Price
server.tool(
  "eth_price",
  "Get current Ethereum (ETH) price",
  {
    currency: z.string().optional().describe("Target currency (default: USD)")
  },
  async ({ currency = "USD" }) => {
    const response = await fetch(`${X402_API_BASE}/api/crypto/eth/price?currency=${currency}`);
    const data = await response.json();
    return {
      content: [{
        type: "text",
        text: JSON.stringify(data, null, 2)
      }]
    };
  }
);

// Tool 3: Get Market Data
server.tool(
  "market_data",
  "Get cryptocurrency market data including top coins by market cap",
  {
    limit: z.number().optional().describe("Number of coins to return (default: 10, max: 100)")
  },
  async ({ limit = 10 }) => {
    const response = await fetch(`${X402_API_BASE}/api/crypto/market?limit=${limit}`);
    const data = await response.json();
    return {
      content: [{
        type: "text",
        text: JSON.stringify(data, null, 2)
      }]
    };
  }
);

// Tool 4: Get Trending Coins
server.tool(
  "trending_coins",
  "Get trending cryptocurrency coins",
  {
    limit: z.number().optional().describe("Number of trending coins to return (default: 10)")
  },
  async ({ limit = 10 }) => {
    const response = await fetch(`${X402_API_BASE}/api/crypto/trending?limit=${limit}`);
    const data = await response.json();
    return {
      content: [{
        type: "text",
        text: JSON.stringify(data, null, 2)
      }]
    };
  }
);

// Tool 5: Check API Status
server.tool(
  "api_status",
  "Check the x402 API service status and payment requirements",
  {},
  async () => {
    const response = await fetch(`${X402_API_BASE}/status`);
    const data = await response.json();
    return {
      content: [{
        type: "text",
        text: JSON.stringify(data, null, 2)
      }]
    };
  }
);

// Export for stdio transport
export default server;
```

---

## MCP 适配器代码 (Python 版本)

```python
"""
x402-Crypto-API MCP Adapter (Python)
使用 FastMCP 框架
"""

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("x402-crypto-api")

X402_API_BASE = "https://spectacular-strength-production-0494.up.railway.app"


@mcp.tool()
async def btc_price(currency: str = "USD") -> str:
    """Get current Bitcoin (BTC) price"""
    import httpx
    async with httpx.AsyncClient() as client:
        response = await client.get(f"{X402_API_BASE}/api/crypto/btc/price", params={"currency": currency})
        return response.text


@mcp.tool()
async def eth_price(currency: str = "USD") -> str:
    """Get current Ethereum (ETH) price"""
    import httpx
    async with httpx.AsyncClient() as client:
        response = await client.get(f"{X402_API_BASE}/api/crypto/eth/price", params={"currency": currency})
        return response.text


@mcp.tool()
async def market_data(limit: int = 10) -> str:
    """Get cryptocurrency market data"""
    import httpx
    async with httpx.AsyncClient() as client:
        response = await client.get(f"{X402_API_BASE}/api/crypto/market", params={"limit": limit})
        return response.text


@mcp.tool()
async def trending_coins(limit: int = 10) -> str:
    """Get trending cryptocurrency coins"""
    import httpx
    async with httpx.AsyncClient() as client:
        response = await client.get(f"{X402_API_BASE}/api/crypto/trending", params={"limit": limit})
        return response.text


@mcp.tool()
async def api_status() -> str:
    """Check API status and payment requirements"""
    import httpx
    async with httpx.AsyncClient() as client:
        response = await client.get(f"{X402_API_BASE}/status")
        return response.text


if __name__ == "__main__":
    mcp.run()
```

---

## 静态 Server Card (server-card.json)

如果暂时不想修改 API 代码，可以添加静态 Server Card：

```json
{
  "serverInfo": {
    "name": "x402-crypto-api",
    "version": "1.0.0"
  },
  "authentication": {
    "required": false
  },
  "tools": [
    {
      "name": "btc_price",
      "description": "Get current Bitcoin (BTC) price in USD or specified currency",
      "inputSchema": {
        "type": "object",
        "properties": {
          "currency": {
            "type": "string",
            "description": "Target currency (default: USD)"
          }
        }
      }
    },
    {
      "name": "eth_price",
      "description": "Get current Ethereum (ETH) price in USD or specified currency",
      "inputSchema": {
        "type": "object",
        "properties": {
          "currency": {
            "type": "string",
            "description": "Target currency (default: USD)"
          }
        }
      }
    },
    {
      "name": "market_data",
      "description": "Get cryptocurrency market data including top coins by market cap",
      "inputSchema": {
        "type": "object",
        "properties": {
          "limit": {
            "type": "number",
            "description": "Number of coins to return (default: 10)"
          }
        }
      }
    },
    {
      "name": "trending_coins",
      "description": "Get trending cryptocurrency coins",
      "inputSchema": {
        "type": "object",
        "properties": {
          "limit": {
            "type": "number",
            "description": "Number of trending coins (default: 10)"
          }
        }
      }
    }
  ],
  "resources": [],
  "prompts": []
}
```

---

## 部署 MCP 适配器

### 选项 1: Railway 部署（推荐）

```bash
# 安装依赖
npm install @modelcontextprotocol/sdk zod

# 本地运行
node mcp-adapter.js
```

### 选项 2: 使用 smithery.yaml

在项目根目录创建 `smithery.yaml`：

```yaml
startCommand:
  type: stdio
  configSchema:
    type: object
    properties: {}
  commandFunction: |-
    (config) => ({
      command: "node",
      args: ["./mcp-adapter.js"]
    })
```

---

## Smithery 注册命令

```bash
npm install -g @smithery/cli@latest
smithery auth login
smithery mcp publish "https://your-mcp-adapter.railway.app/mcp" -n @yourname/x402-crypto-api
```

---

## AgenticMarket 注册要求

AgenticMarket 要求 MCP 服务器必须：
1. ✅ 部署并可通过公共 HTTPS URL 访问
2. ✅ 遵循 MCP 规范
3. ✅ 暴露至少一个工具供 MCP 客户端发现
4. ✅ 正确响应 `tools/list` 请求
5. ✅ 验证 `x-agenticmarket-secret` 请求头

AgenticMarket 注册步骤：
1. 创建账户: https://agenticmarket.dev
2. 生成 API Key
3. 提交服务器: https://agenticmarket.dev/dashboard/submit
4. 等待审核（通常24小时内）
5. 获取 proxy secret 并添加到服务器验证逻辑
