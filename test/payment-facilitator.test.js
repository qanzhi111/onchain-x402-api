'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('../server');
const { ReplayGuard } = require('../lib/replay');
const { FacilitatorClient } = require('../lib/facilitator');
const { startMockFacilitator } = require('./mock-facilitator');
const {
  buildSignedTransfer,
  encodeX402Header,
  startTestServer,
  PAY_TO
} = require('./helpers');

const TARGET_CONTRACT = '0x1234567890123456789012345678901234567890';

// Token security endpoint is fully deterministic offline (no external fetch
// without ETHERSCAN_API_KEY) and costs $0.05 = 50000 atomic.
const TOKEN_PATH = `/api/security/token/${TARGET_CONTRACT}`;

async function setupWithFacilitator({ onVerify } = {}) {
  const fac = await startMockFacilitator({ onVerify });
  const replay = new ReplayGuard();
  const app = createApp({
    mode: 'facilitator',
    internalSecret: 'test-secret',
    replay,
    facilitator: new FacilitatorClient({ url: fac.url }),
    settler: { settle: async () => { throw new Error('onchain settler must not be used'); } }
  });
  const { server, url } = await startTestServer(app);
  return { server, url, fac, replay };
}

test('facilitator mode: no payment -> 402 (same shape as onchain mode)', async () => {
  const { server, url, fac } = await setupWithFacilitator();
  try {
    const res = await fetch(`${url}/api/crypto/price/bitcoin`);
    assert.equal(res.status, 402);
    const body = await res.json();
    assert.equal(body.amount.usd, '0.01');
    assert.equal(body.amount.atomic, '10000');
  } finally {
    server.close();
    fac.server.close();
  }
});

test('facilitator mode: approves valid payment -> 200 data (no onchain settle)', async () => {
  const { server, url, fac } = await setupWithFacilitator({
    onVerify: (paymentObj) => {
      assert.equal(paymentObj.x402Version, 1);
      assert.equal(paymentObj.payTo.toLowerCase(), PAY_TO.toLowerCase());
      assert.equal(paymentObj.amount, 50000);
      assert.equal(paymentObj.network, 'base');
      return { success: true };
    }
  });
  try {
    const signed = await buildSignedTransfer({ amountAtomic: 50000n });
    const header = encodeX402Header({ raw: signed.raw, amountAtomic: 50000n });
    const res = await fetch(`${url}${TOKEN_PATH}`, {
      headers: { 'x-payment': header }
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.address.toLowerCase(), TARGET_CONTRACT.toLowerCase());
  } finally {
    server.close();
    fac.server.close();
  }
});

test('facilitator mode: facilitator rejects -> 402 fail-closed', async () => {
  const { server, url, fac } = await setupWithFacilitator({
    onVerify: () => ({ success: false, failureReason: 'bad payment' })
  });
  try {
    const signed = await buildSignedTransfer({ amountAtomic: 50000n });
    const header = encodeX402Header({ raw: signed.raw, amountAtomic: 50000n });
    const res = await fetch(`${url}${TOKEN_PATH}`, {
      headers: { 'x-payment': header }
    });
    assert.equal(res.status, 402);
    assert.match((await res.json()).x402_error, /bad payment/i);
  } finally {
    server.close();
    fac.server.close();
  }
});

test('facilitator mode: facilitator outage (500) -> 402 fail-closed', async () => {
  const { server, url, fac } = await setupWithFacilitator({
    onVerify: () => { throw new Error('boom'); }
  });
  try {
    const signed = await buildSignedTransfer({ amountAtomic: 50000n });
    const header = encodeX402Header({ raw: signed.raw, amountAtomic: 50000n });
    const res = await fetch(`${url}${TOKEN_PATH}`, {
      headers: { 'x-payment': header }
    });
    assert.equal(res.status, 402);
  } finally {
    server.close();
    fac.server.close();
  }
});

test('facilitator mode: replay of facilitator-approved payment -> rejected', async () => {
  const { server, url, fac } = await setupWithFacilitator();
  try {
    const signed = await buildSignedTransfer({ amountAtomic: 50000n });
    const header = encodeX402Header({ raw: signed.raw, amountAtomic: 50000n });
    const r1 = await fetch(`${url}${TOKEN_PATH}`, {
      headers: { 'x-payment': header }
    });
    assert.equal(r1.status, 200);
    const r2 = await fetch(`${url}${TOKEN_PATH}`, {
      headers: { 'x-payment': header }
    });
    assert.equal(r2.status, 402);
    assert.match((await r2.json()).x402_error, /replay|already used/i);
  } finally {
    server.close();
    fac.server.close();
  }
});

test('facilitator mode: unreachable URL (connection refused) -> 402 fail-closed', async () => {
  const replay = new ReplayGuard();
  const app = createApp({
    mode: 'facilitator',
    internalSecret: 'test-secret',
    replay,
    facilitator: new FacilitatorClient({
      url: 'http://127.0.0.1:1/verify', // nothing listens here
      timeoutMs: 3000
    }),
    settler: { settle: async () => { throw new Error('unused'); } }
  });
  const { server, url } = await startTestServer(app);
  try {
    const signed = await buildSignedTransfer({ amountAtomic: 50000n });
    const header = encodeX402Header({ raw: signed.raw, amountAtomic: 50000n });
    const res = await fetch(`${url}${TOKEN_PATH}`, {
      headers: { 'x-payment': header }
    });
    assert.equal(res.status, 402);
  } finally {
    server.close();
  }
});
