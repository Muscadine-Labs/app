import { describe, expect, it, vi } from 'vitest';
import { readRegistryVaultBalances, vaultDustThreshold } from '@/lib/onchain-positions';
import { getRegistryVaultList } from '@/lib/vaults';

describe('vaultDustThreshold', () => {
  it('is 1e-9 of a token for 18-decimal assets and one base unit otherwise', () => {
    expect(vaultDustThreshold(18)).toBe(BigInt(1_000_000_000));
    expect(vaultDustThreshold(8)).toBe(BigInt(1));
    expect(vaultDustThreshold(6)).toBe(BigInt(1));
  });
});

describe('readRegistryVaultBalances', () => {
  it('drops force-exit dust but keeps real positions', async () => {
    const vaults = getRegistryVaultList();
    const weth = vaults.find((v) => v.symbol === 'WETH')!;
    const usdc = vaults.find((v) => v.symbol === 'USDC')!;
    const cbbtc = vaults.find((v) => v.symbol === 'cbBTC')!;
    const sharesByVault: Record<string, bigint> = {
      [weth.address.toLowerCase()]: BigInt(35_165), // dust left by a force redeem
      [usdc.address.toLowerCase()]: BigInt(10) ** BigInt(18), // 1 share, a real position
      [cbbtc.address.toLowerCase()]: BigInt(40_000), // worth 0 sats
    };
    const assetsByShares = (vault: string, shares: bigint) => {
      if (vault === weth.address.toLowerCase()) return shares; // ~1:1
      if (vault === usdc.address.toLowerCase()) return BigInt(1_000_000); // 1 USDC
      return BigInt(0);
    };
    const publicClient = {
      multicall: vi.fn(async ({ contracts }: { contracts: Array<{ address: string; functionName: string; args: [bigint | string] }> }) =>
        contracts.map((c) =>
          c.functionName === 'balanceOf'
            ? sharesByVault[c.address.toLowerCase()] ?? BigInt(0)
            : assetsByShares(c.address.toLowerCase(), c.args[0] as bigint)
        )
      ),
    };
    const balances = await readRegistryVaultBalances(
      publicClient as never,
      '0x00000000000000000000000000000000000000a1'
    );
    expect(balances![weth.address.toLowerCase()]).toEqual({ shares: BigInt(0), assets: BigInt(0) });
    expect(balances![cbbtc.address.toLowerCase()]).toEqual({ shares: BigInt(0), assets: BigInt(0) });
    expect(balances![usdc.address.toLowerCase()].assets).toBe(BigInt(1_000_000));
  });
});
