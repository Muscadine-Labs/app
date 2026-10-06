import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decodeFunctionData,
  encodeFunctionData,
  maxUint256,
  parseUnits,
} from 'viem';
import {
  getVaultDepositApproval,
  getVaultDepositCaller,
  resolveDepositExecutionRoute,
} from './deposit-route.ts';
import {
  buildVaultBundlesNativeDeposit,
  VAULT_BUNDLES_V1_ABI,
} from './morpho-vault-bundles.ts';
import { VAULT_BUNDLES_V1_ADDRESS } from './constants.ts';
import { maxSharePriceE27FromQuote } from './share-price.ts';

const vault = '0x548653b09b03A69f93B3890c382fE9DcD245cbc4';
const wallet = '0x0000000000000000000000000000000000000001';

test('native deposit encodes the payable VaultBundlesV1 call and exact ETH value', () => {
  const assets = parseUnits('0.01', 18);
  const deadline = 1_800_000_000n;
  const maxSharePriceE27 = 1_001_000_000_000_000_000_000_000_000n;
  const call = buildVaultBundlesNativeDeposit({
    vault,
    assets,
    maxSharePriceE27,
    deadline,
  });
  const data = encodeFunctionData({
    abi: VAULT_BUNDLES_V1_ABI,
    functionName: 'vaultBundlesV1Deposit',
    args: call.args,
  });
  const decoded = decodeFunctionData({ abi: VAULT_BUNDLES_V1_ABI, data });

  assert.equal(call.address, VAULT_BUNDLES_V1_ADDRESS);
  assert.equal(call.value, assets);
  assert.equal(decoded.functionName, 'vaultBundlesV1Deposit');
  assert.equal(decoded.args[0], vault);
  assert.equal(decoded.args[1], assets);
  assert.equal(decoded.args[2], maxSharePriceE27);
  assert.deepEqual(decoded.args[3], { kind: 0, data: '0x' });
  assert.equal(decoded.args[4], 0n);
  assert.equal(decoded.args[5], '0x0000000000000000000000000000000000000000');
  assert.equal(decoded.args[6], deadline);
});

test('share-price bound covers the rounded quote plus Morpho default tolerance', () => {
  const assets = 10_000_000_000_000_000n;
  const shares = 9_986_787_092_182_392n;
  const scale = 10n ** 27n;
  const roundedUpQuote = (assets * scale + shares - 1n) / shares;
  const maxSharePrice = maxSharePriceE27FromQuote(assets, shares);

  assert.ok(maxSharePrice >= roundedUpQuote);
  assert.equal(maxSharePriceE27FromQuote(assets, 0n), maxUint256);
});

test('deposit routes select the matching gate caller and ERC-20 spender', () => {
  const nativeRoute = resolveDepositExecutionRoute({
    isWethVault: true,
    preferredAsset: 'ETH',
    ethToWrap: 1n,
  });
  assert.equal(nativeRoute, 'vault-bundles-v1');
  assert.equal(getVaultDepositCaller(nativeRoute, wallet), VAULT_BUNDLES_V1_ADDRESS);
  assert.equal(
    getVaultDepositApproval({
      route: nativeRoute,
      vault,
      totalAssets: 1n,
      wethFromWallet: 0n,
    }),
    null
  );

  const combinedRoute = resolveDepositExecutionRoute({
    isWethVault: true,
    preferredAsset: 'ALL',
    ethToWrap: 1n,
  });
  assert.equal(combinedRoute, 'bundler3');
  assert.equal(getVaultDepositCaller(combinedRoute, wallet), '0xb98c948CFA24072e58935BC004a8A7b376AE746A');
  assert.deepEqual(
    getVaultDepositApproval({
      route: combinedRoute,
      vault,
      totalAssets: 5n,
      wethFromWallet: 4n,
    }),
    { spender: '0xb98c948CFA24072e58935BC004a8A7b376AE746A', amount: 4n }
  );

  const tokenRoute = resolveDepositExecutionRoute({
    isWethVault: true,
    preferredAsset: 'WETH',
    ethToWrap: 0n,
  });
  assert.equal(tokenRoute, 'erc4626');
  assert.equal(getVaultDepositCaller(tokenRoute, wallet), wallet);
  assert.deepEqual(
    getVaultDepositApproval({
      route: tokenRoute,
      vault,
      totalAssets: 5n,
      wethFromWallet: 0n,
    }),
    { spender: vault, amount: 5n }
  );
});
