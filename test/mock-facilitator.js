'use strict';

/**
 * Mock facilitator HTTP server for tests.
 *
 * Speaks the x402 v1 verify protocol the server uses:
 *   POST /verify
 *   { kind: "exact", payment: { scheme, network, payload } }
 *   -> 200 { verify: { success: true } }
 *      200 { verify: { success: false, failureReason } }
 *
 * The decision callback receives the decoded payload object and returns
 * { success } or throws (a thrown error simulates a facilitator outage).
 */

const http = require('http');

function startMockFacilitator({ onVerify } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      if (req.method !== 'POST' || !req.url.includes('verify')) {
        res.writeHead(404).end();
        return;
      }
      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        const parsedRequest = JSON.parse(body);
        const rawPayload =
          parsedRequest?.payment?.payload ?? parsedRequest?.paymentPayload;
        const paymentObj = JSON.parse(Buffer.from(rawPayload, 'base64').toString('utf8'));

        let decision;
        if (onVerify) {
          decision = await onVerify(paymentObj, parsedRequest);
        } else {
          decision = { success: true };
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify(
            decision.success
              ? { verify: { success: true } }
              : {
                  verify: {
                    success: false,
                    failureReason: decision.failureReason || 'payment rejected by mock facilitator'
                  }
                }
          )
        );
      } catch (e) {
        // Simulate a facilitator failure with 500
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}/verify` });
    });
    server.on('error', reject);
  });
}

module.exports = { startMockFacilitator };
