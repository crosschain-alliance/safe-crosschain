// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.23;

interface IShoyuBashi {
    function getThresholdHash(uint256 domain, uint256 id) external view returns (bytes32);
}
