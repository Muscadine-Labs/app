import { describe, expect, it, vi } from 'vitest';
import { type Address, type Hex } from 'viem';
import type { ForceWithdrawPlan } from '@/lib/force-withdraw-v2';

// The replan before sending finds that instant liquidity now covers the exit.
vi.mock('@/lib/force-withdraw-v2', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/force-withdraw-v2')>()),
  planForceWithdrawV2: vi.fn(async () => null),
}));

const { forceWithdrawFromVaultV2 } = await import('@/lib/transactionUtilsV2');

const VAULT = '0xd6dcad2f7da91fbb27bda471540d9770c97a5a43' as Address;
const USER = '0x00000000000000000000000000000000000000a1' as Address;
const SHARES = BigInt(10) ** BigInt(18) * BigInt(2);
const REQUESTED = BigInt(1_999_990_000_000_000_000);

function clients() {
  const writes: Array<{ functionName: string; args: readonly unknown[] }> = [];
  const read = async ({ functionName }: { functionName: string }) => {
    if (functionName === 'asset') return '0x4200000000000000000000000000000000000006';
    if (functionName === 'decimals') return 18;
    if (functionName === 'balanceOf') return SHARES;
    if (functionName === 'previewWithdraw') return REQUESTED;
    throw new Error(functionName);
  };
  const publicClient = {
    readContract: vi.fn(read),
    multicall: vi.fn(async ({ contracts }: { contracts: Array<{ functionName: string }> }) =>
      Promise.all(contracts.map(read))
    ),
    waitForTransactionReceipt: vi.fn(async () => ({ status: 'success', logs: [] })),
  };
  const walletClient = {
    account: { address: USER, type: 'json-rpc' },
    writeContract: vi.fn(async (req: { functionName: string; args: readonly unknown[] }) => {
      writes.push({ functionName: req.functionName, args: req.args });
      return '0x01' as Hex;
    }),
  };
  return { publicClient: publicClient as never, walletClient: walletClient as never, writes };
}

const basePlan: ForceWithdrawPlan = {
  vaultAddress: VAULT,
  requestedAssets: REQUESTED,
  instantLiquidityAssets: BigInt(0),
  expectedAssetsOut: REQUESTED,
  estimatedPenaltyAssets: BigInt(0),
  maxPenaltyWad: BigInt(0),
  exitMode: 'redeem',
  maxExit: false,
  multicallArgs: ['0x'],
};

describe('forceWithdrawFromVaultV2 when liquidity improves before sending', () => {
  it('withdraws only the typed amount for a near-max (auto-redeem) plan', async () => {
    const { publicClient, walletClient, writes } = clients();
    await forceWithdrawFromVaultV2(publicClient, walletClient, basePlan);
    expect(writes).toHaveLength(1);
    expect(writes[0].functionName).toBe('withdraw');
    expect(writes[0].args[0]).toBe(REQUESTED);
  });

  it('still redeems every share for a MAX plan', async () => {
    const { publicClient, walletClient, writes } = clients();
    await forceWithdrawFromVaultV2(publicClient, walletClient, { ...basePlan, maxExit: true });
    expect(writes).toHaveLength(1);
    expect(writes[0].functionName).toBe('redeem');
    expect(writes[0].args[0]).toBe(SHARES);
  });
});


describe('isForcePlanWorse', () => {
  it('ignores interest-sized changes and flags real drops or penalty rises', async () => {
    const { isForcePlanWorse } = await import('@/lib/force-withdraw-v2');
    const accepted = {
      ...basePlan,
      expectedAssetsOut: BigInt(1_000_000),
      estimatedPenaltyAssets: BigInt(10_000),
    };
    // 0.05% less out and a 0.05% bigger penalty: noise.
    expect(
      isForcePlanWorse(accepted, {
        ...accepted,
        expectedAssetsOut: BigInt(999_500),
        estimatedPenaltyAssets: BigInt(10_005),
      })
    ).toBe(false);
    // More out or less penalty is never worse.
    expect(
      isForcePlanWorse(accepted, {
        ...accepted,
        expectedAssetsOut: BigInt(2_000_000),
        estimatedPenaltyAssets: BigInt(0),
      })
    ).toBe(false);
    expect(isForcePlanWorse(accepted, { ...accepted, expectedAssetsOut: BigInt(990_000) })).toBe(
      true
    );
    expect(
      isForcePlanWorse(accepted, { ...accepted, estimatedPenaltyAssets: BigInt(20_000) })
    ).toBe(true);
  });
});

describe('forceWithdrawFromVaultV2 when the replan is worse', () => {
  it('sends nothing and returns the fresh plan for review', async () => {
    const forceModule = await import('@/lib/force-withdraw-v2');
    const worse: ForceWithdrawPlan = {
      ...basePlan,
      exitMode: 'withdraw',
      expectedAssetsOut: REQUESTED / BigInt(2),
      estimatedPenaltyAssets: BigInt(10) ** BigInt(16),
    };
    vi.mocked(forceModule.planForceWithdrawV2).mockResolvedValueOnce(worse);
    const { publicClient, walletClient, writes } = clients();

    const sent = forceWithdrawFromVaultV2(publicClient, walletClient, basePlan);
    await expect(sent).rejects.toBeInstanceOf(forceModule.ForceWithdrawPlanChangedError);
    await sent.catch((err: InstanceType<typeof forceModule.ForceWithdrawPlanChangedError>) => {
      expect(err.freshPlan).toBe(worse);
    });
    expect(writes).toHaveLength(0);
  });
});
