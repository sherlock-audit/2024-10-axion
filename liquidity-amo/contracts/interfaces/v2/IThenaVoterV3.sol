// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

interface IThenaVoterV3 {
    function createGauge(
        address _pool,
        uint256 _gaugeType
    ) external returns (address _gauge, address _internal_bribe, address _external_bribe);
    function governor() external view returns (address);
    function gauges(address _pool) external view returns (address);
    function whitelist(address[] memory _token) external;
}
