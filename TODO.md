*TO work on today:

- Add on the vaults my position page to include: Earned Interest, with token first than usd value. Research with morpho how to formulate an interest earned function, either with grapgh ql morpho api or abi. The general formula to find how much interest is earned is take the current position underlying tokens, subtract the depsoits and add withdraws to find interest earned. Included Interest earned on the dahsboard for each indiviual vault on the dahsboard at the bottom, inbetween Your Position	and APY / TVL on "Your vaults". On the /vault pages on "My postion" tab on the right of "Your Deposits" on the same line for "Earned Interest".
- On the dashboard, for "Morpho Vaults" include all morpho vault postions for the user address, regardless if it is muscadine or not. This goes fro the "Your Vaults" and "Portfolio Value". But do not have any dedicated vault pages to interact with these vaults besides the ones in constant we use for morpho vaults. Meaning if I have positions in other morpho vaults that are not curated by muscadine, I still want to see those positions on the home dashboard like on the wallet overivew "Morpho Vaults", the vaults im in on Your vaults, but no way to click on these other vaults, but I can see my overview stats, and the portfolio value grapgh of all of it conbined (see if there is a morpho function for just the whole user for the grapgh). Check with me first for the graph if there is one.
- On /vaults page for the filters to select vaults, add a filter for risk, keep it auto default at "Prime" but soon we will be adding a "Frontier" Vault. Also include "All" in the selection, and on Dev mode the the defult can be All for all of the filters like network, asset, version and risk.

Needs confirmation:
- Issue with depositing into V2 on a smart wallet (AA) that uses USDC for gas, check your math and contract abi functions when a smart wallet uses usdc as gas. When regular wallets do transcactions there are no issues. Do not change anything, confirm with me first before any changes.
- With withdraws for V2, research about the morpho v2 vaults, and what "liquditity" is, and if we would need to call the function "force withdraw" if they want to withdraw more than whats in the liqudity market. And, for the vault pages if we should have it has the forceibile liquitity or the liquidaty adaptor liquyidity. Research, Do not change anything, confirm with me first before any changes.
- Net APY on vault pages are diferent than the NET APY on app.morpho.org. See how we calculate it, and show me what the apy for the diferent apy api's from morpho are shown so we can see if we are using the wrong one. Do not change anything, confirm with me first before any changes.
- Review on dashboard on Wallet "Liquid Assets" Seems like on some users it says they have liquid assets in their wallet, but they do not, seems buggy double check the code.
- Look at if the new morpho graph ql or sdk versions if it has any breaking updates we have to change on our repo.

- Run lint, build and test to make sure everything is functional. Reivew your changes and double check your work and code. 
-  Bump the repo version by 0.0.1 each time we push to github. Once its at 9, you pump it to 0 and the next decimal up. Such as 0.2.9 to 0.3.0 and 1.9.9 to 2.0.0. (1.0.8 → 1.0.9 rule documented in CLAUDE.md + AGENTS.md)
-  On CLAUDE.md and AGENTS.md add information to review the TODO.md. Put your new knowledge in the files. (AGENTS.md created; CLAUDE.md "Working agreement" section added) Make sure other md files like readme is updated, consise and quick. 


**To work on another day:

- Deprecate V1 vaults, currently on soft deprication, so delete it off dev mode also. Also give me a rundown on developer mode vs standard mode after everything with v1 vaults is gone, we wouldnt need on vaults page of the list of vaults with v1 and v2 tags. The transcactions, apis, vault/v1 pages ect.

- Add support for new vaults in the summer I'll make new v2 vaults on ethereum and/or other networks if implimented.
- When we add the Frontier vault, is the constants set up right to add it simply? It is a V2 vault, and it would be called Muscadine USDC Frontier (not created yet). Also on the vaults.ts file, the symbol currently is the underlying asset symbol for the vaults, lets also add the vault symbol also, but we dont have to connect it to the repo just for dev looks. The muscadine v1 would always be Muscadine USDC Vault (mvUSDC, mvcbBTC, mvWETH) and Muscadine Prime (mpUSDC, mpcbBTC, mpWETH) Frontier would be (mfUSDC). 

-  Add a function to claim rewards through merkl on the transcact page. We earn rewards in morpho tokens, add function to claim all rewards to wallet through merkl
- Look into if we should keep abi functions to deposit/withdraw for v2 vaults, or change to the V2 vault sdk for transctions with updated Morpho SDKs. Or have the abis just as backup or a feature on dev mode.
