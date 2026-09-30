'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('../server');
const { ReplayGuard } = require('../lib/replay');
const { isAuthorizedInternalCall } = require('../lib/middleware');
const { startTestServer } = require('./helpers');

function makeDeps(over = {}) {
  return {
    mode: 'onchain',
    internalSecret: 'test-secret-value',
    replay: new ReplayGuard(), // no filePath -> purely in-memory
    settler: { settle: async () => ({ hash: '0x' }) },
    facilitator: { verify: async () => ({ success: true }) },
    ...over
  };
}

// ---------- Free endpoints ----------

test('free endpoint / returns 200 with service info', async () => {
  const app = createApp(makeDeps());
  const { server, url } = await startTestServer(app);
  try {
    const res = await fetch(`${url}/`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.match(body.name, /OnChain Shadow/);
    assert.ok(body.paid_endpoints);
  } finally {
    server.close();
  }
});

test('free endpoint /health returns 200', async () => {
  const app = createApp(makeDeps());
  const { server, url } = await startTestServer(app);
  try {
    const res = await fetch(`${url}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
  } finally {
    server.close();
  }
});

test('free endpoint /api/status returns 200 with pricing', async () => {
  const app = createApp(makeDeps());
  const { server, url } = await startTestServer(app);
  try {
    const res = await fetch(`${url}/api/status`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.payment_protocol, 'x402');
    assert.ok(body.pricing);
    assert.ok(body.products['web3-security-guide']);
  } finally {
    server.close();
  }
});

// ---------- Internal bypass authorization (unit tests with mock req) ----------

function mockReq({ remoteAddress = '127.0.0.1', headers = {} } = {}) {
  return {
    socket: { remoteAddress },
    headers
  };
}

test('internal bypass succeeds for loopback + correct secret', () => {
  const req = mockReq({
    headers: { 'x-internal-call': 'true', 'x-internal-secret': 'test-secret-value' }
  });
  assert.equal(isAuthorizedInternalCall(req, 'test-secret-value'), true);
});

test('internal bypass rejected when secret missing on request', () => {
  const req = mockReq({ headers: { 'x-internal-call': 'true' } });
  assert.equal(isAuthorizedInternalCall(req, 'test-secret-value'), false);
});

test('internal bypass rejected when secret wrong', () => {
  const req = mockReq({
    headers: { 'x-internal-call': 'true', 'x-internal-secret': 'wrong' }
  });
  assert.equal(isAuthorizedInternalCall(req, 'test-secret-value'), false);
});

test('internal bypass rejected from non-loopback peer even with secret', () => {
  const req = mockReq({
    remoteAddress: '203.0.113.9',
    headers: { 'x-internal-call': 'true', 'x-internal-secret': 'test-secret-value' }
  });
  assert.equal(isAuthorizedInternalCall(req, 'test-secret-value'), false);
});

test('internal bypass rejected when server has no secret configured', () => {
  const req = mockReq({
    headers: { 'x-internal-call': 'true', 'x-internal-secret': 'test-secret-value' }
  });
  assert.equal(isAuthorizedInternalCall(req, ''), false);
});

test('internal bypass rejected without x-internal-call header', () => {
  const req = mockReq({ headers: { 'x-internal-secret': 'test-secret-value' } });
  assert.equal(isAuthorizedInternalCall(req, 'test-secret-value'), false);
});

test('internal bypass works end-to-end via loopback HTTP with secret', async () => {
  const app = createApp(makeDeps());
  const { server, url } = await startTestServer(app);
  try {
    const res = await fetch(`${url}/api/security/contract/0x1234567890123456789012345678901234567890`, {
      headers: {
        'x-internal-call': 'true',
        'x-internal-secret': 'test-secret-value'
      }
    });
    assert.equal(res.status, 200);
  } finally {
    server.close();
  }
});

test('internal bypass end-to-end rejected with wrong secret over HTTP', async () => {
  const app = createApp(makeDeps());
  const { server, url } = await startTestServer(app);
  try {
    const res = await fetch(`${url}/api/security/contract/0x12345678901234789012345678901234567890`, {
      headers: { 'x-internal-call': 'true', 'x-internal-secret': 'nope' }
    });
    assert.equal(res.status, 402);
  } finally {
    server.close();
  }
});
