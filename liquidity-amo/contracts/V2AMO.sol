// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "./MasterAMO.sol";
import {IGauge} from "./interfaces/v2/IGauge.sol";
import {ISolidlyRouter} from "./interfaces/v2/ISolidlyRouter.sol";
import {IPair} from "./interfaces/v2/IPair.sol";
import {IV2AMO} from "./interfaces/v2/IV2AMO.sol";

contract V2AMO is IV2AMO, MasterAMO {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /* ========== ERRORS ========== */
    error TokenNotWhitelisted(address token);
    error UsdAmountOutMismatch(uint256 routerOutput, uint256 balanceChange);
    error LpAmountOutMismatch(uint256 routerOutput, uint256 balanceChange);
    error InvalidReserveRatio(uint256 ratio);

    /* ========== EVENTS ========== */
    event AddLiquidityAndDeposit(uint256 boostSpent, uint256 usdSpent, uint256 liquidity, uint256 indexed tokenId);
    event UnfarmBuyBurn(uint256 boostRemoved, uint256 usdRemoved, uint256 liquidity, uint256 boostAmountOut);

    event GetReward(address[] tokens, uint256[] amounts);

    event VaultSet(address rewardVault);
    event TokenIdSet(uint256 tokenId, bool useTokenId);
    event ParamsSet(
        uint256 boostMultiplier,
        uint24 validRangeWidth,
        uint24 validRemovingRatio,
        uint256 boostLowerPriceSell,
        uint256 boostUpperPriceBuy,
        uint256 boostSellRatio,
        uint256 usdBuyRatio
    );
    event RewardTokensSet(address[] tokens, bool isWhitelisted);

    /* ========== ROLES ========== */
    /// @inheritdoc IV2AMO.sol
    bytes32 public constant override REWARD_COLLECTOR_ROLE = keccak256("REWARD_COLLECTOR_ROLE");

    /* ========== VARIABLES ========== */
    /// @inheritdoc IV2AMO.sol
    address public override router;
    /// @inheritdoc IV2AMO.sol
    address public override gauge;

    /// @inheritdoc IV2AMO.sol
    address public override rewardVault;
    /// @inheritdoc IV2AMO.sol
    mapping(address => bool) public override whitelistedRewardTokens;
    /// @inheritdoc IV2AMO.sol
    uint256 public override boostSellRatio;
    /// @inheritdoc IV2AMO.sol
    uint256 public override usdBuyRatio;
    /// @inheritdoc IV2AMO.sol
    uint256 public override tokenId;
    /// @inheritdoc IV2AMO.sol
    bool public override useTokenId;

    /* ========== FUNCTIONS ========== */
    function initialize(
        address admin,
        address boost_,
        address usd_,
        address boostMinter_,
        address router_,
        address gauge_,
        address rewardVault_,
        uint256 tokenId_,
        bool useTokenId_,
        uint256 boostMultiplier_,
        uint24 validRangeWidth_,
        uint24 validRemovingRatio_,
        uint256 boostLowerPriceSell_,
        uint256 boostUpperPriceBuy_,
        uint256 boostSellRatio_,
        uint256 usdBuyRatio_
    ) public initializer {
        if (router_ == address(0) || gauge_ == address(0)) revert ZeroAddress();
        address pool_ = ISolidlyRouter(router_).pairFor(usd_, boost_, true);
        super.initialize(admin, boost_, usd_, pool_, boostMinter_);

        router = router_;
        gauge = gauge_;

        _grantRole(SETTER_ROLE, msg.sender);
        setVault(rewardVault_);
        setTokenId(tokenId_, useTokenId_);
        setParams(
            boostMultiplier_,
            validRangeWidth_,
            validRemovingRatio_,
            boostLowerPriceSell_,
            boostUpperPriceBuy_,
            boostSellRatio_,
            usdBuyRatio_
        );
        _revokeRole(SETTER_ROLE, msg.sender);
    }

    ////////////////////////// SETTER_ROLE ACTIONS //////////////////////////
    /// @inheritdoc IV2AMO.sol
    function setVault(address rewardVault_) public override onlyRole(SETTER_ROLE) {
        if (rewardVault_ == address(0)) revert ZeroAddress();
        rewardVault = rewardVault_;
        emit VaultSet(rewardVault);
    }

    /// @inheritdoc IV2AMO.sol
    function setTokenId(uint256 tokenId_, bool useTokenId_) public override onlyRole(SETTER_ROLE) {
        tokenId = tokenId_;
        useTokenId = useTokenId_;
        emit TokenIdSet(tokenId, useTokenId);
    }

    /// @inheritdoc IV2AMO.sol
    function setParams(
        uint256 boostMultiplier_,
        uint24 validRangeWidth_,
        uint24 validRemovingRatio_,
        uint256 boostLowerPriceSell_,
        uint256 boostUpperPriceBuy_,
        uint256 boostSellRatio_,
        uint256 usdBuyRatio_
    ) public override onlyRole(SETTER_ROLE) {
        if (validRangeWidth_ > FACTOR || validRemovingRatio_ < FACTOR) revert InvalidRatioValue(); // validRangeWidth is a few percentage points (scaled with factor). So it needs to be lower than 1 (scaled with FACTOR)
        // validRemovingRatio nedds to be greater than 1 (we remove more BOOST than USD otherwise the pool is balanced )
        boostMultiplier = boostMultiplier_;
        validRangeWidth = validRangeWidth_;
        validRemovingRatio = validRemovingRatio_;
        boostLowerPriceSell = boostLowerPriceSell_;
        boostUpperPriceBuy = boostUpperPriceBuy_;
        boostSellRatio = boostSellRatio_;
        usdBuyRatio = usdBuyRatio_;
        emit ParamsSet(
            boostMultiplier,
            validRangeWidth,
            validRemovingRatio,
            boostLowerPriceSell,
            boostUpperPriceBuy,
            boostSellRatio,
            usdBuyRatio
        );
    }

    /// @inheritdoc IV2AMO.sol
    function setWhitelistedTokens(address[] memory tokens, bool isWhitelisted) external override onlyRole(SETTER_ROLE) {
        for (uint i = 0; i < tokens.length; i++) {
            whitelistedRewardTokens[tokens[i]] = isWhitelisted;
        }
        emit RewardTokensSet(tokens, isWhitelisted);
    }

    ////////////////////////// AMO_ROLE ACTIONS //////////////////////////
    function _mintAndSellBoost(
        uint256 boostAmount,
        uint256 minUsdAmountOut,
        uint256 deadline
    ) internal override returns (uint256 boostAmountIn, uint256 usdAmountOut) {
        // Mint the specified amount of BOOST tokens
        IMinter(boostMinter).protocolMint(address(this), boostAmount);

        // Approve the transfer of BOOST tokens to the router
        IERC20Upgradeable(boost).approve(router, boostAmount);

        // Define the route to swap BOOST tokens for USD tokens
        ISolidlyRouter.route[] memory routes = new ISolidlyRouter.route[](1);
        routes[0] = ISolidlyRouter.route(boost, usd, true);

        if (minUsdAmountOut < toUsdAmount(boostAmount)) minUsdAmountOut = toUsdAmount(boostAmount);

        uint256 usdBalanceBefore = balanceOfToken(usd);
        // Execute the swap and store the amounts of tokens involved
        uint256[] memory amounts = ISolidlyRouter(router).swapExactTokensForTokens(
            boostAmount,
            minUsdAmountOut,
            routes,
            address(this),
            deadline
        );
        uint256 usdBalanceAfter = balanceOfToken(usd);
        boostAmountIn = amounts[0];
        usdAmountOut = amounts[1];

        // we check that selling BOOST yields proportionally more USD
        if (usdAmountOut != usdBalanceAfter - usdBalanceBefore)
            revert UsdAmountOutMismatch(usdAmountOut, usdBalanceAfter - usdBalanceBefore);

        if (usdAmountOut < minUsdAmountOut) revert InsufficientOutputAmount(usdAmountOut, minUsdAmountOut);

        emit MintSell(boostAmount, usdAmountOut);
    }

    function _addLiquidity(
        uint256 usdAmount,
        uint256 minBoostSpend,
        uint256 minUsdSpend,
        uint256 deadline
    ) internal override returns (uint256 boostSpent, uint256 usdSpent, uint256 liquidity) {
        // We only add liquidity when price is withing range (close to $1)
        // Price needs to be in range: 1 +- validRangeRatio / 1e6 == factor +- validRangeRatio
        // if price is too high, we need to mint and sell more before we add liqudiity
        uint256 price = boostPrice();
        if (price <= FACTOR - validRangeWidth || price >= FACTOR + validRangeWidth) revert InvalidRatioToAddLiquidity();

        // Mint the specified amount of BOOST tokens
        uint256 boostAmount = (toBoostAmount(usdAmount) * boostMultiplier) / FACTOR;

        IMinter(boostMinter).protocolMint(address(this), boostAmount);

        // Approve the transfer of BOOST and USD tokens to the router
        IERC20Upgradeable(boost).approve(router, boostAmount);
        IERC20Upgradeable(usd).approve(router, usdAmount);

        uint256 lpBalanceBefore = balanceOfToken(pool);
        // Add liquidity to the BOOST-USD pool
        (boostSpent, usdSpent, liquidity) = ISolidlyRouter(router).addLiquidity(
            boost,
            usd,
            true,
            boostAmount,
            usdAmount,
            minBoostSpend,
            minUsdSpend,
            address(this),
            deadline
        );
        uint256 lpBalanceAfter = balanceOfToken(pool);

        if (liquidity != lpBalanceAfter - lpBalanceBefore)
            revert LpAmountOutMismatch(liquidity, lpBalanceAfter - lpBalanceBefore);

        // Revoke approval from the router
        IERC20Upgradeable(boost).approve(router, 0);
        IERC20Upgradeable(usd).approve(router, 0);

        // Approve the transfer of liquidity tokens to the gauge and deposit them
        IERC20Upgradeable(pool).approve(gauge, liquidity);
        if (useTokenId) {
            IGauge(gauge).deposit(liquidity, tokenId);
        } else {
            IGauge(gauge).deposit(liquidity);
        }

        // Burn excessive boosts
        if (boostAmount > boostSpent) IBoostStablecoin(boost).burn(boostAmount - boostSpent);

        emit AddLiquidityAndDeposit(boostSpent, usdSpent, liquidity, tokenId);
    }

    function _unfarmBuyBurn(
        uint256 liquidity,
        uint256 minBoostRemove,
        uint256 minUsdRemove,
        uint256 minBoostAmountOut,
        uint256 deadline
    )
        internal
        override
        returns (uint256 boostRemoved, uint256 usdRemoved, uint256 usdAmountIn, uint256 boostAmountOut)
    {
        // Withdraw the specified amount of liquidity tokens from the gauge
        IGauge(gauge).withdraw(liquidity);

        // Approve the transfer of liquidity tokens to the router for removal
        IERC20Upgradeable(pool).approve(router, liquidity);

        uint256 usdBalanceBefore = balanceOfToken(usd);
        // Remove liquidity and store the amounts of USD and BOOST tokens received
        (boostRemoved, usdRemoved) = ISolidlyRouter(router).removeLiquidity(
            boost,
            usd,
            true,
            liquidity,
            minBoostRemove,
            minUsdRemove,
            address(this),
            deadline
        );
        uint256 usdBalanceAfter = balanceOfToken(usd);

        // we check that each USDC buys more than 1 BOOST (repegging is not an expense for the protocol)
        if (usdRemoved != usdBalanceAfter - usdBalanceBefore)
            revert UsdAmountOutMismatch(usdRemoved, usdBalanceAfter - usdBalanceBefore);

        // Ensure the BOOST amount is greater than or equal to the USD amount
        if ((boostRemoved * validRemovingRatio) / FACTOR < toBoostAmount(usdRemoved))
            revert InvalidRatioToRemoveLiquidity();

        // Define the route to swap USD tokens for BOOST tokens
        ISolidlyRouter.route[] memory routes = new ISolidlyRouter.route[](1);
        routes[0] = ISolidlyRouter.route(usd, boost, true);

        // Approve the transfer of usd tokens to the router
        IERC20Upgradeable(usd).approve(router, usdRemoved);

        if (minBoostAmountOut < toBoostAmount(usdRemoved)) minBoostAmountOut = toBoostAmount(usdRemoved);

        // Execute the swap and store the amounts of tokens involved
        uint256[] memory amounts = ISolidlyRouter(router).swapExactTokensForTokens(
            usdRemoved,
            minBoostAmountOut,
            routes,
            address(this),
            deadline
        );

        // Burn the BOOST tokens received from the liquidity
        // Burn the BOOST tokens received from the swap
        usdAmountIn = amounts[0];
        boostAmountOut = amounts[1];
        IBoostStablecoin(boost).burn(boostRemoved + boostAmountOut);

        emit UnfarmBuyBurn(boostRemoved, usdRemoved, liquidity, boostAmountOut);
    }

    ////////////////////////// REWARD_COLLECTOR_ROLE ACTIONS //////////////////////////
    /// @inheritdoc IV2AMO.sol
    function getReward(
        address[] memory tokens,
        bool passTokens
    ) external override onlyRole(REWARD_COLLECTOR_ROLE) whenNotPaused nonReentrant {
        uint256[] memory rewardsAmounts = new uint256[](tokens.length);
        // Collect the rewards
        if (passTokens) {
            IGauge(gauge).getReward(address(this), tokens);
        } else {
            IGauge(gauge).getReward();
        }
        // Calculate the reward amounts and transfer them to the reward vault
        for (uint i = 0; i < tokens.length; i++) {
            if (!whitelistedRewardTokens[tokens[i]]) revert TokenNotWhitelisted(tokens[i]);
            rewardsAmounts[i] = IERC20Upgradeable(tokens[i]).balanceOf(address(this));
            IERC20Upgradeable(tokens[i]).safeTransfer(rewardVault, rewardsAmounts[i]);
        }
        // Emit an event for collecting rewards
        emit GetReward(tokens, rewardsAmounts);
    }

    ////////////////////////// PUBLIC FUNCTIONS //////////////////////////
    function _mintSellFarm() internal override returns (uint256 liquidity, uint256 newBoostPrice) {
        (uint256 boostReserve, uint256 usdReserve) = getReserves();

        uint256 boostAmountIn = (((usdReserve - boostReserve) / 2) * boostSellRatio) / FACTOR;

        (, , , , liquidity) = _mintSellFarm(
            boostAmountIn,
            toUsdAmount(boostAmountIn), // minUsdAmountOut
            1, // minBoostSpend
            1, // minUsdSpend
            block.timestamp + 1 // deadline
        );

        newBoostPrice = boostPrice();
    }

    function _unfarmBuyBurn() internal override returns (uint256 liquidity, uint256 newBoostPrice) {
        (uint256 boostReserve, uint256 usdReserve) = getReserves();

        uint256 usdNeeded = (((boostReserve - usdReserve) / 2) * usdBuyRatio) / FACTOR;
        uint256 totalLp = IERC20Upgradeable(pool).totalSupply();
        liquidity = (usdNeeded * totalLp) / usdReserve;

        // Readjust the LP amount and USD needed to balance price before removing LP
        // ( rationale: we first compute the amount of USD needed to rebalance the price in the pool; then first-order adjust for the fact that removing liquidity/totalLP fraction of the pool increases price impact —— less liquidity needs to be removed )
        // liquidity -= liquidity ** 2 / totalLp;

        _unfarmBuyBurn(
            liquidity,
            (liquidity * boostReserve) / totalLp, // the minBoostRemove argument
            toUsdAmount(usdNeeded), // the minUsdRemove argument
            usdNeeded, // the minBoostAmountOut argument
            block.timestamp + 1 // deadline is next block as the computation is valid instantly
        );

        newBoostPrice = boostPrice();
    }

    function _validateSwap(bool boostForUsd) internal view override {
        (uint256 boostReserve, uint256 usdReserve) = getReserves();
        if (boostForUsd && boostReserve >= usdReserve)
            revert InvalidReserveRatio({ratio: (FACTOR * usdReserve) / boostReserve});
        if (!boostForUsd && usdReserve >= boostReserve)
            revert InvalidReserveRatio({ratio: (FACTOR * usdReserve) / boostReserve});
    }

    ////////////////////////// VIEW FUNCTIONS //////////////////////////
    /// @inheritdoc IMasterAMO
    function boostPrice() public view override returns (uint256 price) {
        uint256 amountOut = IPair(pool).getAmountOut(10 ** boostDecimals, boost);
        price = amountOut / 10 ** (usdDecimals - PRICE_DECIMALS);
    }

    function getReserves() public view returns (uint256 boostReserve, uint256 usdReserve) {
        (uint256 reserve0, uint256 reserve1, ) = IPair(pool).getReserves();
        if (boost < usd) {
            boostReserve = reserve0;
            usdReserve = toBoostAmount(reserve1); // scaled
        } else {
            boostReserve = reserve1;
            usdReserve = toBoostAmount(reserve0); // scaled
        }
    }
}
