**To Work on Today:**
- **Merge the Morpho REST migration before Jan 25, 2027** (GraphQL fields are removed then). Done on its branch; trade-offs and dropped features: `docs/morpho-rest-migration.md`.
- See if we can optimize the repo, such as rpc / api calls
- Fix when a wallet is not on the sendassets gate, to have a pop up saying this wallet connect deposit into x vaults, you may continue to view positions, withdraw or to view vaults. Than on the vault pages dont have the deposit model, just withdraw. 

**Future (optional):**
- When Morpho REST adds a vault-wide activity route, bring back the History tab's "Show All" (steps in `docs/morpho-rest-migration.md` §3.1). Same for rewards APR and historical USD prices (§3.2, §3.3).
- Have multichain for viewing such as with stocks, vaults like robinhood chain. With the actual functions on settings be able to switch the chain.
- Smart wallet (AA) deposit issue when USDC is used for gas — investigate before changing tx code.
- Stock/token/cash boxes on dashboard. Was deleted because it was unnecessary. If website gains other functions can be useful to have for user experience to see their wallet and to abstract away crypto.
- Took out eth deposits / withdraws because we would have to rely on outside contracts or other issues with new abstracted smart wallets. Optional to add it back, but anyone can call on wrap/unwrap eth on weth contract. 
