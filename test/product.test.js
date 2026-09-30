'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { createApp, PRODUCTS } = require('../server');
const { ReplayGuard } = require('../lib/replay');
const { MockBaseChain, MockSettler } = require('./mock-chain');
const {
  buildSignedTransfer,
  encodeX402Header,
  startTestServer,
  PAY_TO,
  BUYER_WALLET
} = require('./helpers');

async function setupProductServer() {
  const chain = new MockBaseChain();
  chain.setBalance(BUYER_WALLET.address, 100_000_000n);
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
  return { server, url, chain, settler };
}

test('product catalog points at real on-disk PDF files', () => {
  for (const p of Object.values(PRODUCTS)) {
    assert.ok(fs.existsSync(p.file), `missing file for ${p.id}: ${p.file}`);
    assert.equal(p.usd, '5');
    assert.equal(p.atomic, '5000000'); // $5 = 5,000,000 atomic
  }
});

test('GET /api/product/:id without payment -> 402 priced at $5 (no bytes leaked)', async () => {
  const { server, url } = await setupProductServer();
  try {
    const res = await fetch(`${url}/api/product/web3-security-guide`);
    assert.equal(res.status, 402);
    const body = await res.json();
    assert.equal(body.amount.usd, '5');
    assert.equal(body.amount.atomic, '5000000');
    // Response must not contain any PDF bytes
    assert.doesNotMatch(JSON.stringify(body), /%PDF/);
  } finally {
    server.close();
  }
});

test('unknown product id -> 404', async () => {
  const { server, url } = await setupProductServer();
  try {
    const res = await fetch(`${url}/api/product/does-not-exist`);
    assert.equal(res.status, 404);
  } finally {
    server.close();
  }
});

test('valid $5 payment -> PDF byte stream with attachment headers', async () => {
  const { server, url, chain } = await setupProductServer();
  try {
    const product = PRODUCTS['web3-security-guide'];
    const signed = await buildSignedTransfer({ amountAtomic: 5_000_000n });
    const header = encodeX402Header({ raw: signed.raw, amountAtomic: 5_000_000n });
    const res = await fetch(`${url}/api/product/web3-security-guide`, {
      headers: { 'x-payment': header }
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/pdf/);
    assert.match(res.headers.get('content-disposition'), /attachment/);
    assert.match(res.headers.get('content-disposition'), /web3-security-guide\.pdf/);

    const buf = Buffer.from(await res.arrayBuffer());
    assert.deepEqual(buf.subarray(0, 5), Buffer.from('%PDF-', 'utf8'));
    // Delivered bytes must equal the actual product file exactly
    const realFile = fs.readFileSync(product.file);
    assert.equal(buf.length, realFile.length);
    assert.deepEqual(buf, realFile);

    // Payment really settled
    assert.equal(chain.getBalance(PAY_TO), 5_000_000n);
  } finally {
    server.close();
  }
});

test('second product (AI Agent playbook) downloads as PDF after payment', async () => {
  const { server, url } = await setupProductServer();
  try {
    const signed = await buildSignedTransfer({ amountAtomic: 5_000_000n, nonce: 7 });
    const header = encodeX402Header({ raw: signed.raw, amountAtomic: 5_000_000n });
    const res = await fetch(`${url}/api/product/ai-agent-defi-playbook`, {
      headers: { 'x-payment': header }
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/pdf/);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.deepEqual(buf.subarray(0, 5), Buffer.from('%PDF-', 'utf8'));
  } finally {
    server.close();
  }
});

test('replaying a PDF payment -> 402, no second delivery', async () => {
  const { server, url } = await setupProductServer();
  try {
    const signed = await buildSignedTransfer({ amountAtomic: 5_000_000n });
    const header = encodeX402Header({ raw: signed.raw, amountAtomic: 5_000_000n });
    const first = await fetch(`${url}/api/product/web3-security-guide`, {
      headers: { 'x-payment': header }
    });
    assert.equal(first.status, 200);

    const second = await fetch(`${url}/api/product/web3-security-guide`, {
      headers: { 'x-payment': header }
    });
    assert.equal(second.status, 402);
  } finally {
    server.close();
  }
});

test('underpaying for a PDF ($0.01 tx for $5 item) -> 402', async () => {
  const { server, url } = await setupProductServer();
  try {
    const signed = await buildSignedTransfer({ amountAtomic: 10000n });
    const header = encodeX402Header({ raw: signed.raw, amountAtomic: 10000n });
    const res = await fetch(`${url}/api/product/web3-security-guide`, {
      headers: { 'x-payment': header }
    });
    assert.equal(res.status, 402);
    assert.match((await res.json()).x402_error, /below required/i);
  } finally {
    server.close();
  }
});
