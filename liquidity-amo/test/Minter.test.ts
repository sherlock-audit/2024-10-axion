import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { ContractFactory } from "ethers";
import { Minter, BoostStablecoin, MockERC20, MockMinterCaller } from "../typechain-types"; // Adjust the import paths according to your setup
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("Minter Contract Tests", function() {
  let MockERC20Contract: ContractFactory;

  let minterContract: Minter;
  let collateralToken: MockERC20;
  let boostToken: BoostStablecoin;
  let minterCallerWithMinterRole: MockMinterCaller;
  let minterCallerWithAmoRole: MockMinterCaller;
  let minterCaller: MockMinterCaller;

  let owner: SignerWithAddress;
  let admin: SignerWithAddress;
  let treasury: SignerWithAddress;
  let pauser: SignerWithAddress;
  let unpauser: SignerWithAddress;
  let minterAddress: SignerWithAddress;
  let amo: SignerWithAddress;
  let user: SignerWithAddress;
  let withdrawer: SignerWithAddress;

  let pauserRole: any;
  let unpauserRole: any;
  let minterRole: any;
  let adminRole: any;
  let AMORole: any;
  let withdrawTokenRole: any;

  beforeEach(async function() {
    // Get signers
    [owner, admin, treasury, pauser, unpauser, minterAddress, amo, withdrawer, user] = await ethers.getSigners();

    // Deploy the mock ERC20 token for collateral
    MockERC20Contract = await ethers.getContractFactory("MockERC20");
    collateralToken = (await MockERC20Contract.deploy("Collateral Token", "COL", 6)) as MockERC20;
    await collateralToken.waitForDeployment();
    // Deploy the BOOSTStablecoin contract
    const BOOSTStablecoin = await ethers.getContractFactory("BoostStablecoin", owner);
    boostToken = (
      await upgrades.deployProxy(BOOSTStablecoin, [admin.address], { initializer: "initialize" })
    ) as unknown as BoostStablecoin;
    await boostToken.waitForDeployment();

    // Deploy the Minter contract
    const Minter = await ethers.getContractFactory("Minter", owner);
    minterContract = (await upgrades.deployProxy(Minter, [
      await boostToken.getAddress(),
      await collateralToken.getAddress(),
      treasury.address
    ], { initializer: "initialize" })) as unknown as Minter;
    await minterContract.waitForDeployment();

    // Deploy the ExternalCaller contract
    const TestMinterCaller = await ethers.getContractFactory("MockMinterCaller");
    minterCaller = await TestMinterCaller.deploy(await minterContract.getAddress(), await boostToken.getAddress(), await collateralToken.getAddress());
    await minterCaller.waitForDeployment();
    minterCallerWithMinterRole = await TestMinterCaller.deploy(await minterContract.getAddress(), await boostToken.getAddress(), await collateralToken.getAddress());
    await minterCallerWithMinterRole.waitForDeployment();
    minterCallerWithAmoRole = await TestMinterCaller.deploy(await minterContract.getAddress(), await boostToken.getAddress(), await collateralToken.getAddress());
    await minterCallerWithAmoRole.waitForDeployment();

    pauserRole = await minterContract.PAUSER_ROLE();
    unpauserRole = await minterContract.UNPAUSER_ROLE();
    minterRole = await minterContract.MINTER_ROLE();
    adminRole = await minterContract.ADMIN_ROLE();
    AMORole = await minterContract.AMO_ROLE();
    withdrawTokenRole = await minterContract.WITHDRAWER_ROLE();

    // Grant roles
    await minterContract.connect(owner).grantRole(pauserRole, pauser.address);
    await minterContract.connect(owner).grantRole(unpauserRole, unpauser.address);
    await minterContract.connect(owner).grantRole(minterRole, minterAddress.address);
    await minterContract.connect(owner).grantRole(minterRole, await minterCallerWithMinterRole.getAddress());
    await minterContract.connect(owner).grantRole(adminRole, admin.address);
    await minterContract.connect(owner).grantRole(AMORole, await minterCallerWithAmoRole.getAddress());
    await minterContract.connect(owner).grantRole(AMORole, amo.address);
    await minterContract.connect(owner).grantRole(withdrawTokenRole, withdrawer);

    await boostToken.connect(admin).grantRole(await boostToken.MINTER_ROLE(), minterContract.getAddress());
  });

  describe("Initializing", function() {
    it("Should set initial state correctly", async function() {
      expect(await minterContract.boostAddress()).to.equal(await boostToken.getAddress());
      expect(await minterContract.collateralAddress()).to.equal(await collateralToken.getAddress());
      expect(await minterContract.treasury()).to.equal(await treasury.address);
    });
  });

  describe("Setting", function() {
    it("Should allow setting tokens addresses by admin", async function() {
      const newCollateralToken = await MockERC20Contract.deploy("New Collateral Token", "NEWCOL", 6);
      await newCollateralToken.waitForDeployment();
      await minterContract.connect(admin).setTokens(boostToken.getAddress(), newCollateralToken.getAddress());
      expect(await minterContract.collateralAddress()).to.equal(await newCollateralToken.getAddress());
    });

    it("Should allow setting the treasury address by admin", async function() {
      expect(await minterContract.treasury()).to.equal(treasury.address);
      await minterContract.connect(admin).setTreasury(user.address);
      expect(await minterContract.treasury()).to.equal(user.address);
    });
  });

  describe("Minting", function() {
    it("Should allow minter to mint", async function() {
      expect(await boostToken.balanceOf(user.address)).to.equal(0);
      const mintAmount = ethers.parseUnits("1", 18);
      const collateralAmount = ethers.parseUnits("1", 6);

      expect(await collateralToken.balanceOf(minterAddress.address)).to.equal(0);
      await collateralToken.mint(minterAddress.address, collateralAmount);
      expect(await collateralToken.balanceOf(minterAddress.address)).to.equal(collateralAmount);
      await collateralToken.connect(minterAddress).approve(minterCallerWithMinterRole.getAddress(), collateralAmount);

      await expect(minterCallerWithMinterRole.connect(minterAddress).testMint(minterAddress.address, mintAmount)).to.emit(minterContract, "TokenMinted");
      expect(await boostToken.balanceOf(minterAddress.address)).to.equal(mintAmount);
      expect(await collateralToken.balanceOf(minterAddress.address)).to.equal(0);
    });

    it("Should not allow minter to mint when paused", async function() {
      expect(await boostToken.balanceOf(user.address)).to.equal(0);
      const mintAmount = ethers.parseUnits("1", 18);

      expect(await collateralToken.balanceOf(minterAddress.address)).to.equal(0);
      await collateralToken.mint(minterAddress.address, mintAmount);
      expect(await collateralToken.balanceOf(minterAddress.address)).to.equal(mintAmount);
      await collateralToken.connect(minterAddress).approve(minterContract.getAddress(), mintAmount);

      await minterContract.connect(pauser).pause();

      await expect(minterContract.connect(minterAddress).mint(minterAddress.address, mintAmount)).to.be.revertedWith("Pausable: paused");
      expect(await boostToken.balanceOf(minterAddress.address)).to.equal(0);
      expect(await collateralToken.balanceOf(minterAddress.address)).to.equal(mintAmount);
    });

    it("Should allow AMO to plotocol mint", async function() {
      expect(await boostToken.balanceOf(user.address)).to.equal(0);
      const mintAmount = ethers.parseUnits("1", 18);
      await minterCallerWithAmoRole.connect(amo).testProtocolMint(user.address, mintAmount);
      expect(await boostToken.balanceOf(user.address)).to.equal(mintAmount);
    });

    it("Should not allow AMO to protocol mint when paused", async function() {
      expect(await boostToken.balanceOf(user.address)).to.equal(0);
      const mintAmount = ethers.parseUnits("1", 18);
      await minterContract.connect(pauser).pause();
      await expect(minterContract.connect(amo).protocolMint(user.address, mintAmount)).to.be.revertedWith("Pausable: paused");
      expect(await boostToken.balanceOf(user.address)).to.equal(0);
    });

    it("Should not allow non-contract to protocol mint", async function() {
      expect(await boostToken.balanceOf(user.address)).to.equal(0);
      const mintAmount = ethers.parseUnits("1", 18);
      await expect(minterContract.connect(owner).protocolMint(user.address, mintAmount)).to.be.revertedWithCustomError(minterContract, "NonContractSender");
      await expect(minterContract.connect(minterAddress).protocolMint(user.address, mintAmount)).to.be.revertedWithCustomError(minterContract, "NonContractSender");
      await expect(minterContract.connect(amo).protocolMint(user.address, mintAmount)).to.be.revertedWithCustomError(minterContract, "NonContractSender");
      expect(await boostToken.balanceOf(user.address)).to.equal(0);
    });

    it("Should not allow non-contract to mint", async function() {
      expect(await boostToken.balanceOf(user.address)).to.equal(0);
      const mintAmount = ethers.parseUnits("1", 18);
      await expect(minterContract.connect(owner).mint(user.address, mintAmount)).to.be.revertedWithCustomError(minterContract, "NonContractSender");
      await expect(minterContract.connect(amo).mint(user.address, mintAmount)).to.be.revertedWithCustomError(minterContract, "NonContractSender");
      await expect(minterContract.connect(minterAddress).mint(user.address, mintAmount)).to.be.revertedWithCustomError(minterContract, "NonContractSender");
      expect(await boostToken.balanceOf(user.address)).to.equal(0);
    });

    it("Should not allow non-amo contracts to protocol mint", async function() {
      expect(await boostToken.balanceOf(user.address)).to.equal(0);
      const mintAmount = ethers.parseUnits("1", 18);
      let revertMessage = `AccessControl: account ${(await minterCallerWithMinterRole.getAddress()).toLowerCase()} is missing role ${AMORole}`;
      await expect(minterCallerWithMinterRole.connect(minterAddress).testProtocolMint(user.address, mintAmount)).to.be.revertedWith(revertMessage);

      revertMessage = `AccessControl: account ${(await minterCaller.getAddress()).toLowerCase()} is missing role ${AMORole}`;
      await expect(minterCaller.connect(minterAddress).testProtocolMint(user.address, mintAmount)).to.be.revertedWith(revertMessage);
      expect(await boostToken.balanceOf(user.address)).to.equal(0);
    });

    it("Should not allow non-minter contracts to mint", async function() {
      expect(await boostToken.balanceOf(user.address)).to.equal(0);
      const mintAmount = ethers.parseUnits("1", 18);
      await collateralToken.mint(minterAddress.address, mintAmount);

      await collateralToken.connect(minterAddress).approve(await minterCallerWithAmoRole.getAddress(), mintAmount);
      let revertMessage = `AccessControl: account ${(await minterCallerWithAmoRole.getAddress()).toLowerCase()} is missing role ${minterRole}`;
      await expect(minterCallerWithAmoRole.connect(minterAddress).testMint(user.address, mintAmount)).to.be.revertedWith(revertMessage);

      await collateralToken.connect(minterAddress).approve(await minterCaller.getAddress(), mintAmount);
      revertMessage = `AccessControl: account ${(await minterCaller.getAddress()).toLowerCase()} is missing role ${minterRole}`;
      await expect(minterCaller.connect(minterAddress).testMint(user.address, mintAmount)).to.be.revertedWith(revertMessage);
      expect(await boostToken.balanceOf(user.address)).to.equal(0);
    });
  });

  describe("Pausing and Unpausing", function() {
    it("Should pause and unpause the contract", async function() {
      await minterContract.connect(pauser).pause();

      expect(await minterContract.paused()).to.equal(true);

      await minterContract.connect(unpauser).unpause();
      expect(await minterContract.paused()).to.equal(false);
    });
  });

  describe("Withdraw", function() {
    it("Should allow withdrawer to withdraw token", async function() {
      const newToken = (await MockERC20Contract.deploy("New Token", "Token", 6)) as MockERC20;
      await newToken.waitForDeployment();

      const mintAmount = ethers.parseUnits("100", 6);
      await newToken.mint(minterContract.getAddress(), mintAmount);
      expect(await newToken.balanceOf(minterContract.getAddress())).to.be.equal(mintAmount);

      expect(await newToken.balanceOf(treasury.address)).to.be.equal(0);
      await minterContract.connect(withdrawer).withdrawToken(newToken.getAddress(), mintAmount);
      expect(await newToken.balanceOf(treasury.address)).to.be.equal(mintAmount);
    });

    it("Should not allow others to withdraw token", async function() {
      const newToken = (await MockERC20Contract.deploy("New Token", "Token", 6)) as MockERC20;
      await newToken.waitForDeployment();

      const mintAmount = ethers.parseUnits("100", 6);
      await newToken.mint(minterContract.getAddress(), mintAmount);
      expect(await newToken.balanceOf(minterContract.getAddress())).to.be.equal(mintAmount);
      expect(await newToken.balanceOf(treasury.address)).to.be.equal(0);

      let reverteMessage = `AccessControl: account ${owner.address.toLowerCase()} is missing role ${withdrawTokenRole}`;
      await expect(minterContract.connect(owner).withdrawToken(newToken.getAddress(), mintAmount)).to.be.revertedWith(reverteMessage);

      reverteMessage = `AccessControl: account ${admin.address.toLowerCase()} is missing role ${withdrawTokenRole}`;
      await expect(minterContract.connect(admin).withdrawToken(newToken.getAddress(), mintAmount)).to.be.revertedWith(reverteMessage);

      reverteMessage = `AccessControl: account ${pauser.address.toLowerCase()} is missing role ${withdrawTokenRole}`;
      await expect(minterContract.connect(pauser).withdrawToken(newToken.getAddress(), mintAmount)).to.be.revertedWith(reverteMessage);

      reverteMessage = `AccessControl: account ${unpauser.address.toLowerCase()} is missing role ${withdrawTokenRole}`;
      await expect(minterContract.connect(unpauser).withdrawToken(newToken.getAddress(), mintAmount)).to.be.revertedWith(reverteMessage);

      reverteMessage = `AccessControl: account ${amo.address.toLowerCase()} is missing role ${withdrawTokenRole}`;
      await expect(minterContract.connect(amo).withdrawToken(newToken.getAddress(), mintAmount)).to.be.revertedWith(reverteMessage);

      reverteMessage = `AccessControl: account ${user.address.toLowerCase()} is missing role ${withdrawTokenRole}`;
      await expect(minterContract.connect(user).withdrawToken(newToken.getAddress(), mintAmount)).to.be.revertedWith(reverteMessage);
      expect(await newToken.balanceOf(treasury.address)).to.be.equal(0);
    });
  });

});