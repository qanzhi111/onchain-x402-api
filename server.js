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
        '/api/security/contract/:address': '$0.10 - Contract risk analysis',
        '/api/investigate/:address': '$0.25 - Full on-chain investigation'
      },
      paid_products: Object.fromEntries(
        Object.values(d.products).map((p) => [
          `/api/product/${p.id}`,
          `$${p.usd} - ${p.name} (PDF)`
        ])
      ),
      free_endpoints: {
        '/health': 'Service health check',
        '/api/status': 'API status and pricing'
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
        contract_risk: '$0.10/call',
        full_investigation: '$0.25/call'
      },
      products: Object.fromEntries(
        Object.values(d.products).map((p) => [p.id, { price: `$${p.usd}`, name: p.name }])
      )
    });
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

module.exports = { createApp, PRODUCTS, paymentDeps };
