// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import {IUniswapV3Pool} from "../interfaces/v3/IUniswapV3Pool.sol";
import {IMinter} from "../interfaces/IMinter.sol";

contract MockUniswapV3PoolCaller {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    address poolAddress;
    address collateral;
    address boost;

    enum SwapType {
        SELL,
        BUY
    }

    constructor(address _poolAddress, address _collateral, address _boost) {
        poolAddress = _poolAddress;
        collateral = _collateral;
        boost = _boost;
    }

    /// @notice Adds liquidity for the given recipient/tickLower/tickUpper position
    /// @dev The caller of this method receives a callback in the form of IUniswapV3MintCallback#uniswapV3MintCallback
    /// in which they must pay any token0 or token1 owed for the liquidity. The amount of token0/token1 due depends
    /// on tickLower, tickUpper, the amount of liquidity, and the current price.
    /// @param recipient The address for which the liquidity will be created
    /// @param tickLower The lower tick of the position in which to add liquidity
    /// @param tickUpper The upper tick of the position in which to add liquidity
    /// @param amount The amount of liquidity to mint
    /// @param data Any data that should be passed through to the callback
    /// @return amount0 The amount of token0 that was paid to mint the given amount of liquidity. Matches the value in the callback
    /// @return amount1 The amount of token1 that was paid to mint the given amount of liquidity. Matches the value in the callback
    function mint(
        address recipient,
        int24 tickLower,
        int24 tickUpper,
        uint128 amount,
        bytes calldata data
    ) external returns (uint256 amount0, uint256 amount1) {
        (amount0, amount1) = IUniswapV3Pool(poolAddress).mint(recipient, tickLower, tickUpper, amount, data);
    }

    /// @notice Swap token0 for token1, or token1 for token0
    /// @dev The caller of this method receives a callback in the form of IUniswapV3SwapCallback#uniswapV3SwapCallback
    /// @param recipient The address to receive the output of the swap
    /// @param zeroForOne The direction of the swap, true for token0 to token1, false for token1 to token0
    /// @param amountSpecified The amount of the swap, which implicitly configures the swap as exact input (positive), or exact output (negative)
    /// @param sqrtPriceLimitX96 The Q64.96 sqrt price limit. If zero for one, the price cannot be less than this
    /// value after the swap. If one for zero, the price cannot be greater than this value after the swap
    /// @param data Any data to be passed through to the callback
    /// @return amount0 The delta of the balance of token0 of the pool, exact when negative, minimum when positive
    /// @return amount1 The delta of the balance of token1 of the pool, exact when negative, minimum when positive
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1) {
        (amount0, amount1) = IUniswapV3Pool(poolAddress).swap(
            recipient,
            zeroForOne,
            amountSpecified,
            sqrtPriceLimitX96,
            data
        );
    }

    function solidlyV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        _swapCallback(amount0Delta, amount1Delta, data);
    }

    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        _swapCallback(amount0Delta, amount1Delta, data);
    }

    function ramsesV2SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        _swapCallback(amount0Delta, amount1Delta, data);
    }

    function _swapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) internal {
        (int256 boostDelta, int256 usdDelta) = sortAmounts(amount0Delta, amount1Delta);
        SwapType swapType = abi.decode(data, (SwapType));
        if (swapType == SwapType.SELL) {
            uint256 boostAmountIn = uint256(boostDelta);
            IERC20Upgradeable(boost).safeTransfer(poolAddress, boostAmountIn);
        } else if (swapType == SwapType.BUY) {
            uint256 usdAmountIn = uint256(usdDelta);
            IERC20Upgradeable(collateral).safeTransfer(poolAddress, usdAmountIn);
        }
    }

    function solidlyV3MintCallback(uint256 amount0Owed, uint256 amount1Owed, bytes calldata data) external {
        _mintCallback(amount0Owed, amount1Owed, data);
    }

    function uniswapV3MintCallback(uint256 amount0Owed, uint256 amount1Owed, bytes calldata data) external {
        _mintCallback(amount0Owed, amount1Owed, data);
    }

    function ramsesV2MintCallback(uint256 amount0Owed, uint256 amount1Owed, bytes calldata data) external {
        _mintCallback(amount0Owed, amount1Owed, data);
    }

    function _mintCallback(uint256 amount0Owed, uint256 amount1Owed, bytes calldata) internal {
        (uint256 boostOwed, uint256 usdOwed) = sortAmounts(amount0Owed, amount1Owed);
        IERC20Upgradeable(collateral).safeTransfer(poolAddress, usdOwed);
        IERC20Upgradeable(boost).safeTransfer(poolAddress, boostOwed);
    }

    function sortAmounts(int256 amount0, int256 amount1) internal view returns (int256, int256) {
        if (boost < collateral) return (amount0, amount1);
        return (amount1, amount0);
    }

    function sortAmounts(uint256 amount0, uint256 amount1) internal view returns (uint256, uint256) {
        if (boost < collateral) return (amount0, amount1);
        return (amount1, amount0);
    }
}
