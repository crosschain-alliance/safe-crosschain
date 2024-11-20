//SPDX-License-Identifier: MIT

pragma solidity ^0.8.23;

import { Enum } from "safe-contracts/contracts/common/Enum.sol";
import { IPeripheral } from "./interfaces/IPeripheral.sol";

contract Peripheral is IPeripheral {
    uint256 public immutable TARGET_CHAIN;

    mapping(address => bytes32) public latestCommitments;
    uint256 public currentNonce;

    constructor(uint256 targetChain) {
        TARGET_CHAIN = targetChain;
    }

    /// @inheritdoc IPeripheral
    function changeThreshold(uint256 threshold) external {
        _generateCommitment(abi.encode(threshold));
    }

    /// @inheritdoc IPeripheral
    function enableModule(address module) external {
        _generateCommitment(abi.encode(module));
    }

    /// @inheritdoc IPeripheral
    function execTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        Enum.Operation operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes calldata signatures
    ) external {
        _generateCommitment(
            abi.encode(to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, signatures)
        );
    }

    function _generateCommitment(bytes memory data) internal {
        uint256 nonce = currentNonce;
        bytes32 commitment = keccak256(abi.encode(TARGET_CHAIN, data, nonce));
        latestCommitments[msg.sender] = commitment;
        unchecked {
            ++currentNonce;
        }
        emit Operation(nonce, msg.sender, data);
    }
}
