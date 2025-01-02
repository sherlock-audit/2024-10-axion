// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IMasterAMO} from "../IMasterAMO.sol";

interface IV3AMO {
    /* ========== VARIABLES ========== */
    /// @notice Returns the USD usage ratio to check excessive liquidity removal (in 6 decimals)
    function usdUsageRatio() external view returns (uint24);

    /// @notice Returns The lower tick of the position in which to add or remove liquidity
    function tickLower() external view returns (int24);

    /// @notice Returns The upper tick of the position in which to add or remove liquidity
    function tickUpper() external view returns (int24);

    /// @notice Returns The Q64.96 sqrt price limit for swapping on a SolidlyV3Pool
    function targetSqrtPriceX96() external view returns (uint160);

    /* ========== FUNCTIONS ========== */
    /**
     * @notice This function sets the position's tick bounds
     * @dev Can only be called by an account with the SETTER_ROLE
     * @param tickLower_ The lower tick of the position in which to add or remove liquidity
     * @param tickUpper_ The upper tick of the position in which to add or remove liquidity
     */
    function setTickBounds(int24 tickLower_, int24 tickUpper_) external;

    /**
     * @notice This function sets the Q64.96 sqrt price limit
     * @dev Can only be called by an account with the SETTER_ROLE
     * @param targetSqrtPriceX96_ The Q64.96 sqrt price limit for swapping on a SolidlyV3Pool
     */
    function setTargetSqrtPriceX96(uint160 targetSqrtPriceX96_) external;

    /**
     * @notice This function sets various params for the contract
     * @dev Can only be called by an account with the SETTER_ROLE
     * @param boostMultiplier_ The multiplier used to calculate the amount of boost to mint in addLiquidity()
     * —— this factor makes it possible to mint marginally less than what is needed to revert to peg ( avoids risk of reverting )
     * @param validRangeWidth_ The valid range width for addLiquidity()
     * —— we only add liquidity if price has reverted close to 1.
     * @param validRemovingRatio_ Set the price (<1$) on which the unfarmBuyBurn() is allowed
     * @param usdUsageRatio_ The minimum valid ratio of usdAmountIn to usdRemoved in unfarmBuyBurn()
     * @param boostLowerPriceSell_ The new lower price bound for selling BOOST
     * @param boostUpperPriceBuy_ The new upper price bound for buying BOOST
     */
    function setParams(
        uint256 boostMultiplier_,
        uint24 validRangeWidth_,
        uint24 validRemovingRatio_,
        uint24 usdUsageRatio_,
        uint256 boostLowerPriceSell_,
        uint256 boostUpperPriceBuy_
    ) external;
}
