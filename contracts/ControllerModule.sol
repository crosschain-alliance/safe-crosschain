//SPDX-License-Identifier: MIT

pragma solidity ^0.8.23;

import { RLPReader } from "solidity-rlp/contracts/RLPReader.sol";
import { MerklePatriciaProofVerifier } from "./libraries/MerklePatriciaProofVerifier.sol";
import { Enum } from "safe-contracts/contracts/common/Enum.sol";
import { IShoyuBashi } from "./interfaces/hashi/IShoyuBashi.sol";
import { ISafe } from "./interfaces/safe/ISafe.sol";

contract ControllerModule {
    using RLPReader for RLPReader.RLPItem;
    using RLPReader for bytes;

    uint256 internal constant LATEST_COMMITMENTS_SLOT = 0;

    uint256 public immutable SOURCE_CHAIN_ID;
    address public immutable MAIN_SAFE;
    address public immutable SECONDARY_SAFE;
    address public immutable PERIPHERAL;
    address public immutable SHOYU_BASHI;

    struct Proof {
        uint256 blockNumber;
        uint256 nonce;
        bytes blockHeader;
        bytes peripheralAccountProof;
        bytes peripheralStorageProof;
    }

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

    uint256 public expectedNonce;

    error InvalidLatestPeripheralCommitment(
        bytes32 latestPeripheralCommitment,
        bytes32 expectedLatestPeripheralCommitment
    );
    error InvalidBlockHeader(bytes32 blockHeaderHash, bytes32 expectedBlockHeaderHash);
    error InvalidAccountStorageRoot();
    error InvalidNonce(uint256 nonce, uint256 expectedNonce);
    error InvalidAccountRlp(bytes accountRlp);

    constructor(
        uint256 sourceChainId,
        address mainSafe,
        address secondarySafe,
        address peripheral,
        address shoyuBashi
    ) {
        SOURCE_CHAIN_ID = sourceChainId;
        MAIN_SAFE = mainSafe;
        SECONDARY_SAFE = secondarySafe;
        PERIPHERAL = peripheral;
        SHOYU_BASHI = shoyuBashi;
    }

    function changeThreshold(uint256 threshold, Proof calldata proof) external {
        _verifyProof(proof, abi.encode(threshold));
        ISafe(SECONDARY_SAFE).execTransactionFromModule(
            SECONDARY_SAFE,
            0,
            abi.encodeWithSelector(ISafe.changeThreshold.selector, threshold),
            Enum.Operation.Call
        );
    }

    function enableModule(address module, Proof calldata proof) external {
        _verifyProof(proof, abi.encode(module));
        ISafe(SECONDARY_SAFE).execTransactionFromModule(
            SECONDARY_SAFE,
            0,
            abi.encodeWithSelector(ISafe.enableModule.selector, module),
            Enum.Operation.Call
        );
    }

    function execTransaction(SafeTxParams calldata safeTxParams, Proof calldata proof) external {
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

    function _verifyProof(Proof calldata proof, bytes memory data) internal {
        bytes32 expectedBlockHeaderHash = IShoyuBashi(SHOYU_BASHI).getThresholdHash(
            SOURCE_CHAIN_ID,
            proof.blockNumber
        );
        bytes32 blockHeaderHash = keccak256(proof.blockHeader);
        if (expectedBlockHeaderHash != blockHeaderHash)
            revert InvalidBlockHeader(blockHeaderHash, expectedBlockHeaderHash);

        bytes32 expectedLatestPeripheralCommitment = _verifyStorageProofAndGetValue(
            _verifyAccountProofAndGetStorageRoot(proof.blockHeader, proof.peripheralAccountProof),
            proof.peripheralStorageProof
        );
        bytes32 latestPeripheralCommitment = keccak256(abi.encode(block.chainid, data, proof.nonce));
        if (expectedLatestPeripheralCommitment != latestPeripheralCommitment) {
            revert InvalidLatestPeripheralCommitment(latestPeripheralCommitment, expectedLatestPeripheralCommitment);
        }

        _checkNonceAndIncrementExpectedNonce(proof.nonce);
        return;
    }

    function _verifyAccountProofAndGetStorageRoot(
        bytes memory blockHeader,
        bytes memory peripheralAccountProof
    ) internal view returns (bytes32) {
        RLPReader.RLPItem[] memory blockHeaderFields = blockHeader.toRlpItem().toList();
        bytes32 stateRoot = bytes32(blockHeaderFields[3].toUint());
        bytes memory accountRlp = MerklePatriciaProofVerifier.extractProofValue(
            stateRoot,
            abi.encodePacked(keccak256(abi.encodePacked(PERIPHERAL))),
            peripheralAccountProof.toRlpItem().toList()
        );
        bytes32 accountStorageRoot = bytes32(accountRlp.toRlpItem().toList()[2].toUint());
        if (accountStorageRoot.length == 0) revert InvalidAccountStorageRoot();
        RLPReader.RLPItem[] memory accountFields = accountRlp.toRlpItem().toList();
        if (accountFields.length != 4) revert InvalidAccountRlp(accountRlp); // [nonce, balance, storageRoot, codeHash]
        return bytes32(accountFields[2].toUint());
    }

    function _verifyStorageProofAndGetValue(
        bytes32 storageRoot,
        bytes calldata peripheralStorageProof
    ) internal view returns (bytes32) {
        bytes memory slotValue = MerklePatriciaProofVerifier.extractProofValue(
            storageRoot,
            abi.encodePacked(keccak256(abi.encode(keccak256(abi.encode(MAIN_SAFE, LATEST_COMMITMENTS_SLOT))))),
            peripheralStorageProof.toRlpItem().toList()
        );
        return _bytesToBytes32(slotValue);
    }

    function _checkNonceAndIncrementExpectedNonce(uint256 nonce) internal {
        if (nonce != expectedNonce) revert InvalidNonce(nonce, expectedNonce);
        unchecked {
            ++expectedNonce;
        }
    }

    function _bytesToBytes32(bytes memory source) internal pure returns (bytes32 result) {
        if (source.length == 0) {
            return bytes32(0);
        }
        // solhint-disable-next-line
        assembly {
            result := mload(add(add(source, 1), 32))
        }
    }
}
