**To Work on Today:**
- Earned interest on home dashboard is a small inconsistantcy with earned interest amount on vault pages. Find out why there is an inconsitancy with token and usd amount than fix it. I believe the vault earned interest is the correct amount.
- On the vault pages on overivew with the info toggles for apy and liquidty, there is a bug on the pop up where the top section like "Net APY" is cut off by "APY breakdown". Fix this and the other info section, than find any other small ui bugs.
- On /vaults and net apy, there is a small diference between that apy and the apy on morpho. Tell me all of the net apy or apy morpgo ql call and what they are for each one.
- On Interest earned on dashbaord and on the /vault/v2 pages it does not count a transfer in as token deposited, or transfer out as token withdrawn. on Transaction History
View all deposits and withdrawals for this vault tab, transfer is marked unknown and should be transfer in or transfer out. Review first. See about transfers that are bundled with " one or more Account Abstraction transactions (User Ops), such as this transcaction: 0x8f00707c3eb76374746bd70089cfb30cbe19f92067f4f4d496ce1a08ba623fa8


**To work on another day:**

- **Vault v2 force exit when withdraw > liquidity:** In-app withdraw warns (preview banner + confirm modal with Morpho link) when amount exceeds instant liquidity and on-chain simulation fails; user can continue anyway. Still TODO: auto-route via `forceDeallocate` then `withdraw`/`redeem` in `transactionUtilsV2.ts` (or Morpho SDK `forceWithdraw`/`forceRedeem`). Users can force-exit via [Morpho app](https://app.morpho.org) in the meantime. Ref: [Morpho force deallocate](https://morpho-org-vault-v2.mintlify.app/operations/force-deallocate).

- **Vault v2 My Position chart — stacked principal + interest:** On `/vault/v2/[address]` My Position tab, show two stacked area lines instead of one total line: bottom = deposited amount (cumulative net deposits from activity), top = earned interest (position value − principal), summing to total. Fetch `/api/vault/v2/{address}/activity` (deposits/withdrawals) and split each position-history point via `interest-utils` (`buildActivityFlowEvents`, `netDepositRawAtTime`, `splitPositionValueAtPoint`). Recharts stacked `Area` (primary = deposited, success = interest), legend + tooltip with Deposited / Earned interest / Total. Fallback to single line if activity unavailable. Morpho v2 has no historical PnL series — interest over time is derived from activity + position history.

Considering:
- Smart wallet (AA) deposit issue when USDC is used for gas — investigate math and contract ABI paths before changing transaction code.
- Add support for new vaults in the summer I'll make new v2 vaults on ethereum and/or other networks if implimented.
- Add a function to claim rewards through merkl on the transcact page. We earn rewards in morpho tokens, add function to claim all rewards to wallet through merkl
- Look into if we should keep abi functions to deposit/withdraw for v2 vaults, or change to the V2 vault sdk for transctions with updated Morpho SDKs. Or have the abis just as backup or a feature on dev mode.
- Make this website a safe app i can use for my multi sigs - https://github.com/safe-global/safe-apps-sdk.

