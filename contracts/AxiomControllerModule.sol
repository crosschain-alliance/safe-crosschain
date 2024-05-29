//SPDX-License-Identifier: MIT

pragma solidity ^0.8.23;

import { Enum } from "safe-contracts/contracts/common/Enum.sol";
import { AxiomV2Client } from "@axiom-crypto/v2-periphery/src/client/AxiomV2Client.sol";
import { ISafe } from "./interfaces/safe/ISafe.sol";

contract AxiomControllerModule is AxiomV2Client {
    uint64 public immutable SOURCE_CHAIN_ID;
    address public immutable PERIPHERAL;
    address public immutable MAIN_SAFE;
    address public immutable SECONDARY_SAFE;
    bytes32 public immutable QUERY_SCHEMA;

    uint256 private _expectedNonce;

    error InvalidSourceChainId(uint256 sourceChainId, uint256 expectedSourceChainId);
    error InvalidQuerySchema(bytes32 querySchema, bytes32 expectedQuerySchema);
    error InvalidCommitment(bytes32 commitment, bytes32 expectedCommitment);
    error InvalidPeripheral(address peripheral, address expectedPheriperal);
    error InvalidNonce(uint256 nonce, uint256 expectedNonce);

    constructor(
        address axiomV2Query,
        uint64 sourceChainId,
        address peripheral,
        address mainSafe,
        address secondarySafe,
        bytes32 querySchema
    ) AxiomV2Client(axiomV2Query) {
        SOURCE_CHAIN_ID = sourceChainId;
        PERIPHERAL = peripheral;
        MAIN_SAFE = mainSafe;
        SECONDARY_SAFE = secondarySafe;
        QUERY_SCHEMA = querySchema;
    }

    function _validateAxiomV2Call(
        AxiomCallbackType, // callbackType,
        uint64 sourceChainId,
        address, // caller,
        bytes32 querySchema,
        uint256, // queryId,
        bytes calldata // extraData
    ) internal view override {
        if (sourceChainId != SOURCE_CHAIN_ID) revert InvalidSourceChainId(sourceChainId, SOURCE_CHAIN_ID);
        if (querySchema != QUERY_SCHEMA) revert InvalidQuerySchema(querySchema, QUERY_SCHEMA);
    }

    function _axiomV2Callback(
        uint64, // sourceChainId,
        address, // caller,
        bytes32, // querySchema,
        uint256, // queryId,
        bytes32[] calldata axiomResults,
        bytes calldata extraData
    ) internal override {
        address peripheral = _bytes32ToAddress(axiomResults[0]);
        if (peripheral != PERIPHERAL) revert InvalidPeripheral(peripheral, PERIPHERAL);

        (uint256 nonce, bytes memory data) = abi.decode(extraData, (uint256, bytes));
        _checkNonceAndIncrementExpectedNonce(nonce);

        bytes32 commitment = axiomResults[1];
        bytes32 expectedCommmitment = keccak256(abi.encode(block.chainid, MAIN_SAFE, data, nonce));
        if (commitment != expectedCommmitment) revert InvalidCommitment(commitment, expectedCommmitment);

        ISafe(SECONDARY_SAFE).execTransactionFromModule(SECONDARY_SAFE, 0, data, Enum.Operation.Call);
    }

    function _bytes32ToAddress(bytes32 data) internal pure returns (address) {
        return address(uint160(uint256(data)));
    }

    function _checkNonceAndIncrementExpectedNonce(uint256 nonce) internal {
        if (nonce != _expectedNonce) revert InvalidNonce(nonce, _expectedNonce);
        unchecked {
            ++_expectedNonce;
        }
    }
}
