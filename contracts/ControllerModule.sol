//SPDX-License-Identifier: MIT

pragma solidity ^0.8.23;

import { HashiProver } from "./hashi/HashiProver.sol";
import { AccountAndStorageProof } from "./hashi/HashiProverStructs.sol";
import { Enum } from "safe-contracts/contracts/common/Enum.sol";
import { ISafe } from "./interfaces/safe/ISafe.sol";
import { IControllerModule } from "./interfaces/IControllerModule.sol";

contract ControllerModule is IControllerModule, HashiProver {
    uint256 public constant LATEST_COMMITMENTS_SLOT = 0;

    uint256 public immutable SOURCE_CHAIN_ID;
    address public immutable MAIN_SAFE;
    address public immutable SECONDARY_SAFE;
    address public immutable PERIPHERAL;
    bytes32 public PERIPHERAL_COMMITMENTS_STORAGE_KEY;

    uint256 public currentNonce;

    constructor(
        uint256 sourceChainId,
        address mainSafe,
        address secondarySafe,
        address peripheral,
        address shoyuBashi
    ) HashiProver(shoyuBashi) {
        SOURCE_CHAIN_ID = sourceChainId;
        MAIN_SAFE = mainSafe;
        SECONDARY_SAFE = secondarySafe;
        PERIPHERAL = peripheral;
        PERIPHERAL_COMMITMENTS_STORAGE_KEY = keccak256(
            abi.encode(keccak256(abi.encode(MAIN_SAFE, LATEST_COMMITMENTS_SLOT)))
        );
    }

    /// @inheritdoc IControllerModule
    function changeThreshold(uint256 threshold, AccountAndStorageProof calldata proof) external {
        _verifyProof(proof, abi.encode(threshold));
        ISafe(SECONDARY_SAFE).execTransactionFromModule(
            SECONDARY_SAFE,
            0,
            abi.encodeWithSelector(ISafe.changeThreshold.selector, threshold),
            Enum.Operation.Call
        );
    }

    /// @inheritdoc IControllerModule
    function enableModule(address module, AccountAndStorageProof calldata proof) external {
        _verifyProof(proof, abi.encode(module));
        ISafe(SECONDARY_SAFE).execTransactionFromModule(
            SECONDARY_SAFE,
            0,
            abi.encodeWithSelector(ISafe.enableModule.selector, module),
            Enum.Operation.Call
        );
    }

    /// @inheritdoc IControllerModule
    function execTransaction(SafeTxParams calldata safeTxParams, AccountAndStorageProof calldata proof) external {
        _verifyProof(
            proof,
            abi.encode(
                safeTxParams.to,
                safeTxParams.value,
                safeTxParams.data,
                safeTxParams.operation,
                safeTxParams.safeTxGas,
                safeTxParams.baseGas,
                safeTxParams.gasPrice,
                safeTxParams.gasToken,
                safeTxParams.refundReceiver,
                safeTxParams.signatures
            )
        );
        ISafe(SECONDARY_SAFE).execTransactionFromModule(
            SECONDARY_SAFE,
            0,
            abi.encodeWithSelector(
                ISafe.execTransaction.selector,
                safeTxParams.to,
                safeTxParams.value,
                safeTxParams.data,
                safeTxParams.operation,
                safeTxParams.safeTxGas,
                safeTxParams.baseGas,
                safeTxParams.gasPrice,
                safeTxParams.gasToken,
                safeTxParams.refundReceiver,
                safeTxParams.signatures
            ),
            Enum.Operation.Call
        );
    }

    function _verifyProof(AccountAndStorageProof calldata proof, bytes memory data) internal view {
        if (proof.chainId != SOURCE_CHAIN_ID) revert InvalidChainId(proof.chainId, SOURCE_CHAIN_ID);
        if (proof.account != PERIPHERAL) revert InvalidAccount(proof.account, PERIPHERAL);
        if (proof.storageKeys[0] != PERIPHERAL_COMMITMENTS_STORAGE_KEY)
            revert InvalidStorageKey(proof.storageKeys[0], PERIPHERAL_COMMITMENTS_STORAGE_KEY);

        bytes32 expectedLatestPeripheralCommitment = bytes32(verifyForeignStorage(proof)[0]);
        bytes32 latestPeripheralCommitment = keccak256(abi.encode(block.chainid, data, currentNonce));
        if (expectedLatestPeripheralCommitment != latestPeripheralCommitment) {
            revert InvalidLatestPeripheralCommitment(latestPeripheralCommitment, expectedLatestPeripheralCommitment);
        }
        return;
    }
}
