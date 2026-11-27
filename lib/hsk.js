// HSK 链支付校验（HashKey Chain）
// 客户端带 X-HSK-PAYMENT: <txHash>；服务端读链上 Paid 事件，验证后放行。
// 没有这个头时，请求照旧走 x402（Base 的 USDC），两条支付路径并存。

const { ethers } = require('ethers');

const RPC = process.env.HSK_RPC || 'https://testnet.hsk.xyz';
const CONTRACT = (process.env.HSK_CONTRACT || '').trim();
const EXPECTED_CHAIN_ID = Number(process.env.HSK_CHAIN_ID || 133);

const ABI = [
  'event Paid(address indexed agent, bytes32 indexed nonce, bytes32 endpointId, uint256 amount, uint256 at)',
  'function totalReceived() view returns (uint256)',
  'function isNonceUsed(bytes32) view returns (bool)',
];

const iface = new ethers.Interface(ABI);
const usedTx = new Set(); // 单实例内存去重；重启丢失，演示够用
let provider = null;

function getProvider() {
  if (!provider) provider = new ethers.JsonRpcProvider(RPC, undefined, { staticNetwork: true });
  return provider;
}

// /api/security/token/:address -> keccak256('/api/security/token')
function endpointIdFor(req) {
  const raw = (req.route && req.route.path) || req.path || '';
  const stripped = raw.replace(/\/:[A-Za-z0-9_]+/g, '');
  return ethers.keccak256(ethers.toUtf8Bytes(stripped));
}

async function verifyPayment(txHash, req, cfg) {
  if (!CONTRACT) return { ok: false, code: 'no_contract_configured' };
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return { ok: false, code: 'bad_tx_hash' };
  const key = txHash.toLowerCase();
  if (usedTx.has(key)) return { ok: false, code: 'tx_already_used' };

  const p = getProvider();
  const net = await p.getNetwork();
  if (Number(net.chainId) !== EXPECTED_CHAIN_ID) return { ok: false, code: 'wrong_chain' };

  const rc = await p.getTransactionReceipt(txHash);
  if (!rc) return { ok: false, code: 'tx_not_found' };
  if (rc.status !== 1) return { ok: false, code: 'tx_failed' };

  const wantEndpoint = endpointIdFor(req);
  let found = null;
  for (const log of rc.logs) {
    if (log.address.toLowerCase() !== CONTRACT.toLowerCase()) continue;
    let parsed;
    try { parsed = iface.parseLog(log); } catch { continue; }
    if (parsed && parsed.name === 'Paid') { found = parsed.args; break; }
  }
  if (!found) return { ok: false, code: 'no_paid_event' };
  if (found.endpointId.toLowerCase() !== wantEndpoint.toLowerCase()) return { ok: false, code: 'endpoint_mismatch' };

  const priceWei = BigInt(Math.round(Number(cfg.usd) * 1e6)) * 10n ** 12n; // $1 -> 1e18 wei 的近似映射
  if (found.amount < priceWei) return { ok: false, code: 'underpaid' };

  usedTx.add(key);
  return {
    ok: true,
    via: 'hsk',
    tx: txHash,
    agent: found.agent,
    amount: found.amount.toString(),
    endpointId: found.endpointId,
    at: Number(found.at),
  };
}

function hskGate(cfg) {
  return async (req, res, next) => {
    const txHash = (req.header('X-HSK-PAYMENT') || '').trim();
    if (!txHash) return next();
    try {
      const r = await verifyPayment(txHash, req, cfg);
      if (!r.ok) {
        return res.status(402).json({
          error: 'hsk_payment_invalid',
          reason: r.code,
          contract: CONTRACT || null,
          network: `HashKey Chain (${EXPECTED_CHAIN_ID})`,
        });
      }
      req.hskPayment = r;
      return next();
    } catch (e) {
      return res.status(402).json({ error: 'hsk_payment_unverifiable', reason: e.shortMessage || e.message });
    }
  };
}

module.exports = { hskGate, verifyPayment, endpointIdFor, CONTRACT, RPC, EXPECTED_CHAIN_ID };
