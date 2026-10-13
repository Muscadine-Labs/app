**To Work on Today:**

- see if we should add morpho bundler contracts for eth deposits / withdraws.
- when a wallet is not connected, still show the vaults on the vault list.

- Wrapper vaults back (phase 1, combined My Position history + earned interest, is done):
  - Phase 2: wrappers as registry vaults (`kind`, `underlyingAddress`). Direct ERC-4626 deposits with wrapper → underlying cap walk. Withdraws capped at instant liquidity (wrapper idle + what its adapter can pull from the underlying now). No Bundler3, no wrapper force exit.
  - Phase 3: per-pair default from send-assets gates: Advanced override → underlying if eligible → wrapper if eligible → held contract → underlying view-only.
  - Phase 4: Settings "Combine vault data", default on (Auto / Off). Combines vault page, activity, dashboard chart and Your Vaults per pair.
  - Phase 5: /vaults Advanced filter: Recommended / Switch to Wrapper Vaults / Show All Vaults. Labels "Wrapper" and "Underlying" only in Show All Vaults or when the wallet holds both. Vault page header switch between the pair. Restore wrapper fee note in the advisory modal and bump TERMS_VERSION to 2.3.0.

**To work on another day:**

**Future (optional):**
- Have multichain for viewing such as with stocks, vaults like robinhood chain. With the actual functions on settings be able to switch the chain.
- Smart wallet (AA) deposit issue when USDC is used for gas — investigate before changing tx code.
- Stock/token/cash boxes on dashboard. Was deleted because it was unnecessary. If website gains other functions can be useful to have for user experience to see their wallet and to abstract away crypto.
