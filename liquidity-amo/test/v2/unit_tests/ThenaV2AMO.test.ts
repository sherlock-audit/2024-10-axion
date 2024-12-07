import { expect } from "chai";
import { ethers, network, upgrades } from "hardhat";
import { AbiCoder } from "ethers";

// @ts-ignore
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  Minter,
  BoostStablecoin,
  MockERC20,
  V2AMO,
  IV2Voter,
  IFactory,
  MockRouter,
  IGaugeFactory,
  IVoterV3,
  IThenaVoterV3,
  IThenaRouter,
  IGauge,
  IERC20,
} from "../../../typechain-types";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";

describe("V2AMO", function () {
  const abiCoder = new AbiCoder();

  let v2AMO: V2AMO;
  let boost: BoostStablecoin;
  let testUSD: MockERC20;
  let minter: Minter;
  let router: MockRouter | IThenaRouter;
  let v2Voter: IV2Voter | IVoterV3 | IThenaVoterV3;
  let factory: IFactory;
  let gauge: IGauge | IGaugeFactory;
  let pool: IERC20;
  let admin: SignerWithAddress;
  let rewardVault: SignerWithAddress;
  let setter: SignerWithAddress;
  let amoBot: SignerWithAddress;
  let withdrawer: SignerWithAddress;
  let pauser: SignerWithAddress;
  let unpauser: SignerWithAddress;
  let rewardCollector: SignerWithAddress;
  let boostMinter: SignerWithAddress;
  let user: SignerWithAddress;

  let SETTER_ROLE: string;
  let AMO_ROLE: string;
  let WITHDRAWER_ROLE: string;
  let PAUSER_ROLE: string;
  let UNPAUSER_ROLE: string;
  let REWARD_COLLECTOR_ROLE: string;

  const THENA_VOTER = "0x3A1D0952809F4948d15EBCe8d345962A282C4fCb";
  const THENA_FACTORY = "0xAFD89d21BdB66d00817d4153E055830B1c2B3970";
  const THENA_GAUGE_FACTORY = "0x2c788FE40A417612cb654b14a944cd549B5BF130";
  const THENA_ROUTER = "0xd4ae6eca985340dd434d38f470accce4dc78d109";
  const Thena_Governor = "0x993Ae2b514677c7AC52bAeCd8871d2b362A9D693";
  const THENA_TOKEN = "0xF4C8E32EaDEC4BFe97E0F595AdD0f4450a863a11";
  const VE_THENA = "0xfBBF371C9B0B994EebFcC977CEf603F7f31c070D";
  const WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
  const boostDesired = ethers.parseUnits("11000000", 18); // 11M
  const usdDesired = ethers.parseUnits("11000000", 6); // 11M
  const boostMin4Liquidity = ethers.parseUnits("9990000", 18); // 9.99M
  const usdMin4Liquidity = ethers.parseUnits("9990000", 6); // 9.99M

  let boostAddress: string;
  let usdAddress: string;
  let minterAddress: string;
  let routerAddress: string;
  let poolAddress: string;
  let gaugeAddress: string;
  let amoAddress: string;
  const deadline = Math.floor(Date.now() / 1000) + 60 * 100;
  const delta = ethers.parseUnits("0.001", 6);
  const boostMultiplier = ethers.parseUnits("1.1", 6);
  const validRangeWidth = ethers.parseUnits("0.01", 6);
  const validRemovingRatio = ethers.parseUnits("1.01", 6);
  const boostLowerPriceSell = ethers.parseUnits("0.99", 6);
  const boostUpperPriceBuy = ethers.parseUnits("1.01", 6);
  const boostSellRatio = ethers.parseUnits("0.8", 6);
  const usdBuyRatio = ethers.parseUnits("0.8", 6);
  const params = [
    ethers.parseUnits("1.1", 6), // boostMultiplier
    ethers.parseUnits("0.01", 6), // validRangeWidth
    ethers.parseUnits("1.01", 6), // validRemovingRatio
    ethers.parseUnits("0.99", 6), // boostLowerPriceSell
    ethers.parseUnits("1.01", 6), // boostUpperPriceBuy
    ethers.parseUnits("0.8", 6), // boostSellRatio
    ethers.parseUnits("0.8", 6), // usdBuyRatio
  ];

  before(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: "https://bnb.rpc.subquery.network/public",
            blockNumber: 44322111, // Update with appropriate block number
          },
        },
      ],
    });
  });

  async function deployBaseContracts() {
    [
      admin,
      rewardVault,
      setter,
      amoBot,
      withdrawer,
      pauser,
      unpauser,
      boostMinter,
      user,
      rewardCollector,
    ] = await ethers.getSigners();

    const BoostFactory = await ethers.getContractFactory("BoostStablecoin");
    boost = await upgrades.deployProxy(BoostFactory, [admin.address]);
    await boost.waitForDeployment();
    boostAddress = await boost.getAddress();

    const MockErc20Factory = await ethers.getContractFactory("MockERC20");
    testUSD = await MockErc20Factory.deploy("USD", "USD", 6);
    await testUSD.waitForDeployment();
    usdAddress = await testUSD.getAddress();

    const MinterFactory = await ethers.getContractFactory("Minter");
    minter = await upgrades.deployProxy(MinterFactory, [
      boostAddress,
      usdAddress,
      admin.address,
    ]);
    await minter.waitForDeployment();
    minterAddress = await minter.getAddress();

    // Mint tokens
    await boost.grantRole(await boost.MINTER_ROLE(), minterAddress);
    await boost.grantRole(await boost.MINTER_ROLE(), boostMinter.address);
    await boost.connect(boostMinter).mint(admin.address, boostDesired);
    await testUSD.connect(boostMinter).mint(admin.address, usdDesired);
  }

  async function setupSolidlyV2Environment() {
    // Create Pool
    factory = await ethers.getContractAt("IFactory", THENA_FACTORY);
    await factory.connect(admin).createPair(boostAddress, usdAddress, true);
    poolAddress = await factory.getPair(boostAddress, usdAddress, true);

    // Get Thena Router
    router = await ethers.getContractAt("IThenaRouter", THENA_ROUTER);
    routerAddress = THENA_ROUTER;

    // Setup gauge and wait for it
    await setupGauge();

    // Deploy AMO
    const SolidlyV2LiquidityAMOFactory =
      await ethers.getContractFactory("V2AMO");
    v2AMO = await upgrades.deployProxy(
      SolidlyV2LiquidityAMOFactory,
      [
        admin.address,
        boostAddress,
        usdAddress,
        0, // SOLIDLY_V2
        minterAddress,
        ethers.ZeroAddress, // No factory needed for Solidly
        routerAddress,
        gaugeAddress, // Now we're sure this is set
        rewardVault.address,
        0, // tokenId
        false, // useTokenId
        ...params,
      ],
      {
        initializer:
          "initialize(address,address,address,uint8,address,address,address,address,address,uint256,bool,uint256,uint24,uint24,uint256,uint256,uint256,uint256)",
        timeout: 0,
      },
    );
    await v2AMO.waitForDeployment();
    amoAddress = await v2AMO.getAddress();
  }

  async function setupGauge() {
    try {
      // Setup Gauge
      const gaugeFactory = await ethers.getContractAt(
        "IGaugeFactory",
        THENA_GAUGE_FACTORY,
      );
      v2Voter = await ethers.getContractAt("IThenaVoterV3", THENA_VOTER);

      // Fund the governor account with more ETH to ensure enough gas
      await network.provider.send("hardhat_setBalance", [
        Thena_Governor,
        "0x1000000000000000000",
      ]);

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [Thena_Governor],
      });

      const governorSigner = await ethers.getSigner(Thena_Governor);

      // Check if tokens are already whitelisted
      const isBoostWhitelisted = await v2Voter.isWhitelisted(boostAddress);
      const isUsdWhitelisted = await v2Voter.isWhitelisted(usdAddress);

      if (!isBoostWhitelisted || !isUsdWhitelisted) {
        // Whitelist tokens one by one to avoid potential issues
        if (!isBoostWhitelisted) {
          await v2Voter.connect(governorSigner).whitelist([boostAddress]);
        }
        if (!isUsdWhitelisted) {
          await v2Voter.connect(governorSigner).whitelist([usdAddress]);
        }
      }

      // Check if gauge already exists
      let existingGauge = await v2Voter.gauges(poolAddress);

      if (existingGauge === ethers.ZeroAddress) {
        // Create gauge only if it doesn't exist
        const tx = await v2Voter
          .connect(governorSigner)
          .createGauge(poolAddress, 0);
        await tx.wait();
        existingGauge = await v2Voter.gauges(poolAddress);
      }

      gaugeAddress = existingGauge;
      //console.log("Gauge Address:", gaugeAddress);

      // Stop impersonating
      await network.provider.request({
        method: "hardhat_stopImpersonatingAccount",
        params: [Thena_Governor],
      });

      if (!gaugeAddress || gaugeAddress === ethers.ZeroAddress) {
        throw new Error("Gauge address not set properly");
      }

      return gaugeAddress;
    } catch (error) {
      console.error("Comprehensive Error in setupGauge:", error);
      // Log more details about the error
      if (error.transaction) {
        console.error("Transaction:", error.transaction);
      }
      if (error.receipt) {
        console.error("Receipt:", error.receipt);
      }
      throw error;
    }
  }

  async function provideLiquidity() {
    await boost.approve(routerAddress, boostDesired);
    await testUSD.approve(routerAddress, usdDesired);

    await router
      .connect(admin)
      .addLiquidity(
        usdAddress,
        boostAddress,
        true,
        usdDesired,
        boostDesired,
        usdMin4Liquidity,
        boostMin4Liquidity,
        amoAddress,
        deadline,
      );
  }

  async function setupRoles() {
    SETTER_ROLE = await v2AMO.SETTER_ROLE();
    AMO_ROLE = await v2AMO.AMO_ROLE();
    WITHDRAWER_ROLE = await v2AMO.WITHDRAWER_ROLE();
    PAUSER_ROLE = await v2AMO.PAUSER_ROLE();
    UNPAUSER_ROLE = await v2AMO.UNPAUSER_ROLE();
    REWARD_COLLECTOR_ROLE = await v2AMO.REWARD_COLLECTOR_ROLE();

    await v2AMO.grantRole(SETTER_ROLE, setter.address);
    await v2AMO.grantRole(AMO_ROLE, amoBot.address);
    await v2AMO.grantRole(WITHDRAWER_ROLE, withdrawer.address);
    await v2AMO.grantRole(PAUSER_ROLE, pauser.address);
    await v2AMO.grantRole(UNPAUSER_ROLE, unpauser.address);
    await v2AMO.grantRole(REWARD_COLLECTOR_ROLE, rewardCollector.address);
    await minter.grantRole(await minter.AMO_ROLE(), amoAddress);
  }

  async function depositToGauge() {
    pool = await ethers.getContractAt(
      "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20",
      poolAddress,
    );
    let lpBalance = await pool.balanceOf(amoAddress);
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [amoAddress],
    });
    await setBalance(amoAddress, ethers.parseEther("1"));
    const amoSigner = await ethers.getSigner(amoAddress);
    await pool.connect(amoSigner).approve(gaugeAddress, lpBalance);
    gauge = await ethers.getContractAt("IGauge", gaugeAddress);
    await gauge.connect(amoSigner)["deposit(uint256)"](lpBalance);
    await network.provider.request({
      method: "hardhat_stopImpersonatingAccount",
      params: [amoAddress],
    });
  }

  before(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: "https://bnb.rpc.subquery.network/public",
            blockNumber: 44322111, // Update with appropriate block number
          },
        },
      ],
    });
  });

  describe("Thena V2Pool Tests", function () {
    beforeEach(async function () {
      await deployBaseContracts();
      await setupSolidlyV2Environment();
      await setupGauge();
      await provideLiquidity();
      await depositToGauge();
      await setupRoles();
    });
    describe("Initialization", function () {
      it("should initialize with correct parameters", async function () {
        expect(await v2AMO.boost()).to.equal(boostAddress);
        expect(await v2AMO.usd()).to.equal(usdAddress);
        expect(await v2AMO.boostMinter()).to.equal(minterAddress);
      });

      it("Should set correct roles", async function () {
        expect(await v2AMO.hasRole(SETTER_ROLE, setter.address)).to.be.true;
        expect(await v2AMO.hasRole(AMO_ROLE, amoBot.address)).to.be.true;
        expect(await v2AMO.hasRole(WITHDRAWER_ROLE, withdrawer.address)).to.be
          .true;
        expect(await v2AMO.hasRole(PAUSER_ROLE, pauser.address)).to.be.true;
        expect(await v2AMO.hasRole(UNPAUSER_ROLE, unpauser.address)).to.be.true;
      });
    });

    describe("Setter Role Actions", function () {
      describe("setParams", function () {
        it("Should set params correctly", async function () {
          await expect(
            v2AMO
              .connect(setter)
              .setParams(
                boostMultiplier,
                validRangeWidth,
                validRemovingRatio,
                boostLowerPriceSell,
                boostUpperPriceBuy,
                boostSellRatio,
                usdBuyRatio,
              ),
          )
            .to.emit(v2AMO, "ParamsSet")
            .withArgs(
              boostMultiplier,
              validRangeWidth,
              validRemovingRatio,
              boostLowerPriceSell,
              boostUpperPriceBuy,
              boostSellRatio,
              usdBuyRatio,
            );

          expect(await v2AMO.boostMultiplier()).to.equal(boostMultiplier);
          expect(await v2AMO.validRangeWidth()).to.equal(validRangeWidth);
          expect(await v2AMO.validRemovingRatio()).to.equal(validRemovingRatio);
          expect(await v2AMO.boostSellRatio()).to.equal(boostSellRatio);
          expect(await v2AMO.usdBuyRatio()).to.equal(usdBuyRatio);
          expect(await v2AMO.boostLowerPriceSell()).to.equal(
            boostLowerPriceSell,
          );
          expect(await v2AMO.boostUpperPriceBuy()).to.equal(boostUpperPriceBuy);
        });

        it("Should revert when called by non-setter", async function () {
          await expect(
            v2AMO
              .connect(user)
              .setParams(
                boostMultiplier,
                validRangeWidth,
                validRemovingRatio,
                boostLowerPriceSell,
                boostUpperPriceBuy,
                boostSellRatio,
                usdBuyRatio,
              ),
          ).to.be.revertedWith(
            `AccessControl: account ${user.address.toLowerCase()} is missing role ${SETTER_ROLE}`,
          );
        });

        it("Should revert when value is out of range", async function () {
          await expect(
            v2AMO
              .connect(setter)
              .setParams(
                boostMultiplier,
                ethers.parseUnits("1.1", 6),
                validRemovingRatio,
                boostLowerPriceSell,
                boostUpperPriceBuy,
                boostSellRatio,
                usdBuyRatio,
              ),
          ).to.be.revertedWithCustomError(v2AMO, "InvalidRatioValue");

          await expect(
            v2AMO
              .connect(setter)
              .setParams(
                boostMultiplier,
                validRangeWidth,
                ethers.parseUnits("0.99", 6),
                boostLowerPriceSell,
                boostUpperPriceBuy,
                boostSellRatio,
                usdBuyRatio,
              ),
          ).to.be.revertedWithCustomError(v2AMO, "InvalidRatioValue");
        });
      });
    });

    describe("AMO Role Actions", function () {
      describe("mintAndSellBoost", function () {
        it("Should execute mintAndSellBoost successfully", async function () {
          // Setup price above peg first
          const usdToBuy = ethers.parseUnits("1000000", 6);
          await testUSD.connect(admin).mint(user.address, usdToBuy);
          await testUSD.connect(user).approve(routerAddress, usdToBuy);

          const routeBuyBoost = [
            {
              from: usdAddress,
              to: boostAddress,
              stable: true,
            },
          ];

          await router.connect(user).swapExactTokensForTokens(
            usdToBuy,
            0, // min amount out
            routeBuyBoost,
            user.address,
            deadline,
          );

          // Test mintAndSellBoost
          const boostAmount = ethers.parseUnits("990000", 18);

          // Grant necessary roles
          await v2AMO.grantRole(AMO_ROLE, amoBot.address);
          await minter.grantRole(
            await minter.AMO_ROLE(),
            await v2AMO.getAddress(),
          );

          // Test unauthorized access
          await expect(
            v2AMO.connect(user).mintAndSellBoost(boostAmount),
          ).to.be.revertedWith(
            `AccessControl: account ${user.address.toLowerCase()} is missing role ${AMO_ROLE}`,
          );

          // Test authorized access
          await expect(
            v2AMO.connect(amoBot).mintAndSellBoost(boostAmount),
          ).to.emit(v2AMO, "MintSell");
        });
        it("Should revert mintAndSellBoost when called by non-amo", async function () {
          const boostAmount = ethers.parseUnits("990000", 18);
          await expect(
            v2AMO.connect(user).mintAndSellBoost(boostAmount),
          ).to.be.revertedWith(
            `AccessControl: account ${user.address.toLowerCase()} is missing role ${AMO_ROLE}`,
          );
        });
      });

      it("Should revert mintSellFarm when called by non-amo", async function () {
        const boostAmount = ethers.parseUnits("990000", 18);
        const usdAmount = ethers.parseUnits("980000", 6);
        await expect(
          v2AMO.connect(user).mintSellFarm(boostAmount, 1, 1),
        ).to.be.revertedWith(
          `AccessControl: account ${user.address.toLowerCase()} is missing role ${AMO_ROLE}`,
        );
      });

      it("Should revert unfarmBuyBurn when called by non-amo", async function () {
        // Use revertedWith for access control error
        await expect(
          v2AMO
            .connect(user)
            .unfarmBuyBurn(ethers.parseUnits("1000000", 18), 1, 1),
        ).to.be.revertedWith(
          `AccessControl: account ${user.address.toLowerCase()} is missing role ${AMO_ROLE}`,
        );
      });

      it("should only allow PAUSER_ROLE to pause and UNPAUSER_ROLE to unpause", async function () {
        // Grant roles
        await v2AMO.grantRole(AMO_ROLE, amoBot.address);
        await v2AMO.grantRole(PAUSER_ROLE, pauser.address);
        await v2AMO.grantRole(UNPAUSER_ROLE, unpauser.address);

        // Test pause
        await expect(v2AMO.connect(pauser).pause())
          .to.emit(v2AMO, "Paused")
          .withArgs(pauser.address);

        // Test operation while paused
        const boostAmount = ethers.parseUnits("1000", 18);
        await expect(
          v2AMO.connect(amoBot).mintAndSellBoost(boostAmount),
        ).to.be.revertedWith("Pausable: paused");

        // Test unpause
        await expect(v2AMO.connect(unpauser).unpause())
          .to.emit(v2AMO, "Unpaused")
          .withArgs(unpauser.address);
      });

      it("should allow WITHDRAWER_ROLE to withdraw ERC20 tokens", async function () {
        // Transfer some tokens to the contract
        await testUSD
          .connect(user)
          .mint(amoAddress, ethers.parseUnits("1000", 6));

        // Try withdrawing tokens without WITHDRAWER_ROLE
        await expect(
          v2AMO
            .connect(user)
            .withdrawERC20(
              usdAddress,
              ethers.parseUnits("1000", 6),
              user.address,
            ),
        ).to.be.revertedWith(
          `AccessControl: account ${user.address.toLowerCase()} is missing role ${WITHDRAWER_ROLE}`,
        );

        // Withdraw tokens with WITHDRAWER_ROLE
        await v2AMO
          .connect(withdrawer)
          .withdrawERC20(
            usdAddress,
            ethers.parseUnits("1000", 6),
            user.address,
          );
        const usdBalanceOfUser = await testUSD.balanceOf(
          await user.getAddress(),
        );
        expect(usdBalanceOfUser).to.be.equal(ethers.parseUnits("1000", 6));
      });

      it("should execute unfarmBuyBurn succesfully", async function () {
        const boostToBuy = ethers.parseUnits("2000000", 18);
        const minUsdReceive = ethers.parseUnits("1990000", 6);
        const routeSellBoost = [
          {
            from: boostAddress,
            to: usdAddress,
            stable: true,
          },
        ];
        await boost.connect(boostMinter).mint(user.address, boostToBuy);
        await boost.connect(user).approve(routerAddress, boostToBuy);
        await router
          .connect(user)
          .swapExactTokensForTokens(
            boostToBuy,
            minUsdReceive,
            routeSellBoost,
            user.address,
            deadline,
          );

        expect(await v2AMO.boostPrice()).to.be.lt(ethers.parseUnits("1", 6));

        await expect(v2AMO.connect(user).unfarmBuyBurn()).to.be.emit(
          v2AMO,
          "PublicUnfarmBuyBurnExecuted",
        );
        expect(await v2AMO.boostPrice()).to.be.approximately(
          ethers.parseUnits("1", 6),
          delta,
        );
      });

      it("should correctly return boostPrice", async function () {
        expect(await v2AMO.boostPrice()).to.be.approximately(
          ethers.parseUnits("1", 6),
          delta,
        );
      });

      describe("addLiquidity", function () {
        it("Should execute addLiquidity successfully", async function () {
          const usdAmountToAdd = ethers.parseUnits("1000", 6);
          const boostMinAmount = ethers.parseUnits("900", 18);
          const usdMinAmount = ethers.parseUnits("900", 6);

          await testUSD.connect(admin).mint(amoAddress, usdAmountToAdd);

          // Test with non-AMO role (user)
          await expect(
            v2AMO
              .connect(user)
              .addLiquidity(usdAmountToAdd, boostMinAmount, usdMinAmount),
          ).to.be.revertedWith(
            `AccessControl: account ${user.address.toLowerCase()} is missing role ${AMO_ROLE}`,
          );

          // Test with tokenId set
          await v2AMO.connect(setter).setTokenId(1, true);
          await expect(
            v2AMO
              .connect(amoBot)
              .addLiquidity(usdAmountToAdd, boostMinAmount, usdMinAmount),
          ).to.be.revertedWithoutReason();

          await v2AMO.connect(setter).setTokenId(0, false);

          // Test with AMO role
          await expect(
            v2AMO
              .connect(amoBot)
              .addLiquidity(usdAmountToAdd, boostMinAmount, usdMinAmount),
          ).to.emit(v2AMO, "AddLiquidityAndDeposit");
        });

        it("Should revert addLiquidity when called by non-amo", async function () {
          const usdBalance = ethers.parseUnits("980000", 6);
          await expect(
            v2AMO.connect(user).addLiquidity(usdBalance, 1, 1),
          ).to.be.revertedWith(
            `AccessControl: account ${user.address.toLowerCase()} is missing role ${AMO_ROLE}`,
          );
        });
      });

      describe("mintSellFarm", function () {
        it("should execute public mintSellFarm succesfully", async function () {
          const usdToBuy = ethers.parseUnits("2000000", 6);
          const minBoostReceive = ethers.parseUnits("1990000", 18);
          const routeBuyBoost = [
            {
              from: usdAddress,
              to: boostAddress,
              stable: true,
            },
          ];
          await testUSD.connect(admin).mint(user.address, usdToBuy);
          await testUSD.connect(user).approve(routerAddress, usdToBuy);
          await router
            .connect(user)
            .swapExactTokensForTokens(
              usdToBuy,
              minBoostReceive,
              routeBuyBoost,
              user.address,
              deadline,
            );

          expect(await v2AMO.boostPrice()).to.be.gt(ethers.parseUnits("1", 6));

          await expect(v2AMO.connect(user).mintSellFarm()).to.be.emit(
            v2AMO,
            "PublicMintSellFarmExecuted",
          );
          expect(await v2AMO.boostPrice()).to.be.approximately(
            ethers.parseUnits("1", 6),
            delta,
          );
        });

        it("should correctly return boostPrice", async function () {
          expect(await v2AMO.boostPrice()).to.be.approximately(
            ethers.parseUnits("1", 6),
            delta,
          );
        });

        it("Should revert mintSellFarm when called by non-amo", async function () {
          const boostAmount = ethers.parseUnits("990000", 18);
          await expect(
            v2AMO.connect(user).mintSellFarm(boostAmount, 1, 1),
          ).to.be.revertedWith(
            `AccessControl: account ${user.address.toLowerCase()} is missing role ${AMO_ROLE}`,
          );
        });
      });

      describe("unfarmBuyBurn", function () {
        it("should execute unfarmBuyBurn succesfully", async function () {
          const boostToBuy = ethers.parseUnits("2000000", 18);
          const minUsdReceive = ethers.parseUnits("1990000", 6);
          const routeSellBoost = [
            {
              from: boostAddress,
              to: usdAddress,
              stable: true,
            },
          ];
          await boost.connect(boostMinter).mint(user.address, boostToBuy);
          await boost.connect(user).approve(routerAddress, boostToBuy);
          await router
            .connect(user)
            .swapExactTokensForTokens(
              boostToBuy,
              minUsdReceive,
              routeSellBoost,
              user.address,
              deadline,
            );

          expect(await v2AMO.boostPrice()).to.be.lt(ethers.parseUnits("1", 6));

          await expect(v2AMO.connect(user).unfarmBuyBurn()).to.be.emit(
            v2AMO,
            "PublicUnfarmBuyBurnExecuted",
          );
          expect(await v2AMO.boostPrice()).to.be.approximately(
            ethers.parseUnits("1", 6),
            delta,
          );
        });
      });
    });

    describe("Public AMO Functions", function () {
      describe("mintSellFarm", function () {
        it("should execute public mintSellFarm above 1 ", async function () {
          const usdToBuy = ethers.parseUnits("2000000", 6);
          const minBoostReceive = ethers.parseUnits("1990000", 18);
          const routeBuyBoost = [
            {
              from: usdAddress,
              to: boostAddress,
              stable: true,
            },
          ];
          await testUSD.connect(admin).mint(user.address, usdToBuy);
          await testUSD.connect(user).approve(routerAddress, usdToBuy);
          await router
            .connect(user)
            .swapExactTokensForTokens(
              usdToBuy,
              minBoostReceive,
              routeBuyBoost,
              user.address,
              deadline,
            );

          expect(await v2AMO.boostPrice()).to.be.gt(ethers.parseUnits("1", 6));

          await expect(v2AMO.connect(user).mintSellFarm()).to.be.emit(
            v2AMO,
            "PublicMintSellFarmExecuted",
          );
          expect(await v2AMO.boostPrice()).to.be.approximately(
            ethers.parseUnits("1", 6),
            delta,
          );
        });

        it("Should revert unfarmBuyBurn when price is 1", async function () {
          // Use amoBot instead of amoAddress
          await expect(
            v2AMO.connect(amoBot).unfarmBuyBurn(),
          ).to.be.revertedWithCustomError(v2AMO, "InvalidReserveRatio");
        });
      });

      describe("unfarmBuyBurn", function () {
        it("should execute unfarmBuyBurn below 1", async function () {
          const boostToBuy = ethers.parseUnits("2000000", 18);
          const minUsdReceive = ethers.parseUnits("1990000", 6);
          const routeSellBoost = [
            {
              from: boostAddress,
              to: usdAddress,
              stable: true,
            },
          ];
          await boost.connect(boostMinter).mint(user.address, boostToBuy);
          await boost.connect(user).approve(routerAddress, boostToBuy);
          await router
            .connect(user)
            .swapExactTokensForTokens(
              boostToBuy,
              minUsdReceive,
              routeSellBoost,
              user.address,
              deadline,
            );

          expect(await v2AMO.boostPrice()).to.be.lt(ethers.parseUnits("1", 6));

          await expect(v2AMO.connect(user).unfarmBuyBurn()).to.be.emit(
            v2AMO,
            "PublicUnfarmBuyBurnExecuted",
          );
          expect(await v2AMO.boostPrice()).to.be.approximately(
            ethers.parseUnits("1", 6),
            delta,
          );
        });

        it("Should revert mintSellFarm when price is 1", async function () {
          // Use amoBot instead of amoAddress since it's a proper signer
          await expect(
            v2AMO.connect(amoBot).mintSellFarm(),
          ).to.be.revertedWithCustomError(v2AMO, "InvalidReserveRatio");
        });
      });

      describe("MasterAMO DAO Functions", function () {
        describe("pause", function () {
          it("should allow pauser to pause the contract", async function () {
            await expect(v2AMO.connect(pauser).pause()).to.not.be.reverted;
            expect(await v2AMO.paused()).to.equal(true);
          });

          it("should not allow non-pauser to pause the contract", async function () {
            const reverteMessage = `AccessControl: account ${user.address.toLowerCase()} is missing role ${PAUSER_ROLE}`;
            await expect(v2AMO.connect(user).pause()).to.be.revertedWith(
              reverteMessage,
            );
          });

          it("should not allow operations when paused", async function () {
            // Use proper signers instead of addresses
            await v2AMO.connect(pauser).pause();

            const boostAmount = ethers.parseUnits("990000", 18);
            const usdBalance = await testUSD.balanceOf(
              await v2AMO.getAddress(),
            );

            // Use amoBot for all operations
            await expect(
              v2AMO.connect(amoBot).mintAndSellBoost(boostAmount),
            ).to.be.revertedWith("Pausable: paused");

            await expect(
              v2AMO.connect(amoBot).addLiquidity(usdBalance, 1, 1),
            ).to.be.revertedWith("Pausable: paused");

            await expect(
              v2AMO.connect(amoBot).mintSellFarm(),
            ).to.be.revertedWith("Pausable: paused");

            await expect(
              v2AMO.connect(amoBot).unfarmBuyBurn(),
            ).to.be.revertedWith("Pausable: paused");
          });
        });
      });

      describe("unpause", function () {
        it("should allow unpauser to unpause the contract", async function () {
          await v2AMO.connect(pauser).pause();
          expect(await v2AMO.paused()).to.equal(true);

          await expect(v2AMO.connect(unpauser).unpause()).to.not.be.reverted;
          expect(await v2AMO.paused()).to.equal(false);
        });

        it("should not allow non-unpauser to unpause the contract", async function () {
          await v2AMO.connect(pauser).pause();
          const reverteMessage = `AccessControl: account ${user.address.toLowerCase()} is missing role ${UNPAUSER_ROLE}`;
          await expect(v2AMO.connect(user).unpause()).to.be.revertedWith(
            reverteMessage,
          );
        });
      });

      describe("should revert when invalid parameters are set", function () {
        for (const i of [1]) {
          it(`param on index ${i}`, async function () {
            let tempParams = [...params];
            tempParams[i] = ethers.parseUnits("1.00001", 6);
            await expect(
              v2AMO.connect(setter).setParams(...tempParams),
            ).to.be.revertedWithCustomError(v2AMO, "InvalidRatioValue");
          });
        }

        for (const i of [2]) {
          it(`param on index ${i}`, async function () {
            let tempParams = [...params];
            tempParams[i] = ethers.parseUnits("0.99999", 6);
            await expect(
              v2AMO.connect(setter).setParams(...tempParams),
            ).to.be.revertedWithCustomError(v2AMO, "InvalidRatioValue");
          });
        }
      });
      describe("get reward", async function () {
        const tokens = [];
        it("should revert when token is not whitelisted", async function () {});
        it("should revert for non-setter", async function () {
          await expect(
            v2AMO.connect(user).setWhitelistedTokens(tokens, true),
          ).to.be.revertedWith(
            `AccessControl: account ${user.address.toLowerCase()} is missing role ${SETTER_ROLE}`,
          );
        });
        it("should whitelist tokens", async function () {
          await expect(
            v2AMO.connect(setter).setWhitelistedTokens(tokens, true),
          ).to.emit(v2AMO, "RewardTokensSet");
        });
        it("should revert for non-reward_collector", async function () {
          await expect(
            v2AMO.connect(user).getReward(tokens, true),
          ).to.be.revertedWith(
            `AccessControl: account ${user.address.toLowerCase()} is missing role ${REWARD_COLLECTOR_ROLE}`,
          );
        });
        it("should get reward", async function () {
          await expect(
            v2AMO.connect(rewardCollector).getReward(tokens, true),
          ).to.emit(v2AMO, "GetReward");
        });
      });
    });
  });
});
