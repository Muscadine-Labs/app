*TO work on today:

- Update the dependencies in packages, note no wagmi 3.x is able as of now.
- fix portfolio value graph on dashboard for total aum with the v1 vaults and v2 vaults. On some wallets where I dont have v1 vault positions anymore, it is stuck at the amount I last had before i withdrew. Review the overivew graph. Also All, 90D, 30D and 7D are all at diferent numbers (for instance all would say 100$, 30D would say 2$, 7D would not even show a grapgh. Fix the issue.

///

- Run lint, build and test to make sure everything is functional
- Bump the repo version by 0.0.1 each time we push to github. Once its at 9, you pump it to 0 and the next decimal up. Such as 0.2.9 to 0.3.0 and 1.9.9 to 2.0.0.
- On CLAUDE.md and AGENTS.md add information to review the TODO.md. Put your new knowledge in the files.
- 
**To work on another day:

- Deprecate V1 vaults, currently on soft deprication. Also give me a rundown on developer mode vs standard mode after everything with v1 vaults is gone. The transcactions, apis, vault/v1 pages ect.
- Add support for new vaults in the summer I'll make new v2 vaults on ethereum and/or other networks if implimented.
-  Add a function to claim rewards through merkl on the transcact page. We earn rewards in morpho tokens, add function to claim all rewards to wallet through merkl
- Look into if we should keep abi functions to deposit/withdraw for v2 vaults, or change to the V2 vault sdk for transctions with updated Morpho SDKs. Or have the abis just as backup or a feature on dev mode.


