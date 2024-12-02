// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.7.5;

interface IAlgebraQuoter {
    /// Quoter contract function
    /// @notice Returns the amount in required to receive the given exact output amount but for a swap of a single pool
    /// @param tokenIn The token being swapped in
    /// @param tokenOut The token being swapped out
    /// @param amountOut The desired output amount
    /// @param limitSqrtPrice The price limit of the pool that cannot be exceeded by the swap
    /// @return amountIn The amount required as the input for the swap in order to receive `amountOut`
    function quoteExactOutputSingle(
        address tokenIn,
        address tokenOut,
        uint256 amountOut,
        uint160 limitSqrtPrice
    ) external returns (uint256 amountIn, uint16 fee);

    struct QuoteExactOutputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amount;
        uint160 limitSqrtPrice;
    }

    /// QuoterV2 contract function
    /// @notice Returns the amount in required to receive the given exact output amount but for a swap of a single pool
    /// @param params The params for the quote, encoded as `QuoteExactOutputSingleParams`
    /// tokenIn The token being swapped in
    /// tokenOut The token being swapped out
    /// amountOut The desired output amount
    /// limitSqrtPrice The price limit of the pool that cannot be exceeded by the swap
    /// @return amountOut The amount of the last token that would be received
    /// @return amountIn The amount required as the input for the swap in order to receive `amountOut`
    /// @return sqrtPriceX96After The sqrt price of the pool after the swap
    /// @return initializedTicksCrossed The number of initialized ticks that the swap crossed
    /// @return gasEstimate The estimate of the gas that the swap consumes
    /// @return fee The fee value used for swap in the pool
    function quoteExactOutputSingle(
        QuoteExactOutputSingleParams memory params
    )
        external
        returns (
            uint256 amountOut,
            uint256 amountIn,
            uint160 sqrtPriceX96After,
            uint32 initializedTicksCrossed,
            uint256 gasEstimate,
            uint16 fee
        );
}
