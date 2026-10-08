**To Work on Today:**

- Review bundler 3, morpho is going to deprecate it (on their bundler3 github), look into the new bundles contract on github. See if we need to migrate.
- Also, re-design the wrapper vaults since we took off send-assets-gates. Have it so its auto underlying on settings, if you own wrapper vault shares than it shows up with the underlying vault, and the wrapper would have the label. Take the checks for the gates off. 

**To work on another day:**


**Future (optional):**
- Have multichain for viewing such as with stocks, vaults like robinhood chain. With the actual functions on settings be able to switch the chain.
- Smart wallet (AA) deposit issue when USDC is used for gas — investigate before changing tx code.
- Stock/token/cash boxes on dashboard. Was deleted because it was unnecessary. If website gains other functions can be useful to have for user experience to see their wallet and to abstract away crypto.
