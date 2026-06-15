*TO work on today:
- Issue with depositing into V2 vaults using the abi on a smart wallet that uses USDC for gas, check your math and contract abi functions when a smart wallet uses usdc as gas. When regular wallets do transcactions there are no issues.
- With withdraws for V2, research about the morpho v2 vaults, and what "liquditity" is, and if we would need to call the function "force withdraw" if they want to withdraw more than whats in the liqudity market. And, for the vault pages if we should have it has the forceibile liquitity or the liquidaty adaptor liquyidity. 
- Add on the vaults my position page to include: Earned Interest, with token first than usd value. Research with morpho how to formulate an interest earned function, either with grapgh ql morpho api or abi. The gemeral formula to find how much interest is earned is take the current position tokens, subtract the depsoits and add withdraws to find interest earned. Included Interest earned on the dahsboard for total for wallet next to morpho vaults on dashbaord, than for each indiviual vault on the dahsboard at the bottom, inbetween Your Position	and APY / TVL.
///

- Run lint, build and test to make sure everything is functional (lint + build pass on 1.0.7)
-  Bump the repo version by 0.0.1 each time we push to github. Once its at 9, you pump it to 0 and the next decimal up. Such as 0.2.9 to 0.3.0 and 1.9.9 to 2.0.0. (1.0.8 → 1.0.9 rule documented in CLAUDE.md + AGENTS.md)
-  On CLAUDE.md and AGENTS.md add information to review the TODO.md. Put your new knowledge in the files. (AGENTS.md created; CLAUDE.md "Working agreement" section added) Make sure other md files like readme is updated, consise and quick. 


**To work on another day:

- Deprecate V1 vaults, currently on soft deprication. Also give me a rundown on developer mode vs standard mode after everything with v1 vaults is gone, we wouldnt need on vaults page of the list of vaults with v1 and v2 tags. The transcactions, apis, vault/v1 pages ect.
- Add support for new vaults in the summer I'll make new v2 vaults on ethereum and/or other networks if implimented.
-  Add a function to claim rewards through merkl on the transcact page. We earn rewards in morpho tokens, add function to claim all rewards to wallet through merkl
- Look into if we should keep abi functions to deposit/withdraw for v2 vaults, or change to the V2 vault sdk for transctions with updated Morpho SDKs. Or have the abis just as backup or a feature on dev mode.
