'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { createApp, tokenSafetyRateLimit, tokenSafetyCache } = require('../server');
const { ReplayGuard } = require('../lib/replay');

function makeDeps(over = {}) {
  return {
    mode: 'onchain',
    internalSecret: 'test-secret',
    replay: new ReplayGuard(),
    settler: { settle: async () => ({ hash: '0x' }) },
    facilitator: { verify: async () => ({ success: true }) },
    ...over
  };
}

function startTestServer(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
    });
    server.on('error', reject);
  });
}

/**
 * Start a tiny mock GoPlus server that returns controlled responses.
 */
function startMockGoPlus({ handler } = {}) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (handler) {
        handler(req, res);
      } else {
        // Default: return a realistic GoPlus response for Base USDC
        const url = new URL(req.url, `http://127.0.0.1`);
        const addr = url.searchParams.get('contract_addresses') || '';
        res.end(JSON.stringify({
          message: 'OK',
          result: {
            [addr.toLowerCase()]: {
              is_honeypot: '0',
              is_open_source: '1',
              is_proxy: '0',
              buy_tax: '0',
              sell_tax: '0',
              owner_change_balance: '0',
              can_take_back_ownership: '0',
              hidden_owner: '0',
              transfer_pausable: '0',
              is_blacklisted: '0',
              is_whitelisted: '0',
              lp_holder_count: '120',
              slippage_modifiable: '0',
              is_mintable: '0',
              owner_address: '0x0000000000000000000000000000000000000000',
              creator_address: '0x3365b6abfd9c20b1b1b1b1b1b1b1b1b1b1b1b1b1',
              trust_list: '',
              total_supply: '1000000000',
              holder_count: '42000'
            }
          }
        }));
      }
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

// ======================== Tests ========================

// ---------- Validation ----------

test('free token-safety: invalid address -> 400', async () => {
  const app = createApp(makeDeps());
  const { server, url } = await startTestServer(app);
  try {
    const res = await fetch(`${url}/api/free/token-safety/not-a-real-address`);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.reason, 'invalid_address');
  } finally {
    server.close();
  }
});

test('free token-safety: unsupported chain -> 400', async () => {
  const app = createApp(makeDeps());
  const { server, url } = await startTestServer(app);
  try {
    const res = await fetch(`${url}/api/free/token-safety/0x1234567890123456789012345678901234567890?chain=solana`);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.reason, 'unsupported_chain');
  } finally {
    server.close();
  }
});

// ---------- Successful response with mock GoPlus ----------

test('free token-safety: valid address + mock GoPlus -> translated result', async () => {
  const mockGoPlus = await startMockGoPlus();
  // Patch global fetch to redirect GoPlus calls to mock
  const origFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (typeof url === 'string' && url.includes('api.gopluslabs.io')) {
      const mockUrl = url.replace('https://api.gopluslabs.io', mockGoPlus.url);
      return origFetch(mockUrl, opts);
    }
    return origFetch(url, opts);
  };
  try {
    const app = createApp(makeDeps());
    const { server, url } = await startTestServer(app);
    try {
      const addr = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
      const res = await fetch(`${url}/api/free/token-safety/${addr}?chain=base`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.ok, true);
      assert.equal(body.address, addr);
      assert.equal(body.chain, 'base');
      assert.ok(['high_risk', 'caution', 'low_risk'].includes(body.verdict));
      assert.equal(body.raw_source, 'GoPlus');
      assert.ok(Array.isArray(body.flags));
      assert.ok(body.flags.length > 0);
      assert.ok(body.paid_upgrade);
      assert.equal(body.paid_upgrade.full_report.endpoint, '/api/security/token/:address');
      assert.equal(body.paid_upgrade.full_report.price_usd, '0.05');
      assert.equal(body.paid_upgrade.pdf.price_usd, '5');
      assert.ok(body.timestamp > 0);
      assert.equal(typeof body.score, 'number');
      assert.equal(typeof body.headline, 'string');
    } finally {
      server.close();
    }
  } finally {
    global.fetch = origFetch;
    mockGoPlus.server.close();
  }
});

// ---------- Risky token detection ----------

test('free token-safety: honeypot token -> high_risk with danger flags', async () => {
  const mockGoPlus = await startMockGoPlus({
    handler: (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const addr = url.searchParams.get('contract_addresses') || '';
      res.end(JSON.stringify({
        message: 'OK',
        result: {
          [addr.toLowerCase()]: {
            is_honeypot: '1',
            is_open_source: '0',
            is_proxy: '1',
            buy_tax: '0',
            sell_tax: '0.99',
            owner_change_balance: '1',
            can_take_back_ownership: '1',
            hidden_owner: '1',
            transfer_pausable: '1',
            is_blacklisted: '1',
            is_whitelisted: '1',
            lp_holder_count: '2'
          }
        }
      }));
    }
  });
  const origFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (typeof url === 'string' && url.includes('api.gopluslabs.io')) {
      return origFetch(url.replace('https://api.gopluslabs.io', mockGoPlus.url), opts);
    }
    return origFetch(url, opts);
  };
  try {
    const app = createApp(makeDeps());
    const { server, url } = await startTestServer(app);
    try {
      const addr = '0xdead000000000000000000000000000000000001';
      const res = await fetch(`${url}/api/free/token-safety/${addr}?chain=eth`);
      const body = await res.json();
      assert.equal(body.ok, true);
      assert.equal(body.verdict, 'high_risk');
      // Must have danger-level flags
      const dangers = body.flags.filter(f => f.level === 'danger');
      assert.ok(dangers.length >= 3, `expected >=3 danger flags, got ${dangers.length}`);
      // Must mention honeypot
      assert.ok(body.flags.some(f => f.label.includes('貔貅')), 'should flag honeypot in Chinese');
      assert.ok(body.score >= 50, 'risky token should have high score');
    } finally {
      server.close();
    }
  } finally {
    global.fetch = origFetch;
    mockGoPlus.server.close();
  }
});

// ---------- Caching ----------

test('free token-safety: second call within 30s uses cache (GoPlus hit only once)', async () => {
  let goPlusHits = 0;
  const mockGoPlus = await startMockGoPlus({
    handler: (req, res) => {
      goPlusHits++;
      const url = new URL(req.url, 'http://127.0.0.1');
      const addr = url.searchParams.get('contract_addresses') || '';
      res.end(JSON.stringify({
        message: 'OK',
        result: {
          [addr.toLowerCase()]: {
            is_honeypot: '0', is_open_source: '1', is_proxy: '0',
            buy_tax: '0', sell_tax: '0', owner_change_balance: '0',
            can_take_back_ownership: '0', hidden_owner: '0',
            transfer_pausable: '0', is_blacklisted: '0', is_whitelisted: '0'
          }
        }
      }));
    }
  });
  const origFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (typeof url === 'string' && url.includes('api.gopluslabs.io')) {
      return origFetch(url.replace('https://api.gopluslabs.io', mockGoPlus.url), opts);
    }
    return origFetch(url, opts);
  };
  try {
    const app = createApp(makeDeps());
    const { server, url } = await startTestServer(app);
    try {
      const addr = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      await fetch(`${url}/api/free/token-safety/${addr}?chain=base`);
      await fetch(`${url}/api/free/token-safety/${addr}?chain=base`);
      await fetch(`${url}/api/free/token-safety/${addr}?chain=base`);
      assert.equal(goPlusHits, 1, 'GoPlus should be called only once due to cache');
    } finally {
      server.close();
    }
  } finally {
    global.fetch = origFetch;
    mockGoPlus.server.close();
  }
});

// ---------- Upstream failure ----------

test('free token-safety: GoPlus upstream unavailable -> ok:false reason:upstream_unavailable', async () => {
  // Start a mock server that returns non-JSON / errors
  const mockGoPlus = await startMockGoPlus({
    handler: (_req, res) => {
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  });
  const origFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (typeof url === 'string' && url.includes('api.gopluslabs.io')) {
      return origFetch(url.replace('https://api.gopluslabs.io', mockGoPlus.url), opts);
    }
    return origFetch(url, opts);
  };
  try {
    const app = createApp(makeDeps());
    const { server, url } = await startTestServer(app);
    try {
      const addr = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
      const res = await fetch(`${url}/api/free/token-safety/${addr}`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.ok, false);
      assert.equal(body.reason, 'upstream_unavailable');
    } finally {
      server.close();
    }
  } finally {
    global.fetch = origFetch;
    mockGoPlus.server.close();
  }
});

// ---------- Rate limiting ----------

test('free token-safety: rate limit kicks in after 20 requests per minute', async () => {
  // Clear rate limit state from previous tests
  tokenSafetyRateLimit.clear();
  tokenSafetyCache.clear();
  // Use a mock GoPlus that returns valid data so each request completes
  const mockGoPlus = await startMockGoPlus(); // default handler returns safe data
  const origFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (typeof url === 'string' && url.includes('api.gopluslabs.io')) {
      return origFetch(url.replace('https://api.gopluslabs.io', mockGoPlus.url), opts);
    }
    return origFetch(url, opts);
  };
  try {
    const app = createApp(makeDeps());
    const { server, url } = await startTestServer(app);
    try {
      const addr = '0xcccccccccccccccccccccccccccccccccccccccc';
      // Send 20 requests — should all succeed
      for (let i = 0; i < 20; i++) {
        const res = await fetch(`${url}/api/free/token-safety/${addr}?chain=base`);
        assert.equal(res.status, 200, `request ${i + 1} should return 200`);
      }
      // 21st request should be rate-limited
      const res = await fetch(`${url}/api/free/token-safety/${addr}?chain=base`);
      assert.equal(res.status, 429);
      const body = await res.json();
      assert.equal(body.reason, 'rate_limited');
    } finally {
      server.close();
    }
  } finally {
    global.fetch = origFetch;
    mockGoPlus.server.close();
  }
});

// ---------- No paywall ----------

test('free token-safety: no X-PAYMENT header needed (no 402)', async () => {
  // Clear rate limit state from previous tests
  tokenSafetyRateLimit.clear();
  tokenSafetyCache.clear();
  // Use mock GoPlus so the request completes; verify no 402 is returned
  const mockGoPlus = await startMockGoPlus();
  const origFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (typeof url === 'string' && url.includes('api.gopluslabs.io')) {
      return origFetch(url.replace('https://api.gopluslabs.io', mockGoPlus.url), opts);
    }
    return origFetch(url, opts);
  };
  try {
    const app = createApp(makeDeps());
    const { server, url } = await startTestServer(app);
    try {
      const addr = '0xdddddddddddddddddddddddddddddddddddddddd';
      const res = await fetch(`${url}/api/free/token-safety/${addr}`);
      // Should NOT be 402 (payment required)
      assert.notEqual(res.status, 402);
      assert.equal(res.status, 200);
    } finally {
      server.close();
    }
  } finally {
    global.fetch = origFetch;
    mockGoPlus.server.close();
  }
});

// ---------- Offline intercepts ----------

test('/api/security/contract/:address returns 503 (offline, before paywall)', async () => {
  const app = createApp(makeDeps());
  const { server, url } = await startTestServer(app);
  try {
    const res = await fetch(`${url}/api/security/contract/0x1234567890123456789012345678901234567890`);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error, 'service_unavailable');
    assert.ok(body.message.includes('temporarily offline'));
    assert.ok(body.alternative.includes('/api/free/token-safety'));
  } finally {
    server.close();
  }
});

test('/api/investigate/:address returns 503 (offline, before paywall)', async () => {
  const app = createApp(makeDeps());
  const { server, url } = await startTestServer(app);
  try {
    const res = await fetch(`${url}/api/investigate/0x1234567890123456789012345678901234567890`);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error, 'service_unavailable');
    assert.ok(body.alternative.includes('/api/free/token-safety'));
  } finally {
    server.close();
  }
});

test('/api/security/contract 503 even with valid payment (no payment taken for empty result)', async () => {
  const { createApp } = require('../server');
  const { MockBaseChain, MockSettler } = require('./mock-chain');
  const { buildSignedTransfer, encodeX402Header, BUYER_WALLET } = require('./helpers');
  const chain = new MockBaseChain();
  chain.setBalance(BUYER_WALLET.address, 10_000_000n);
  const replay = new ReplayGuard();
  const settler = new MockSettler(chain);
  const app = createApp({
    mode: 'onchain',
    internalSecret: 'test-secret',
    replay,
    settler,
    facilitator: { verify: async () => { throw new Error('unused'); } }
  });
  const { server, url } = await startTestServer(app);
  try {
    const signed = await buildSignedTransfer({ amountAtomic: 100000n });
    const header = encodeX402Header({ raw: signed.raw, amountAtomic: 100000n });
    const res = await fetch(`${url}/api/security/contract/0x1234567890123456789012345678901234567890`, {
      headers: { 'x-payment': header }
    });
    // Should be 503 NOT 200 — no payment accepted for offline endpoint
    assert.equal(res.status, 503);
    // Buyer was NOT debited
    assert.equal(chain.getBalance(BUYER_WALLET.address), 10_000_000n);
  } finally {
    server.close();
  }
});

// ---------- Root endpoint updated ----------

test('root / shows free token-safety endpoint and marks offline endpoints', async () => {
  const app = createApp(makeDeps());
  const { server, url } = await startTestServer(app);
  try {
    const res = await fetch(`${url}/`);
    assert.equal(res.status, 200);
    const body = await res.json();
    // free_endpoints includes token-safety
    assert.ok(body.free_endpoints['/api/free/token-safety/:address']);
    // paid_endpoints marks contract and investigate as offline
    assert.match(body.paid_endpoints['/api/security/contract/:address'], /temporarily offline/i);
    assert.match(body.paid_endpoints['/api/investigate/:address'], /temporarily offline/i);
  } finally {
    server.close();
  }
});
