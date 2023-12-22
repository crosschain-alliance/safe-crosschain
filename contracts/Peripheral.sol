pragma solidity ^0.8.17;

import { Enum } from "safe-contracts/contracts/common/Enum.sol";

contract Peripheral {
    mapping(address => bytes32) public latestCommitments;
    uint256 public nonce;

    event Operation(uint256 nonce, address safe, bytes data);

    function changeThreshold(uint256 threshold) external {
        _generateCommitment(abi.encode(threshold));
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
            abi.encode(to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, signatures)
        );
    }

    function _generateCommitment(bytes memory data) internal {
        uint256 currentNonce = nonce;
        bytes32 commitment = keccak256(abi.encode(data, currentNonce));
        latestCommitments[msg.sender] = commitment;
        unchecked {
            ++nonce;
        }
        emit Operation(currentNonce, msg.sender, data);
    }
}
