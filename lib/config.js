'use strict';

// ============ Protocol constants (x402 v1, Base mainnet, USDC) ============

const CHAIN_ID = 8453;
const NETWORK_NAME = 'base';
// USDC (native) on Base mainnet
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_DECIMALS = 6;
// Default收款地址
const DEFAULT_PAY_TO = '0x801B27e126d91D99A70cd31ffc8BC867B329023D';

// Free public Base RPC endpoints (used with fallback in onchain mode)
const DEFAULT_RPC_URLS = [
  'https://mainnet.base.org',
  'https://base.publicnode.com',
  'https://base-rpc.publicnode.com',
  'https://base.llamarpc.com'
];

// Public facilitator. NOTE: https://x402.org/facilitator is operated by the
// x402 project and is intended for testnet development — it does NOT register
// a facilitator for Base mainnet (eip155:8453). For mainnet traffic in
// facilitator mode, self-host a facilitator (e.g. coinbase/x402 facilitator)
// and point FACILITATOR_URL at it, or use PAYMENT_MODE=onchain.
const DEFAULT_FACILITATOR_URL = 'https://x402.org/facilitator/verify';

// ERC20 transfer(address,uint256) selector
const TRANSFER_SELECTOR = '0xa9059cbb';

// Convert a USD price string ("0.01", "5") to USDC atomic units (6 decimals)
function usdToAtomic(usd) {
  return BigInt(Math.round(Number(usd) * 10 ** USDC_DECIMALS));
}

// ============ Paid API endpoint pricing (must stay backward compatible) ============

const ENDPOINT_PRICES = {
  cryptoPrice: { usd: '0.01', description: 'Real-time cryptocurrency price' },
  market: { usd: '0.02', description: 'Top cryptocurrencies market data' },
  address: { usd: '0.05', description: 'Blockchain address analysis' },
  tokenSecurity: { usd: '0.05', description: 'Token security and rug-pull risk assessment' },
  contractSecurity: { usd: '0.10', description: 'Smart contract risk analysis' },
  investigate: { usd: '0.25', description: 'Full on-chain investigation report' }
};

// Attach atomic amounts
for (const k of Object.keys(ENDPOINT_PRICES)) {
  ENDPOINT_PRICES[k].atomic = usdToAtomic(ENDPOINT_PRICES[k].usd).toString();
}

module.exports = {
  CHAIN_ID,
  NETWORK_NAME,
  USDC_ADDRESS,
  USDC_DECIMALS,
  DEFAULT_PAY_TO,
  DEFAULT_RPC_URLS,
  DEFAULT_FACILITATOR_URL,
  TRANSFER_SELECTOR,
  usdToAtomic,
  ENDPOINT_PRICES
};
