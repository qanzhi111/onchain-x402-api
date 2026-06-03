# OnChain Shadow x402 API

**Paid API for AI Agents — Crypto & Web3 Security Data via x402 protocol + CROO CAP integration**

An autonomous, pay-per-call API that provides cryptocurrency data, token security checks, and on-chain investigation reports. Built for AI agents that need Web3 data without subscriptions.

## 💰 Dual Payment Protocol

This API supports two complementary payment protocols:

| Protocol | Use Case | Settlement |
|----------|----------|------------|
| **x402** | Direct HTTP API calls from any client | USDC on Base |
| **CROO CAP** | A2A (Agent-to-Agent) commerce via CROO marketplace | USDC on Base (escrow) |

## 🔌 API Endpoints

| Endpoint | Price | Description |
|----------|-------|-------------|
| `GET /api/crypto/price/:symbol` | $0.01 | Real-time crypto price with 24h change |
| `GET /api/crypto/market` | $0.02 | Top 20 coins market overview |
| `GET /api/crypto/address/:address` | $0.05 | Ethereum address analysis |
| `GET /api/security/token/:address` | $0.05 | Token rug pull risk check |
| `GET /api/security/contract/:address` | $0.10 | Smart contract risk analysis |
| `GET /api/investigate/:address` | $0.25 | Full on-chain investigation report |

### Free Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | API info and endpoint listing |
| `GET /health` | Service health check |
| `GET /api/status` | API status and pricing |

## 🚀 Quick Start

### x402 Protocol (Direct API)

1. **Install the x402 client:**
   ```bash
   npm install @anthropic-ai/x402
   ```

2. **Make a paid request:**
   ```javascript
   const { x402Fetch } = require('@anthropic-ai/x402');

   const response = await x402Fetch('https://your-api-url/api/crypto/price/bitcoin', {
     wallet: yourWallet,
     maxAmount: 0.01
   });
   const data = await response.json();
   ```

3. **Or use curl with manual payment:**
   ```bash
   # First request returns 402 with payment details
   curl https://your-api-url/api/crypto/price/bitcoin
   
   # After payment, include the payment receipt
   curl -H "x-payment: <receipt>" https://your-api-url/api/crypto/price/bitcoin
   ```

### CROO CAP Protocol (A2A Commerce)

This agent is also available on the [CROO Agent Store](https://agent.croo.network/) for agent-to-agent commerce.

1. **Install the CROO SDK:**
   ```bash
   npm install @croo-network/sdk
   ```

2. **Find and call this agent on CROO:**
   ```javascript
   import { CrooClient } from '@croo-network/sdk';

   const client = new CrooClient({ apiKey: 'croo_sk_...' });
   
   // Discover available services
   const services = await client.discoverServices({ tags: ['defi', 'on-chain'] });
   
   // Place an order
   const order = await client.negotiateOrder({
     serviceId: 'onchain-shadow-api',
     input: { symbol: 'bitcoin' }
   });
   ```

3. **Or run as a CROO Provider yourself:**
   ```bash
   cd croo-provider
   cp .env.example .env
   # Edit .env with your CROO SDK key
   npm run croo:provider
   ```

## 🏗️ Architecture

```
┌─────────────┐     x402 (HTTP 402)     ┌──────────────────┐
│  AI Agent   │ ──────────────────────► │  x402-crypto-api │
│  (Client)   │     USDC on Base        │  (Express server) │
└─────────────┘                         └────────┬─────────┘
                                                 │
                                                 │ Internal API calls
                                                 ▼
┌─────────────┐   CROO CAP (WebSocket)   ┌──────────────────┐
│  AI Agent   │ ──────────────────────►  │  CROO Provider   │
│  (Requester)│   USDC Escrow on Base    │  (croo-provider) │
└─────────────┘                          └──────────────────┘
```

The CROO Provider wraps the x402 API endpoints as CROO services. When another agent requests a service through the CROO marketplace, the provider:
1. Accepts the negotiation
2. Receives payment in escrow
3. Calls the internal x402 API (bypassing x402 payment)
4. Delivers the result with proof of delivery
5. Escrow settles automatically

## 🔧 Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `WALLET_ADDRESS` | Yes | - | USDC recipient wallet on Base |
| `PORT` | No | 3000 | Server port |
| `COINGECKO_API_KEY` | No | - | CoinGecko API key for higher rate limits |
| `ETHERSCAN_API_KEY` | No | - | Etherscan API key for on-chain analysis |
| `CROO_API_URL` | CROO only | https://api.croo.network | CROO API endpoint |
| `CROO_WS_URL` | CROO only | wss://api.croo.network/ws | CROO WebSocket endpoint |
| `CROO_SDK_KEY` | CROO only | - | API key from agent.croo.network |
| `X402_API_BASE` | CROO only | http://localhost:3000 | Base URL for internal API calls |

## 🏆 CROO Agent Hackathon

This project is submitted to the [CROO Agent Hackathon](https://dorahacks.io/hackathon/croo-hackathon) under:
- **DeFi / On-chain Ops Agents** — monitoring, alerts, on-chain execution
- **Developer Tooling Agents** — tools for other CAP builders

### Judging Alignment

| Criteria | How We Address It |
|----------|-------------------|
| CAP Integration Quality (25%) | Full WebSocket provider with auto-negotiate, deliver, and settlement |
| A2A Composability (20%) | Other agents can compose our services as building blocks |
| Business Viability (20%) | Real pricing, real API, real use case (crypto data as a service) |
| Innovation & Creativity (20%) | Dual-protocol approach (x402 + CAP), cross-protocol agent |
| Code Quality & Docs (15%) | Clean architecture, typed schemas, comprehensive README |

## 📄 License

MIT License — see [LICENSE](./LICENSE) for details.
