// examples/agent-fetch.js
//
// Minimal x402 client: an agent pays 0.05 USDC on Base and receives a token risk check.
// No account. No API key. The payment is the credential.
//
//   npm i x402-fetch viem
//   AGENT_PRIVATE_KEY=0x... API_BASE=https://your-deployment.onrender.com node examples/agent-fetch.js 0xTokenAddress
//
// Notes:
// - x402-fetch is Coinbase's client helper; if its export names change, follow the
//   package README — the flow below is the stable part:
//     1) call the paid URL without payment  2) read the 402  3) retry with the payment header.
// - The wallet must hold a little USDC on Base plus ~0.0001 ETH for gas.

import { wrapFetchWithPayment } from "x402-fetch";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const API_BASE = process.env.API_BASE ?? "https://onchain-shadow-x402-api.onrender.com";
const address = process.argv[2] ?? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY);
const wallet = createWalletClient({ account, chain: base, transport: http() });
const payFetch = wrapFetchWithPayment(fetch, wallet);

// 1. Free route — no payment required, useful for a smoke test.
const free = await fetch(`${API_BASE}/api/free/token-safety/${address}`);
console.log("free  :", free.status);
console.log((await free.text()).slice(0, 200));

// 2. Paid route — 0.05 USDC. Without a payment header this returns 402 with the
//    requirements; payFetch signs the USDC transfer and retries automatically.
const paid = await payFetch(`${API_BASE}/api/security/token/${address}`);
console.log("paid  :", paid.status);
console.log((await paid.text()).slice(0, 800));
