# CROO Hackathon Demo Video Script
## x402-crypto-api + CROO CAP Integration
## Target: 3-4 minutes

---

### [0:00-0:30] INTRO - The Problem
**Screen**: Title card "x402-crypto-api: Making AI Agents Pay Their Own Way"

**Narration**: 
"AI agents need access to real-time crypto data — prices, token security checks, on-chain investigations. But how do agents pay for API calls without human intervention? We solve this with a dual-protocol approach: x402 for direct HTTP payments, and CROO CAP for agent-to-agent commerce."

---

### [0:30-1:30] PART 1 - x402 Direct API Demo
**Screen**: Terminal / Postman showing API calls

**Actions**:
1. Show `GET /api/status` — free endpoint, API overview
2. Show `GET /api/crypto/price/bitcoin` — returns 402 with payment required
3. Show payment flow: agent receives 402 → pays USDC on Base → gets data
4. Show `GET /api/security/token/:address` — rug pull risk check result
5. Show `GET /api/investigate/:address` — full investigation report

**Narration**:
"First, the x402 protocol. When an agent calls our API without payment, it receives a 402 Payment Required response with payment details. The agent's wallet automatically pays USDC on Base, then the API delivers the data. Pricing ranges from $0.01 for price data to $0.25 for a full investigation report."

---

### [1:30-2:30] PART 2 - CROO CAP Integration
**Screen**: Split screen - CROO Agent Store + Provider logs

**Actions**:
1. Show CROO Agent Store listing for x402-crypto-api
2. Show 6 services registered: crypto-price, market, address, token-security, contract-risk, investigation
3. Show provider terminal: WebSocket connected, waiting for requests
4. Show requester agent calling CROO SDK: `client.negotiateOrder({serviceId: 'crypto-price', input: {symbol: 'ethereum'}})`
5. Show provider auto-accepting negotiation
6. Show internal API call (bypassing x402 payment via x-internal-call header)
7. Show delivery with proof, escrow settlement

**Narration**:
"Now the CROO CAP integration. We've registered as a provider on the CROO Agent Store with 6 services. When another agent requests our service, the CROO marketplace handles the escrow and negotiation. Our provider auto-accepts, calls the internal API bypassing the x402 payment layer, and delivers results with proof of delivery. The escrow settles automatically."

---

### [2:30-3:15] PART 3 - Architecture Deep Dive
**Screen**: Architecture diagram from README

**Actions**:
1. Show the dual-protocol architecture diagram
2. Highlight the x402 → Express server flow
3. Highlight the CROO → Provider → internal API flow
4. Show the x-internal-call header bypass mechanism

**Narration**:
"Our architecture uses a dual-protocol approach. The Express server handles x402 payments for direct clients. The CROO Provider wraps the same API endpoints but uses internal calls with a special header to bypass x402 payment, since the CROO escrow handles settlement instead. This means one codebase serves both payment protocols."

---

### [3:15-3:45] PART 4 - A2A Composability
**Screen**: Code example of another agent composing our services

**Actions**:
1. Show code: Agent A calls crypto-price → gets BTC price
2. Show code: Agent A then calls token-security → checks if token is safe
3. Show code: Agent A then calls investigate → full report if suspicious
4. Emphasize: all through CROO CAP, fully autonomous

**Narration**:
"A2A composability is key. Other agents can chain our services: first check a price, then verify token security, then run a full investigation if something looks off. All without human intervention, all settled through CROO's escrow mechanism."

---

### [3:45-4:00] OUTRO
**Screen**: Summary card

**Content**:
- ✅ Dual payment: x402 + CROO CAP
- ✅ 6 services, real pricing, real use case
- ✅ Open source: github.com/onchain-shadow/x402-crypto-api
- 🏆 Submitting to: DeFi/On-chain Ops + Developer Tooling

**Narration**:
"x402-crypto-api: dual-protocol, real pricing, real utility. Open source and ready for the CROO ecosystem. Thank you."

---

## Recording Notes
- Use screen recording (OBS or similar)
- Terminal: dark theme, font size 18+
- Browser: CROO Agent Store + DoraHacks BUIDL page
- Keep narration concise, practice 2-3 times
- Export as MP4, 1080p, <500MB
