import { expect } from "chai";
import { ethers, network, upgrades } from "hardhat";
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
    IERC20,
    IPoolFactory,
    IVRouter,
    IVeloVoter

} from "../../../typechain-types";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";

describe("V2AMO", function () {
    // Common variables for both pool types
    let v2AMO: V2AMO;
    let boost: BoostStablecoin;
    let testUSD: MockERC20;
    let minter: Minter;
    let router: MockRouter | IVRouter;
    let v2Voter: IV2Voter | IVeloVoter;
    let factory: IFactory | IPoolFactory;
    let gauge: IGauge;
    let pool: IERC20;



    // Signers
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

    // Roles
    let SETTER_ROLE: string;
    let AMO_ROLE: string;
    let WITHDRAWER_ROLE: string;
    let PAUSER_ROLE: string;
    let UNPAUSER_ROLE: string;
    let REWARD_COLLECTOR_ROLE: string;

    // Constants
    const V2_VOTER = "0xE3D1A117dF7DCaC2eB0AC8219341bAd92f18dAC1";
    const V2_FACTORY = "0xc6366EFD0AF1d09171fe0EBF32c7943BB310832a";
    const VELO_FACTORY = "0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a"; // Add VELO factory address
    const WETH = "0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83";
    const VELO_ROUTER = "0xa062aE8A9c5e11aaA026fc2670B0D65cCc8B2858";
    const AeroPoolFactory = "0x420DD381b31aEf6683db6B902084cB0FFECe40Da";
    const AeroRouter = "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43";
    const AeroForwarder = "0x15e62707FCA7352fbE35F51a8D6b0F8066A05DCc";
    const AeroFactoryRegistry = "0x5C3F18F06CC09CA1910767A34a20F771039E37C0";
    const AeroVoter = "0x16613524e02ad97eDfeF371bC883F2F5d6C480A5";
    const AeroPool = "0xA4e46b4f701c62e14DF11B48dCe76A7d793CD6d7";

    // Amounts and addresses
    const boostDesired = ethers.parseUnits("11000000", 18);
    const usdDesired = ethers.parseUnits("11000000", 6);
    const boostMin4Liquidity = ethers.parseUnits("9990000", 18);
    const usdMin4Liquidity = ethers.parseUnits("9990000", 6);
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
    // Setup functions
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


    async function setupVELO_LIKEEnvironment() {
        try {
            // Real Velodrome v2 addresses
            const VELO_FACTORY = "0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a";
            const VELO_ROUTER = "0xa062aE8A9c5e11aaA026fc2670B0D65cCc8B2858";
            const VELO_VOTER = "0x41C914ee0c7E1A5edCD0295623e6dC557B5aBf3C";

            // Get contracts with proper interfaces
            factory = await ethers.getContractAt("IPoolFactory", VELO_FACTORY);
            router = await ethers.getContractAt("IVRouter", VELO_ROUTER);

            // Sort tokens (required by Velodrome)
            const [token0, token1] = boostAddress.toLowerCase() < usdAddress.toLowerCase()
                ? [boostAddress, usdAddress]
                : [usdAddress, boostAddress];


            // Fund admin with ETH for gas
            await network.provider.send("hardhat_setBalance", [
                admin.address,
                "0x1000000000000000000"
            ]);

            // Create pool through factory
            const createPoolTx = await factory.connect(admin).createPool(
                token0,
                token1,
                true // stable
            );
            const receipt = await createPoolTx.wait();


            // Get pool address through router (more reliable than factory.getPool)
            poolAddress = await router.poolFor(
                token0,
                token1,
                true,
                VELO_FACTORY
            );

            // Approve tokens for router
            await boost.approve(VELO_ROUTER, boostDesired);
            await testUSD.approve(VELO_ROUTER, usdDesired);


            // Setup gauge using real voter
            v2Voter = await ethers.getContractAt("IVeloVoter", VELO_VOTER);

            // Get the governor address from epochGovernor instead of governor
            const epochGovernor = await v2Voter.epochGovernor();
            if (!epochGovernor || epochGovernor === ethers.ZeroAddress) {
                throw new Error("Invalid epoch governor address");
            }

            // Fund and impersonate the epoch governor
            await network.provider.request({
                method: "hardhat_impersonateAccount",
                params: [epochGovernor]
            });
            await network.provider.send("hardhat_setBalance", [
                epochGovernor,
                "0x1000000000000000000"
            ]);
            const governorSigner = await ethers.getSigner(epochGovernor);

            // Create gauge transaction
            const createGaugeTx = await v2Voter.connect(governorSigner).createGauge(
                VELO_FACTORY,
                poolAddress
            );
            await createGaugeTx.wait();

            // Stop impersonating
            await network.provider.request({
                method: "hardhat_stopImpersonatingAccount",
                params: [epochGovernor]
            });

            // Get the gauge address
            gaugeAddress = await v2Voter.gauges(poolAddress);
            if (!gaugeAddress || gaugeAddress === ethers.ZeroAddress) {
                throw new Error("Gauge creation failed - address is zero");
            }

            // Deploy AMO
            const SolidlyV2LiquidityAMOFactory = await ethers.getContractFactory("V2AMO");
            v2AMO = await upgrades.deployProxy(
                SolidlyV2LiquidityAMOFactory,
                [
                    admin.address,
                    boostAddress,
                    usdAddress,
                    1, // VELO_LIKE
                    minterAddress,
                    VELO_FACTORY,
                    VELO_ROUTER,
                    gaugeAddress,
                    rewardVault.address,
                    0,
                    false,
                    params[0],
                    params[1],
                    params[2],
                    params[3],
                    params[4],
                    params[5],
                    params[6]
                ],
                {
                    initializer: 'initialize(address,address,address,uint8,address,address,address,address,address,uint256,bool,uint256,uint24,uint24,uint256,uint256,uint256,uint256)'
                }
            );
            await v2AMO.waitForDeployment();
            amoAddress = await v2AMO.getAddress();


            // Add initial liquidity through router
            await router.addLiquidity(
                token0,
                token1,
                true,
                token0 === boostAddress ? boostDesired : usdDesired,
                token1 === usdAddress ? usdDesired : boostDesired,
                0, // min amounts = 0 for testing
                0,
                amoAddress,
                ethers.MaxUint256
            );

        } catch (error) {
            console.error("Detailed error in setupVELO_LIKEEnvironment:", error);
            console.error("Error details:", error.message);
            throw error;
        }
    }


    async function setupGauge() {
        try {
            v2Voter = await ethers.getContractAt("IV2Voter", V2_VOTER);
            const governor = await v2Voter.governor();
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

            await network.provider.request({
                method: "hardhat_stopImpersonatingAccount",
                params: [governor]
            });
            gaugeAddress = await v2Voter.gauges(poolAddress);
        } catch (error) {
            console.error("Error in setupGauge:", error);
            throw error;
        }
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
        await gauge.connect(amoSigner)["deposit(uint256)"](lpBalance);
        await network.provider.request({
            method: "hardhat_stopImpersonatingAccount",
            params: [amoAddress]
        });
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

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: "https://optimism.rpc.subquery.network/public",
                        blockNumber: 128216000, // Optional: specify a block number
                    }
                }
            ]
        });
    });


    async function provideLiquidityForVelo() {
        // Sort tokens as per Velodrome requirements
        const [token0, token1] = boostAddress.toLowerCase() < usdAddress.toLowerCase()
            ? [boostAddress, usdAddress]
            : [usdAddress, boostAddress];

        // Mint tokens to admin
        await boost.connect(boostMinter).mint(admin.address, boostDesired);
        await testUSD.connect(admin).mint(admin.address, usdDesired);

        // Approve router
        await boost.connect(admin).approve(router.getAddress(), boostDesired);
        await testUSD.connect(admin).approve(router.getAddress(), usdDesired);

        // Add liquidity
        await router.connect(admin).addLiquidity(
            token0,
            token1,
            true, // stable
            token0 === boostAddress ? boostDesired : usdDesired,
            token1 === usdAddress ? usdDesired : boostDesired,
            0, // min amounts = 0 for testing
            0,
            amoAddress,
            ethers.MaxUint256
        );
    }


    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: "https://optimism.rpc.subquery.network/public",
                        blockNumber: 128216000, // Optional: specify a block number
                    }
                }
            ]
        });
    });


    describe("VELO_LIKE Pool Tests", function () {
        beforeEach(async function () {
            await deployBaseContracts();
            await setupVELO_LIKEEnvironment();
            await setupRoles();
        });

        describe("Initialization", () => {
            it("should initialize with correct parameters", async function () {
                expect(await v2AMO.router()).to.equal(VELO_ROUTER);
                expect(await v2AMO.boost()).to.equal(boostAddress);
                expect(await v2AMO.usd()).to.equal(usdAddress);
                expect(await v2AMO.poolType()).to.equal(1); // VELO_LIKE
            });

            it("should use default factory when factory is zero address", async function () {
                const veloRouter = await ethers.getContractAt("IVRouter", VELO_ROUTER);
                const defaultFactory = await veloRouter.defaultFactory();

                const SolidlyV2LiquidityAMOFactory = await ethers.getContractFactory("V2AMO");
                const args = [
                    admin.address,
                    boostAddress,
                    usdAddress,
                    1, // VELO_LIKE
                    minterAddress,
                    ethers.ZeroAddress,
                    VELO_ROUTER, // Use the actual router address
                    gaugeAddress,
                    rewardVault.address,
                    0,
                    false,
                    params[0],
                    params[1],
                    params[2],
                    params[3],
                    params[4],
                    params[5],
                    params[6]
                ];

                const newAMO = await upgrades.deployProxy(
                    SolidlyV2LiquidityAMOFactory,
                    args,
                    {
                        initializer: 'initialize(address,address,address,uint8,address,address,address,address,address,uint256,bool,uint256,uint24,uint24,uint256,uint256,uint256,uint256)'
                    }
                );
                await newAMO.waitForDeployment();
                expect(await newAMO.factory()).to.equal(defaultFactory);
            });

            it("should execute public mintSellFarm when price above 1", async function () {
                // Add initial liquidity first
                const initialBoostAmount = ethers.parseUnits("10000000", 18);
                const initialUsdAmount = ethers.parseUnits("10000000", 6);

                await boost.connect(boostMinter).mint(admin.address, initialBoostAmount);
                await testUSD.connect(admin).mint(admin.address, initialUsdAmount);

                await boost.connect(admin).approve(VELO_ROUTER, initialBoostAmount);
                await testUSD.connect(admin).approve(VELO_ROUTER, initialUsdAmount);

                // Add initial liquidity
                await router.connect(admin).addLiquidity(
                    usdAddress,
                    boostAddress,
                    true,
                    initialUsdAmount,
                    initialBoostAmount,
                    0,
                    0,
                    amoAddress,
                    deadline
                );

                // Grant necessary roles
                await v2AMO.grantRole(AMO_ROLE, user.address);
                await minter.grantRole(await minter.AMO_ROLE(), await v2AMO.getAddress());

                // Push price above peg with larger amount
                const usdToBuy = ethers.parseUnits("5000000", 6);
                await testUSD.connect(admin).mint(user.address, usdToBuy);
                await testUSD.connect(user).approve(VELO_ROUTER, usdToBuy);

                const routeBuyBoost = [{
                    from: usdAddress,
                    to: boostAddress,
                    stable: true,
                    factory: VELO_FACTORY
                }];


                await router.connect(user).swapExactTokensForTokens(
                    usdToBuy,
                    0,
                    routeBuyBoost,
                    user.address,
                    deadline
                );

                const priceAfterSwap = await v2AMO.boostPrice();
                expect(priceAfterSwap).to.be.gt(ethers.parseUnits("1", 6));

                await expect(
                    v2AMO.connect(user).mintSellFarm()
                ).to.emit(v2AMO, "PublicMintSellFarmExecuted");
            });


            it("should correctly return boostPrice", async function () {
                expect(await v2AMO.boostPrice()).to.be.approximately(
                    ethers.parseUnits("1", 6),
                    delta
                );
            });

            it("should execute public unfarmBuyBurn when price below 1", async function () {
                // Grant necessary roles first
                await v2AMO.grantRole(AMO_ROLE, user.address);
                await minter.grantRole(await minter.AMO_ROLE(), await v2AMO.getAddress());

                // Add substantial initial liquidity to AMO
                const initialBoostAmount = ethers.parseUnits("5000000", 18);
                const initialUsdAmount = ethers.parseUnits("5000000", 6);

                // Mint tokens to AMO
                await boost.connect(boostMinter).mint(amoAddress, initialBoostAmount);
                await testUSD.connect(admin).mint(amoAddress, initialUsdAmount);

                // Impersonate AMO
                await network.provider.request({
                    method: "hardhat_impersonateAccount",
                    params: [amoAddress]
                });
                const amoSigner = await ethers.getSigner(amoAddress);
                await network.provider.send("hardhat_setBalance", [
                    amoAddress,
                    "0x1000000000000000000"
                ]);

                // Approve and add liquidity
                await boost.connect(amoSigner).approve(VELO_ROUTER, initialBoostAmount);
                await testUSD.connect(amoSigner).approve(VELO_ROUTER, initialUsdAmount);

                const addLiquidityTx = await router.connect(amoSigner).addLiquidity(
                    usdAddress,
                    boostAddress,
                    true,
                    initialUsdAmount,
                    initialBoostAmount,
                    0,
                    0,
                    amoAddress,
                    deadline
                );
                await addLiquidityTx.wait();

                // Get pool and approve for gauge
                const pool = await ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", poolAddress);
                const lpBalance = await pool.balanceOf(amoAddress);

                // Approve and deposit to gauge
                await pool.connect(amoSigner).approve(gaugeAddress, lpBalance);
                const gauge = await ethers.getContractAt("IGauge", gaugeAddress);
                await gauge.connect(amoSigner)["deposit(uint256)"](lpBalance);

                // Stop impersonating AMO
                await network.provider.request({
                    method: "hardhat_stopImpersonatingAccount",
                    params: [amoAddress]
                });

                // Push price below peg
                const boostToBuy = ethers.parseUnits("3000000", 18);
                await boost.connect(boostMinter).mint(user.address, boostToBuy);
                await boost.connect(user).approve(VELO_ROUTER, boostToBuy);

                const routeSellBoost = [{
                    from: boostAddress,
                    to: usdAddress,
                    stable: true,
                    factory: VELO_FACTORY
                }];


                await router.connect(user).swapExactTokensForTokens(
                    boostToBuy,
                    0,
                    routeSellBoost,
                    user.address,
                    deadline
                );

                const priceAfterSwap = await v2AMO.boostPrice();

                // Verify price is below peg
                expect(priceAfterSwap).to.be.lt(ethers.parseUnits("1", 6));
                // Execute unfarmBuyBurn
                await expect(
                    v2AMO.connect(user).unfarmBuyBurn()
                ).to.emit(v2AMO, "PublicUnfarmBuyBurnExecuted");
            });



            it("should correctly return boostPrice after operations", async function () {
                expect(await v2AMO.boostPrice()).to.be.approximately(
                    ethers.parseUnits("1", 6),
                    delta
                );
            });
        });




        describe("Price and Reserve Functions", function () {
            it("should calculate BOOST price correctly with Velo router", async function () {
                const price = await v2AMO.boostPrice();

                // Price should be close to 1 USD initially
                expect(price).to.be.closeTo(
                    ethers.parseUnits("1", 6),
                    ethers.parseUnits("0.01", 6)
                );
            });

            it("should return correct reserves using Velo router", async function () {
                const [boostReserve, usdReserve] = await v2AMO.getReserves();


                // Both reserves should be in boost decimals (18)
                // No need to normalize since getReserves already handles scaling
                expect(boostReserve).to.equal(usdReserve);

                // Verify reserves are non-zero
                expect(boostReserve).to.be.gt(0);
                expect(usdReserve).to.be.gt(0);
            });




            it("should validate swaps correctly", async function () {
                // Provide initial liquidity first
                await provideLiquidityForVelo();

                await v2AMO.grantRole(AMO_ROLE, admin.address);
                await minter.grantRole(await minter.AMO_ROLE(), v2AMO.getAddress());

                const [boostReserve, usdReserve] = await v2AMO.getReserves();

                if (boostReserve < usdReserve) {
                    await expect(
                        v2AMO.connect(admin).mintAndSellBoost(
                            ethers.parseUnits("100000", 18)
                        )
                    ).to.not.be.reverted;
                }
            });
        });




        describe("Swap Operations", () => {

            it("should only allow AMO_ROLE to call mintAndSellBoost", async function () {
                // Add initial liquidity first
                const initialBoostAmount = ethers.parseUnits("5000000", 18);
                const initialUsdAmount = ethers.parseUnits("5000000", 6);

                await boost.connect(boostMinter).mint(admin.address, initialBoostAmount);
                await testUSD.connect(admin).mint(admin.address, initialUsdAmount);

                await boost.connect(admin).approve(VELO_ROUTER, initialBoostAmount);
                await testUSD.connect(admin).approve(VELO_ROUTER, initialUsdAmount);

                // Add initial liquidity
                await router.connect(admin).addLiquidity(
                    usdAddress,
                    boostAddress,
                    true,
                    initialUsdAmount,
                    initialBoostAmount,
                    0,
                    0,
                    admin.address,
                    deadline
                );

                // Push price above peg with larger amounts
                const usdToBuy = ethers.parseUnits("3000000", 6); // Increased amount
                const swapAmount = usdToBuy / 3n; // Split into three parts using BigInt division

                await testUSD.connect(admin).mint(admin.address, usdToBuy);
                await testUSD.connect(admin).approve(VELO_ROUTER, usdToBuy);

                const routes = [{
                    from: usdAddress,
                    to: boostAddress,
                    stable: true,
                    factory: VELO_FACTORY
                }];


                // Execute multiple swaps to push price higher
                for (let i = 0; i < 3; i++) {
                    await router.connect(admin).swapExactTokensForTokens(
                        swapAmount,
                        0,
                        routes,
                        admin.address,
                        deadline
                    );
                }

                const finalPrice = await v2AMO.boostPrice();
                expect(finalPrice).to.be.gt(ethers.parseUnits("1", 6));

                // Test mintAndSellBoost
                const boostAmount = ethers.parseUnits("990000", 18);

                // Grant necessary roles
                await v2AMO.grantRole(AMO_ROLE, amoBot.address);
                await minter.grantRole(await minter.AMO_ROLE(), await v2AMO.getAddress());

                // Test unauthorized access
                await expect(
                    v2AMO.connect(user).mintAndSellBoost(boostAmount)
                ).to.be.revertedWith(
                    `AccessControl: account ${user.address.toLowerCase()} is missing role ${AMO_ROLE}`
                );

                // Test authorized access
                await expect(
                    v2AMO.connect(amoBot).mintAndSellBoost(boostAmount)
                ).to.emit(v2AMO, "MintSell");
            });

        });

        describe("Liquidity Operations", () => {

            it("should add liquidity with VELO factory", async function () {
                const usdAmountToAdd = ethers.parseUnits("1000", 6);
                const boostMinAmount = ethers.parseUnits("900", 18);
                const usdMinAmount = ethers.parseUnits("900", 6);

                await testUSD.connect(admin).mint(amoAddress, usdAmountToAdd);

                await expect(
                    v2AMO.connect(amoBot).addLiquidity(
                        usdAmountToAdd,
                        boostMinAmount,
                        usdMinAmount
                    )
                ).to.emit(v2AMO, "AddLiquidityAndDeposit");
            });

            it("should validate pool reserves correctly", async function () {
                const [boostReserve, usdReserve] = await v2AMO.getReserves();
                expect(boostReserve).to.be.gt(0);
                expect(usdReserve).to.be.gt(0);
            });
        });

        describe("Reward Collection", () => {
            it("should handle VELO_LIKE specific getReward", async function () {
                const tokens: string[] = [];
                await v2AMO.connect(setter).setWhitelistedTokens(tokens, true);

                await expect(
                    v2AMO.connect(rewardCollector).getReward(tokens, true)
                ).to.emit(v2AMO, "GetReward");
            });

            it("should collect rewards without token list in VELO_LIKE mode", async function () {
                await expect(
                    v2AMO.connect(rewardCollector).getReward([], false)
                ).to.emit(v2AMO, "GetReward");
            });
        });

        describe("Access Control", () => {
            it("should maintain role restrictions for VELO operations", async function () {
                const usdAmountToAdd = ethers.parseUnits("1000", 6);
                const boostMinAmount = ethers.parseUnits("900", 18);
                const usdMinAmount = ethers.parseUnits("900", 6);

                await testUSD.connect(admin).mint(amoAddress, usdAmountToAdd);

                await expect(
                    v2AMO.connect(user).addLiquidity(
                        usdAmountToAdd,
                        boostMinAmount,
                        usdMinAmount
                    )
                ).to.be.revertedWith(
                    `AccessControl: account ${user.address.toLowerCase()} is missing role ${AMO_ROLE}`
                );
            });

            it("should enforce reward collector role for VELO rewards", async function () {
                await expect(
                    v2AMO.connect(user).getReward([], true)
                ).to.be.revertedWith(
                    `AccessControl: account ${user.address.toLowerCase()} is missing role ${REWARD_COLLECTOR_ROLE}`
                );
            });

            it("should restrict setter role operations", async function () {
                const usdAmountToAdd = ethers.parseUnits("1000", 6);
                const boostMinAmount = ethers.parseUnits("900", 18);
                const usdMinAmount = ethers.parseUnits("900", 6);

                await testUSD.connect(admin).mint(amoAddress, usdAmountToAdd);

                await expect(
                    v2AMO.connect(setter).addLiquidity(
                        usdAmountToAdd,
                        boostMinAmount,
                        usdMinAmount
                    )
                ).to.be.revertedWith(
                    `AccessControl: account ${setter.address.toLowerCase()} is missing role ${AMO_ROLE}`
                );
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

            it("should restrict withdrawer role operations", async function () {
                const usdAmountToAdd = ethers.parseUnits("1000", 6);
                const boostMinAmount = ethers.parseUnits("900", 18);
                const usdMinAmount = ethers.parseUnits("900", 6);

                await testUSD.connect(admin).mint(amoAddress, usdAmountToAdd);

                await expect(
                    v2AMO.connect(withdrawer).addLiquidity(
                        usdAmountToAdd,
                        boostMinAmount,
                        usdMinAmount
                    )
                ).to.be.revertedWith(
                    `AccessControl: account ${withdrawer.address.toLowerCase()} is missing role ${AMO_ROLE}`
                );
            });
        });


        describe("Liquidity Operations with Factory", () => {
            it("should add liquidity using correct factory", async function () {
                const usdAmountToAdd = ethers.parseUnits("1000", 6);
                const boostMinAmount = ethers.parseUnits("900", 18);
                const usdMinAmount = ethers.parseUnits("900", 6);

                await testUSD.connect(admin).mint(amoAddress, usdAmountToAdd);

                await expect(
                    v2AMO.connect(amoBot).addLiquidity(
                        usdAmountToAdd,
                        boostMinAmount,
                        usdMinAmount
                    )
                ).to.emit(v2AMO, "AddLiquidityAndDeposit");
            });
        });

    });

});
