# Liquidity AMO —— rebalancing the liquidity and stable price altogether

## Organization
The AMO manages a significant portion of the USDC backing for the stablecoin (referred to as BOOST in this version). There are two functions:
* v3AMO.sol For ve33 Dexes/pools based on CLAMM (Uniswap v3 and algebra contracts).
* v2AMO.sol For ve33 Dexes based on Uniswap v2 contracts.

*Note 1:* These two functions have identical logic, they just interact with two different AMM contracts => similarity qualitatively over 90% 

*Note 2:* Price rebalancing is triggered by a bot but can also be activated by the community through the publicAMO.sol contracts. This rebalancing is designed to be beneficial for the protocol, with no possible risk to the stablecoin project from either community actions or flash loans.


## Audit Scope

* Both the v2AMO and v3AMO logic.
* The utils contract (which manages veNFT, our voting power in Dexes) on the other branch.
* Interfaces: note that some interfaces are external and do not need to be audited, typically:
    + v2AMO: IGauge.sol, IPair.sol, [Dexname]_Router.sol
    + v3AMO: [Dexname]_Factory.sol, [Dexname]_Pool.sol

*Note*: Each ve33 Dex has slightly different contract versions, meaning adaptations for each chain or Dex may be required. This could lead to later ad-hoc reviews by an auditor.

## Running the project
This project demonstrates a basic Hardhat use case. It comes with a sample contract, a test for that contract, and a script that deploys that contract.

Try running some of the following tasks:

```shell
npx hardhat help
npx hardhat test
REPORT_GAS=true npx hardhat test
npx hardhat node
npx hardhat run scripts/deploy.ts
```

# Description of contracts and components

## I) Booststablecoin:
The BoostStablecoin contract implements an ERC-20 token called "BOOST," which serves as the foundation of the BOOST stablecoin project. This token is upgradable and includes several key features for managing and securing its functionality:

**Main Functions**
* **Pause & Unpause**: These functions allow addresses with the PAUSER_ROLE to pause token transfers and UNPAUSER_ROLE to resume transfers. This can be useful in emergency scenarios.
The pause function can be delegated to a security monitoring firms for automatic responses.
* **Minting**: This function allows addresses with the MINTER_ROLE to mint new tokens (using the Minter.Sol contract) and send them to a specified address (to_).
Token Transfer Guard: This ensures that token transfers are only allowed when the contract is not paused, adding an additional layer of security.

## II) LiquidityAMO:
The LiquidityAMO smart contract is designed for a dual purpose:
* it maintains the BOOST peg to USD in ve33 pool.
* It provides protocol-owned liquidity to the pools 

This joint operation involves
* When BOOST is above par, minting BOOST tokens, selling them for USD, then farming the USDC with free-minted BOOST 
* When BOOST is below par, removing liquidity from the pool, buying back BOOST from the pool with the USD, then burning BOOST

**Note on vocabulary:** 
* Free-minted BOOST is called protocol-owned BOOST in the Frax vocabulary; it has no backing and is created when the protocol receives USD — and burned when the USDC is redeemed.
* USD is a generic name for a reference stable coin paired with BOOST in the AMO ( USDC and USDT are the first natural candidates )

Below are the key functions that define the core logic of the contract:
**Main Functions:**
### 1. Initialize
Purpose: The initialize function sets up the Liquidity AMO contract, defining the addresses of BOOST, USD, Minter, Dex Pool and Treasury. Typically called when the contract is first deployed, this replaces a constructor in upgradeable contracts.
### 2. setVault Function
This function sets or changes the treasury vault address. Only an account with the SETTER_ROLE can call it.
### 3. setTickBounds
Purpose: this function is only available in the main branch which relies on uniswap v3 tech. setTickBounds defines the price range (ticks) at which it provides liquidity in the BOOST-USD pool. The current tech, however, uses full-range liquidity.	

### 4.  mintAndSellBoost
			Purpose: Mints a specified amount of BOOST and sells it for USD in the pool. 
Triggered: When the BOOST-USD price diverges from peg (e.g., BOOST is trading above $1), this function is triggered to mint additional BOOST and sell it for USD to bring the price back down to peg.

**Parameters:**
* boostAmount: The amount of BOOST tokens to be minted and sold
* minUsdAmountOut: The minimum USD amount should be received following the swap
* deadline: Timestamp representing the deadline for the operation to be executed
* usdAmountOut: The USD amount that received from the swap

**Return values:** 
	usdAmountOut: The USD amount that received from the swap
Logic and economic security: the function reverts if Boost is not sold above par, so this function can never induce a loss for the protocol.

### 5. addLiquidity ( v3AMO.sol ) and addLiquidityAndDeposit  v2AMO.sol )

**Purpose (brief):** These addLiquidity functions add protocol-owned liquidity to the BOOST-USD pool, with minor implementation changes between the v3AMO (which “mints” positions) and v2AMO (which adds liquidity and stakes it).
It involves free-minting BOOST tokens, pairing it with USDC backing, and after approving both BOOST and USD tokens for transfer to the pool, ading them as liquidity.

**Purpose (detailed)**: 
1. The function first calculates the amount of BOOST to be minted based on the usdAmount provided. The minted BOOST amount is determined by converting the USD amount to its BOOST equivalent and applying a margin for error with the boostMultiplier.  
2. The contract interacts with the boostMinter to mint the calculated amount of BOOST tokens. 
3. The contract approves the BOOST and USD tokens for transfer to the pool. 
4. The contract calculates the amount of liquidity that will be provided to the pool based on the USD amount. It also calculates the minimum amounts of BOOST and USD that can be used to add liquidity (from minBoostSpend and minUsdSpend).
5. The function sorts the amounts of BOOST and USD to determine the actual amounts spent when adding liquidity.
6. It then checks that the USD spent is within the valid range based on the validRangeWidth and BOOST spent. This ensures the liquidity added is balanced between BOOST and USD.
7. If any BOOST tokens are left unused (i.e., not spent to provide liquidity), the contract burns them.

**Triggered**: When the protocol needs to add liquidity to the BOOST-USD pool, usually right after price rebalancing (MintAndSell).
**Example**: The protocol decides to add liquidity using 100,000 USD. It free-mints the corresponding amount of BOOST and adds both BOOST and USD as liquidity to the pool.
**Parameters**:
* usdAmount (uint256): The total amount of USD that will be added as liquidity to the pool.
* minBoostSpend (uint256): The minimum required amount of BOOST tokens that must be spent in order to proceed with the liquidity addition.
* minUsdSpend (uint256): The minimum required amount of USD that must be contributed to the pool for the liquidity addition to be valid.
* deadline (uint256): Timestamp representing the deadline for the operation to be executed. If the deadline is exceeded, the transaction will revert.

### 6. mintSellFarm
 Purpose (brief): The mintSellFarm essentially bundles the mintAndSell and the addLiquidity functions.
 


### 7.unfarmBuyBurn
	**Purpose (brief)**: The unfarmBuyBurn function is used to increase BOOST price back to peg and is symmetrical to the MintSellFarm function. 
First it removes protocol owned liquidity, swaps the USD for Boost, then burns the BOOST

**Purpose (detailed):** 
* The function first checks the available liquidity using the position() function and ensures the requested liquidity removal does not exceed the protocol's allowed limits (liquidityAmountLimit).
* The function removes liquidity using the appropriate underlying pool logic: it calls burnAndCollect() in v3AMO.sol, and withdraw() and removeLiquidity() in v2AMO.sol.
* The function reverts if BOOST amount withdrawn is lesser than USDC amount, as BOOST pool implied price would not be below peg.
* Once liquidity is removed, the function swaps the USD tokens for BOOST tokens in the pool. The swap ensures that at least minBoostAmountOut BOOST is received.
* The BOOST tokens received from removing liquidity and swapping USD are burned to reduce the circulating supply of BOOST. 

**Return values:**
* boostRemoved (uint256): The amount of BOOST tokens removed from the liquidity pool.
* usdRemoved (uint256): The amount of USD tokens removed from the liquidity pool.
* boostAmountOut (uint256): The amount of BOOST tokens received from swapping USD tokens.

**Parameters (for v3AMO.sol)**:
* liquidity (uint256): The amount of liquidity tokens to be removed from the BOOST-USD pool.
* minBoostRemove (uint256): The minimum amount of BOOST tokens that should be removed from the pool when liquidity is withdrawn.
* minUsdRemove (uint256): The minimum amount of USD tokens that should be removed from the pool when liquidity is withdrawn.
* minBoostAmountOut (uint256): The minimum amount of BOOST tokens to be received after swapping USD tokens for BOOST.
* deadline (uint256): The deadline by which the transaction must be completed. If this deadline is exceeded, the transaction will fail.

## III) PublicAMO:

Purpose:

1) The contract ensures decentralised security, 
It lets any participant (even though the contract allows for whitelisting) rebalance the BOOST price permissionless. 
It ensures that the health of the protocol does not depend on our team or any given (possibly centralised) infrastructure: it is permissionless.

2) Mechanism: 
Technically, it triggers the AMO mechanisms where the amount to mint, sell and farm, or unfarm and buy back, is computed onchain —— rather than by an off-chain bot.

3) A user-friendly interface: 
The PublicAMO contract provides a simpler interface for users or other contracts to interact with the underlying LiquidityAMO functionality, such as minting, selling, adding/removing liquidity, etc., without exposing all the internal difficulties of the LiquidityAMO contract.

