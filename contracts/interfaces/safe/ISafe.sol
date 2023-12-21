// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.17;

import { Enum } from "safe-contracts/contracts/common/Enum.sol";

interface ISafe {
    /**
     * @notice Execute `operation` (0: Call, 1: DelegateCall) to `to` with `value` (Native Token)
     * @dev Function is virtual to allow overriding for L2 singleton to emit an event for indexing.
     * @param _to Destination address of module transaction.
     * @param _value Ether value of module transaction.
     * @param _data Data payload of module transaction.
     * @param _operation Operation type of module transaction.
     * @return _success Boolean flag indicating if the call succeeded.
     */
    function execTransactionFromModule(
        address _to,
        uint256 _value,
        bytes memory _data,
        Enum.Operation _operation
    ) external returns (bool _success);

    /**
     * @notice Executes a `operation` {0: Call, 1: DelegateCall}} transaction to `to` with `value` (Native Currency)
     *          and pays `gasPrice` * `gasLimit` in `gasToken` token to `refundReceiver`.
     * @dev The fees are always transferred, even if the user transaction fails.
     *      This method doesn't perform any sanity check of the transaction, such as:
     *      - if the contract at `to` address has code or not
     *      - if the `gasToken` is a contract or not
     *      It is the responsibility of the caller to perform such checks.
     * @param _to Destination address of Safe transaction.
     * @param _value Ether value of Safe tsransaction.
     * @param _data Data payload of Safe transaction.
     * @param _operation Operation type of Safe transaction.
     * @param _safeTxGas Gas that should be used for the Safe transaction.
     * @param _baseGas Gas costs that are independent of the transaction execution(e.g. base transaction fee, signature check, payment of the refund)
     * @param _gasPrice Gas price that should be used for the payment calculation.
     * @param _gasToken Token address (or 0 if ETH) that is used for the payment.
     * @param _refundReceiver Address of receiver of gas payment (or 0 if tx.origin).
     * @param _signatures Signature data that should be verified.
     *                   Can be packed ECDSA signature ({bytes32 r}{bytes32 s}{uint8 v}), contract signature (EIP-1271) or approved hash.
     * @return _success Boolean indicating transaction's success.
     */
    function execTransaction(
        address _to,
        uint256 _value,
        bytes calldata _data,
        Enum.Operation _operation,
        uint256 _safeTxGas,
        uint256 _baseGas,
        uint256 _gasPrice,
        address _gasToken,
        address payable _refundReceiver,
        bytes memory _signatures
    ) external payable returns (bool _success);

    /**
     * @dev Set a guard that checks transactions before execution
     *      This can only be done via a Safe transaction.
     *      ⚠️ IMPORTANT: Since a guard has full power to block Safe transaction execution,
     *        a broken guard can cause a denial of service for the Safe. Make sure to carefully
     *        audit the guard code and design recovery mechanisms.
     * @notice Set Transaction Guard `guard` for the Safe. Make sure you trust the guard.
     * @param _guard The address of the guard to be used or the 0 address to disable the guard
     */
    function setGuard(address _guard) external;

    /**
     * @notice Enables the module `module` for the Safe.
     * @dev This can only be done via a Safe transaction.
     * @param _module Module to be whitelisted.
     */
    function enableModule(address _module) external;

    /**
     * @notice Returns the number of required confirmations for a Safe transaction aka the threshold.
     * @return _threshold Threshold number.
     */
    function getThreshold() external view returns (uint256 _threshold);

    /**
     * @notice Changes the threshold of the Safe to `_threshold`.
     * @dev This can only be done via a Safe transaction.
     * @param _threshold New threshold.
     */
    function changeThreshold(uint256 _threshold) external;

    /**
     * @notice Returns a list of Safe owners.
     * @return _owners Array of Safe owners.
     */
    function getOwners() external view returns (address[] memory _owners);

    /**
     * @notice Adds the owner `owner` to the Safe and updates the threshold to `_threshold`.
     * @dev This can only be done via a Safe transaction.
     * @param _owner New owner address.
     * @param _threshold New threshold.
     */
    function addOwnerWithThreshold(address _owner, uint256 _threshold) external;

    /**
     * @notice Removes the owner `owner` from the Safe and updates the threshold to `_threshold`.
     * @dev This can only be done via a Safe transaction.
     * @param _prevOwner Owner that pointed to the owner to be removed in the linked list
     * @param _owner Owner address to be removed.
     * @param _threshold New threshold.
     */
    function removeOwner(address _prevOwner, address _owner, uint256 _threshold) external;

    /**
     * @notice Replaces the owner `oldOwner` in the Safe with `newOwner`.
     * @dev This can only be done via a Safe transaction.
     * @param _prevOwner Owner that pointed to the owner to be replaced in the linked list
     * @param _oldOwner Owner address to be replaced.
     * @param _newOwner New owner address.
     */
    function swapOwner(address _prevOwner, address _oldOwner, address _newOwner) external;

    /**
     * @notice Returns if `owner` is an owner of the Safe.
     * @return _result if owner is an owner of the Safe.
     */
    function isOwner(address _owner) external view returns (bool _result);

    /**
     * @notice Returns the nonce of the safe
     * @return _nonce Current nonce.
     */
    function nonce() external view returns (uint256 _nonce);

    /**
     * @notice Sets an initial storage of the Safe contract.
     * @dev This method can only be called once.
     *      If a proxy was created without setting up, anyone can call setup and claim the proxy.
     * @param _owners List of Safe owners.
     * @param _threshold Number of required confirmations for a Safe transaction.
     * @param _to Contract address for optional delegate call.
     * @param _data Data payload for optional delegate call.
     * @param _fallbackHandler Handler for fallback calls to this contract
     * @param _paymentToken Token that should be used for the payment (0 is ETH)
     * @param _payment Value that should be paid
     * @param _paymentReceiver Address that should receive the payment (or 0 if tx.origin)
     */
    function setup(
        address[] calldata _owners,
        uint256 _threshold,
        address _to,
        bytes calldata _data,
        address _fallbackHandler,
        address _paymentToken,
        uint256 _payment,
        address payable _paymentReceiver
    ) external;

    /**
     * @notice Returns the pre-image of the transaction hash (see getTransactionHash).
     * @param _to Destination address.
     * @param _value Ether value.
     * @param _data Data payload.
     * @param _operation Operation type.
     * @param _safeTxGas Gas that should be used for the safe transaction.
     * @param _baseGas Gas costs for that are independent of the transaction execution(e.g. base transaction fee, signature check, payment of the refund)
     * @param _gasPrice Maximum gas price that should be used for this transaction.
     * @param _gasToken Token address (or 0 if ETH) that is used for the payment.
     * @param _refundReceiver Address of receiver of gas payment (or 0 if tx.origin).
     * @param _nonce Transaction nonce.
     * @return _tx Transaction hash bytes.
     */
    function encodeTransactionData(
        address _to,
        uint256 _value,
        bytes calldata _data,
        Enum.Operation _operation,
        uint256 _safeTxGas,
        uint256 _baseGas,
        uint256 _gasPrice,
        address _gasToken,
        address _refundReceiver,
        uint256 _nonce
    ) external view returns (bytes memory _tx);
}
