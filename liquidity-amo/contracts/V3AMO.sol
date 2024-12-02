// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@uniswap/v3-core/contracts/libraries/TickMath.sol";
import "@uniswap/v3-periphery/contracts/libraries/LiquidityAmounts.sol";
import "./MasterAMO.sol";
import {IQuoterV2} from "./interfaces/v3/quoter/IQuoterV2.sol";
import {IVeloQuoterV2} from "./interfaces/v3/quoter/IVeloQuoterV2.sol";
import {IAlgebraQuoter} from "./interfaces/v3/quoter/IAlgebraQuoter.sol";
import {IUniswapV3Pool} from "./interfaces/v3/IUniswapV3Pool.sol";
import {ISolidlyV3Pool} from "./interfaces/v3/ISolidlyV3Pool.sol";
import {ISolidlyV3Factory} from "./interfaces/v3/ISolidlyV3Factory.sol";
import {IRewardsDistributor} from "./interfaces/v3/IRewardsDistributor.sol";
import {ICLPool} from "./interfaces/v3/ICLPool.sol";
import {IAlgebraPool} from "./interfaces/v3/IAlgebraPool.sol";
import {IAlgebraV10Pool} from "./interfaces/v3/IAlgebraV10Pool.sol";
import {IAlgebraV19Pool} from "./interfaces/v3/IAlgebraV19Pool.sol";
import {IAlgebraIntegralPool} from "./interfaces/v3/IAlgebraIntegralPool.sol";
import {IRamsesV2Pool} from "./interfaces/v3/IRamsesV2Pool.sol";
import {IV3AMO} from "./interfaces/v3/IV3AMO.sol";

contract V3AMO is IV3AMO, MasterAMO {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /* ========== ERRORS ========== */
    error UntrustedCaller(address caller);
    error InvalidDelta();
    error InvalidOwed();
    error InsufficientTokenSpent();

    /* ========== EVENTS ========== */
    event AddLiquidity(uint256 boostSpent, uint256 usdSpent, uint256 liquidity);
    event UnfarmBuyBurn(
        uint256 boostRemoved,
        uint256 usdRemoved,
        uint256 liquidity,
        uint256 usdAmountIn,
        uint256 boostAmountOut,
        uint256 boostCollectedFee,
        uint256 usdCollectedFee
    );
    event TickBoundsSet(int24 tickLower, int24 tickUpper);
    event TargetSqrtPriceX96Set(uint160 targetSqrtPriceX96);
    event ParamsSet(
        address quoter,
        uint256 boostMultiplier,
        uint24 validRangeWidth,
        uint24 validRemovingRatio,
        uint24 usdUsageRatio,
        uint256 boostLowerPriceSell,
        uint256 boostUpperPriceBuy
    );

    /* ========== VARIABLES ========== */
    /// @inheritdoc IV3AMO
    PoolType public override poolType;
    /// @inheritdoc IV3AMO
    uint24 public override usdUsageRatio;
    /// @inheritdoc IV3AMO
    int24 public override tickLower;
    /// @inheritdoc IV3AMO
    int24 public override tickUpper;
    /// @inheritdoc IV3AMO
    uint160 public override targetSqrtPriceX96;
    /// @inheritdoc IV3AMO
    address public override quoter;

    /* ========== CONSTANTS ========== */
    uint160 internal constant MIN_SQRT_RATIO = 4295128739;
    uint160 internal constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;
    uint256 internal constant Q96 = 2 ** 96;
    uint24 internal constant SQRT10 = 3162278; // sqrt(10) = 3.162278

    /* ========== FUNCTIONS ========== */
    function initialize(
        address admin,
        address boost_,
        address usd_,
        address pool_,
        PoolType poolType_,
        address quoter_,
        address boostMinter_,
        int24 tickLower_,
        int24 tickUpper_,
        uint160 targetSqrtPriceX96_,
        uint256 boostMultiplier_,
        uint24 validRangeWidth_,
        uint24 validRemovingRatio_,
        uint24 usdUsageRatio_,
        uint256 boostLowerPriceSell_,
        uint256 boostUpperPriceBuy_
    ) public initializer {
        super.initialize(admin, boost_, usd_, pool_, boostMinter_);
        poolType = poolType_;

        setTickBounds(tickLower_, tickUpper_);
        setTargetSqrtPriceX96(targetSqrtPriceX96_);

        _grantRole(SETTER_ROLE, msg.sender);
        setParams(
            quoter_,
            boostMultiplier_,
            validRangeWidth_,
            validRemovingRatio_,
            usdUsageRatio_,
            boostLowerPriceSell_,
            boostUpperPriceBuy_
        );
        _revokeRole(SETTER_ROLE, msg.sender);
    }

    ////////////////////////// SETTER_ROLE ACTIONS //////////////////////////
    /// @inheritdoc IV3AMO
    function setTickBounds(int24 tickLower_, int24 tickUpper_) public override onlyRole(SETTER_ROLE) {
        tickLower = tickLower_;
        tickUpper = tickUpper_;
        emit TickBoundsSet(tickLower, tickUpper);
    }

    /// @inheritdoc IV3AMO
    function setTargetSqrtPriceX96(uint160 targetSqrtPriceX96_) public override onlyRole(SETTER_ROLE) {
        if (targetSqrtPriceX96_ <= MIN_SQRT_RATIO || targetSqrtPriceX96_ >= MAX_SQRT_RATIO) revert InvalidRatioValue();
        targetSqrtPriceX96 = targetSqrtPriceX96_;
        emit TargetSqrtPriceX96Set(targetSqrtPriceX96);
    }

    /// @inheritdoc IV3AMO
    function setParams(
        address quoter_,
        uint256 boostMultiplier_,
        uint24 validRangeWidth_,
        uint24 validRemovingRatio_,
        uint24 usdUsageRatio_,
        uint256 boostLowerPriceSell_,
        uint256 boostUpperPriceBuy_
    ) public override onlyRole(SETTER_ROLE) {
        if (validRangeWidth_ > FACTOR || validRemovingRatio_ < FACTOR || usdUsageRatio_ > FACTOR)
            revert InvalidRatioValue();
        // validRangeWidth is a few percentage points (scaled with FACTOR). So it needs to be lower than 1 (scaled with FACTOR)
        // validRemovingRatio needs to be greater than 1 (we remove more BOOST than USD otherwise the pool is balanced)
        quoter = quoter_;
        boostMultiplier = boostMultiplier_;
        validRangeWidth = validRangeWidth_;
        validRemovingRatio = validRemovingRatio_;
        usdUsageRatio = usdUsageRatio_;
        boostLowerPriceSell = boostLowerPriceSell_;
        boostUpperPriceBuy = boostUpperPriceBuy_;
        emit ParamsSet(
            quoter,
            boostMultiplier,
            validRangeWidth,
            validRemovingRatio,
            usdUsageRatio,
            boostLowerPriceSell,
            boostUpperPriceBuy
        );
    }

    /**
     * @dev Internal function to handle swap callbacks from Uniswap V3 pools.
     * @param amount0Delta Amount of token0 involved in the swap.
     * @param amount1Delta Amount of token1 involved in the swap.
     * @param data Encoded swap type data.
     * @dev the pool uses _swapCallback to buy (resp to sell) the desired amount of BOOST to repeg in UnfarmBuyBurn (resp. in MintSellFarm)
     * @dev calling _swapCallback is more gas efficient than calling the router —- in effect we're using it as an efficient and secure call to the router
     */
    function _swapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) internal {
        if (msg.sender != pool) revert UntrustedCaller(msg.sender);

        (int256 boostDelta, int256 usdDelta) = sortAmounts(amount0Delta, amount1Delta);
        SwapType swapType = abi.decode(data, (SwapType));
        if (swapType == SwapType.SELL) {
            uint256 boostAmountIn = uint256(boostDelta);
            uint256 usdAmountOut = uint256(-usdDelta);
            if (balanceOfToken(usd) < usdAmountOut || boostAmountIn > toBoostAmount(usdAmountOut))
                revert InvalidDelta();
            IMinter(boostMinter).protocolMint(pool, boostAmountIn);
        } else if (swapType == SwapType.BUY) {
            uint256 usdAmountIn = uint256(usdDelta);
            uint256 boostAmountOut = uint256(-boostDelta);
            if (balanceOfToken(boost) < boostAmountOut || usdAmountIn > toUsdAmount(boostAmountOut))
                revert InvalidDelta();
            IERC20Upgradeable(usd).safeTransfer(pool, usdAmountIn);
        }
    }

    ////////////////////////// CALLBACK FUNCTIONS //////////////////////////
    function solidlyV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        _swapCallback(amount0Delta, amount1Delta, data);
    }

    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        _swapCallback(amount0Delta, amount1Delta, data);
    }

    function algebraSwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        _swapCallback(amount0Delta, amount1Delta, data);
    }

    function ramsesV2SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        _swapCallback(amount0Delta, amount1Delta, data);
    }

    function solidlyV3MintCallback(uint256 amount0Owed, uint256 amount1Owed, bytes calldata data) external {
        _mintCallback(amount0Owed, amount1Owed, data);
    }

    function uniswapV3MintCallback(uint256 amount0Owed, uint256 amount1Owed, bytes calldata data) external {
        _mintCallback(amount0Owed, amount1Owed, data);
    }

    function algebraMintCallback(uint256 amount0Owed, uint256 amount1Owed, bytes calldata data) external {
        _mintCallback(amount0Owed, amount1Owed, data);
    }

    function ramsesV2MintCallback(uint256 amount0Owed, uint256 amount1Owed, bytes calldata data) external {
        _mintCallback(amount0Owed, amount1Owed, data);
    }

    /**
     * @dev internal function called by the pool to transfer the USD and BOOST
     * @param amount0Owed represent BOOST and USD — depends on order
     * @param amount1Owed represent BOOST and USD — depends on order
     * @param callData of the addLiquidity which passed to the pool in our case Bypassed
     */
    function _mintCallback(uint256 amount0Owed, uint256 amount1Owed, bytes calldata) internal {
        if (msg.sender != pool) revert UntrustedCaller(msg.sender);

        (uint256 boostOwed, uint256 usdOwed) = sortAmounts(amount0Owed, amount1Owed);
        uint256 boostAmount = (toBoostAmount(usdOwed) * boostMultiplier) / FACTOR;
        if (boostAmount < boostOwed) revert InvalidOwed();

        IERC20Upgradeable(usd).safeTransfer(pool, usdOwed);
        IMinter(boostMinter).protocolMint(pool, boostOwed);
    }

    ////////////////////////// AMO_ROLE ACTIONS //////////////////////////
    function _mintAndSellBoost(
        uint256 boostAmount
    ) internal override returns (uint256 boostAmountIn, uint256 usdAmountOut) {
        // Mint BOOST and execute the swap BOOST->USD
        // The swap is executed at the targetSqrtPriceX96
        (int256 amount0, int256 amount1) = IUniswapV3Pool(pool).swap(
            address(this),
            boost < usd, // zeroForOne
            int256(boostAmount), // Amount of BOOST tokens being swapped
            targetSqrtPriceX96, // The target square root price
            abi.encode(SwapType.SELL)
        );

        (int256 boostDelta, int256 usdDelta) = sortAmounts(amount0, amount1);
        boostAmountIn = uint256(boostDelta); // BOOST tokens used in the swap
        usdAmountOut = uint256(-usdDelta); // USD tokens received from the swap

        emit MintSell(boostAmountIn, usdAmountOut);
    }

    /**
     * @notice Calculates the liquidity required to match a given USD amount.
     * @dev This function ensures accurate liquidity estimation by using the current pool state and tick bounds.
     *      It avoids inaccuracies by leveraging the Uniswap V3 price and liquidity formulas.
     * @param usdAmount The amount of USD for which the corresponding liquidity is to be calculated.
     * @return liquidity The calculated liquidity amount corresponding to the given USD amount.
     */
    function _getLiquidityForUsdAmount(uint256 usdAmount) internal view returns (uint256 liquidity) {
        // Step 1: Fetch the current price and pool data
        uint160 sqrtRatioX96 = _getSqrtPriceX96();

        // Step 2: Fetch the price bounds corresponding to the tickLower and tickUpper
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(tickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(tickUpper);

        // Step 3: Sort amounts to determine the maximum amounts of token0 (BOOST) and token1 (USD)
        (uint256 amount0, uint256 amount1) = sortAmounts(type(uint128).max, usdAmount);

        // Step 4: Use the Uniswap V3 LiquidityAmounts library to calculate liquidity
        liquidity = uint256(
            LiquidityAmounts.getLiquidityForAmounts(
                sqrtRatioX96, // Current pool price
                sqrtRatioAX96, // Lower bound price
                sqrtRatioBX96, // Upper bound price
                amount0, // Maximum BOOST
                amount1 // Maximum USD
            )
        );
    }

    function _addLiquidity(
        uint256 usdAmount,
        uint256 minBoostSpend,
        uint256 minUsdSpend
    ) internal override returns (uint256 boostSpent, uint256 usdSpent, uint256 liquidity) {
        liquidity = _getLiquidityForUsdAmount(usdAmount);

        // Add liquidity to the BOOST-USD pool within the specified tick range (we are full range in this version)
        uint256 amount0;
        uint256 amount1;
        if (
            poolType == PoolType.ALGEBRA_V1_0 ||
            poolType == PoolType.ALGEBRA_V1_9 ||
            poolType == PoolType.ALGEBRA_INTEGRAL
        )
            (amount0, amount1, ) = IAlgebraPool(pool).mint(
                address(this),
                address(this),
                tickLower,
                tickUpper,
                uint128(liquidity),
                ""
            );
        else
            (amount0, amount1) = IUniswapV3Pool(pool).mint(address(this), tickLower, tickUpper, uint128(liquidity), "");

        (boostSpent, usdSpent) = sortAmounts(amount0, amount1);
        if (boostSpent < minBoostSpend || usdSpent < minUsdSpend) revert InsufficientTokenSpent();

        // Calculate valid range for USD spent based on BOOST spent and validRangeWidth (in %)
        uint256 allowedBoostDeviation = (boostSpent * validRangeWidth) / FACTOR; // validRange is the width in scaled dollar terms
        if (toBoostAmount(usdSpent) <= boostSpent - allowedBoostDeviation || toBoostAmount(usdSpent) >= boostSpent + allowedBoostDeviation)
            revert InvalidRatioToAddLiquidity();

        emit AddLiquidity(boostSpent, usdSpent, liquidity);
    }

    /**
     * @notice Removes liquidity, swaps USD for BOOST to repeg BOOST, and burns excess BOOST.
     * @dev Fixes the issue of incorrectly estimating liquidity in V3 pools by using `quoteSwap` for solidly and
            Quoter contract for other univ3 forks like algebra
     *      to calculate the required amount of liquidity based on the deviation from the target price.
     *      This ensures the liquidity removed and USD swapped are calculated precisely.
     * @param liquidity Amount of liquidity to remove from the pool.
     * @param minBoostRemove Minimum amount of BOOST tokens to remove when withdrawing liquidity.
     * @param minUsdRemove Minimum amount of USD tokens to remove when withdrawing liquidity.
     * @return boostRemoved Amount of BOOST tokens removed from the pool.
     * @return usdRemoved Amount of USD tokens removed from the pool.
     * @return usdAmountIn Amount of USD tokens swapped into BOOST.
     * @return boostAmountOut Amount of BOOST tokens bought and burned.
     */
    function _unfarmBuyBurn(
        uint256 liquidity,
        uint256 minBoostRemove,
        uint256 minUsdRemove
    )
        internal
        override
        returns (uint256 boostRemoved, uint256 usdRemoved, uint256 usdAmountIn, uint256 boostAmountOut)
    {
        // Step 1: Remove liquidity from the pool
        // Remove liquidity and store the amounts of USD and BOOST tokens received
        uint256 amount0FromBurn;
        uint256 amount1FromBurn;
        if (poolType == PoolType.ALGEBRA_INTEGRAL)
            (amount0FromBurn, amount1FromBurn) = IAlgebraIntegralPool(pool).burn(
                tickLower,
                tickUpper,
                uint128(liquidity),
                ""
            );
        else (amount0FromBurn, amount1FromBurn) = IUniswapV3Pool(pool).burn(tickLower, tickUpper, uint128(liquidity));
        (boostRemoved, usdRemoved) = sortAmounts(amount0FromBurn, amount1FromBurn);

        // Ensure the BOOST amount removed from our full-range position is greater than or equal to the USD amount removed
        if (boostRemoved < minBoostRemove) revert InsufficientOutputAmount(boostRemoved, minBoostRemove);
        if (usdRemoved < minUsdRemove) revert InsufficientOutputAmount(usdRemoved, minUsdRemove);

        if (poolType == PoolType.SOLIDLY_V3) {
            address feeCollector = ISolidlyV3Factory(ISolidlyV3Pool(pool).factory()).feeCollector();
            IRewardsDistributor(feeCollector).collectPoolFees(pool);
        }
        uint128 amount0Collected;
        uint128 amount1Collected;
        (amount0Collected, amount1Collected) = IUniswapV3Pool(pool).collect(
            address(this),
            tickLower,
            tickUpper,
            type(uint128).max,
            type(uint128).max
        );
        (uint256 boostCollected, uint256 usdCollected) = sortAmounts(amount0Collected, amount1Collected);

        // Ensure the BOOST amount removed from our full-range position is greater than or equal to the USD amount removed
        // this calculation/check is valid because based on our full-range liquidity (not on the aggregate pool liquidity)
        if ((boostRemoved * validRemovingRatio) / FACTOR < toBoostAmount(usdRemoved))
            revert InvalidRatioToRemoveLiquidity();

        // Step 4: Use quoteSwap to determine the USD needed to bring the price back to peg
        (int256 amount0, int256 amount1) = IUniswapV3Pool(pool).swap(
            address(this),
            boost > usd, // zeroForOne
            int256(usdRemoved), // Maximum USD to use for the swap
            targetSqrtPriceX96, // Target price for the swap
            abi.encode(SwapType.BUY)
        );

        // Step 5: We farm/AMO the residual USD
        (int256 boostDelta, int256 usdDelta) = sortAmounts(amount0, amount1);
        usdAmountIn = uint256(usdDelta);
        boostAmountOut = uint256(-boostDelta);

        uint256 unusedUsdAmount = usdRemoved - usdAmountIn;
        if (unusedUsdAmount > 0) _addLiquidity(unusedUsdAmount, 1, 1);

        // Step 6: Burn the BOOST tokens collected from liquidity removal, collected owed tokens and swap
        IBoostStablecoin(boost).burn(boostCollected + boostAmountOut);

        // Final step: emit event:
        emit UnfarmBuyBurn(
            boostRemoved,
            usdRemoved,
            liquidity,
            usdAmountIn,
            boostAmountOut,
            boostCollected - boostRemoved, // boostCollectedFee
            usdCollected - usdRemoved // usdCollectedFee
        );
    }

    ////////////////////////// PUBLIC FUNCTIONS //////////////////////////
    function _mintSellFarm() internal override returns (uint256 liquidity, uint256 newBoostPrice) {
        (, , , , liquidity) = _mintSellFarm(
            uint256(type(int256).max), // boostAmount
            1, // minBoostSpend
            1 // minUsdSpend
        );

        newBoostPrice = boostPrice();
    }

    /**
     * @dev _unfarmBuyBurn() is the internal function that support the the public unfarmBuyBurn() function
     * @notice Removes liquidity, stabilizes BOOST price, and calculates the new price post-operation.
     * @dev Fixes the issue of relying on incorrect liquidity calculations by using `quoteSwap` or Quoter Contract
     *      to estimate the required USD amount and `_getLiquidityForUsdAmount` to determine the corresponding liquidity.
     *      Ensures the operation only removes the necessary liquidity to achieve the target price, preventing overshooting.
     * @return liquidity Amount of liquidity removed from the pool.
     * @return newBoostPrice The updated BOOST price after the operation.
     */
    function _unfarmBuyBurn() internal override returns (uint256 liquidity, uint256 newBoostPrice) {
        (uint256 positionLiquidity, , ) = position();
        uint256 amountIn;
        if (poolType == PoolType.SOLIDLY_V3) {
            (int256 amount0, int256 amount1, , , ) = ISolidlyV3Pool(pool).quoteSwap(
                boost > usd, // zeroForOne
                type(int256).max,
                targetSqrtPriceX96
            );
            (, int256 usdDelta) = sortAmounts(amount0, amount1);
            amountIn = uint256(usdDelta);
        } else if (poolType == PoolType.CL) {
            IVeloQuoterV2.QuoteExactOutputSingleParams memory params = IVeloQuoterV2.QuoteExactOutputSingleParams({
                tokenIn: usd,
                tokenOut: boost,
                amount: uint256(type(int256).max),
                tickSpacing: IUniswapV3Pool(pool).tickSpacing(),
                sqrtPriceLimitX96: targetSqrtPriceX96
            });
            (amountIn, , , ) = IVeloQuoterV2(quoter).quoteExactOutputSingle(params);
        } else if (poolType == PoolType.ALGEBRA_V1_0 || poolType == PoolType.ALGEBRA_V1_9) {
            (amountIn, ) = IAlgebraQuoter(quoter).quoteExactOutputSingle(
                usd,
                boost,
                uint256(type(int256).max),
                targetSqrtPriceX96
            );
        } else if (poolType == PoolType.ALGEBRA_INTEGRAL) {
            IAlgebraQuoter.QuoteExactOutputSingleParams memory params = IAlgebraQuoter.QuoteExactOutputSingleParams({
                tokenIn: usd,
                tokenOut: boost,
                amount: uint256(type(int256).max),
                limitSqrtPrice: targetSqrtPriceX96
            });
            (, amountIn, , , , ) = IAlgebraQuoter(quoter).quoteExactOutputSingle(params);
        } else {
            IQuoterV2.QuoteExactOutputSingleParams memory params = IQuoterV2.QuoteExactOutputSingleParams({
                tokenIn: usd,
                tokenOut: boost,
                amount: uint256(type(int256).max),
                fee: IUniswapV3Pool(pool).fee(),
                sqrtPriceLimitX96: targetSqrtPriceX96
            });
            (amountIn, , , ) = IQuoterV2(quoter).quoteExactOutputSingle(params);
        }
        liquidity = _getLiquidityForUsdAmount(amountIn);
        if (liquidity > positionLiquidity) liquidity = positionLiquidity;

        _unfarmBuyBurn(
            liquidity,
            1, // minBoostRemove
            1 // minUsdRemove
        );

        newBoostPrice = boostPrice();
    }

    function _validateSwap(bool boostForUsd) internal view override {}

    function _getSqrtPriceX96() internal view returns (uint160 _sqrtPriceX96) {
        if (poolType == PoolType.SOLIDLY_V3) {
            (_sqrtPriceX96, , , ) = ISolidlyV3Pool(pool).slot0();
        } else if (poolType == PoolType.CL) {
            (_sqrtPriceX96, , , , , ) = ICLPool(pool).slot0();
        } else if (poolType == PoolType.ALGEBRA_V1_0) {
            (_sqrtPriceX96, , , , , , ) = IAlgebraV10Pool(pool).globalState();
        } else if (poolType == PoolType.ALGEBRA_V1_9) {
            (_sqrtPriceX96, , , , , , , ) = IAlgebraV19Pool(pool).globalState();
        } else if (poolType == PoolType.ALGEBRA_INTEGRAL) {
            (_sqrtPriceX96, , , , , ) = IAlgebraIntegralPool(pool).globalState();
        } else {
            (_sqrtPriceX96, , , , , , ) = IUniswapV3Pool(pool).slot0();
        }
    }

    ////////////////////////// VIEW FUNCTIONS //////////////////////////

    /**
     * @dev Calculates the boost price with precision adjustments to prevent rounding errors.
     * The function determines the price based on the relation between `boost` and `usd`,
     * while accounting for potential precision loss in mathematical operations.
     *
     * The method uses adjusted decimals and avoids direct division of large integers,
     * which can lead to significant precision loss. This ensures accurate calculations
     * and resolves previously identified issues with rounding errors in edge cases.
     *
     * @return price The calculated price of BOOST relative to USD.
     */
    function boostPrice() public view override returns (uint256 price) {
        uint256 sqrtPriceX96 = uint256(_getSqrtPriceX96());
        uint8 decimalsDiff = boostDecimals - usdDecimals;
        uint256 sqrtDecimals;
        if (decimalsDiff % 2 == 0) sqrtDecimals = 10 ** (decimalsDiff / 2) * 10 ** PRICE_DECIMALS;
        else sqrtDecimals = (10 ** (decimalsDiff / 2) * 10 ** PRICE_DECIMALS * SQRT10) / FACTOR;

        if (boost < usd) {
            price = ((sqrtDecimals * sqrtPriceX96) / Q96) ** 2 / 10 ** PRICE_DECIMALS;
        } else {
            price = ((sqrtDecimals * Q96) / sqrtPriceX96) ** 2 / 10 ** PRICE_DECIMALS;
        }
    }

    /// @inheritdoc IV3AMO
    function position() public view override returns (uint256 liquidity, uint256 boostOwed, uint256 usdOwed) {
        bytes32 key;
        if (
            poolType == PoolType.ALGEBRA_V1_0 ||
            poolType == PoolType.ALGEBRA_V1_9 ||
            poolType == PoolType.ALGEBRA_INTEGRAL
        ) {
            address owner = address(this);
            int24 bottomTick = tickLower;
            int24 topTick = tickUpper;
            assembly {
                key := or(shl(24, or(shl(24, owner), and(bottomTick, 0xFFFFFF))), and(topTick, 0xFFFFFF))
            }
        } else if (poolType == PoolType.RAMSES_V2) {
            uint256 index = 0;
            key = keccak256(abi.encodePacked(address(this), index, tickLower, tickUpper));
        } else key = keccak256(abi.encodePacked(address(this), tickLower, tickUpper));

        uint128 _liquidity;
        uint128 tokensOwed0;
        uint128 tokensOwed1;
        if (poolType == PoolType.SOLIDLY_V3) {
            (_liquidity, tokensOwed0, tokensOwed1) = ISolidlyV3Pool(pool).positions(key);
        } else if (poolType == PoolType.ALGEBRA_V1_0) {
            (_liquidity, , , , tokensOwed0, tokensOwed1) = IAlgebraV10Pool(pool).positions(key);
        } else if (poolType == PoolType.ALGEBRA_V1_9) {
            (_liquidity, , , , tokensOwed0, tokensOwed1) = IAlgebraV19Pool(pool).positions(key);
        } else if (poolType == PoolType.ALGEBRA_INTEGRAL) {
            (liquidity, , , tokensOwed0, tokensOwed1) = IAlgebraIntegralPool(pool).positions(key);
        } else if (poolType == PoolType.RAMSES_V2) {
            (_liquidity, , , tokensOwed0, tokensOwed1, ) = IRamsesV2Pool(pool).positions(key);
        } else {
            (_liquidity, , , tokensOwed0, tokensOwed1) = IUniswapV3Pool(pool).positions(key);
        }
        if (_liquidity > 0) liquidity = uint256(_liquidity);
        (boostOwed, usdOwed) = sortAmounts(uint256(tokensOwed0), uint256(tokensOwed1));
    }
}
