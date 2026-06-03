# CROO Hackathon - DoraHacks BUIDL 提交内容

## 项目名称
x402-crypto-api: Dual-Protocol Paid API for AI Agents

## 一句话描述
Paid crypto & Web3 security API for AI agents with dual payment protocols — x402 for direct HTTP calls and CROO CAP for agent-to-agent commerce.

## 详细描述

### Problem
AI agents need real-time cryptocurrency data, token security checks, and on-chain investigation capabilities. But current APIs require subscriptions or manual API key management — both barriers for autonomous agents that need to pay their own way.

### Solution
x402-crypto-api provides paid API endpoints specifically designed for AI agents, supporting two complementary payment protocols:

1. **x402 Protocol**: Direct HTTP 402 Payment Required flow. Agents call the API, receive payment details, pay with USDC on Base, and get data. No API keys, no subscriptions.

2. **CROO CAP Protocol**: Agent-to-Agent commerce via the CROO marketplace. Other agents discover and call our services through CROO's escrow-based negotiation system, enabling composable A2A workflows.

### Services (6 endpoints)
| Service | Price | Description |
|---------|-------|-------------|
| crypto-price | $0.01 | Real-time crypto price with 24h change |
| crypto-market | $0.02 | Top 20 coins market overview |
| address-analysis | $0.05 | Ethereum address analysis |
| token-security | $0.05 | Token rug pull risk check |
| contract-risk | $0.10 | Smart contract risk analysis |
| investigation | $0.25 | Full on-chain investigation report |

### Architecture
- Express server handles x402 payment flow for direct HTTP clients
- CROO Provider wraps the same API endpoints, using internal calls with `x-internal-call` header to bypass x402 payment (CROO escrow handles settlement instead)
- One codebase serves both protocols

### Tracks
- DeFi / On-chain Ops Agents
- Developer Tooling Agents

## GitHub
https://github.com/qanzhi111/x402-crypto-api
(Backup: https://github.com/onchain-shadow/x402-crypto-api - pending PAT update)

## Tech Stack
- Node.js, Express
- @anthropic-ai/x402 (HTTP 402 payment protocol)
- @croo-network/sdk (CROO CAP A2A protocol)
- CoinGecko API, Etherscan API
- USDC on Base (payment settlement)

## Demo Video
[To be recorded - max 5 minutes]

## Team
Solo developer - onchain-shadow (Web3 Security Researcher & Agent Developer)
