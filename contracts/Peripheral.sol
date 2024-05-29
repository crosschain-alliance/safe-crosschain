//SPDX-License-Identifier: MIT

pragma solidity ^0.8.23;

import { Enum } from "safe-contracts/contracts/common/Enum.sol";
import { ISafe } from "./interfaces/safe/ISafe.sol";

contract Peripheral {
    uint256 public immutable TARGET_CHAIN_ID;

    mapping(address => bytes32) public latestCommitments;
    uint256 public nonce;

    event Operation(uint256 nonce, address safe, bytes data);

    constructor(uint256 targetChainId) {
        TARGET_CHAIN_ID = targetChainId;
    }

    function changeThreshold(uint256 threshold) external {
        _generateCommitment(abi.encodeWithSelector(ISafe.changeThreshold.selector, threshold));
    }

    function enableModule(address module) external {
        _generateCommitment(abi.encodeWithSelector(ISafe.enableModule.selector, module));
    }

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
            abi.encodeWithSelector(
                ISafe.execTransaction.selector,
                to,
                value,
                data,
                operation,
                safeTxGas,
                baseGas,
                gasPrice,
                gasToken,
                refundReceiver,
                signatures
            )
        );
    }

    function _generateCommitment(bytes memory data) internal {
        uint256 currentNonce = nonce;
        bytes32 commitment = keccak256(abi.encode(TARGET_CHAIN_ID, msg.sender, data, currentNonce));
        latestCommitments[msg.sender] = commitment;
        unchecked {
            ++nonce;
        }
        emit Operation(currentNonce, msg.sender, data);
    }
}
