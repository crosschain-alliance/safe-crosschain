//SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { Enum } from "safe-contracts/contracts/common/Enum.sol";
import { AccountAndStorageProof, ReceiptProof } from "../hashi/HashiProverStructs.sol";

interface IControllerModule {
    struct SafeTxParams {
        address to;
        uint256 value;
        bytes data;
        Enum.Operation operation;
        uint256 safeTxGas;
        uint256 baseGas;
        uint256 gasPrice;
        address gasToken;
        address payable refundReceiver;
        bytes signatures;
    }

    error InvalidLatestPeripheralCommitment(
        bytes32 latestPeripheralCommitment,
        bytes32 expectedLatestPeripheralCommitment
    );
    error InvalidChainId(uint256 chainId, uint256 expectedChainId);
    error InvalidAccount(address account, address expectedAccount);
    error InvalidStorageKey(bytes32 storageKey, bytes32 expectedStorageKey);
    error InvalidEventSignature(bytes32 expectedEventSignature, bytes32 actualEventSignature);

    function setPeripheral(address peripheral) external;

    function execTransaction(SafeTxParams calldata safeTxParams, AccountAndStorageProof calldata proof) external;

    function removeOwnerOperation(
        ReceiptProof calldata ownerProof,
        AccountAndStorageProof calldata thresholdProof
    ) external;

    function addOwnerOperation(
        AccountAndStorageProof calldata ownerProof,
        AccountAndStorageProof calldata thresholdProof
    ) external;

    function swapOwnerOperation(AccountAndStorageProof calldata ownerProof, address previousOwner) external;
}
