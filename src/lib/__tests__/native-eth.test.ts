import { describe, expect, it, vi } from 'vitest';
import {
  type Address,
  type Hex,
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  parseAbi,
} from 'viem';
import { BASE_WETH_ADDRESS, ETH_GAS_RESERVE_WEI } from '@/lib/constants';
import {
  WETH_ABI,
  buildUnwrapCall,
  buildWrapCall,
  maxDepositForFunding,
  planDepositWrap,
  wethPaidByVault,
} from '@/lib/native-eth';
import {
  depositToVaultV2,
  redeemFromVaultV2,
  unwrapExitProceedsV2,
  withdrawFromVaultV2,
} from '@/lib/transactionUtilsV2';

const ETH = BigInt(10) ** BigInt(18);
const VAULT = '0xD6DCAd2f7Da91FBb27BdA471540d9770c97a5a43' as Address;
const USER = '0x00000000000000000000000000000000000000a1' as Address;
const OTHER = '0x00000000000000000000000000000000000000b2' as Address;

const TRANSFER_ABI = parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)']);
const VAULT_ABI = parseAbi([
  'function deposit(uint256 assets, address onBehalf) returns (uint256)',
  'function withdraw(uint256 assets, address receiver, address owner) returns (uint256)',
  'function redeem(uint256 shares, address receiver, address owner) returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
]);

function transferLog(token: Address, from: Address, to: Address, value: bigint) {
  return {
    address: token,
    topics: encodeEventTopics({ abi: TRANSFER_ABI, eventName: 'Transfer', args: { from, to } }),
    data: encodeAbiParameters([{ type: 'uint256' }], [value]),
    blockHash: '0x01',
    blockNumber: BigInt(1),
    logIndex: 0,
    transactionHash: '0x02',
    transactionIndex: 0,
    removed: false,
  } as never;
}

describe('planDepositWrap', () => {
  const reserve = ETH_GAS_RESERVE_WEI;

  it('wraps nothing for WETH funding and rejects more than the WETH balance', () => {
    expect(planDepositWrap({ funding: 'WETH', amount: ETH, wethBalance: ETH, ethBalance: BigInt(0) })).toBe(BigInt(0));
    expect(() =>
      planDepositWrap({ funding: 'WETH', amount: ETH + BigInt(1), wethBalance: ETH, ethBalance: ETH * BigInt(9) })
    ).toThrow(/WETH/);
  });

  it('wraps the full amount for ETH funding, ignoring WETH already held', () => {
    expect(
      planDepositWrap({ funding: 'ETH', amount: ETH, wethBalance: ETH * BigInt(5), ethBalance: ETH * BigInt(2) })
    ).toBe(ETH);
  });

  it('keeps the gas reserve for ETH funding', () => {
    expect(() =>
      planDepositWrap({ funding: 'ETH', amount: ETH, wethBalance: BigInt(0), ethBalance: ETH })
    ).toThrow(/gas/);
    expect(
      planDepositWrap({ funding: 'ETH', amount: ETH, wethBalance: BigInt(0), ethBalance: ETH + reserve })
    ).toBe(ETH);
  });

  it('does not wrap again on a retry while the earlier wrap is still held', () => {
    expect(
      planDepositWrap({ funding: 'ETH', amount: ETH, wethBalance: ETH, ethBalance: BigInt(0), alreadyWrapped: ETH })
    ).toBe(BigInt(0));
    // The earlier wrap was spent elsewhere: only what is still held counts.
    expect(
      planDepositWrap({
        funding: 'ETH',
        amount: ETH,
        wethBalance: ETH / BigInt(4),
        ethBalance: ETH * BigInt(2),
        alreadyWrapped: ETH,
      })
    ).toBe((ETH * BigInt(3)) / BigInt(4));
  });

  it('spends WETH first for ETH + WETH and wraps only the shortfall', () => {
    expect(
      planDepositWrap({ funding: 'ALL', amount: ETH, wethBalance: ETH / BigInt(4), ethBalance: ETH })
    ).toBe((ETH * BigInt(3)) / BigInt(4));
    expect(
      planDepositWrap({ funding: 'ALL', amount: ETH, wethBalance: ETH * BigInt(2), ethBalance: BigInt(0) })
    ).toBe(BigInt(0));
    expect(() =>
      planDepositWrap({ funding: 'ALL', amount: ETH * BigInt(2), wethBalance: ETH, ethBalance: ETH })
    ).toThrow(/ETH \+ WETH/);
  });
});

describe('maxDepositForFunding', () => {
  it('matches each funding choice', () => {
    const weth = ETH;
    const eth = ETH + ETH_GAS_RESERVE_WEI;
    expect(maxDepositForFunding('WETH', weth, eth)).toBe(ETH);
    expect(maxDepositForFunding('ETH', weth, eth)).toBe(ETH);
    expect(maxDepositForFunding('ALL', weth, eth)).toBe(ETH * BigInt(2));
    expect(maxDepositForFunding('ETH', weth, ETH_GAS_RESERVE_WEI / BigInt(2))).toBe(BigInt(0));
  });
});

describe('wethPaidByVault', () => {
  it('counts only WETH sent from the vault to the user', () => {
    const paid = wethPaidByVault(
      {
        logs: [
          transferLog(BASE_WETH_ADDRESS, VAULT, USER, ETH),
          transferLog(BASE_WETH_ADDRESS, OTHER, USER, ETH * BigInt(7)),
          transferLog(BASE_WETH_ADDRESS, VAULT, OTHER, ETH * BigInt(3)),
          transferLog('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', VAULT, USER, ETH * BigInt(9)),
          transferLog(BASE_WETH_ADDRESS, VAULT, USER, BigInt(5)),
        ],
      },
      VAULT,
      USER
    );
    expect(paid).toBe(ETH + BigInt(5));
  });
});

describe('wrap / unwrap calls', () => {
  it('encode WETH deposit with value and withdraw with the exact amount', () => {
    const wrap = buildWrapCall(ETH);
    expect(wrap.to).toBe(BASE_WETH_ADDRESS);
    expect(wrap.value).toBe(ETH);
    expect(decodeFunctionData({ abi: WETH_ABI, data: wrap.data }).functionName).toBe('deposit');
    const unwrap = buildUnwrapCall(BigInt(123));
    expect(decodeFunctionData({ abi: WETH_ABI, data: unwrap.data }).args).toEqual([BigInt(123)]);
  });
});

/** Minimal clients: a WETH vault, a wallet that batches atomically or not. */
function makeClients(options: {
  atomic: boolean;
  shares?: bigint;
  walletWeth?: bigint;
  walletEth?: bigint;
  allowance?: bigint;
  exitPays?: bigint;
  cannotReceiveEth?: boolean;
}) {
  const sent: Array<{ to: Address; data: Hex; value?: bigint }> = [];
  const batches: Array<Array<{ to: Address; data: Hex; value?: bigint }>> = [];
  let walletWeth = options.walletWeth ?? BigInt(0);
  const receipts = new Map<string, unknown>();

  const publicClient = {
    readContract: vi.fn(async ({ address, functionName }: { address: Address; functionName: string }) => {
      if (functionName === 'asset') return BASE_WETH_ADDRESS;
      if (functionName === 'balanceOf') {
        return address.toLowerCase() === BASE_WETH_ADDRESS.toLowerCase()
          ? walletWeth
          : options.shares ?? ETH * BigInt(10);
      }
      if (functionName === 'previewWithdraw') return ETH;
      if (functionName === 'convertToAssets') return ETH * BigInt(10);
      throw new Error(`unexpected read ${functionName}`);
    }),
    multicall: vi.fn(async ({ contracts }: { contracts: Array<{ functionName: string }> }) =>
      contracts.map((c) => {
        if (c.functionName === 'balanceOf') return walletWeth;
        if (c.functionName === 'allowance') return options.allowance ?? BigInt(0);
        // Deposit gate / cap reads: open, no cap.
        if (c.functionName === 'canSendAssets') return { status: 'success', result: true };
        return { status: 'success', result: null };
      })
    ),
    getBalance: vi.fn(async () => options.walletEth ?? ETH * BigInt(100)),
    // eth_call WETH.withdraw(0) from the user: smart wallets revert (2300-gas transfer).
    call: vi.fn(async () => {
      if (options.cannotReceiveEth) {
        const { ExecutionRevertedError } = await import('viem');
        throw new ExecutionRevertedError({});
      }
      return { data: '0x' };
    }),
    waitForTransactionReceipt: vi.fn(async ({ hash }: { hash: string }) => receipts.get(hash)),
    getTransactionReceipt: vi.fn(async ({ hash }: { hash: string }) => receipts.get(hash)),
  };

  const walletClient = {
    account: { address: USER, type: 'json-rpc' },
    getCapabilities: vi.fn(async () =>
      options.atomic ? { atomic: { status: 'supported' } } : { atomic: { status: 'unsupported' } }
    ),
    sendCalls: vi.fn(async ({ calls }: { calls: Array<{ to: Address; data: Hex; value?: bigint }> }) => {
      batches.push(calls);
      return { id: '0xbatch' };
    }),
    waitForCallsStatus: vi.fn(async () => ({
      status: 'success',
      receipts: [{ status: 'success', transactionHash: '0xbatchtx' }],
    })),
    sendTransaction: vi.fn(async (call: { to: Address; data: Hex; value?: bigint }) => {
      sent.push(call);
      const hash = `0x${sent.length.toString(16).padStart(2, '0')}`;
      const isExit = call.to.toLowerCase() === VAULT.toLowerCase();
      if (isExit && options.exitPays) walletWeth += options.exitPays;
      if (call.to.toLowerCase() === BASE_WETH_ADDRESS.toLowerCase() && !call.value) {
        walletWeth -= decodeWethCall(call.data).args?.[0] as bigint;
      }
      receipts.set(hash, {
        status: 'success',
        logs: isExit && options.exitPays ? [transferLog(BASE_WETH_ADDRESS, VAULT, USER, options.exitPays)] : [],
      });
      return hash;
    }),
  };

  return { publicClient: publicClient as never, walletClient: walletClient as never, sent, batches };
}

function decodeVaultCall(data: Hex) {
  return decodeFunctionData({ abi: VAULT_ABI, data: data.slice(0, 10 + 64 * 3) as Hex });
}

function decodeWethCall(data: Hex) {
  return decodeFunctionData({ abi: WETH_ABI, data: data.slice(0, 10 + 64) as Hex });
}

vi.mock('@/lib/vault-gates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/vault-gates')>()),
  isWalletDepositBlocked: vi.fn(async () => false),
}));
vi.mock('@/lib/deposit-capacity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/deposit-capacity')>()),
  assertDepositWithinCapacity: vi.fn(async () => undefined),
}));

describe('ETH exits', () => {
  it('redeem to ETH unwraps exactly what the redeem paid, not the wallet WETH balance', async () => {
    const paid = ETH + BigInt(987); // includes interest accrued after any quote
    const { publicClient, walletClient, sent, batches } = makeClients({
      atomic: true,
      walletWeth: ETH * BigInt(3), // WETH the wallet already held
      exitPays: paid,
    });
    await redeemFromVaultV2(publicClient, walletClient, VAULT, undefined, { receiveAs: 'ETH' });
    expect(batches).toHaveLength(0); // redeem never batches: the paid amount is unknown before mining
    expect(sent).toHaveLength(2);
    expect(decodeVaultCall(sent[0].data).functionName).toBe('redeem');
    expect(decodeWethCall(sent[1].data).args).toEqual([paid]);
  });

  it('partial withdraw to ETH batches exit + exact unwrap on atomic wallets', async () => {
    const { publicClient, walletClient, sent, batches } = makeClients({ atomic: true });
    await withdrawFromVaultV2(publicClient, walletClient, VAULT, '1', 18, undefined, { receiveAs: 'ETH' });
    expect(sent).toHaveLength(0);
    expect(batches).toHaveLength(1);
    expect(decodeVaultCall(batches[0][0].data).functionName).toBe('withdraw');
    expect(decodeWethCall(batches[0][1].data).args).toEqual([ETH]);
  });

  it('partial withdraw to ETH on a plain wallet sends exit then unwrap of the paid amount', async () => {
    const onExitConfirmed = vi.fn();
    const { publicClient, walletClient, sent } = makeClients({ atomic: false, exitPays: ETH });
    await withdrawFromVaultV2(publicClient, walletClient, VAULT, '1', 18, undefined, {
      receiveAs: 'ETH',
      onExitConfirmed,
    });
    expect(sent).toHaveLength(2);
    expect(onExitConfirmed).toHaveBeenCalledWith('0x01');
    expect(decodeWethCall(sent[1].data).args).toEqual([ETH]);
  });

  it('resume unwraps only the earlier exit, and refuses once that WETH is gone', async () => {
    const { publicClient, walletClient, sent } = makeClients({
      atomic: false,
      exitPays: ETH,
      walletWeth: ETH / BigInt(2),
    });
    // Exit mined, unwrap rejected: the wallet holds its own 0.5 WETH plus the 1 WETH paid.
    const send = (walletClient as unknown as { sendTransaction: ReturnType<typeof vi.fn> }).sendTransaction;
    const original = send.getMockImplementation()!;
    send.mockImplementationOnce(original).mockImplementationOnce(async () => {
      throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
    });
    await expect(
      withdrawFromVaultV2(publicClient, walletClient, VAULT, '1', 18, undefined, { receiveAs: 'ETH' })
    ).rejects.toThrow(/rejected/);

    await unwrapExitProceedsV2(publicClient, walletClient, VAULT, '0x01');
    expect(decodeWethCall(sent[sent.length - 1].data).args).toEqual([ETH]);

    // A retry that knows the earlier unwrap returns it instead of unwrapping again.
    const unwrapHash = `0x${sent.length.toString(16).padStart(2, '0')}` as Hex;
    const count = sent.length;
    expect(
      await unwrapExitProceedsV2(publicClient, walletClient, VAULT, '0x01', undefined, {
        priorUnwrapHash: unwrapHash,
      })
    ).toBe(unwrapHash);
    expect(sent).toHaveLength(count);

    // Without it, the balance check still refuses once only the earlier 0.5 WETH is left.
    await expect(unwrapExitProceedsV2(publicClient, walletClient, VAULT, '0x01')).rejects.toThrow(
      /less WETH/
    );
  });
});

describe('smart wallets', () => {
  it('refuse an ETH exit before sending anything when the wallet cannot receive the unwrap', async () => {
    const { publicClient, walletClient, sent, batches } = makeClients({
      atomic: true,
      cannotReceiveEth: true,
    });
    await expect(
      withdrawFromVaultV2(publicClient, walletClient, VAULT, '1', 18, undefined, { receiveAs: 'ETH' })
    ).rejects.toThrow(/smart wallets/);
    await expect(
      redeemFromVaultV2(publicClient, walletClient, VAULT, undefined, { receiveAs: 'ETH' })
    ).rejects.toThrow(/smart wallets/);
    expect(sent).toHaveLength(0);
    expect(batches).toHaveLength(0);
  });
});

describe('ETH deposits', () => {
  it('batches wrap + approve + deposit on atomic wallets', async () => {
    const { publicClient, walletClient, batches } = makeClients({ atomic: true });
    await depositToVaultV2(publicClient, walletClient, VAULT, '1', 18, undefined, { funding: 'ETH' });
    expect(batches).toHaveLength(1);
    const [wrap, approve, deposit] = batches[0];
    expect(wrap.value).toBe(ETH);
    expect(decodeVaultCall(approve.data).functionName).toBe('approve');
    expect(decodeVaultCall(deposit.data).args).toEqual([ETH, getAddress(USER)]);
  });

  it('ETH + WETH wraps only the shortfall and skips approval when allowed', async () => {
    const onWrapped = vi.fn();
    const { publicClient, walletClient, sent } = makeClients({
      atomic: false,
      walletWeth: ETH / BigInt(4),
      allowance: ETH,
    });
    await depositToVaultV2(publicClient, walletClient, VAULT, '1', 18, undefined, {
      funding: 'ALL',
      onWrapped,
    });
    expect(sent).toHaveLength(2);
    expect(sent[0].value).toBe((ETH * BigInt(3)) / BigInt(4));
    expect(onWrapped).toHaveBeenCalledWith((ETH * BigInt(3)) / BigInt(4));
    expect(decodeVaultCall(sent[1].data).functionName).toBe('deposit');
  });
});
