'use strict';

/**
 * FacilitatorClient — verify an x402 payment through an external facilitator.
 *
 * Request (x402 v1 "exact"):
 *   POST {facilitatorUrl}
 *   { kind: "exact",
 *     payment: { scheme: "exact", network: "base", payload: <raw X-PAYMENT base64> } }
 *
 * Standard response:
 *   { verify: { success: true|false, failureReason?: string, ... } }
 *
 * The implementation also tolerates the alternate field layout used by some
 * deployed facilitators ({ isValid, invalidReason }). Any network error,
 * non-2xx status, malformed JSON or explicit failure -> rejection (fail-closed).
 */
class FacilitatorClient {
  constructor({ url, timeoutMs = 15000, fetchImpl } = {}) {
    this.url = url;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl || globalThis.fetch;
  }

  async verify(rawBase64Payment) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res;
    try {
      res = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          kind: 'exact',
          payment: {
            scheme: 'exact',
            network: 'base',
            payload: rawBase64Payment
          }
        })
      });
    } catch (e) {
      throw new Error(`facilitator request failed: ${e.name === 'AbortError' ? 'timeout' : e.message}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      let detail = '';
      try {
        detail = JSON.stringify(await res.json());
      } catch (e) {}
      throw new Error(`facilitator HTTP ${res.status} ${detail}`.trim());
    }

    let data;
    try {
      data = await res.json();
    } catch (e) {
      throw new Error('facilitator response is not valid JSON');
    }

    // Layout 1: { verify: { success, failureReason } }
    if (data && typeof data.verify === 'object') {
      if (data.verify.success === true) return { success: true };
      throw new Error(
        `facilitator rejected payment${data.verify.failureReason ? ': ' + data.verify.failureReason : ''}`
      );
    }

    // Layout 2: { isValid, invalidReason / invalidMessage }
    if (data && typeof data.isValid === 'boolean') {
      if (data.isValid === true) return { success: true };
      throw new Error(
        `facilitator rejected payment: ${data.invalidReason || data.invalidMessage || 'invalid'}`
      );
    }

    throw new Error('facilitator response missing verify.success / isValid fields');
  }
}

module.exports = { FacilitatorClient };
