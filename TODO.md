**To Work on Today:**

- see if we should add morpho bundler contracts for eth deposits / withdraws.
- when a wallet is not connected, still show the vaults on the vault list.

- Wrapper vaults back (phases 1–3 done: combined history, wrappers as registry vaults with deposits and capped withdraws, per-pair defaults with `kindMode`):
  - Phase 4: Settings "Combine vault data", default on (Auto / Off). Combines vault page, activity, dashboard chart and Your Vaults per pair.
  - Phase 5: /vaults Advanced filter that sets `kindMode` in ExplorerVaultsContext: Recommended / Switch to Wrapper Vaults / Show All Vaults. Pill on listed vaults the wallet cannot deposit into ("Approved wallets only"). Labels "Wrapper" and "Underlying" only in Show All Vaults or when the wallet holds both. Vault page header switch between the pair. (Wrapper fee note and TERMS_VERSION 2.3.0 shipped with phase 2.)

**To work on another day:**

**Future (optional):**
- Have multichain for viewing such as with stocks, vaults like robinhood chain. With the actual functions on settings be able to switch the chain.
- Smart wallet (AA) deposit issue when USDC is used for gas — investigate before changing tx code.
- Stock/token/cash boxes on dashboard. Was deleted because it was unnecessary. If website gains other functions can be useful to have for user experience to see their wallet and to abstract away crypto.
