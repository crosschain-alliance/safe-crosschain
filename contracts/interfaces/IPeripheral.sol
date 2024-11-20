//SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { Enum } from "safe-contracts/contracts/common/Enum.sol";

interface IPeripheral {
    event Operation(uint256 nonce, address safe, bytes data);

    function changeThreshold(uint256 threshold) external;

    function enableModule(address module) external;

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
    ) external;
}
