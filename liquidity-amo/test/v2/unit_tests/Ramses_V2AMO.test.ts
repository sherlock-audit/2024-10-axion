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
    IGauge,
    IERC20
} from "../../../typechain-types";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";



describe("V2AMO", function () {
    let v2AMO: V2AMO;
    let boost: BoostStablecoin;
    let testUSD: MockERC20;
    let minter: Minter;
    let router: MockRouter;
    let v2Voter: IV2Voter;
    let factory: IFactory;
    let gauge: IGauge;
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

    const V2_VOTER = "0xAAA2564DEb34763E3d05162ed3f5C2658691f499"; // Rmases DEX Voter
    const V2_FACTORY = "0xAAA20D08e59F6561f242b08513D36266C5A29415"; // Ramses DEX PairFactory
    const WETH = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"; // Wrapped ArbOne
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


    async function deployBaseContracts() {
        [admin, rewardVault, setter, amoBot, withdrawer, pauser, unpauser, boostMinter, user, rewardCollector]
            = await ethers.getSigners();

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

        // Mint tokens
        await boost.grantRole(await boost.MINTER_ROLE(), minterAddress);
        await boost.grantRole(await boost.MINTER_ROLE(), boostMinter.address);
        await boost.connect(boostMinter).mint(admin.address, boostDesired);
        await testUSD.connect(boostMinter).mint(admin.address, usdDesired);
    }

    async function setupSolidlyV2Environment() {
        // Create Pool
        factory = await ethers.getContractAt("IFactory", V2_FACTORY);
        await factory.connect(admin).createPair(boostAddress, usdAddress, true);
        poolAddress = await factory.getPair(boostAddress, usdAddress, true);

        // Deploy Router
        const RouterFactory = await ethers.getContractFactory("MockRouter");
        router = await RouterFactory.deploy(V2_FACTORY, WETH);
        await router.waitForDeployment();
        routerAddress = await router.getAddress();


        await setupGauge();

        // Deploy AMO
        const SolidlyV2LiquidityAMOFactory = await ethers.getContractFactory("V2AMO");
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
                gaugeAddress,
                rewardVault.address,
                0, // tokenId
                false, // useTokenId
                ethers.parseUnits("1.1", 6), // boostMultiplier
                ethers.parseUnits("0.01", 6), // validRangeWidth
                ethers.parseUnits("1.01", 6), // validRemovingRatio
                ethers.parseUnits("0.99", 6), // boostLowerPriceSell
                ethers.parseUnits("1.01", 6), // boostUpperPriceBuy
                ethers.parseUnits("0.8", 6), // boostSellRatio
                ethers.parseUnits("0.8", 6) // usdBuyRatio
            ],
            {
                initializer: 'initialize(address,address,address,uint8,address,address,address,address,address,uint256,bool,uint256,uint24,uint24,uint256,uint256,uint256,uint256)'
                , timeout: 0

            }
        );
        await v2AMO.waitForDeployment();
        amoAddress = await v2AMO.getAddress();
    }


    async function setupGauge() {
        // create Gauge
        v2Voter = await ethers.getContractAt("IV2Voter", V2_VOTER);
        const governor = await v2Voter.governor();

        // Fund the governor account with enough ETH
        await network.provider.send("hardhat_setBalance", [
            governor,
            "0x1000000000000000000"

        ]);

        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [governor]
        });

        const governorSigner = await ethers.getSigner(governor);

        // Check if gauge already exists
        const existingGauge = await v2Voter.gauges(poolAddress);
        if (existingGauge === ethers.ZeroAddress) {
            await v2Voter.connect(governorSigner).createGauge(poolAddress);
        }
        // await v2Voter.connect(governorSigner).createGauge(poolAddress);

        await network.provider.request({
            method: "hardhat_stopImpersonatingAccount",
            params: [governor]
        });
        gaugeAddress = await v2Voter.gauges(poolAddress);
    }

    async function provideLiquidity() {
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
        await gauge.connect(amoSigner)["deposit(uint256,uint256)"](lpBalance, 0);
        await network.provider.request({
            method: "hardhat_stopImpersonatingAccount",
            params: [amoAddress]
        });
    }

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: "https://arbitrum-one-rpc.publicnode.com",
                        blockNumber: 278220000 // Optional: specify a block number
                    }
                }
            ]
        });
    });


    describe("SolidlyV2 Pool Tests", function () {
        beforeEach(async function () {
            await deployBaseContracts();
            await setupSolidlyV2Environment();
            await setupGauge();
            await provideLiquidity();
            await depositToGauge();
            await setupRoles();
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
            // First verify initial price
            const initialPrice = await v2AMO.boostPrice();
            expect(initialPrice).to.be.approximately(
                ethers.parseUnits("1", 6),
                ethers.parseUnits("0.001", 6)
            );

            // Create larger imbalance to ensure price moves above 1
            const usdToBuy = ethers.parseUnits("2000000", 6); // Increased amount
            await testUSD.connect(admin).mint(user.address, usdToBuy);
            await testUSD.connect(user).approve(routerAddress, usdToBuy);

            const routeBuyBoost = [{
                from: usdAddress,
                to: boostAddress,
                stable: true
            }];

            await router.connect(user).swapExactTokensForTokens(
                usdToBuy,
                0, // min amount out
                routeBuyBoost,
                user.address,
                deadline
            );

            // Verify price is above peg
            const priceAfterSwap = await v2AMO.boostPrice();
            expect(priceAfterSwap).to.be.gt(ethers.parseUnits("1", 6));

            // Test mintAndSellBoost
            const boostAmount = ethers.parseUnits("1500000", 18); // Adjusted amount

            await v2AMO.grantRole(AMO_ROLE, amoBot.address);
            await minter.grantRole(await minter.AMO_ROLE(), await v2AMO.getAddress());

            await expect(
                v2AMO.connect(user).mintAndSellBoost(boostAmount)
            ).to.be.revertedWith(
                `AccessControl: account ${user.address.toLowerCase()} is missing role ${AMO_ROLE}`
            );

            await expect(
                v2AMO.connect(amoBot).mintAndSellBoost(boostAmount)
            ).to.emit(v2AMO, "MintSell");
        });



        it("should only allow AMO_ROLE to call addLiquidity", async function () {
            const usdAmountToAdd = ethers.parseUnits("1000", 6);
            const boostMinAmount = ethers.parseUnits("900", 18);
            const usdMinAmount = ethers.parseUnits("900", 6);

            await testUSD.connect(admin).mint(amoAddress, usdAmountToAdd);

            // Test with non-AMO role (user)
            await expect(
                v2AMO.connect(user).addLiquidity(
                    usdAmountToAdd,
                    boostMinAmount,
                    usdMinAmount
                )
            ).to.be.revertedWith(
                `AccessControl: account ${user.address.toLowerCase()} is missing role ${AMO_ROLE}`
            );

            // Test with tokenId set
            await v2AMO.connect(setter).setTokenId(1, true);
            await expect(
                v2AMO.connect(amoBot).addLiquidity(
                    usdAmountToAdd,
                    boostMinAmount,
                    usdMinAmount
                )
            ).to.be.revertedWithoutReason();

            await v2AMO.connect(setter).setTokenId(0, false);

            // Test with AMO role
            await expect(
                v2AMO.connect(amoBot).addLiquidity(
                    usdAmountToAdd,
                    boostMinAmount,
                    usdMinAmount
                )
            ).to.emit(v2AMO, "AddLiquidityAndDeposit");
        });



        it("should only allow PAUSER_ROLE to pause and UNPAUSER_ROLE to unpause", async function () {
            // Grant roles
            await v2AMO.grantRole(AMO_ROLE, amoBot.address);
            await v2AMO.grantRole(PAUSER_ROLE, pauser.address);
            await v2AMO.grantRole(UNPAUSER_ROLE, unpauser.address);

            // Test pause
            await expect(
                v2AMO.connect(pauser).pause()
            ).to.emit(v2AMO, "Paused")
                .withArgs(pauser.address);

            // Test operation while paused
            const boostAmount = ethers.parseUnits("1000", 18);
            await expect(
                v2AMO.connect(amoBot).mintAndSellBoost(boostAmount)
            ).to.be.revertedWith("Pausable: paused");

            // Test unpause
            await expect(
                v2AMO.connect(unpauser).unpause()
            ).to.emit(v2AMO, "Unpaused")
                .withArgs(unpauser.address);
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
            // Create price imbalance
            const usdToBuy = ethers.parseUnits("2000000", 6);
            await testUSD.connect(admin).mint(user.address, usdToBuy);
            await testUSD.connect(user).approve(routerAddress, usdToBuy);

            const routeBuyBoost = [{
                from: usdAddress,
                to: boostAddress,
                stable: true
            }];

            // Create imbalance
            await router.connect(user).swapExactTokensForTokens(
                usdToBuy,
                0,
                routeBuyBoost,
                user.address,
                deadline
            );

            // Grant necessary permissions
            await minter.grantRole(await minter.AMO_ROLE(), v2AMO.getAddress());

            const priceBeforeOperation = await v2AMO.boostPrice();
            console.log("Price before operation:", priceBeforeOperation.toString());
            expect(priceBeforeOperation).to.be.gt(ethers.parseUnits("1", 6));

            // Execute mintSellFarm
            await expect(v2AMO.connect(user).mintSellFarm())
                .to.emit(v2AMO, "PublicMintSellFarmExecuted");
        });





        it("should execute public unfarmBuyBurn when price below 1", async function () {
            // Create larger imbalance
            const boostToBuy = ethers.parseUnits("2000000", 18); // Increased amount
            await boost.connect(boostMinter).mint(user.address, boostToBuy);
            await boost.connect(user).approve(routerAddress, boostToBuy);

            const routeSellBoost = [{
                from: boostAddress,
                to: usdAddress,
                stable: true
            }];

            await router.connect(user).swapExactTokensForTokens(
                boostToBuy,
                0, // No minimum for test
                routeSellBoost,
                user.address,
                deadline
            );

            const priceBeforeOperation = await v2AMO.boostPrice();
            expect(priceBeforeOperation).to.be.lt(ethers.parseUnits("1", 6));

            await expect(v2AMO.connect(user).unfarmBuyBurn())
                .to.emit(v2AMO, "PublicUnfarmBuyBurnExecuted")

            it("should correctly return boostPrice", async function () {
                expect(await v2AMO.boostPrice()).to.be.approximately(ethers.parseUnits("1", 6), delta);
            });
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
});
