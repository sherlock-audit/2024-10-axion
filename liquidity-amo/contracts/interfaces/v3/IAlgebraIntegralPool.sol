// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.5.0;

import "./IAlgebraPool.sol";

/// @title The interface for an Algebra Integral Pool
interface IAlgebraIntegralPool is IAlgebraPool {
    /// @notice The globalState structure in the pool stores many values but requires only one slot
    /// and is exposed as a single method to save gas when accessed externally.
    /// @dev **important security note: caller should check `unlocked` flag to prevent read-only reentrancy**
    /// @return price The current price of the pool as a sqrt(dToken1/dToken0) Q64.96 value
    /// @return tick The current tick of the pool, i.e. according to the last tick transition that was run
    /// This value may not always be equal to SqrtTickMath.getTickAtSqrtRatio(price) if the price is on a tick boundary
    /// @return lastFee The current (last known) pool fee value in hundredths of a bip, i.e. 1e-6 (so '100' is '0.01%'). May be obsolete if using dynamic fee plugin
    /// @return pluginConfig The current plugin config as bitmap. Each bit is responsible for enabling/disabling the hooks, the last bit turns on/off dynamic fees logic
    /// @return communityFee The community fee represented as a percent of all collected fee in thousandths, i.e. 1e-3 (so 100 is 10%)
    /// @return unlocked Reentrancy lock flag, true if the pool currently is unlocked, otherwise - false
    function globalState()
        external
        view
        returns (uint160 price, int24 tick, uint16 lastFee, uint8 pluginConfig, uint16 communityFee, bool unlocked);

    /// @notice Burn liquidity from the sender and account tokens owed for the liquidity to the position
    /// @dev Can be used to trigger a recalculation of fees owed to a position by calling with an amount of 0
    /// @dev Fees must be collected separately via a call to #collect
    /// @param bottomTick The lower tick of the position for which to burn liquidity
    /// @param topTick The upper tick of the position for which to burn liquidity
    /// @param amount How much liquidity to burn
    /// @param data Any data that should be passed through to the plugin
    /// @return amount0 The amount of token0 sent to the recipient
    /// @return amount1 The amount of token1 sent to the recipient
    function burn(
        int24 bottomTick,
        int24 topTick,
        uint128 amount,
        bytes calldata data
    ) external returns (uint256 amount0, uint256 amount1);

    /// @notice Returns the information about a position by the position's key
    /// @dev **important security note: caller should check reentrancy lock to prevent read-only reentrancy**
    /// @param key The position's key is a packed concatenation of the owner address, bottomTick and topTick indexes
    /// @return liquidity The amount of liquidity in the position
    /// @return innerFeeGrowth0Token Fee growth of token0 inside the tick range as of the last mint/burn/poke
    /// @return innerFeeGrowth1Token Fee growth of token1 inside the tick range as of the last mint/burn/poke
    /// @return fees0 The computed amount of token0 owed to the position as of the last mint/burn/poke
    /// @return fees1 The computed amount of token1 owed to the position as of the last mint/burn/poke
    function positions(
        bytes32 key
    )
        external
        view
        returns (
            uint256 liquidity,
            uint256 innerFeeGrowth0Token,
            uint256 innerFeeGrowth1Token,
            uint128 fees0,
            uint128 fees1
        );
}
