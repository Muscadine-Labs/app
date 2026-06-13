*TO work on today:

- [x] Update the dependencies in packages, note no wagmi 3.x is able as of now. (done — all deps bumped within ranges; wagmi stays 2.19.5, eslint stays 9.x)
- [x] fix portfolio value graph on dashboard for total aum with the v1 vaults and v2 vaults. (done — `finalizePositionHistory` in `api-utils.ts` zeros out stale v1 history after full withdrawal; All/90D/30D/7D windows now forward-fill instead of showing empty/diverging values)

///

- [x] Run lint, build and test to make sure everything is functional (lint + build pass on 1.0.7)
- [x] Bump the repo version by 0.0.1 each time we push to github. Once its at 9, you pump it to 0 and the next decimal up. Such as 0.2.9 to 0.3.0 and 1.9.9 to 2.0.0. (1.0.6 → 1.0.7; rule documented in CLAUDE.md + AGENTS.md)
- [x] On CLAUDE.md and AGENTS.md add information to review the TODO.md. Put your new knowledge in the files. (AGENTS.md created; CLAUDE.md "Working agreement" section added)


**To work on another day:

- Deprecate V1 vaults, currently on soft deprication. Also give me a rundown on developer mode vs standard mode after everything with v1 vaults is gone, we wouldnt need on vaults page of the list of vaults with v1 and v2 tags. The transcactions, apis, vault/v1 pages ect.
- Add support for new vaults in the summer I'll make new v2 vaults on ethereum and/or other networks if implimented.
-  Add a function to claim rewards through merkl on the transcact page. We earn rewards in morpho tokens, add function to claim all rewards to wallet through merkl
- Look into if we should keep abi functions to deposit/withdraw for v2 vaults, or change to the V2 vault sdk for transctions with updated Morpho SDKs. Or have the abis just as backup or a feature on dev mode.
