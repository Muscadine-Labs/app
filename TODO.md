**To Work on Today:**

**To work on another day:**
- **Deposit gate — use on-chain RPC whitelist (optional):** Today the app uses a config-only depositor allowlist (gate UI always active) and never calls `sendAssetsGate` / `canSendAssets` over RPC. Lets have it so it fast loads with our config, while chekcing onchain so it than checks if the current address is onchain, than if it is it uses it. So, there is less time between loading. 
- use morpho sdks or onchain for forced deallocation for both the underlying vaults and wrapper vaults. So users on the fee wrapper can withdraw if not enough idle liquidity
Context
0make sure no sdks or grapghql queries are becoming depericated that we use.

Morpho Vault V2 fee wrapper W wrapping a child Vault V2 C through a single MorphoVaultV1Adapter (legacy name — the child is V2). W.liquidityAdapter is set to that adapter with empty data. W's forceDeallocate penalty is 2%. All of C's adapters have their forceDeallocate penalty set to 0. Stack is viem.

Goal

A withdrawal planner for the front end. Given a requested asset amount, return an ordered list of calls to execute in one bundle.

Rules

Never call maxWithdraw or maxRedeem on a Vault V2 — they always return 0.
instant = erc20.balanceOf(W) + erc20.balanceOf(C) + childLiquidityRouteCapacity. That's what a plain W.withdraw cascade reaches with no penalty.
childLiquidityRouteCapacity = min(adapter.expectedSupplyAssets(marketId), market.totalSupplyAssets - market.totalBorrowAssets) for the adapter/market C.liquidityAdapter() + C.liquidityData() point at.
If assets <= instant, the only call is W.withdraw(assets, receiver, user).
Otherwise compute the same min(...) for every other adapter/market pair on C, sort descending, take greedily until assets - instant is covered. Emit one C.forceDeallocate(adapter, data, amount, user) per source, in that order, then W.withdraw(assets, receiver, user) last.
data is 0x for a MorphoVaultV1Adapter (its deallocate has require(data.length == 0)) and abi.encode(MarketParams) for a MorphoMarketV1AdapterV2.
onBehalf is the user. The burn is zero at zero penalty so no child shares or allowance are needed, but don't pass address(0).
If the greedy pass can't cover the shortfall, throw with the reachable max so the UI caps the input instead of letting the tx revert.
Accrue C and W before reading, and recompute immediately before building the tx. Simulate before sending.

Non-negotiable

All calls go in one bundle. Split across transactions, an allocator on C can re-allocate the freed idle back out before the withdraw lands.

Signatures

VaultV2:
  forceDeallocate(address adapter, bytes data, uint256 assets, address onBehalf) returns (uint256)
  withdraw(uint256 assets, address receiver, address onBehalf) returns (uint256)
  accrueInterest()
  liquidityAdapter() view returns (address)
  liquidityData() view returns (bytes)
  forceDeallocatePenalty(address adapter) view returns (uint256)
  permit(address owner, address spender, uint256 shares, uint256 deadline, uint8 v, bytes32 r, bytes32 s)

MorphoMarketV1AdapterV2:
  expectedSupplyAssets(bytes32 marketId) view returns (uint256)

MorphoVaultV1Adapter:
  allocation() view returns (uint256)

Morpho:
  market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)

MarketParams = (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)
prepend the permit or approve call itself (spender is your bundler) and to wrap the output array in your Bundler3 multicall 

-on liquidity, add the ability to force deallocate from a underlying vault to fee wrapper for fee wrapper liquidity so it correclt states it liquidity.
-on a wallet that has the ability to depsoit into fee wrapper and underlying, have it store in catch the filter if its all, wrapper or underlying if i change it. 

**Future (optional):**
- Have multichain for viewing such as with stocks, vaults like robinhood chain. With the actual functions on settings be able to switch the chain. 
- Smart wallet (AA) deposit issue when USDC is used for gas — investigate before changing tx code.
- Stock/token/cash boxes on dashboard. Was deleted because it was unnecessary. If website gains other functions can be useful to have for user experience to see their wallet and to abstract away crypto.
