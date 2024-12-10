// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.5.0;

/// @title The interface for a Solidly V3 Pool
/// @notice A Solidly pool facilitates swapping and automated market making between any two assets that strictly conform
/// to the ERC20 specification
interface ISolidlyV3Pool {
    /// @notice The 0th storage slot in the pool stores many values, and is exposed as a single method to save gas
    /// when accessed externally.
    /// @return sqrtPriceX96 The current price of the pool as a sqrt(token1/token0) Q64.96 value
    /// tick The current tick of the pool, i.e. according to the last tick transition that was run.
    /// This value may not always be equal to SqrtTickMath.getTickAtSqrtRatio(sqrtPriceX96) if the price is on a tick
    /// boundary.
    /// fee The pool's current fee in hundredths of a bip, i.e. 1e-6
    /// unlocked Whether the pool is currently locked to reentrancy
    function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint24 fee, bool unlocked);

    /// @notice Returns the information about a position by the position's key
    /// @param key The position's key is a hash of a preimage composed by the owner, tickLower and tickUpper
    /// @return _liquidity The amount of liquidity in the position,
    /// Returns tokensOwed0 the computed amount of token0 owed to the position as of the last mint/burn/poke,
    /// Returns tokensOwed1 the computed amount of token1 owed to the position as of the last mint/burn/poke
    function positions(
        bytes32 key
    ) external view returns (uint128 _liquidity, uint128 tokensOwed0, uint128 tokensOwed1);

    /// @notice The contract that deployed the pool, which must adhere to the ISolidlyV3Factory interface
    /// @return The contract address
    function factory() external view returns (address);

    /// @notice Returns the amounts in/out and resulting pool state for a swap without executing the swap
    /// @param zeroForOne The direction of the swap, true for token0 to token1, false for token1 to token0
    /// @param amountSpecified The amount of the swap, which implicitly configures the swap as exact input (positive), or exact output (negative)
    /// @param sqrtPriceLimitX96 The Q64.96 sqrt price limit. If zero for one, the price cannot be less than this
    /// value after the swap. If one for zero, the price cannot be greater than this value after the swap
    /// @return amount0 The delta of the pool's balance of token0 that will result from the swap (exact when negative, minimum when positive)
    /// @return amount1 The delta of the pool's balance of token1 that will result from the swap (exact when negative, minimum when positive)
    /// @return sqrtPriceX96After The value the pool's sqrtPriceX96 will have after the swap
    /// @return tickAfter The value the pool's tick will have after the swap
    /// @return liquidityAfter The value the pool's liquidity will have after the swap
    function quoteSwap(
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96
    )
        external
        view
        returns (int256 amount0, int256 amount1, uint160 sqrtPriceX96After, int24 tickAfter, uint128 liquidityAfter);
}
