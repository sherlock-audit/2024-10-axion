// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlEnumerableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721Upgradeable.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/interfaces/IERC20Metadata.sol";
import {IMinter} from "./interfaces/IMinter.sol";
import {IBoostStablecoin} from "./interfaces/IBoostStablecoin.sol";
import {IMasterAMO} from "./interfaces/IMasterAMO.sol";

/**
 * the contracts are upgradable but behind a time lock. This is because we plan further improvements to the AMO logic ( we could for instance deploy an AMO cotract for concentrated liquidity).
 * in future versions, upgrades could be strictly tied to a governance vote (where upgrade can only be passed with testified governance vote approval)
 * the contracts are pausable — also governance-unpausable to ensure decentralisation
 */

abstract contract MasterAMO is
    IMasterAMO,
    Initializable,
    AccessControlEnumerableUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /* ========== ERRORS ========== */
    error ZeroAddress();
    error InvalidRatioValue();
    error InsufficientOutputAmount(uint256 outputAmount, uint256 minRequired);
    error InvalidRatioToAddLiquidity();
    error InvalidRatioToRemoveLiquidity();
    error PriceNotInRange(uint256 price);

    /* ========== EVENTS ========== */
    event MintSell(uint256 boostAmountIn, uint256 usdAmountOut);
    event PublicMintSellFarmExecuted(uint256 liquidity, uint256 newBoostPrice);
    event PublicUnfarmBuyBurnExecuted(uint256 liquidity, uint256 newBoostPrice);

    /* ========= MODIFIERS ========= */
    modifier validateSwap(bool boostForUsd) {
        _validateSwap(boostForUsd);
        _;
    }

    /* ========== ROLES ========== */
    /// @inheritdoc IMasterAMO
    bytes32 public constant override SETTER_ROLE = keccak256("SETTER_ROLE");
    /// @inheritdoc IMasterAMO
    bytes32 public constant override AMO_ROLE = keccak256("AMO_ROLE");
    /// @inheritdoc IMasterAMO
    bytes32 public constant override PAUSER_ROLE = keccak256("PAUSER_ROLE");
    /// @inheritdoc IMasterAMO
    bytes32 public constant override UNPAUSER_ROLE = keccak256("UNPAUSER_ROLE");
    /// @inheritdoc IMasterAMO
    bytes32 public constant override WITHDRAWER_ROLE = keccak256("WITHDRAWER_ROLE");

    /* ========== VARIABLES ========== */
    /// @inheritdoc IMasterAMO
    address public override boost;
    /// @inheritdoc IMasterAMO
    address public override usd;
    /// @inheritdoc IMasterAMO
    address public override pool;
    /// @inheritdoc IMasterAMO
    uint8 public override boostDecimals;
    /// @inheritdoc IMasterAMO
    uint8 public override usdDecimals;
    /// @inheritdoc IMasterAMO
    address public override boostMinter;

    /// @inheritdoc IMasterAMO
    uint256 public override boostMultiplier;
    /// @inheritdoc IMasterAMO
    uint24 public override validRangeWidth;
    /// @inheritdoc IMasterAMO
    uint24 public override validRemovingRatio;

    /// @inheritdoc IMasterAMO
    uint256 public override boostLowerPriceSell;
    /// @inheritdoc IMasterAMO
    uint256 public override boostUpperPriceBuy;

    /* ========== CONSTANTS ========== */
    uint8 internal constant PRICE_DECIMALS = 6; // BOOST price decimals. For instance, if the actual BOOST price is 1.2$ the internal BOOST price is 1200000
    uint8 internal constant PARAMS_DECIMALS = 6; // Decimals of all parameters for internal calculations
    uint256 internal constant FACTOR = 10 ** PARAMS_DECIMALS; // Factor scales 1 with PARAMS_DECIMALS for internal calcs. It is the internal representation of the value 1
    bool internal constant SELL_BOOST = true; // param for the validation modifier
    bool internal constant BUY_BOOST = false; // param for the validation modifier

    /* ========== FUNCTIONS ========== */
    function initialize(
        address admin, // // Address assigned the admin role (given exclusively to a multi-sig wallet)
        address boost_, // The Boost stablecoin address
        address usd_, // generic name for $1 collateral ( typically USDC or USDT )
        address pool_, // The pool where AMO logic applies for Boost-USD pair
        // On each chain where Boost is deployed, there will be a stable Boost-USD pool ensuring BOOST's peg.
        // Multiple Boost-USD pools can exist across different DEXes on the same chain, each with its own AMO, maintaining independent peg guarantees.
        address boostMinter_ // the minter contract
    ) public onlyInitializing {
        __AccessControlEnumerable_init();
        __Pausable_init();
        // Ensure no zero addresses are passed to critical parameters
        if (
            admin == address(0) ||
            boost_ == address(0) ||
            usd_ == address(0) ||
            pool_ == address(0) ||
            boostMinter_ == address(0)
        ) revert ZeroAddress(); // zero-address error checks

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        boost = boost_;
        usd = usd_;
        pool = pool_;
        boostDecimals = IERC20Metadata(boost).decimals();
        usdDecimals = IERC20Metadata(usd).decimals();
        boostMinter = boostMinter_;
    }

    ////////////////////////// PAUSE ACTIONS //////////////////////////
    /// @inheritdoc IMasterAMO
    function pause() external override onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /// @inheritdoc IMasterAMO
    function unpause() external override onlyRole(UNPAUSER_ROLE) {
        _unpause();
    }

    ////////////////////////// AMO_ROLE ACTIONS //////////////////////////
    /**
     * I) When Boost is over peg (in the AMOed pool)
     * 1.a) Boost can minted and sold for USD — this is the mintAndSellBoost() function
     * 1.b) When peg is restored, the USD 'Backing" (we received from (a) ) is paired with free-minted Boost — it is added farmed with the addLiquidity function
     * II) When Boost is under peg
     * 2.a) the algo
     * 2.b)
     * Implementation: the actions to maintain peg ( I and II ) can be triggered permissionlessly
     */
    function _mintAndSellBoost(
        uint256 boostAmount
    ) internal virtual returns (uint256 boostAmountIn, uint256 usdAmountOut);

    /// @inheritdoc IMasterAMO
    function mintAndSellBoost(
        uint256 boostAmount
    )
        external
        override
        onlyRole(AMO_ROLE)
        whenNotPaused
        nonReentrant
        returns (uint256 boostAmountIn, uint256 usdAmountOut)
    {
        (boostAmountIn, usdAmountOut) = _mintAndSellBoost(boostAmount);
    }

    function _addLiquidity(
        uint256 usdAmount,
        uint256 minBoostSpend,
        uint256 minUsdSpend
    ) internal virtual returns (uint256 boostSpent, uint256 usdSpent, uint256 liquidity);

    /// @inheritdoc IMasterAMO
    function addLiquidity(
        uint256 usdAmount,
        uint256 minBoostSpend,
        uint256 minUsdSpend
    )
        external
        override
        onlyRole(AMO_ROLE)
        whenNotPaused
        nonReentrant
        returns (uint256 boostSpent, uint256 usdSpent, uint256 liquidity)
    {
        (boostSpent, usdSpent, liquidity) = _addLiquidity(usdAmount, minBoostSpend, minUsdSpend);
    }

    /**
     * combines mintAndSellBoost and addLiquidity
     * addLiquidity only can be performed when price is close to peg (within range)
     * mintAndSellBoost will be looped as long as price remains too far above peg
     */
    function _mintSellFarm(
        uint256 boostAmount,
        uint256 minBoostSpend,
        uint256 minUsdSpend
    )
        internal
        returns (uint256 boostAmountIn, uint256 usdAmountOut, uint256 boostSpent, uint256 usdSpent, uint256 liquidity)
    {
        (boostAmountIn, usdAmountOut) = _mintAndSellBoost(boostAmount);

        uint256 price = boostPrice();
        if (price > FACTOR - validRangeWidth && price < FACTOR + validRangeWidth) {
            uint256 usdBalance = IERC20Upgradeable(usd).balanceOf(address(this));
            (boostSpent, usdSpent, liquidity) = _addLiquidity(usdBalance, minBoostSpend, minUsdSpend);
        }
    }

    /// @inheritdoc IMasterAMO
    function mintSellFarm(
        uint256 boostAmount,
        uint256 minBoostSpend,
        uint256 minUsdSpend
    )
        external
        override
        onlyRole(AMO_ROLE)
        whenNotPaused
        nonReentrant
        returns (uint256 boostAmountIn, uint256 usdAmountOut, uint256 boostSpent, uint256 usdSpent, uint256 liquidity)
    {
        (boostAmountIn, usdAmountOut, boostSpent, usdSpent, liquidity) = _mintSellFarm(
            boostAmount,
            minBoostSpend,
            minUsdSpend
        );
    }

    function _unfarmBuyBurn(
        uint256 liquidity,
        uint256 minBoostRemove,
        uint256 minUsdRemove
    ) internal virtual returns (uint256 boostRemoved, uint256 usdRemoved, uint256 usdAmountIn, uint256 boostAmountOut);

    /// @inheritdoc IMasterAMO
    function unfarmBuyBurn(
        uint256 liquidity,
        uint256 minBoostRemove,
        uint256 minUsdRemove
    )
        external
        override
        onlyRole(AMO_ROLE)
        whenNotPaused
        nonReentrant
        returns (uint256 boostRemoved, uint256 usdRemoved, uint256 usdAmountIn, uint256 boostAmountOut)
    {
        (boostRemoved, usdRemoved, usdAmountIn, boostAmountOut) = _unfarmBuyBurn(
            liquidity,
            minBoostRemove,
            minUsdRemove
        );
    }

    ////////////////////////// PUBLIC FUNCTIONS //////////////////////////
    function _mintSellFarm() internal virtual returns (uint256 liquidity, uint256 newBoostPrice);

    // This function handles the minting, selling, and farming of Boost when it's over the peg.
    function mintSellFarm()
        external
        override
        whenNotPaused
        nonReentrant
        validateSwap(SELL_BOOST)
        returns (uint256 liquidity, uint256 newBoostPrice)
    {
        (liquidity, newBoostPrice) = _mintSellFarm(); // Perform the mint and sell, and return liquidity and the new Boost price
        // Checks if the actual average price of boost when selling is greater than the boostLowerPriceSell
        if (newBoostPrice < boostLowerPriceSell) revert PriceNotInRange(newBoostPrice);

        emit PublicMintSellFarmExecuted(liquidity, newBoostPrice);
    }

    function _unfarmBuyBurn() internal virtual returns (uint256 liquidity, uint256 newBoostPrice);

    // This function handles the un-farming, buying, and burning of Boost when it's under the peg.
    function unfarmBuyBurn()
        external
        override
        whenNotPaused // Ensures the contract is not paused
        nonReentrant
        validateSwap(BUY_BOOST)
        returns (uint256 liquidity, uint256 newBoostPrice)
    {
        (liquidity, newBoostPrice) = _unfarmBuyBurn();
        // Checks if the actual average price of boost when buying is less than the boostUpperPriceBuy
        if (newBoostPrice > boostUpperPriceBuy) revert PriceNotInRange(newBoostPrice);

        emit PublicUnfarmBuyBurnExecuted(liquidity, newBoostPrice);
    }
    ////////////////////////// WITHDRAWAL FUNCTIONS //////////////////////////
    /// @inheritdoc IMasterAMO
    function withdrawERC20(
        address token,
        uint256 amount,
        address recipient
    ) external override onlyRole(WITHDRAWER_ROLE) {
        if (recipient == address(0)) revert ZeroAddress();
        IERC20Upgradeable(token).safeTransfer(recipient, amount);
    }

    ////////////////////////// INTERNAL FUNCTIONS //////////////////////////
    function sortAmounts(uint256 amount0, uint256 amount1) internal view returns (uint256, uint256) {
        if (boost < usd) return (amount0, amount1);
        return (amount1, amount0);
    }

    function sortAmounts(int256 amount0, int256 amount1) internal view returns (int256, int256) {
        if (boost < usd) return (amount0, amount1);
        return (amount1, amount0);
    }

    function toBoostAmount(uint256 usdAmount) internal view returns (uint256) {
        return usdAmount * 10 ** (boostDecimals - usdDecimals);
    }

    function toUsdAmount(uint256 boostAmount) internal view returns (uint256) {
        return boostAmount / 10 ** (boostDecimals - usdDecimals);
    }

    function balanceOfToken(address token) internal view returns (uint256) {
        return IERC20Upgradeable(token).balanceOf(address(this));
    }

    // Binary Search Square Root
    function sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        else {
            uint256 xx = x;
            uint256 r = 1;
            if (xx >= 0x100000000000000000000000000000000) {
                xx >>= 128;
                r <<= 64;
            }
            if (xx >= 0x10000000000000000) {
                xx >>= 64;
                r <<= 32;
            }
            if (xx >= 0x100000000) {
                xx >>= 32;
                r <<= 16;
            }
            if (xx >= 0x10000) {
                xx >>= 16;
                r <<= 8;
            }
            if (xx >= 0x100) {
                xx >>= 8;
                r <<= 4;
            }
            if (xx >= 0x10) {
                xx >>= 4;
                r <<= 2;
            }
            if (xx >= 0x8) {
                r <<= 1;
            }
            r = (r + x / r) >> 1;
            r = (r + x / r) >> 1;
            r = (r + x / r) >> 1;
            r = (r + x / r) >> 1;
            r = (r + x / r) >> 1;
            r = (r + x / r) >> 1;
            r = (r + x / r) >> 1;
            uint256 r1 = x / r;
            return r < r1 ? r : r1;
        }
    }

    ////////////////////////// VIEW FUNCTIONS //////////////////////////
    function boostPrice() public view virtual returns (uint256 price);

    function _validateSwap(bool boostForUsd) internal view virtual;
}
