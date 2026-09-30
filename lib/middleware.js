'use strict';

const { ethers } = require('ethers');
const {
  NETWORK_NAME,
  USDC_ADDRESS,
  DEFAULT_PAY_TO,
  usdToAtomic
} = require('./config');
const { parsePayment } = require('./payment-parser');
const { OnchainSettler } = require('./onchain');
const { FacilitatorClient } = require('./facilitator');
const { ReplayGuard } = require('./replay');

// ============ Secured internal-call bypass ============

/**
 * Internal calls may bypass payment ONLY when ALL hold:
 *   - the TCP peer is a loopback address (127.0.0.1 / ::1 / ::ffff:127.0.0.1)
 *   - X-Internal-Call: true
 *   - X-Internal-Secret matches INTERNAL_SECRET
 */
function isLoopbackAddress(addr) {
  if (!addr) return false;
  return (
    addr === '127.0.0.1' ||
    addr === '::1' ||
    addr === '::ffff:127.0.0.1' ||
    addr === '::ffff:7f00:1'
  );
}

function isAuthorizedInternalCall(req, internalSecret) {
  if (req.headers['x-internal-call'] !== 'true') return false;
  if (!internalSecret) return false; // no secret configured -> bypass disabled
  if (!isLoopbackAddress(req.socket && req.socket.remoteAddress)) return false;
  const provided = req.headers['x-internal-secret'];
  if (typeof provided !== 'string') return false;
  return timingSafeEqual(provided, internalSecret);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

// ============ Dynamic base URL ============

function getBaseUrl(req) {
  // Behind a proxy (Render sets x-forwarded-*); trust it when present.
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host') || 'localhost:3000';
  return `${proto.split(',')[0].trim()}://${host.split(',')[0].trim()}`;
}

// ============ 402 Payment Required body ============

function build402Body(req, config) {
  const baseUrl = getBaseUrl(req);
  const atomic = config.atomic || usdToAtomic(config.usd).toString();
  const recipient = config.payTo || DEFAULT_PAY_TO;

  return {
    // ---- x402 core fields ----
    x402_version: 1,
    scheme: 'exact',
    network: NETWORK_NAME,
    asset: USDC_ADDRESS,
    // amount carries BOTH USD and atomic units (atomic = USD * 10^6)
    amount: {
      usd: config.usd,
      atomic,
      decimals: 6
    },
    // Legacy scalar fields kept for backward compatibility
    amount_usd: config.usd,
    amount_atomic: atomic,
    recipient,
    description: config.description || 'API access fee',
    max_amount_required: config.usd,
    max_amount_required_atomic: atomic,
    payment_requirements: {
      schema: 'exact',
      scheme: 'exact',
      network: NETWORK_NAME,
      asset: USDC_ADDRESS,
      amount: { usd: config.usd, atomic, decimals: 6 },
      recipient,
      payTo: recipient,
      expires_in: 3600
    },
    error: config.error || 'Payment Required',
    // ---- x402 Bazaar extension (service discovery) ----
    extensions: {
      bazaar: {
        name: 'OnChain Shadow API',
        description:
          'Crypto prices, Web3 security data, on-chain investigation reports and paid PDF guides for AI Agents',
        category: config.category || 'finance',
        tags: ['crypto', 'web3', 'security', 'blockchain', 'defi', 'investigation', 'pdf'],
        homepage: baseUrl,
        endpoints: [
          { path: '/api/crypto/price/:symbol', price: '$0.01', description: 'Real-time crypto price' },
          { path: '/api/crypto/market', price: '$0.02', description: 'Market overview' },
          { path: '/api/crypto/address/:address', price: '$0.05', description: 'Address analysis' },
          { path: '/api/security/token/:address', price: '$0.05', description: 'Token security check' },
          { path: '/api/security/contract/:address', price: '$0.10', description: 'Contract risk analysis' },
          { path: '/api/investigate/:address', price: '$0.25', description: 'Full on-chain investigation' },
          { path: '/api/product/web3-security-guide', price: '$5.00', description: 'Web3 Security Investigation Guide (PDF)' },
          { path: '/api/product/ai-agent-defi-playbook', price: '$5.00', description: 'AI Agent DeFi Security Playbook (PDF)' }
        ],
        seller: 'OnChain Shadow',
        network: NETWORK_NAME
      }
    }
  };
}

function send402(req, res, config, reason) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const body = build402Body(req, config);
  if (reason) body.x402_error = reason;
  res.status(402).json(body);
}

// ============ Payment middleware factory ============

/**
 * @param {object} config { usd, atomic?, description, payTo, category }
 * @param {object} deps   { mode, internalSecret, replay, settler, facilitator }
 */
function x402PaymentRequired(config, deps) {
  const expectedAtomic = BigInt(config.atomic || usdToAtomic(config.usd).toString());

  return async function (req, res, next) {
    try {
      // 1. Secured internal bypass
      if (isAuthorizedInternalCall(req, deps.internalSecret)) {
        req.paid = true;
        req.paymentMode = 'internal';
        return next();
      }

      const rawHeader = req.headers['x-payment'];
      if (!rawHeader) {
        return send402(req, res, config, 'missing payment');
      }

      // 2. Structural / cryptographic validation (shared by both modes)
      const parsed = parsePayment(rawHeader, {
        payTo: config.payTo || DEFAULT_PAY_TO,
        expectedAtomic
      });
      if (!parsed.ok) {
        return send402(req, res, config, parsed.reason);
      }

      // 3. Replay protection — reject anything we have already settled
      if (deps.replay.isSettledHash(parsed.hash)) {
        return send402(req, res, config, 'payment transaction already used (replay)');
      }
      if (deps.replay.isSettledSenderNonce(parsed.sender, parsed.nonce)) {
        return send402(req, res, config, 'sender nonce already settled (replay)');
      }

      // 4. Verify / settle according to mode
      if (deps.mode === 'facilitator') {
        try {
          await deps.facilitator.verify(rawHeader);
        } catch (e) {
          return send402(req, res, config, e.message);
        }
      } else {
        // onchain: settle at most once per hash (concurrent duplicates coalesce)
        try {
          await deps.replay.withInflight(parsed.hash, async () => {
            // Re-check after acquiring the inflight slot
            if (deps.replay.isSettledHash(parsed.hash)) {
              const e = new Error('payment transaction already used (replay)');
              throw e;
            }
            await deps.settler.settle(parsed, parsed.payload.transaction);
            deps.replay.markSettled(parsed.hash, parsed.sender, parsed.nonce);
          });
        } catch (e) {
          if (e.code === 'REPLAY') {
            return send402(req, res, config, 'payment transaction already used (replay)');
          }
          return send402(req, res, config, `onchain verification failed: ${e.message}`);
        }
      }

      // Facilitator mode still tracks settled payments for our own replay defence
      if (deps.mode === 'facilitator') {
        deps.replay.markSettled(parsed.hash, parsed.sender, parsed.nonce);
      }

      req.paid = true;
      req.paymentMode = deps.mode;
      req.paymentTx = parsed.hash;
      req.paymentAmount = parsed.amount.toString();
      return next();
    } catch (e) {
      // Absolute fail-closed: unexpected error -> 402, never open access
      return send402(req, res, config, `internal error: ${e.message}`);
    }
  };
}

module.exports = {
  x402PaymentRequired,
  build402Body,
  send402,
  isAuthorizedInternalCall,
  isLoopbackAddress,
  getBaseUrl,
  timingSafeEqual
};
