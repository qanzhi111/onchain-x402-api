'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('../server');
const { ReplayGuard } = require('../lib/replay');
const { MockBaseChain, MockSettler } = require('./mock-chain');
const {
  buildSignedTransfer,
  encodeX402Header,
  startTestServer,
  PAY_TO,
  BUYER_WALLET
} = require('./helpers');

const TARGET_CONTRACT = '0x1234567890123456789012345678901234567890';

async function setupServer({ balance = 10_000_000n, settlerOverrides = {} } = {}) {
  const chain = new MockBaseChain();
  chain.setBalance(BUYER_WALLET.address, balance);
  const replay = new ReplayGuard();
  const settler = new MockSettler(chain, settlerOverrides);
  const app = createApp({
    mode: 'onchain',
    internalSecret: 'test-secret',
    replay,
    settler,
    facilitator: { verify: async () => { throw new Error('should not be called'); } }
  });
  const { server, url } = await startTestServer(app);
  return { server, url, chain, replay, settler };
}

// ---------- 402 without payment ----------

test('no X-PAYMENT header -> 402 with payment requirements and no-store', async () => {
  const { server, url } = await setupServer();
  try {
    const res = await fetch(`${url}/api/security/token/${TARGET_CONTRACT}`);
    assert.equal(res.status, 402);
    assert.match(res.headers.get('cache-control') || '', /no-store/);
    const body = await res.json();
    assert.equal(body.scheme, 'exact');
    assert.equal(body.network, 'base');
    // amount gives both USD and atomic
    assert.equal(body.amount.usd, '0.05');
    assert.equal(body.amount.atomic, '50000');
    assert.equal(body.recipient.toLowerCase(), PAY_TO.toLowerCase());
    assert.ok(body.payment_requirements);
    assert.ok(body.extensions.bazaar);
  } finally {
    server.close();
  }
});

// ---------- Forged / tampered transactions ----------

test('garbage X-PAYMENT value -> 402 (fail-closed)', async () => {
  const { server, url } = await setupServer();
  try {
    const res = await fetch(`${url}/api/security/token/${TARGET_CONTRACT}`, {
      headers: { 'x-payment': 'not-valid-base64!!!' }
    });
    assert.equal(res.status, 402);
    const body = await res.json();
    assert.match(body.x402_error, /base64|parse/i);
  } finally {
    server.close();
  }
});

test('signed tx with wrong chainId -> rejected', async () => {
  const { server, url } = await setupServer();
  try {
    const signed = await buildSignedTransfer({ amountAtomic: 50000n, chainId: 1 });
    const header = encodeX402Header({ raw: signed.raw, amountAtomic: 50000n });
    const res = await fetch(`${url}/api/security/token/${TARGET_CONTRACT}`, {
      headers: { 'x-payment': header }
    });
    assert.equal(res.status, 402);
    const body = await res.json();
    assert.match(body.x402_error, /chainId/i);
  } finally {
    server.close();
  }
});

test('signed tx sending to wrong token contract -> rejected', async () => {
  const { server, url } = await setupServer();
  try {
    const signed = await buildSignedTransfer({
      amountAtomic: 50000n,
      to: '0xdead000000000000000000000000000000000000'
    });
    const header = encodeX402Header({ raw: signed.raw, amountAtomic: 50000n });
    const res = await fetch(`${url}/api/security/token/${TARGET_CONTRACT}`, {
      headers: { 'x-payment': header }
    });
    assert.equal(res.status, 402);
    assert.match((await res.json()).x402_error, /USDC|to/i);
  } finally {
    server.close();
  }
});

test('signed transfer to wrong recipient -> rejected', async () => {
  const { server, url } = await setupServer();
  try {
    const attacker = '0x000000000000000000000000000000000000dEaD';
    const signed = await buildSignedTransfer({ amountAtomic: 50000n, payTo: attacker });
    // header claims payTo=merchant but calldata pays attacker -> mismatch
    const header = encodeX402Header({ raw: signed.raw, amountAtomic: 50000n });
    const res = await fetch(`${url}/api/security/token/${TARGET_CONTRACT}`, {
      headers: { 'x-payment': header }
    });
    assert.equal(res.status, 402);
    assert.match((await res.json()).x402_error, /payTo|recipient/i);
  } finally {
    server.close();
  }
});

test('underpaid signed tx ($0.02 for a $0.05 endpoint) -> rejected', async () => {
  const { server, url } = await setupServer();
  try {
    const signed = await buildSignedTransfer({ amountAtomic: 20000n });
    const header = encodeX402Header({ raw: signed.raw, amountAtomic: 20000n });
    const res = await fetch(`${url}/api/security/token/${TARGET_CONTRACT}`, {
      headers: { 'x-payment': header }
    });
    assert.equal(res.status, 402);
    assert.match((await res.json()).x402_error, /below required/i);
  } finally {
    server.close();
  }
});

test('unsigned/forged raw transaction -> rejected', async () => {
  const { server, url } = await setupServer();
  try {
    const header = Buffer.from(
      JSON.stringify({
        x402Version: 1,
        scheme: 'exact',
        network: 'base',
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        payTo: PAY_TO,
        amount: 50000,
        transaction: '0x02c7' // not a real signed tx
      })
    ).toString('base64');
    const res = await fetch(`${url}/api/security/token/${TARGET_CONTRACT}`, {
      headers: { 'x-payment': header }
    });
    assert.equal(res.status, 402);
  } finally {
    server.close();
  }
});

test('valid signed tx but simulated transfer fails (no balance) -> rejected', async () => {
  const { server, url } = await setupServer({ balance: 0n });
  try {
    const signed = await buildSignedTransfer({ amountAtomic: 50000n });
    const header = encodeX402Header({ raw: signed.raw, amountAtomic: 50000n });
    const res = await fetch(`${url}/api/security/token/${TARGET_CONTRACT}`, {
      headers: { 'x-payment': header }
    });
    assert.equal(res.status, 402);
    assert.match((await res.json()).x402_error, /balance|reverted|verification/i);
  } finally {
    server.close();
  }
});

test('all-RPC network outage during settlement -> rejected (fail-closed)', async () => {
  const { server, url } = await setupServer({ settlerOverrides: { broadcastWorks: false } });
  try {
    const signed = await buildSignedTransfer({ amountAtomic: 50000n });
    const header = encodeX402Header({ raw: signed.raw, amountAtomic: 50000n });
    const res = await fetch(`${url}/api/security/token/${TARGET_CONTRACT}`, {
      headers: { 'x-payment': header }
    });
    assert.equal(res.status, 402);
    assert.match((await res.json()).x402_error, /RPC|outage|failed/i);
  } finally {
    server.close();
  }
});

// ---------- Valid payment -> data ----------

test('valid signed payment -> 200 and endpoint data delivered', async () => {
  const { server, url, chain } = await setupServer();
  try {
    const signed = await buildSignedTransfer({ amountAtomic: 50000n });
    const header = encodeX402Header({ raw: signed.raw, amountAtomic: 50000n });
    const res = await fetch(`${url}/api/security/token/${TARGET_CONTRACT}`, {
      headers: { 'x-payment': header }
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.address.toLowerCase(), TARGET_CONTRACT.toLowerCase());
    // Buyer was debited, merchant credited on the mock chain
    assert.equal(chain.getBalance(BUYER_WALLET.address), 10_000_000n - 50000n);
    assert.equal(chain.getBalance(PAY_TO), 50000n);
  } finally {
    server.close();
  }
});

test('overpayment is accepted as a tip and delivers data', async () => {
  const { server, url, chain } = await setupServer();
  try {
    const signed = await buildSignedTransfer({ amountAtomic: 75000n }); // $0.075 for $0.05
    const header = encodeX402Header({ raw: signed.raw, amountAtomic: 75000n });
    const res = await fetch(`${url}/api/security/token/${TARGET_CONTRACT}`, {
      headers: { 'x-payment': header }
    });
    assert.equal(res.status, 200);
    assert.equal(chain.getBalance(PAY_TO), 75000n);
  } finally {
    server.close();
  }
});

// ---------- Replay ----------

test('replaying the same settled transaction a second time -> rejected', async () => {
  const { server, url } = await setupServer();
  try {
    const signed = await buildSignedTransfer({ amountAtomic: 50000n });
    const header = encodeX402Header({ raw: signed.raw, amountAtomic: 50000n });
    const first = await fetch(`${url}/api/security/token/${TARGET_CONTRACT}`, {
      headers: { 'x-payment': header }
    });
    assert.equal(first.status, 200);

    const second = await fetch(`${url}/api/security/token/${TARGET_CONTRACT}`, {
      headers: { 'x-payment': header }
    });
    assert.equal(second.status, 402);
    assert.match((await second.json()).x402_error, /replay|already used/i);
  } finally {
    server.close();
  }
});

test('same sender nonce re-signed into a new tx -> rejected', async () => {
  const { server, url } = await setupServer();
  try {
    const first = await buildSignedTransfer({ amountAtomic: 50000n, nonce: 0 });
    const h1 = encodeX402Header({ raw: first.raw, amountAtomic: 50000n });
    const r1 = await fetch(`${url}/api/security/token/${TARGET_CONTRACT}`, {
      headers: { 'x-payment': h1 }
    });
    assert.equal(r1.status, 200);

    // Same nonce 0 but slightly different fee -> different hash, same sender nonce
    const second = await buildSignedTransfer({
      amountAtomic: 50000n,
      nonce: 0,
      overrides: { maxFeePerGas: 2000000n }
    });
    const h2 = encodeX402Header({ raw: second.raw, amountAtomic: 50000n });
    const r2 = await fetch(`${url}/api/security/token/${TARGET_CONTRACT}`, {
      headers: { 'x-payment': h2 }
    });
    assert.equal(r2.status, 402);
    assert.match((await r2.json()).x402_error, /nonce|replay/i);
  } finally {
    server.close();
  }
});
