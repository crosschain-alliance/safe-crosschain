//SPDX-License-Identifier: MIT

pragma solidity ^0.8.23;

import { RLPReader } from "@eth-optimism/contracts-bedrock/src/libraries/rlp/RLPReader.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { HashiProver } from "./hashi/HashiProver.sol";
import { AccountAndStorageProof, ReceiptProof } from "./hashi/HashiProverStructs.sol";
import { Enum } from "safe-contracts/contracts/common/Enum.sol";
import { ISafe } from "./interfaces/safe/ISafe.sol";
import { IControllerModule } from "./interfaces/IControllerModule.sol";

contract ControllerModule is IControllerModule, HashiProver, Ownable {
    using RLPReader for RLPReader.RLPItem;
    using RLPReader for bytes;

    uint256 public constant LATEST_COMMITMENTS_SLOT = 0;
    uint256 public constant OWNER_SLOT = 2; // Slot in Safe
    uint256 public constant THRESHOLD_SLOT = 4; // Slot in Safe

    uint256 public immutable SOURCE_CHAIN_ID;
    address public immutable MAIN_SAFE;
    address public immutable SECONDARY_SAFE;
    address public immutable SENTIMENTAL_OWNER = address(0x1); // refer to https://github.com/safe-global/safe-smart-account/blob/main/contracts/base/OwnerManager.sol#L17
    address public peripheralContract;
    bytes32 public PERIPHERAL_COMMITMENTS_STORAGE_KEY;
    bytes32 public immutable REMOVED_OWNER_EVENT_SIG =
        0xf8d49fc529812e9a7c5c50e69c20f0dccc0db8fa95c98bc58cc9a4f1c1299eaf;

    uint256 public currentNonce;

    constructor(
        uint256 sourceChainId,
        address mainSafe,
        address secondarySafe,
        address shoyuBashi
    ) HashiProver(shoyuBashi) Ownable(msg.sender) {
        SOURCE_CHAIN_ID = sourceChainId;
        MAIN_SAFE = mainSafe;
        SECONDARY_SAFE = secondarySafe;
        PERIPHERAL_COMMITMENTS_STORAGE_KEY = keccak256(abi.encode(MAIN_SAFE, LATEST_COMMITMENTS_SLOT));
    }

    function setPeripheral(address peripheral_) external onlyOwner {
        peripheralContract = peripheral_;
    }

    /// @inheritdoc IControllerModule
    function execTransaction(SafeTxParams calldata safeTxParams, AccountAndStorageProof calldata proof) external {
        bytes memory data = abi.encode(
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
        );
        bytes32 expectedLatestPeripheralCommitment = _verifyStorageProof(
            proof,
            false,
            PERIPHERAL_COMMITMENTS_STORAGE_KEY
        );
        bytes32 latestPeripheralCommitment = keccak256(abi.encode(block.chainid, data, currentNonce));
        if (expectedLatestPeripheralCommitment != latestPeripheralCommitment) {
            revert InvalidLatestPeripheralCommitment(latestPeripheralCommitment, expectedLatestPeripheralCommitment);
        }
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

    /// @inheritdoc IControllerModule
    function removeOwnerOperation(
        ReceiptProof calldata ownerProof,
        AccountAndStorageProof calldata thresholdProof
    ) external {
        // Owner proof
        bytes memory rlpEncodedEvent = verifyForeignEvent(ownerProof);
        RLPReader.RLPItem[] memory rlpEncodedEventFields = rlpEncodedEvent.toRLPItem().readList();
        bytes32 emitterBytes32 = bytes32(rlpEncodedEventFields[0].readBytes()); // result returned is right padded bytes32 address

        RLPReader.RLPItem[] memory eventData = rlpEncodedEventFields[1].readList();

        bytes32 eventSignature = bytes32(eventData[0].readBytes());
        bytes32 removedOwnerBytes32 = bytes32(eventData[1].readBytes()); // result returned is left pad bytes32 address
        address emitterContractAddress;
        address removedOwner = address(uint160(uint256(removedOwnerBytes32)));
        assembly {
            emitterContractAddress := shr(96, emitterBytes32)
        }

        if (emitterContractAddress != MAIN_SAFE) {
            revert InvalidAccount(emitterContractAddress, MAIN_SAFE);
        }
        if (eventSignature != REMOVED_OWNER_EVENT_SIG) {
            revert InvalidEventSignature(REMOVED_OWNER_EVENT_SIG, eventSignature);
        }

        // threshold proof

        bytes32 expectedThresholdFromProof = _verifyStorageProof(thresholdProof, true, bytes32(THRESHOLD_SLOT));
        uint256 expectedThreshold;
        assembly {
            // assume that the max threshold allowed <= 0xff (255)
            expectedThreshold := shr(248, expectedThresholdFromProof)
        }
        require(expectedThreshold > 0, "Invalid threshold");

        address[] memory originalOwners = ISafe(SECONDARY_SAFE).getOwners();
        // we could in theory prove the previous owner before 1 block to check that if the value is the removed Owner
        // here we check the local owners list instead
        for (uint256 i = 0; i < originalOwners.length; i++) {
            if (i == 0 && originalOwners[i] == removedOwner) {
                ISafe(SECONDARY_SAFE).execTransactionFromModule(
                    SECONDARY_SAFE,
                    0,
                    abi.encodeWithSelector(
                        ISafe.removeOwner.selector,
                        SENTIMENTAL_OWNER, // prev owner is 0x1 if the removed owner is the first in the list
                        removedOwner,
                        expectedThreshold
                    ),
                    Enum.Operation.Call
                );
            } else if (originalOwners[i] == removedOwner) {
                ISafe(SECONDARY_SAFE).execTransactionFromModule(
                    SECONDARY_SAFE,
                    0,
                    abi.encodeWithSelector(
                        ISafe.removeOwner.selector,
                        originalOwners[i - 1], // prev owner is 0x1 if the removed owner is the first in the list
                        removedOwner,
                        expectedThreshold
                    ),
                    Enum.Operation.Call
                );
            }
        }
    }

    /// @inheritdoc IControllerModule
    function addOwnerOperation(
        AccountAndStorageProof calldata ownerProof,
        AccountAndStorageProof calldata thresholdProof
    ) external {
        // The new owner will be added to the top of the list
        // Before: owners[SENTIMENTAL_OWNER] -> originalOwner
        // After: owners[SENTIMENTAL_OWNER] -> newOwner -> originalOwner

        bytes32 bytes32Address = bytes32(uint256(uint160(SENTIMENTAL_OWNER)));
        bytes32 bytes32Slot = bytes32(uint256(OWNER_SLOT));
        bytes32 sentimentalOwnerStorageKey = keccak256(abi.encodePacked(bytes32Address, bytes32Slot));
        if (ownerProof.storageKeys[0] != sentimentalOwnerStorageKey)
            revert InvalidStorageKey(ownerProof.storageKeys[0], sentimentalOwnerStorageKey);

        // result returned is right padded bytes32 address
        bytes32 expectedNewOwnerValueFromProof = bytes32(verifyForeignStorage(ownerProof)[0]);
        // new owner from the main safe
        address expectedNewOwner;

        assembly {
            expectedNewOwner := shr(96, expectedNewOwnerValueFromProof)
        }

        if (thresholdProof.storageKeys[0] != bytes32(uint256(THRESHOLD_SLOT))) {
            revert InvalidStorageKey(thresholdProof.storageKeys[0], bytes32(uint256(THRESHOLD_SLOT)));
        }

        bytes32 expectedThresholdFromProof = _verifyStorageProof(thresholdProof, true, bytes32(THRESHOLD_SLOT));
        uint256 expectedThreshold;
        assembly {
            // assume that the max threshold allowed <= 0xff (255)
            expectedThreshold := shr(248, expectedThresholdFromProof)
        }

        require(expectedThreshold > 0, "Invalid threshold");

        ISafe(SECONDARY_SAFE).execTransactionFromModule(
            SECONDARY_SAFE,
            0,
            abi.encodeWithSelector(ISafe.addOwnerWithThreshold.selector, expectedNewOwner, expectedThreshold),
            Enum.Operation.Call
        );
    }

    /// @inheritdoc IControllerModule
    function swapOwnerOperation(AccountAndStorageProof calldata ownerProof, address previousOwner) external {
        bytes32 bytes32Address = bytes32(uint256(uint160(previousOwner)));
        bytes32 bytes32Slot = bytes32(uint256(OWNER_SLOT));
        bytes32 previousOwnerStorageKey = keccak256(abi.encodePacked(bytes32Address, bytes32Slot));

        bytes32 expectedNewOwnerValueFromProof = _verifyStorageProof(ownerProof, true, previousOwnerStorageKey);
        address expectedNewOwner;

        assembly {
            expectedNewOwner := shr(96, expectedNewOwnerValueFromProof)
        }

        address[] memory originalOwners = ISafe(SECONDARY_SAFE).getOwners();
        if (previousOwner == SENTIMENTAL_OWNER && originalOwners[0] != expectedNewOwner) {
            ISafe(SECONDARY_SAFE).execTransactionFromModule(
                SECONDARY_SAFE,
                0,
                abi.encodeWithSelector(ISafe.swapOwner.selector, previousOwner, originalOwners[0], expectedNewOwner),
                Enum.Operation.Call
            );
        } else {
            for (uint256 i = 0; i < originalOwners.length; i++) {
                if (originalOwners[i] == previousOwner && originalOwners[i + 1] != expectedNewOwner) {
                    // update new owner;
                    ISafe(SECONDARY_SAFE).execTransactionFromModule(
                        SECONDARY_SAFE,
                        0,
                        abi.encodeWithSelector(
                            ISafe.swapOwner.selector,
                            previousOwner,
                            originalOwners[i + 1],
                            expectedNewOwner
                        ),
                        Enum.Operation.Call
                    );
                }
            }
        }
    }

    function _verifyStorageProof(
        AccountAndStorageProof calldata proof,
        bool isSafeOperation,
        bytes32 storageKey
    ) internal view returns (bytes32) {
        if (proof.chainId != SOURCE_CHAIN_ID) revert InvalidChainId(proof.chainId, SOURCE_CHAIN_ID);
        if (proof.storageKeys[0] != storageKey) revert InvalidStorageKey(proof.storageKeys[0], storageKey);
        if (isSafeOperation) {
            if (proof.account != MAIN_SAFE) revert InvalidAccount(proof.account, MAIN_SAFE);
        } else {
            if (proof.account != peripheralContract) revert InvalidAccount(proof.account, peripheralContract);
        }

        bytes32 expectedStorageValue = bytes32(verifyForeignStorage(proof)[0]);

        return expectedStorageValue;
    }
}
