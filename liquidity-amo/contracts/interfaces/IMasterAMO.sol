// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

interface IMasterAMO {
    /* ========== ROLES ========== */
    /// @notice Returns the identifier for the SETTER_ROLE
    /// @dev This role allows calling set functions to modifying certain parameters of the contract
    function SETTER_ROLE() external view returns (bytes32);

    /// @notice Returns the identifier for the AMO_ROLE
    /// @dev This role allows calling mintAndSellBoost(), addLiquidity(), mintSellFarm() and unfarmBuyBurn();
    /// actions related to the AMO (Asset Management Operations)
    function AMO_ROLE() external view returns (bytes32);

    /// @notice Returns the identifier for the PAUSER_ROLE
    /// @dev This role allows calling pause(), the pausing of the contract's critical functions
    function PAUSER_ROLE() external view returns (bytes32);

    /// @notice Returns the identifier for the UNPAUSER_ROLE
    /// @dev This role allows calling unpause(), the unpausing of the contract's critical functions
    function UNPAUSER_ROLE() external view returns (bytes32);

    /// @notice Returns the identifier for the WITHDRAWER_ROLE
    /// @dev This role allows calling withdrawERC20() and withdrawERC721() for withdrawing tokens from the contract
    function WITHDRAWER_ROLE() external view returns (bytes32);

    /* ========== VARIABLES ========== */
    /// @notice Returns the address of the BOOST token
    function boost() external view returns (address);

    /// @notice Returns the address of the USD token
    function usd() external view returns (address);

    /// @notice Returns the address of the liquidity pool
    function pool() external view returns (address);

    /// @notice Returns the number of decimals used by the BOOST token
    function boostDecimals() external view returns (uint8);

    /// @notice Returns the number of decimals used by the USD token
    function usdDecimals() external view returns (uint8);

    /// @notice Returns the address of the BOOST Minter contract
    function boostMinter() external view returns (address);

    /// @notice Returns the multiplier for BOOST (in 6 decimals)
    function boostMultiplier() external view returns (uint256);

    /// @notice Returns the valid range ratio for adding liquidity (in 6 decimals). Will be a few percentage points ( scaled with Factor = 6 decimals),
    /// actual ratio is 1 +- validRangeWidth / 1e6 == factor +- validRangeWidth
    function validRangeWidth() external view returns (uint24);

    /// @notice Returns the valid removing liquidity ratio (in 6 decimals)
    /// value is expected to be very close to 1
    function validRemovingRatio() external view returns (uint24);

    /// @notice Returns the BOOST lower price after sell (in 6 decimals)
    function boostLowerPriceSell() external view returns (uint256);

    /// @notice Returns the BOOST upper price after buy (in 6 decimals)
    function boostUpperPriceBuy() external view returns (uint256);

    /* ========== FUNCTIONS ========== */
    /**
     * @notice Pauses the contract, disabling specific functionalities
     * @dev Only an address with the PAUSER_ROLE can call this function
     */
    function pause() external;

    /**
     * @notice Unpauses the contract, re-enabling specific functionalities
     * @dev Only an address with the UNPAUSER_ROLE can call this function
     */
    function unpause() external;

    /**
     * @notice This function mints BOOST tokens and sells them for USD
     * @dev Can only be called by an account with the AMO_ROLE when the contract is not paused
     * @param boostAmount The amount of BOOST tokens to be minted and sold
     * @return boostAmountIn The BOOST amount that sent to the pool for the swap
     * @return usdAmountOut The USD amount that received from the swap
     */
    function mintAndSellBoost(uint256 boostAmount) external returns (uint256 boostAmountIn, uint256 usdAmountOut);

    /**
     * @notice This function adds liquidity to the BOOST-USD pool
     * @dev Can only be called by an account with the AMO_ROLE when the contract is not paused
     * @param usdAmount The amount of USD to be added as liquidity
     * @param minBoostSpend The minimum amount of BOOST that must be added to the pool
     * @param minUsdSpend The minimum amount of USD that must be added to the pool
     * @return boostSpent The BOOST amount that is spent in add liquidity
     * @return usdSpent The USD amount that is spent in add liquidity
     * @return liquidity The liquidity Amount that received from add liquidity
     */
    function addLiquidity(
        uint256 usdAmount,
        uint256 minBoostSpend,
        uint256 minUsdSpend
    ) external returns (uint256 boostSpent, uint256 usdSpent, uint256 liquidity);

    /**
     * @notice This function rebalances the BOOST-USD pool by Calling mintAndSellBoost() and addLiquidity()
     * @dev Can only be called by an account with the AMO_ROLE when the contract is not paused
     * @param boostAmount The amount of BOOST tokens to be minted and sold
     * @param minBoostSpend The minimum amount of BOOST that must be added to the pool
     * @param minUsdSpend The minimum amount of USD that must be added to the pool
     * @return boostAmountIn The BOOST amount that sent to the pool for the swap
     * @return usdAmountOut The USD amount that received from the swap
     * @return boostSpent The BOOST amount that is spent in add liquidity
     * @return usdSpent The USD amount that is spent in add liquidity
     * @return liquidity The liquidity Amount that received from add liquidity
     */
    function mintSellFarm(
        uint256 boostAmount,
        uint256 minBoostSpend,
        uint256 minUsdSpend
    )
        external
        returns (uint256 boostAmountIn, uint256 usdAmountOut, uint256 boostSpent, uint256 usdSpent, uint256 liquidity);

    /**
     * @notice This function rebalances the BOOST-USD pool by removing liquidity, buying and burning BOOST tokens
     * @dev Can only be called by an account with the AMO_ROLE when the contract is not paused
     * @param liquidity The amount of liquidity tokens to be removed from the pool
     * @param minBoostRemove The minimum amount of BOOST tokens that must be removed from the pool
     * @param minUsdRemove The minimum amount of USD tokens that must be removed from the pool
     * @return boostRemoved The BOOST amount that received from remove liquidity
     * @return usdRemoved The USD amount that received from remove liquidity
     * @return usdAmountIn The USD amount that sent to the pool for the swap
     * @return boostAmountOut The BOOST amount that received from the swap
     */
    function unfarmBuyBurn(
        uint256 liquidity,
        uint256 minBoostRemove,
        uint256 minUsdRemove
    ) external returns (uint256 boostRemoved, uint256 usdRemoved, uint256 usdAmountIn, uint256 boostAmountOut);

    /**
     * @notice Mints BOOST tokens and sells them for USD
     * @return liquidity The liquidity Amount that received from add liquidity
     * @return newBoostPrice The BOOST new price after mintSellFarm()
     */
    function mintSellFarm() external returns (uint256 liquidity, uint256 newBoostPrice);

    /**
     * @notice Unfarms liquidity, buys BOOST tokens with USD, and burns them
     * @return liquidity The liquidity Amount that unfarmed from add liquidity
     * @return newBoostPrice The BOOST new price after unfarmBuyBurn()
     */
    function unfarmBuyBurn() external returns (uint256 liquidity, uint256 newBoostPrice);

    /**
     * @notice Withdraws ERC20 tokens from the contract
     * @dev Can only be called by an account with the WITHDRAWER_ROLE
     * @param token The address of the ERC20 token contract
     * @param amount The amount of tokens to withdraw
     * @param recipient The address to receive the tokens
     */
    function withdrawERC20(address token, uint256 amount, address recipient) external;

    /**
     * @notice This view function returns the current BOOST price with PRICE_DECIMALS = 6
     * @return price the current BOOST price
     */
    function boostPrice() external view returns (uint256 price);
}
