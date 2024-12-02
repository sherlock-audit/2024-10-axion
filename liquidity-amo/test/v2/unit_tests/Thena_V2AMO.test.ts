import { expect } from "chai";
import { ethers, network, upgrades } from "hardhat";
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
  IThenaRouter,
  IGauge,
  IERC20
} from "../../../typechain-types";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";

before(async () => {
  await network.provider.request({
    method: "hardhat_reset",
    params: [
      {
        forking: {
          jsonRpcUrl: "https://bnb.rpc.subquery.network/public",
          blockNumber: 44322111 // Update with appropriate block number
        }
      }
    ]
  });
});

describe("V2AMO", function () {
  let v2AMO: V2AMO;
  let boost: BoostStablecoin;
  let testUSD: MockERC20;
  let minter: Minter;
  let router: MockRouter | IThenaRouter;
  let v2Voter: IV2Voter | IVoterV3;
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
  const params = [
    ethers.parseUnits("1.1", 6), // boostMultiplier
    ethers.parseUnits("0.01", 6), // validRangeWidth
    ethers.parseUnits("1.01", 6), // validRemovingRatio
    ethers.parseUnits("0.99", 6), // boostLowerPriceSell
    ethers.parseUnits("1.01", 6), // boostUpperPriceBuy
    ethers.parseUnits("0.8", 6), // boostSellRatio
    ethers.parseUnits("0.8", 6) // usdBuyRatio
  ];

  beforeEach(async function () {
    [
      admin, rewardVault, setter, amoBot, withdrawer, pauser, unpauser, boostMinter, user, rewardCollector
    ] = await ethers.getSigners();

    // Deploy the actual contracts using deployProxy
    const BoostFactory = await ethers.getContractFactory("BoostStablecoin");
    boost = await upgrades.deployProxy(BoostFactory, [admin.address]);
    await boost.waitForDeployment();
    boostAddress = await boost.getAddress();

    const MockErc20Factory = await ethers.getContractFactory("MockERC20");
    testUSD = await MockErc20Factory.deploy("USD", "USD", 6);
    await testUSD.waitForDeployment();
    usdAddress = await testUSD.getAddress();

    const MinterFactory = await ethers.getContractFactory("Minter");
    minter = await upgrades.deployProxy(MinterFactory, [boostAddress, usdAddress, admin.address]);
    await minter.waitForDeployment();
    minterAddress = await minter.getAddress();

    // Mint Boost and TestUSD
    await boost.grantRole(await boost.MINTER_ROLE(), minterAddress);
    await boost.grantRole(await boost.MINTER_ROLE(), boostMinter.address);
    await boost.connect(boostMinter).mint(admin.address, boostDesired);
    await testUSD.connect(boostMinter).mint(admin.address, usdDesired);

    // Create Pool
    factory = await ethers.getContractAt("IFactory", THENA_FACTORY);
    await factory.connect(admin).createPair(boostAddress, usdAddress, true);
    poolAddress = await factory.getPair(boostAddress, usdAddress, true);

    // Get Thena Router
    router = await ethers.getContractAt("IThenaRouter", THENA_ROUTER);
    routerAddress = THENA_ROUTER;

    // create Gauge

    // Setup Gauge
    const gaugeFactory = await ethers.getContractAt("IGaugeFactory", THENA_GAUGE_FACTORY);
    v2Voter = await ethers.getContractAt("IVoterV3", THENA_VOTER);

    // Fund the governor account with enough ETH
    await network.provider.send("hardhat_setBalance", [
      Thena_Governor,
      "0x1000000000000000000"

    ]);

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [Thena_Governor]
    });


    const tokensToWhitelist = [
      boostAddress,
      usdAddress
    ];

    const governorSigner = await ethers.getSigner(Thena_Governor);
    await v2Voter.connect(governorSigner).whitelist(tokensToWhitelist);

    try {
      const governorSigner = await ethers.getSigner(Thena_Governor);

      // Send the transaction
      const tx = await v2Voter.connect(governorSigner).createGauge(poolAddress, 0);

      // Wait for the transaction to be mined
      const receipt = await tx.wait();

      // Directly get the gauge address from the contract after creation
      const gaugeAddress = await v2Voter.gauges(poolAddress);

      console.log("Gauge Address:", gaugeAddress);

      return gaugeAddress;
    } catch (error) {
      console.error("Comprehensive Error:", error);
      throw error;
    }










    // Deploy SolidlyVAMO using upgrades.deployProxy
    const SolidlyV2LiquidityAMOFactory = await ethers.getContractFactory("V2AMO");
    const args = [
      admin.address,
      boostAddress,
      usdAddress,
      0, // SOLIDLY_V2 type
      minterAddress,
      ethers.ZeroAddress, // No factory needed for Solidly
      routerAddress,
      gaugeAddress,
      rewardVault.address,
      0, //tokenId_
      false //useTokenId_
    ].concat(params);

    v2AMO = await upgrades.deployProxy(SolidlyV2LiquidityAMOFactory, args, {
      initializer: 'initialize(address,address,address,uint8,address,address,address,address,address,uint256,bool,uint256,uint24,uint24,uint256,uint256,uint256,uint256)'
      , timeout: 0
    });
    await v2AMO.waitForDeployment();
    amoAddress = await v2AMO.getAddress();

    // provide liquidity
    await boost.approve(routerAddress, boostDesired);
    await testUSD.approve(routerAddress, usdDesired);

    await router.connect(admin).addLiquidity(
      usdAddress,
      boostAddress,
      true,
      usdDesired,
      boostDesired,
      usdMin4Liquidity,
      boostMin4Liquidity,
      amoAddress,
      deadline
    );

    // Deposit LP
    pool = await ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", poolAddress);
    let lpBalance = await pool.balanceOf(amoAddress);
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [amoAddress]
    });
    await setBalance(amoAddress, ethers.parseEther("1"));
    const amoSigner = await ethers.getSigner(amoAddress);
    await pool.connect(amoSigner).approve(gaugeAddress, lpBalance);
    gauge = await ethers.getContractAt("IGauge", gaugeAddress);
    await gauge.connect(amoSigner)["deposit(uint256)"](lpBalance);
    await network.provider.request({
      method: "hardhat_stopImpersonatingAccount",
      params: [amoAddress]
    });

    // Grant Roles
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
  });

  it("should initialize with correct parameters", async function () {
    expect(await v2AMO.boost()).to.equal(boostAddress);
    expect(await v2AMO.usd()).to.equal(usdAddress);
    expect(await v2AMO.boostMinter()).to.equal(minterAddress);
  });


  it("should only allow SETTER_ROLE to call setParams", async function () {
    // Try calling setParams without SETTER_ROLE
    await expect(
      v2AMO.connect(user).setParams(...params)
    ).to.be.revertedWith(`AccessControl: account ${user.address.toLowerCase()} is missing role ${SETTER_ROLE}`);

    // Call setParams with SETTER_ROLE
    await expect(
      v2AMO.connect(setter).setParams(...params)
    ).to.emit(v2AMO, "ParamsSet");
  });

  it("should only allow AMO_ROLE to call mintAndSellBoost", async function () {
    const usdToBuy = ethers.parseUnits("1000000", 6);
    const minBoostReceive = ethers.parseUnits("990000", 18);
    const routeBuyBoost = [{
      from: usdAddress,
      to: boostAddress,
      stable: true
    }];

    await testUSD.connect(admin).mint(user.address, usdToBuy);
    await testUSD.connect(user).approve(routerAddress, usdToBuy);
    await router.connect(user).swapExactTokensForTokens(
      usdToBuy,
      minBoostReceive,
      routeBuyBoost,
      user.address,
      deadline
    );

    const boostAmount = ethers.parseUnits("990000", 18);
    const usdAmount = ethers.parseUnits("990000", 6);

    await expect(
      v2AMO.connect(user).mintAndSellBoost(
        boostAmount,
        usdAmount,
        deadline
      )
    ).to.be.revertedWith(`AccessControl: account ${user.address.toLowerCase()} is missing role ${AMO_ROLE}`);

    await expect(
      v2AMO.connect(amoBot).mintAndSellBoost(
        boostAmount,
        usdAmount,
        deadline
      )
    ).to.emit(v2AMO, "MintSell");
    expect(await v2AMO.boostPrice()).to.be.approximately(ethers.parseUnits("1", 6), delta);
  });


  it("should only allow AMO_ROLE to call addLiquidity", async function () {
    const usdAmountToAdd = ethers.parseUnits("1000", 6);
    const boostMinAmount = ethers.parseUnits("900", 18);
    const usdMinAmount = ethers.parseUnits("900", 6);
    await testUSD.connect(admin).mint(amoAddress, usdAmountToAdd);

    await expect(
      v2AMO.connect(user).addLiquidity(
        usdAmountToAdd,
        boostMinAmount,
        usdMinAmount,
        deadline
      )
    ).to.be.revertedWith(`AccessControl: account ${user.address.toLowerCase()} is missing role ${AMO_ROLE}`);

    await v2AMO.connect(setter).setTokenId(1, true);
    await expect(v2AMO.connect(amoBot).addLiquidity(
      usdAmountToAdd,
      boostMinAmount,
      usdMinAmount,
      deadline
    )).to.be.revertedWithoutReason();
    await v2AMO.connect(setter).setTokenId(0, false);

    await expect(
      v2AMO.connect(amoBot).addLiquidity(
        usdAmountToAdd,
        boostMinAmount,
        usdMinAmount,
        deadline
      )
    ).to.emit(v2AMO, "AddLiquidityAndDeposit");
  });


  it("should only allow PAUSER_ROLE to pause and UNPAUSER_ROLE to unpause", async function () {
    await expect(v2AMO.connect(pauser).pause()).to.emit(v2AMO, "Paused").withArgs(pauser.address);

    await expect(
      v2AMO.connect(amoBot).mintAndSellBoost(
        ethers.parseUnits("1000", 18),
        ethers.parseUnits("950", 6),
        deadline
      )
    ).to.be.revertedWith("Pausable: paused");

    await expect(v2AMO.connect(unpauser).unpause()).to.emit(v2AMO, "Unpaused").withArgs(unpauser.address);
  });

  it("should allow WITHDRAWER_ROLE to withdraw ERC20 tokens", async function () {
    // Transfer some tokens to the contract
    await testUSD.connect(user).mint(amoAddress, ethers.parseUnits("1000", 6));

    // Try withdrawing tokens without WITHDRAWER_ROLE
    await expect(
      v2AMO.connect(user).withdrawERC20(usdAddress, ethers.parseUnits("1000", 6), user.address)
    ).to.be.revertedWith(`AccessControl: account ${user.address.toLowerCase()} is missing role ${WITHDRAWER_ROLE}`);

    // Withdraw tokens with WITHDRAWER_ROLE
    await v2AMO.connect(withdrawer).withdrawERC20(usdAddress, ethers.parseUnits("1000", 6), user.address);
    const usdBalanceOfUser = await testUSD.balanceOf(await user.getAddress());
    expect(usdBalanceOfUser).to.be.equal(ethers.parseUnits("1000", 6));
  });

  it("should execute public mintSellFarm when price above 1", async function () {
    const usdToBuy = ethers.parseUnits("1000000", 6);
    const minBoostReceive = ethers.parseUnits("990000", 18);
    const routeBuyBoost = [{
      from: usdAddress,
      to: boostAddress,
      stable: true
    }];
    await testUSD.connect(admin).mint(user.address, usdToBuy);
    await testUSD.connect(user).approve(routerAddress, usdToBuy);
    await router.connect(user).swapExactTokensForTokens(
      usdToBuy,
      minBoostReceive,
      routeBuyBoost,
      user.address,
      deadline
    );

    expect(await v2AMO.boostPrice()).to.be.gt(ethers.parseUnits("1", 6));

    await expect(v2AMO.connect(user).mintSellFarm()).to.be.emit(v2AMO, "PublicMintSellFarmExecuted");
    expect(await v2AMO.boostPrice()).to.be.approximately(ethers.parseUnits("1", 6), delta);
  });

  it("should correctly return boostPrice", async function () {
    expect(await v2AMO.boostPrice()).to.be.approximately(ethers.parseUnits("1", 6), delta);
  });

  it("should execute public unfarmBuyBurn when price below 1", async function () {
    const boostToBuy = ethers.parseUnits("1000000", 18);
    const minUsdReceive = ethers.parseUnits("990000", 6);
    const routeSellBoost = [{
      from: boostAddress,
      to: usdAddress,
      stable: true
    }];
    await boost.connect(boostMinter).mint(user.address, boostToBuy);
    await boost.connect(user).approve(routerAddress, boostToBuy);
    await router.connect(user).swapExactTokensForTokens(
      boostToBuy,
      minUsdReceive,
      routeSellBoost,
      user.address,
      deadline
    );

    expect(await v2AMO.boostPrice()).to.be.lt(ethers.parseUnits("1", 6));

    await expect(v2AMO.connect(user).unfarmBuyBurn()).to.be.emit(v2AMO, "PublicUnfarmBuyBurnExecuted");
    expect(await v2AMO.boostPrice()).to.be.approximately(ethers.parseUnits("1", 6), delta);
  });

  it("should correctly return boostPrice", async function () {
    expect(await v2AMO.boostPrice()).to.be.approximately(ethers.parseUnits("1", 6), delta);
  });

  describe("should revert when invalid parameters are set", function () {
    for (const i of [1]) {
      it(`param on index ${i}`, async function () {
        let tempParams = [...params];
        tempParams[i] = ethers.parseUnits("1.00001", 6);
        await expect(v2AMO.connect(setter).setParams(...tempParams)
        ).to.be.revertedWithCustomError(v2AMO, "InvalidRatioValue");
      });
    }

    for (const i of [2]) {
      it(`param on index ${i}`, async function () {
        let tempParams = [...params];
        tempParams[i] = ethers.parseUnits("0.99999", 6);
        await expect(v2AMO.connect(setter).setParams(...tempParams)
        ).to.be.revertedWithCustomError(v2AMO, "InvalidRatioValue");
      });
    }
  });
  describe("get reward", async function () {
    const tokens = [];
    it("should revert when token is not whitelisted", async function () {

    });
    it("should revert for non-setter", async function () {
      await expect(v2AMO.connect(user).setWhitelistedTokens(tokens, true)).to.be.revertedWith(
        `AccessControl: account ${user.address.toLowerCase()} is missing role ${SETTER_ROLE}`);
    });
    it("should whitelist tokens", async function () {
      await expect(v2AMO.connect(setter).setWhitelistedTokens(tokens, true)).to.emit(v2AMO, "RewardTokensSet");
    });
    it("should revert for non-reward_collector", async function () {
      await expect(v2AMO.connect(user).getReward(tokens, true)).to.be.revertedWith(
        `AccessControl: account ${user.address.toLowerCase()} is missing role ${REWARD_COLLECTOR_ROLE}`);
    });
    it("should get reward", async function () {
      await expect(v2AMO.connect(rewardCollector).getReward(tokens, true)).to.emit(v2AMO, "GetReward");
    });
  });
});
