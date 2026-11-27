# OnChain Shadow x402 API

**Paid API for AI Agents — crypto & Web3-security data plus paid PDF downloads, settled in USDC on Base via the x402 protocol.**

An autonomous, pay-per-call API that provides cryptocurrency data, token security checks, on-chain investigation reports and downloadable PDF guides. Built for AI agents that need Web3 data without subscriptions.

## 💰 Payments

| Protocol | Use case | Settlement |
|----------|----------|------------|
| **x402 v1 ("exact")** | Direct HTTP calls from any client | USDC on Base mainnet (chainId 8453) |
| **CROO CAP** | A2A commerce via the CROO marketplace | USDC on Base (escrow) |

### Payment verification modes (`PAYMENT_MODE`)

The client sends a base64-encoded JSON payload in the `X-PAYMENT` header containing a **signed but not-yet-broadcast** EIP-1559 transaction that calls `USDC.transfer(payTo, amount)`.

| Mode | How verification works | Trust assumptions |
|------|------------------------|-------------------|
| `onchain` *(recommended)* | The server parses the signed tx with ethers, validates chain/asset/recipient/amount/signature, **simulates it with `eth_call` against free public Base RPCs** (`mainnet.base.org`, `base.publicnode.com`, … with fallback), broadcasts it, then polls for a confirmed receipt (status = 1). | No third party; only public RPCs |
| `facilitator` | The server POSTs `{kind:"exact", payment:{scheme:"exact", network:"base", payload:<raw header>}}` to `FACILITATOR_URL` and requires `verify.success`. | Depends on the facilitator operator |

**Fail-closed:** malformed payloads, wrong chain/asset/recipient, underpayment, failed simulation, network outages, facilitator failures — all return `402 Payment Required`. Access is never granted on an error.

**Important:** the free public facilitator at `https://x402.org/facilitator` is operated for **testnet development only** and does not support Base mainnet. For mainnet traffic, use `PAYMENT_MODE=onchain`, or self-host a facilitator and point `FACILITATOR_URL` at it.

**Replay protection:** settled tx hashes and `(sender, nonce)` pairs are tracked in memory and persisted to `data/settled.json` when the directory is writable. A used payment can never deliver a second response.

### Internal calls

The CROO provider calls this API server over loopback. Such calls bypass payment **only when all** are true: the TCP peer is loopback (`127.0.0.1` / `::1`), `X-Internal-Call: true`, and `X-Internal-Secret` matches the server's `INTERNAL_SECRET`.

## 🤖 For AI agents (no account, no API key)

The payment is the credential. An agent calls a paid route, receives `402` with the
requirements, signs a USDC transfer on Base, and retries with the `X-PAYMENT` header.

| Step | What the agent sees |
|---|---|
| `GET /api/security/token/:address` with no header | `402` + JSON describing asset, amount, recipient, chain |
| Retry with a valid `X-PAYMENT` | `200` + the data |

Prices are per call, from $0.01 (price lookup) to $0.25 (full investigation report).
Free routes under `/api/free/*` need no payment, so an agent can verify reachability
before spending anything.

Working client (Node, ~25 lines): [`examples/agent-fetch.js`](examples/agent-fetch.js)

Anything that can make an HTTPS request and sign a transaction can use this —
no SDK is required, the header format is documented in `server.js`.

## 🔌 API endpoints

| Endpoint | Price | Atomic (USDC, 6 decimals) | Description |
|----------|-------|---------------------------|-------------|
| `GET /api/crypto/price/:symbol` | $0.01 | 10,000 | Real-time crypto price with 24h change |
| `GET /api/crypto/market` | $0.02 | 20,000 | Top 20 coins market overview |
| `GET /api/crypto/address/:address` | $0.05 | 50,000 | Address analysis |
| `GET /api/security/token/:address` | $0.05 | 50,000 | Token rug-pull risk check |
| `GET /api/security/contract/:address` | — coming soon | — | Smart contract risk analysis |
| `GET /api/investigate/:address` | — coming soon | — | Full on-chain investigation report |

### PDF products

`GET /api/product/:productId` — same payment middleware; one payment delivers one file. PDFs live under `private-products/`, which has **no static route** and cannot be downloaded without a verified payment. Files are streamed as `application/pdf` with `Content-Disposition: attachment`.

| Product id | Price | File |
|------------|-------|------|
| `web3-security-guide` | $5.00 (5,000,000 atomic) | Web3 Security Investigation Guide, 31 pages |
| `ai-agent-defi-playbook` | $5.00 (5,000,000 atomic) | AI Agent DeFi Security Playbook, 19 pages |

Unknown product ids return `404`.

> **Two endpoints are not live yet.** `/api/security/contract/:address` and
> `/api/investigate/:address` return `503` with `{"error":"service_unavailable"}` while they
> are rebuilt on real data. **No payment is required and nothing is charged** — they are listed
> for completeness, not for sale. Four endpoints are live and payable today: `/api/crypto/price/:symbol`,
> `/api/crypto/market`, `/api/crypto/address/:address`, `/api/security/token/:address`.

### Free endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | API info and endpoint listing |
| `GET /health` | Service health check |
| `GET /api/status` | API status, mode and pricing |

## 🚀 Quick start

```bash
npm install
cp .env.example .env      # set WALLET_ADDRESS, INTERNAL_SECRET, PAYMENT_MODE
npm start                 # node server.js, default port 3000
```

Every paid endpoint follows the same x402 flow:

1. Request without payment → `402` with payment requirements (`no-store` cache headers).
2. The x402 client signs the USDC transfer and retries with `X-PAYMENT`.
3. The server verifies & settles (or the facilitator does) and returns the data.

```bash
# 1) discover payment requirements
curl https://your-api.example.com/api/security/token/0xTokenAddress

# 2) x402-aware clients handle signing automatically, e.g. with the x402 fetch SDK
```

### Running the CROO provider

```bash
cd croo-provider
cp .env.example .env   # CROO_SDK_KEY and INTERNAL_SECRET (must match the API server)
npm run croo:provider
```

## ✅ Tests

```bash
npm test                 # node --test test/*.test.js
```

The suite uses an in-process HTTP **mock facilitator** and an ethers-built **mock on-chain settler** (deterministic balances, independent raw-tx parsing). It covers: missing payment → 402; forged/garbage/tampered/wrong-chain/wrong-recipient/underpaid transactions → rejected; valid payment → data; valid $5 payment → exact PDF byte stream (and no bytes without payment); replay of a settled tx and of the same `(sender, nonce)` → rejected; free endpoints → 200; internal bypass without secret/wrong secret/non-loopback → rejected (unit + end-to-end).

## 🌐 Deploy free on Render

The repo includes `render.yaml` (web service, free plan, `node server.js`, health check `/health`).

**Steps — parts in the Render dashboard must be done by you in a browser:**

1. Push the repo (including `render.yaml`, `private-products/`) to a GitHub repository.
2. Open <https://dashboard.render.com/> and log in (sign up with GitHub). **(you)**
3. **New + → Blueprint**, select the repository. Render reads `render.yaml`. **(you)**
4. Render prompts for the blueprint env vars:
   - `WALLET_ADDRESS` — your Base USDC recipient address.
   - `PAYMENT_MODE` — prefilled `onchain` (recommended).
   - `INTERNAL_SECRET` — Render generates a random value automatically.
   - leave `FACILITATOR_URL`, `BASE_RPC_URLS`, `COINGECKO_API_KEY`, `ETHERSCAN_API_KEY` blank unless you need them. **(you)**
5. Click **Apply**; Render builds (`npm install`) and starts the service. After deploy, verify `https://<your-service>.onrender.com/health`. **(you)**
6. (Optional) If running `croo-provider` against the deployed/co-located API, set that process's `INTERNAL_SECRET` to the same value.

Caveats: free instances sleep after ~15 min of inactivity (cold start 30–60s on the next request); set the same env vars manually if you create a plain **Web Service** instead of a Blueprint.

## 🔧 Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `WALLET_ADDRESS` | Yes | — | USDC recipient wallet on Base |
| `PAYMENT_MODE` | No | `facilitator` | `onchain` or `facilitator` |
| `INTERNAL_SECRET` | For internal bypass | random per process | Shared secret for loopback internal callers |
| `FACILITATOR_URL` | Facilitator mode | `https://x402.org/facilitator/verify` (testnet-only) | Facilitator `/verify` endpoint |
| `BASE_RPC_URLS` | No | public Base RPCs | Comma-separated RPC fallback list |
| `PORT` | No | 3000 | Server port (set automatically by Render) |
| `COINGECKO_API_KEY` | No | — | Higher CoinGecko rate limits |
| `ETHERSCAN_API_KEY` | No | — | Richer on-chain analysis |
| `CROO_SDK_KEY` | CROO provider | — | Key from agent.croo.network |
| `X402_API_BASE` | CROO provider | `http://localhost:3000` | Base URL for internal calls |

## 🏗️ Architecture

```
x402-api/
├── server.js                 # Express app + free/paid/PDF routes (node server.js)
├── lib/
│   ├── config.js             # Chain/asset/pricing constants, USD -> atomic
│   ├── middleware.js         # x402 middleware, 402 builder, internal-auth rules
│   ├── payment-parser.js     # Structural + signature validation of X-PAYMENT
│   ├── onchain.js            # RPC simulate/broadcast/receipt (multi-node fallback)
│   ├── facilitator.js        # External facilitator /verify client
│   └── replay.js             # Settled hash/nonce guard, persisted JSON
├── private-products/         # Paid PDFs — NO express.static points here
│   ├── web3-security-guide.pdf
│   └── ai-agent-defi-playbook.pdf
├── croo-provider/            # CROO marketplace wrapper (loopback internal client)
└── test/                     # node:test suite with mock facilitator + mock chain
```

## 📄 License

MIT License — see [LICENSE](./LICENSE) for details.
