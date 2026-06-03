/**
 * x402-Crypto-API MCP Adapter
 * 
 * 将 x402 API 转换为标准 MCP 协议兼容的服务器
 * 使用 @modelcontextprotocol/sdk
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamable-http.js";

const X402_API_BASE = "https://spectacular-strength-production-0494.up.railway.app";

const server = new McpServer({
  name: "x402-crypto-api",
  version: "1.0.0",
  description: "Cryptocurrency price API with x402 payment protocol. Get real-time BTC, ETH prices, market data, and trending coins."
});

// Tool 1: Get Bitcoin Price
server.tool(
  "btc_price",
  "Get current Bitcoin (BTC) price",
  {
    currency: z.string().optional().describe("Target currency (default: USD)")
  },
  async ({ currency = "USD" }) => {
    try {
      const response = await fetch(`${X402_API_BASE}/api/crypto/btc/price?currency=${currency}`);
      const data = await response.json();
      return {
        content: [{
          type: "text",
          text: JSON.stringify(data, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Error fetching BTC price: ${error.message}`
        }],
        isError: true
      };
    }
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
    try {
      const response = await fetch(`${X402_API_BASE}/api/crypto/eth/price?currency=${currency}`);
      const data = await response.json();
      return {
        content: [{
          type: "text",
          text: JSON.stringify(data, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Error fetching ETH price: ${error.message}`
        }],
        isError: true
      };
    }
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
    try {
      const response = await fetch(`${X402_API_BASE}/api/crypto/market?limit=${limit}`);
      const data = await response.json();
      return {
        content: [{
          type: "text",
          text: JSON.stringify(data, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Error fetching market data: ${error.message}`
        }],
        isError: true
      };
    }
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
    try {
      const response = await fetch(`${X402_API_BASE}/api/crypto/trending?limit=${limit}`);
      const data = await response.json();
      return {
        content: [{
          type: "text",
          text: JSON.stringify(data, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Error fetching trending coins: ${error.message}`
        }],
        isError: true
      };
    }
  }
);

// Tool 5: Check API Status
server.tool(
  "api_status",
  "Check the x402 API service status and payment requirements",
  {},
  async () => {
    try {
      const response = await fetch(`${X402_API_BASE}/status`);
      const data = await response.json();
      return {
        content: [{
          type: "text",
          text: JSON.stringify(data, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Error checking API status: ${error.message}`
        }],
        isError: true
      };
    }
  }
);

// Tool 6: Get Price for Any Coin
server.tool(
  "coin_price",
  "Get price for any supported cryptocurrency",
  {
    symbol: z.string().describe("Coin symbol (e.g., BTC, ETH, SOL)"),
    currency: z.string().optional().describe("Target currency (default: USD)")
  },
  async ({ symbol, currency = "USD" }) => {
    try {
      const response = await fetch(`${X402_API_BASE}/api/crypto/price?symbol=${symbol.toUpperCase()}&currency=${currency}`);
      const data = await response.json();
      return {
        content: [{
          type: "text",
          text: JSON.stringify(data, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Error fetching price for ${symbol}: ${error.message}`
        }],
        isError: true
      };
    }
  }
);

// Start the server with HTTP transport
const transport = new StreamableHTTPServerTransport({
  port: 3000,
  onstart: async (server) => {
    console.log("x402-Crypto-API MCP Adapter running on http://localhost:3000/mcp");
  }
});

async function main() {
  await transport.start();
  await server.run(transport);
}

main().catch(console.error);
