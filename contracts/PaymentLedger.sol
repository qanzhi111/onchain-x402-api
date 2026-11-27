// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title PaymentLedger
/// @notice 一次 API 调用一笔链上付款。agent 付款 → 合约记账 → 服务端凭 tx 放行数据。
/// @dev 部署在 HashKey Chain 主网（chainId 177）。原生 HSK 计价，无代币依赖。
contract PaymentLedger {
    address public immutable payee;

    uint256 public totalReceived;
    mapping(bytes32 => bool) public usedNonce;      // 防重放：同一个 nonce 只能付一次
    mapping(address => uint256) public paidBy;      // 按 agent 累计

    event Paid(
        address indexed agent,
        bytes32 indexed nonce,
        bytes32 endpointId,
        uint256 amount,
        uint256 at
    );
    event Withdrawn(address to, uint256 amount);

    error ZeroAmount();
    error NonceUsed();
    error NotPayee();
    error WithdrawFailed();

    constructor(address _payee) {
        payee = _payee;
    }

    /// @notice 为一个 API 端点付一次款
    /// @param nonce      调用方生成的唯一值（建议 keccak256(agent, endpoint, timestamp, id)）
    /// @param endpointId 端点标识，例如 keccak256("/api/security/token")
    function pay(bytes32 nonce, bytes32 endpointId) external payable {
        if (msg.value == 0) revert ZeroAmount();
        if (usedNonce[nonce]) revert NonceUsed();

        usedNonce[nonce] = true;
        totalReceived += msg.value;
        paidBy[msg.sender] += msg.value;

        emit Paid(msg.sender, nonce, endpointId, msg.value, block.timestamp);
    }

    /// @notice 收款人取走合约余额
    function withdraw() external {
        if (msg.sender != payee) revert NotPayee();
        uint256 bal = address(this).balance;
        (bool ok, ) = payee.call{value: bal}("");
        if (!ok) revert WithdrawFailed();
        emit Withdrawn(payee, bal);
    }

    /// @notice 视图：某笔 nonce 有没有被用过（服务端优先读事件，这个做兜底）
    function isNonceUsed(bytes32 nonce) external view returns (bool) {
        return usedNonce[nonce];
    }
}
