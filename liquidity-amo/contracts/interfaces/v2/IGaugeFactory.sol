// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.19;

interface IGaugeFactory {
    function createGaugeV2(
        address _rewardToken,
        address _ve,
        address _token,
        address _distribution,
        address _internal_bribe,
        address _external_bribe
    ) external returns (address);

    function createGauge(
        address _pool,
        uint256 _gaugeType
    ) external returns (address _gauge, address _internal_bribe, address _external_bribe);
}
