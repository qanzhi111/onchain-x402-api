'use strict';

/**
 * OnChain Shadow x402 API
 * -----------------------
 * Express server selling:
 *   - crypto / Web3-security JSON data (pay per call)
 *   - PDF guides (one payment -> one file delivery)
 *
 * Payments follow x402 v1 ("exact"): USDC on Base mainnet.
 * Verification has two fail-closed paths, selected by PAYMENT_MODE:
 *   - facilitator (default): POST the X-PAYMENT payload to an external facilitator
 *   - onchain: parse, simulate, broadcast and confirm using free public Base RPCs
 *
 * Node >= 18 required. Uses the global fetch API (no node-fetch).
 */

const path = require('path');
const fsp = require('fs/promises');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');

const {
  NETWORK_NAME,
  USDC_ADDRESS,
  CHAIN_ID,
  DEFAULT_PAY_TO,
  DEFAULT_RPC_URLS,
  DEFAULT_FACILITATOR_URL,
  ENDPOINT_PRICES,
  usdToAtomic
} = require('./lib/config');
const { OnchainSettler } = require('./lib/onchain');
const { FacilitatorClient } = require('./lib/facilitator');
const { ReplayGuard } = require('./lib/replay');
const { x402PaymentRequired } = require('./lib/middleware');

// ============ Configuration from environment ============

const WALLET_ADDRESS = process.env.WALLET_ADDRESS || DEFAULT_PAY_TO;
const PORT = process.env.PORT || 3000;
const PAYMENT_MODE = (process.env.PAYMENT_MODE || 'facilitator').toLowerCase();
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || '';
const ETHERSCAN_API_KEY = process.env.Etherscan_API_KEY || process.env.ETHERSCAN_API_KEY || '';
const FACILITATOR_URL = process.env.FACILITATOR_URL || DEFAULT_FACILITATOR_URL;
const RPC_URLS = process.env.BASE_RPC_URLS
  ? process.env.BASE_RPC_URLS.split(',').map((s) => s.trim()).filter(Boolean)
  : DEFAULT_RPC_URLS;

// Shared secret for internal loopback calls. If unset, generate a random one
// for this process (bypass stays usable only by callers that know it).
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.INTERNAL_SECRET) {
  console.warn(
    '⚠️  INTERNAL_SECRET not set — generated an ephemeral one for this process. ' +
      'Set INTERNAL_SECRET in the environment for stable internal (CROO provider) calls.'
  );
}
if (PAYMENT_MODE !== 'facilitator' && PAYMENT_MODE !== 'onchain') {
  console.warn(`⚠️  Unknown PAYMENT_MODE "${PAYMENT_MODE}", falling back to "facilitator".`);
}
const mode = PAYMENT_MODE === 'onchain' ? 'onchain' : 'facilitator';

// ============ Dependency wiring ============

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
const replay = new ReplayGuard({ filePath: path.join(dataDir, 'settled.json') });
const settler = new OnchainSettler({ rpcUrls: RPC_URLS });
const facilitator = new FacilitatorClient({ url: FACILITATOR_URL });

const paymentDeps = {
  mode,
  internalSecret: INTERNAL_SECRET,
  replay,
  settler,
  facilitator
};

// ============ Product catalog (PDFs) ============

const PRODUCTS = {
  'web3-security-guide': {
    id: 'web3-security-guide',
    file: path.join(__dirname, 'private-products', 'web3-security-guide.pdf'),
    usd: '5',
    name: 'Web3 Security Investigation Guide',
    description: 'Practical Web3 security & on-chain investigation guide (PDF, 31 pages)'
  },
  'ai-agent-defi-playbook': {
    id: 'ai-agent-defi-playbook',
    file: path.join(__dirname, 'private-products', 'ai-agent-defi-playbook.pdf'),
    usd: '5',
    name: 'AI Agent DeFi Security Playbook',
    description: 'How to protect assets when AI agents trade for you (PDF, 19 pages)'
  }
};
for (const p of Object.values(PRODUCTS)) {
  p.atomic = usdToAtomic(p.usd).toString();
}

// ============ Free token-safety helpers (GoPlus proxy) ============

const tokenSafetyCache = new Map(); // key -> { data, ts }
const tokenSafetyRateLimit = new Map(); // ip -> { count, windowStart }
const TOKEN_SAFETY_CACHE_TTL = 30_000; // 30 seconds
const TOKEN_SAFETY_RATE_LIMIT = 20; // per minute per IP

const CHAIN_MAP = { base: '8453', eth: '1', bsc: '56' };

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = tokenSafetyRateLimit.get(ip);
  if (!entry || now - entry.windowStart > 60_000) {
    tokenSafetyRateLimit.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= TOKEN_SAFETY_RATE_LIMIT) return false;
  entry.count++;
  return true;
}

function hexToFloat(val) {
  if (val == null || val === '' || val === 'null' || val === 'undefined') return 0;
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

function translateGoPlus(data, address, chain) {
  const d = data || {};
  const flags = [];
  let dangerCount = 0;
  let warnCount = 0;

  // Honeypot — the #1 fear
  if (d.is_honeypot === '1') {
    flags.push({ level: 'danger', label: '貔貅盘', detail: '代币无法正常卖出' });
    dangerCount++;
  }
  // Owner can change balance directly
  if (d.owner_change_balance === '1') {
    flags.push({ level: 'danger', label: '可改余额', detail: '管理员可以直接修改你的代币余额' });
    dangerCount++;
  }
  // Hidden owner
  if (d.hidden_owner === '1') {
    flags.push({ level: 'danger', label: '隐藏管理员', detail: '存在未公开的控制人' });
    dangerCount++;
  }
  // Can take back ownership
  if (d.can_take_back_ownership === '1') {
    flags.push({ level: 'danger', label: '可夺回权限', detail: '管理员即使放弃权限也能重新夺回控制' });
    dangerCount++;
  }

  // Transfer pausable
  if (d.transfer_pausable === '1') {
    flags.push({ level: 'warn', label: '可暂停转账', detail: '管理员可以冻结所有转账操作' });
    warnCount++;
  }
  // Not open source
  if (d.is_open_source === '0') {
    flags.push({ level: 'warn', label: '未开源', detail: '合约代码未公开验证，风险较高' });
    warnCount++;
  }
  // Proxy contract
  if (d.is_proxy === '1') {
    flags.push({ level: 'warn', label: '代理合约', detail: '合约逻辑可被管理员更换' });
    warnCount++;
  }
  // Blacklist
  if (d.is_blacklisted === '1') {
    flags.push({ level: 'warn', label: '有黑名单', detail: '管理员可以将地址加入黑名单阻止交易' });
    warnCount++;
  }
  // Whitelist (often paired with blacklist)
  if (d.is_whitelisted === '1') {
    flags.push({ level: 'warn', label: '有白名单', detail: '交易可能需要先被加入白名单' });
    warnCount++;
  }
  // Buy tax
  const buyTax = hexToFloat(d.buy_tax) * 100;
  if (buyTax > 5) {
    flags.push({ level: 'warn', label: `买入税 ${buyTax.toFixed(1)}%`, detail: `每笔买入被扣除 ${buyTax.toFixed(1)}% 手续费` });
    warnCount++;
  }
  // Sell tax
  const sellTax = hexToFloat(d.sell_tax) * 100;
  if (sellTax > 5) {
    flags.push({ level: 'warn', label: `卖出税 ${sellTax.toFixed(1)}%`, detail: `每笔卖出被扣除 ${sellTax.toFixed(1)}% 手续费` });
    warnCount++;
  }

  // Positive signals
  if (d.is_open_source === '1') {
    flags.push({ level: 'ok', label: '开源合约', detail: '代码已公开验证' });
  }
  if (d.is_honeypot === '0') {
    flags.push({ level: 'ok', label: '非貔貅盘', detail: '可以正常买卖' });
  }
  if (d.is_blacklisted !== '1') {
    flags.push({ level: 'ok', label: '无黑名单', detail: '未发现黑名单机制' });
  }

  // Verdict
  let verdict, headline;
  if (dangerCount >= 2) {
    verdict = 'high_risk';
    headline = '⛔ 高风险：存在多个严重安全问题，极有可能是骗局';
  } else if (dangerCount >= 1) {
    verdict = 'high_risk';
    headline = '⛔ 高风险：发现严重安全隐患，请极度谨慎';
  } else if (warnCount >= 3) {
    verdict = 'caution';
    headline = '⚠️ 需谨慎：存在多个中等风险信号';
  } else if (warnCount >= 1) {
    verdict = 'caution';
    headline = '⚠️ 需注意：存在一些风险因素，建议谨慎操作';
  } else {
    verdict = 'low_risk';
    headline = '✅ 低风险：未发现明显安全问题';
  }

  // Score (0=safest, higher=more risky)
  const score = Math.min(100, dangerCount * 30 + warnCount * 10);

  return {
    ok: true,
    address,
    chain,
    verdict,
    headline,
    flags,
    score,
    raw_source: 'GoPlus',
    paid_upgrade: {
      full_report: { endpoint: '/api/security/token/:address', price_usd: '0.05' },
      pdf: { endpoint: '/api/product/web3-security-guide', price_usd: '5' }
    },
    timestamp: Date.now()
  };
}

// ============ App factory (exported so tests can inject dependencies) ============

function createApp(deps = {}) {
  const app = express();
  app.use(cors());
  app.use(express.json());
  // IMPORTANT: there is intentionally NO express.static pointing at
  // private-products/ — PDFs are only reachable through paid endpoints.

  const d = {
    ...paymentDeps,
    ...deps,
    payTo: deps.payTo || WALLET_ADDRESS,
    products: deps.products || PRODUCTS
  };

  const paywall = (cfg) => x402PaymentRequired({ ...cfg, payTo: d.payTo }, d);

  // ---------- Free endpoints ----------

  app.get('/', (req, res) => {
    res.json({
      name: 'OnChain Shadow API',
      description: 'Crypto & Web3 Security Data for AI Agents',
      version: '1.2.0',
      paid_endpoints: {
        '/api/crypto/price/:symbol': '$0.01 - Real-time crypto price',
        '/api/crypto/market': '$0.02 - Market overview (top coins)',
        '/api/crypto/address/:address': '$0.05 - Address analysis',
        '/api/security/token/:address': '$0.05 - Token security check',
        '/api/security/contract/:address': '$0.10 - Contract risk analysis (temporarily offline)',
        '/api/investigate/:address': '$0.25 - Full on-chain investigation (temporarily offline)'
      },
      paid_products: Object.fromEntries(
        Object.values(d.products).map((p) => [
          `/api/product/${p.id}`,
          `$${p.usd} - ${p.name} (PDF)`
        ])
      ),
      free_endpoints: {
        '/health': 'Service health check',
        '/api/status': 'API status and pricing',
        '/api/free/token-safety/:address': 'Free token safety check (powered by GoPlus)'
      },
      payment: 'x402 protocol v1 - USDC on Base',
      network: `${NETWORK_NAME} (chainId ${CHAIN_ID})`,
      wallet: d.payTo
    });
  });

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now(), uptime: process.uptime() });
  });

  app.get('/api/status', (req, res) => {
    res.json({
      service: 'OnChain Shadow API',
      payment_protocol: 'x402',
      payment_mode: d.mode,
      network: 'Base',
      wallet: d.payTo,
      pricing: {
        crypto_price: '$0.01/call',
        market_overview: '$0.02/call',
        address_analysis: '$0.05/call',
        token_security: '$0.05/call',
        contract_risk: '$0.10/call (temporarily offline)',
        full_investigation: '$0.25/call (temporarily offline)'
      },
      products: Object.fromEntries(
        Object.values(d.products).map((p) => [p.id, { price: `$${p.usd}`, name: p.name }])
      )
    });
  });

  // ---------- Free token-safety endpoint (no paywall) ----------
  app.get('/api/free/token-safety/:address', async (req, res) => {
    try {
      const address = req.params.address;
      // Validate hex address
      if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
        return res.status(400).json({ ok: false, reason: 'invalid_address', message: 'Address must be a valid 42-character hex string (0x + 40 hex chars)' });
      }
      // Rate limit
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      if (!checkRateLimit(ip)) {
        return res.status(429).json({ ok: false, reason: 'rate_limited', message: 'Too many requests. Limit: 20 per minute per IP.' });
      }
      // Chain parameter
      const chain = (req.query.chain || 'base').toLowerCase();
      const chainId = CHAIN_MAP[chain];
      if (!chainId) {
        return res.status(400).json({ ok: false, reason: 'unsupported_chain', message: `Supported chains: ${Object.keys(CHAIN_MAP).join(', ')}` });
      }
      // Cache check
      const cacheKey = `${chain}:${address.toLowerCase()}`;
      const cached = tokenSafetyCache.get(cacheKey);
      if (cached && Date.now() - cached.ts < TOKEN_SAFETY_CACHE_TTL) {
        return res.json(cached.data);
      }
      // Fetch GoPlus with 8s timeout
      let tokenData;
      try {
        const goPlusUrl = `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${address}`;
        const fetchPromise = fetch(goPlusUrl);
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 8000)
        );
        const response = await Promise.race([fetchPromise, timeoutPromise]);
        const json = await response.json();
        tokenData = json && json.result && json.result[address.toLowerCase()];
      } catch (_fetchErr) {
        // Upstream failure — return graceful error (never throw)
        return res.json({ ok: false, reason: 'upstream_unavailable', message: 'GoPlus API is temporarily unavailable', address, chain });
      }
      if (!tokenData) {
        return res.json({ ok: false, reason: 'no_data', message: 'Token not found in GoPlus database', address, chain });
      }
      const translated = translateGoPlus(tokenData, address, chain);
      // Cache successful result
      tokenSafetyCache.set(cacheKey, { data: translated, ts: Date.now() });
      return res.json(translated);
    } catch (_outerErr) {
      return res.json({ ok: false, reason: 'internal_error', message: 'An unexpected error occurred' });
    }
  });

  // ---------- Temporarily offline intercepts (before paywall) ----------
  // These endpoints currently return empty/placeholder data.
  // Block BEFORE paywall so users don't pay for nothing.
  const OFFLINE_BODY = {
    error: 'service_unavailable',
    message: 'This endpoint is temporarily offline while we rebuild it with real data. No payment required.',
    alternative: 'Use the free /api/free/token-safety/:address for token checks'
  };
  app.get('/api/security/contract/:address', (req, res) => {
    res.status(503).json(OFFLINE_BODY);
  });
  app.get('/api/investigate/:address', (req, res) => {
    res.status(503).json(OFFLINE_BODY);
  });

  // ---------- Paid JSON endpoints ----------

  // 1. Crypto Price - $0.01
  app.get(
    '/api/crypto/price/:symbol',
    paywall({ usd: ENDPOINT_PRICES.cryptoPrice.usd, atomic: ENDPOINT_PRICES.cryptoPrice.atomic, description: ENDPOINT_PRICES.cryptoPrice.description }),
    async (req, res) => {
      try {
        const symbol = req.params.symbol.toLowerCase();
        const headers = COINGECKO_API_KEY ? { 'x-cg-demo-api-key': COINGECKO_API_KEY } : {};
        const response = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(
            symbol
          )}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`,
          { headers }
        );
        const data = await response.json();
        if (!data || Object.keys(data).length === 0) {
          return res
            .status(404)
            .json({ error: 'Symbol not found', hint: 'Use CoinGecko IDs: bitcoin, ethereum, solana, etc.' });
        }
        res.json({ symbol: req.params.symbol.toUpperCase(), data, timestamp: Date.now(), source: 'CoinGecko' });
      } catch (error) {
        res.status(502).json({ error: 'Failed to fetch price data' });
      }
    }
  );

  // 2. Market Overview - $0.02
  app.get(
    '/api/crypto/market',
    paywall({ usd: ENDPOINT_PRICES.market.usd, atomic: ENDPOINT_PRICES.market.atomic, description: ENDPOINT_PRICES.market.description }),
    async (req, res) => {
      try {
        const headers = COINGECKO_API_KEY ? { 'x-cg-demo-api-key': COINGECKO_API_KEY } : {};
        const response = await fetch(
          'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=20&page=1&sparkline=false&price_change_percentage=24h',
          { headers }
        );
        const data = await response.json();
        res.json({
          top_coins: data.map((coin) => ({
            rank: coin.market_cap_rank,
            name: coin.name,
            symbol: coin.symbol.toUpperCase(),
            price: coin.current_price,
            change_24h: coin.price_change_percentage_24h,
            market_cap: coin.market_cap,
            volume_24h: coin.total_volume
          })),
          timestamp: Date.now(),
          source: 'CoinGecko'
        });
      } catch (error) {
        res.status(502).json({ error: 'Failed to fetch market data' });
      }
    }
  );

  // 3. Address Analysis - $0.05
  app.get(
    '/api/crypto/address/:address',
    paywall({ usd: ENDPOINT_PRICES.address.usd, atomic: ENDPOINT_PRICES.address.atomic, description: ENDPOINT_PRICES.address.description }),
    async (req, res) => {
      try {
        const address = req.params.address;
        const apiKey = ETHERSCAN_API_KEY;
        if (!apiKey) {
          return res.json({
            address,
            note: 'Full analysis requires Etherscan API key. Providing basic info.',
            network: 'Ethereum',
            link: `https://etherscan.io/address/${address}`
          });
        }
        const balanceRes = await fetch(
          `https://api.etherscan.io/api?module=account&action=balance&address=${address}&tag=latest&apikey=${apiKey}`
        );
        const balanceData = await balanceRes.json();
        const txRes = await fetch(
          `https://api.etherscan.io/api?module=proxy&action=eth_getTransactionCount&address=${address}&tag=latest&apikey=${apiKey}`
        );
        const txData = await txRes.json();
        const ethBalance = balanceData.result ? (parseInt(balanceData.result, 16) / 1e18).toFixed(4) : '0';
        const txCount = txData.result ? parseInt(txData.result, 16) : 0;
        res.json({
          address,
          eth_balance: ethBalance + ' ETH',
          transaction_count: txCount,
          network: 'Ethereum Mainnet',
          etherscan: `https://etherscan.io/address/${address}`,
          timestamp: Date.now()
        });
      } catch (error) {
        res.status(502).json({ error: 'Failed to analyze address' });
      }
    }
  );

  // 4. Token Security Check - $0.05
  app.get(
    '/api/security/token/:address',
    paywall({ usd: ENDPOINT_PRICES.tokenSecurity.usd, atomic: ENDPOINT_PRICES.tokenSecurity.atomic, description: ENDPOINT_PRICES.tokenSecurity.description }),
    async (req, res) => {
      try {
        const address = req.params.address;
        const apiKey = ETHERSCAN_API_KEY;
        const securitySignals = {
          address,
          checks: {
            contract_verified: false,
            has_mint_function: 'unknown',
            has_pause_function: 'unknown',
            has_blacklist: 'unknown',
            liquidity_locked: 'unknown',
            owner_can_renounce: 'unknown'
          },
          risk_level: 'unknown',
          recommendation: 'Verify contract on Etherscan before investing',
          etherscan: `https://etherscan.io/token/${address}`,
          note: 'Enhanced analysis available with API key configuration'
        };
        if (apiKey) {
          const verifyRes = await fetch(
            `https://api.etherscan.io/api?module=contract&action=getabi&address=${address}&apikey=${apiKey}`
          );
          const verifyData = await verifyRes.json();
          securitySignals.checks.contract_verified = verifyData.status === '1';
          if (securitySignals.checks.contract_verified) {
            try {
              const abi = JSON.parse(verifyData.result);
              const functionNames = abi.filter((x) => x.type === 'function').map((x) => x.name);
              securitySignals.checks.has_mint_function = functionNames.some((n) => n.toLowerCase().includes('mint')) ? 'yes' : 'no';
              securitySignals.checks.has_pause_function = functionNames.some((n) => n.toLowerCase().includes('pause')) ? 'yes' : 'no';
              securitySignals.checks.has_blacklist = functionNames.some(
                (n) => n.toLowerCase().includes('blacklist') || n.toLowerCase().includes('block')
              ) ? 'yes' : 'no';
              const risks = [];
              if (securitySignals.checks.has_mint_function === 'yes') risks.push('Mint function detected');
              if (securitySignals.checks.has_pause_function === 'yes') risks.push('Pause function detected');
              if (securitySignals.checks.has_blacklist === 'yes') risks.push('Blacklist function detected');
              securitySignals.risk_level = risks.length === 0 ? 'low' : risks.length <= 1 ? 'medium' : 'high';
              if (risks.length > 0) securitySignals.warnings = risks;
            } catch (e) {
              /* ABI parse failed — leave signals unknown */
            }
          } else {
            securitySignals.risk_level = 'high';
            securitySignals.warnings = ['Contract not verified - high risk'];
          }
        }
        res.json({ ...securitySignals, timestamp: Date.now() });
      } catch (error) {
        res.status(502).json({ error: 'Failed to check token security' });
      }
    }
  );

  // 5. Contract Risk Analysis - $0.10
  app.get(
    '/api/security/contract/:address',
    paywall({ usd: ENDPOINT_PRICES.contractSecurity.usd, atomic: ENDPOINT_PRICES.contractSecurity.atomic, description: ENDPOINT_PRICES.contractSecurity.description }),
    async (req, res) => {
      try {
        const address = req.params.address;
        res.json({
          address,
          analysis: { contract_type: 'analysis_pending', risk_factors: [], recommendations: [] },
          note: 'Full contract analysis requires deployment with Etherscan API key',
          etherscan: `https://etherscan.io/address/${address}`,
          timestamp: Date.now()
        });
      } catch (error) {
        res.status(502).json({ error: 'Failed to analyze contract' });
      }
    }
  );

  // 6. Full Investigation - $0.25
  app.get(
    '/api/investigate/:address',
    paywall({ usd: ENDPOINT_PRICES.investigate.usd, atomic: ENDPOINT_PRICES.investigate.atomic, description: ENDPOINT_PRICES.investigate.description }),
    async (req, res) => {
      try {
        const address = req.params.address;
        res.json({
          address,
          investigation: {
            summary: 'Investigation report generated',
            risk_assessment: 'pending_full_analysis',
            fund_flow: [],
            related_addresses: [],
            timeline: []
          },
          reports: 'https://onchain-shadow.github.io/on-chain-investigations/',
          note: 'Full investigation requires API key configuration and extended analysis',
          timestamp: Date.now()
        });
      } catch (error) {
        res.status(502).json({ error: 'Failed to generate investigation report' });
      }
    }
  );

  // ---------- Paid PDF product delivery ----------
  // GET /api/product/:productId — same payment middleware, price per product.
  // One valid payment = one delivery: the payment tx is consumed by replay guard.
  app.get(
    '/api/product/:productId',
    async (req, res, next) => {
      const product = d.products[req.params.productId];
      if (!product) {
        return res.status(404).json({ error: 'Unknown product', available: Object.keys(d.products) });
      }
      // Resolve the product-specific paywall for this request
      const mw = x402PaymentRequired(
        {
          usd: product.usd,
          atomic: product.atomic,
          description: product.description,
          payTo: d.payTo,
          category: 'digital-good'
        },
        d
      );
      return mw(req, res, next);
    },
    async (req, res) => {
      try {
        const product = d.products[req.params.productId];
        const fileBuffer = await fsp.readFile(product.file); // read only AFTER payment verified
        const downloadName = `${product.id}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
        res.setHeader('Content-Length', fileBuffer.length);
        res.setHeader('Cache-Control', 'no-store');
        res.send(fileBuffer);
      } catch (error) {
        res.status(404).json({ error: 'Product file unavailable' });
      }
    }
  );

  return app;
}

// ============ Boot (only when run directly) ============

if (require.main === module) {
  (async () => {
    await replay.load();
    // Fail fast if a listed product file is missing
    for (const p of Object.values(PRODUCTS)) {
      try {
        await fsp.access(p.file);
      } catch (e) {
        console.warn(`⚠️  Product file missing for ${p.id}: ${p.file} (endpoint will 404 until restored)`);
      }
    }
    const app = createApp();
    const server = app.listen(PORT, () => {
      console.log(`🚀 OnChain Shadow API running on port ${PORT}`);
      console.log(`💰 Payment wallet: ${WALLET_ADDRESS}`);
      console.log(`🔗 x402 v1 - USDC on Base (chainId ${CHAIN_ID})`);
      console.log(`🧪 Payment mode: ${mode}${mode === 'facilitator' ? ` (${FACILITATOR_URL})` : ''}`);
    });
    const shutdown = async () => {
      server.close(async () => {
        await replay.flush();
        process.exit(0);
      });
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  })();
}

module.exports = { createApp, PRODUCTS, paymentDeps, tokenSafetyRateLimit, tokenSafetyCache };
