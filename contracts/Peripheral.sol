pragma solidity ^0.8.17;

import { Enum } from "safe-contracts/contracts/common/Enum.sol";

contract Peripheral {
    mapping(address => bytes32) public latestCommitments;
    uint256 public nonce;

    event Operation(uint256 nonce, address safe, bytes data);

    function changeThreshold(uint256 threshold) external {
        uint256 currentNonce = nonce;
        bytes memory encodedThreshold = abi.encode(threshold);
        latestCommitments[msg.sender] = _getCommitment(encodedThreshold);
        emit Operation(currentNonce, msg.sender, encodedThreshold);
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
        uint256 currentNonce = nonce;
        bytes memory encodedParams = abi.encode(
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
        );
        latestCommitments[msg.sender] = _getCommitment(encodedParams);
        emit Operation(currentNonce, msg.sender, encodedParams);
    }

    function _getCommitment(bytes memory data) internal returns (bytes32) {
        bytes32 commitment = keccak256(abi.encode(data, nonce));
        unchecked {
            ++nonce;
        }
        return commitment;
    }
}
