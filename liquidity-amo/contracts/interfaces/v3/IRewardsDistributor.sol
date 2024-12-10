// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.5.0;

interface IRewardsDistributor {
    function collectPoolFees(address pool) external returns (uint256 amount0, uint256 amount1);
}
