import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, toFunctionSelector } from 'viem';
import { capTypeFromIdData, decodeSubmittedCall } from '@/lib/vault-v2-pending-submits';
import { mapVaultV2Pending } from '@/lib/vault-v2-pending';

const abi = parseAbi([
  'function increaseAbsoluteCap(bytes idData, uint256 newAbsoluteCap)',
  'function setPerformanceFee(uint256 newPerformanceFee)',
  'function abdicate(bytes4 selector)',
]);
const TOKEN = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf';
const idData = encodeAbiParameters([{ type: 'string' }, { type: 'address' }], ['collateralToken', TOKEN]);

describe('decodeSubmittedCall', () => {
  it('decodes a cap raise into the fields mapVaultV2Pending reads', () => {
    const data = encodeFunctionData({ abi, functionName: 'increaseAbsoluteCap', args: [idData, BigInt(7)] });
    expect(decodeSubmittedCall(data)).toEqual({
      functionName: 'increaseAbsoluteCap',
      decodedData: { cap: '7', config: { id: keccak256(idData), type: 'Collateral' } },
    });
  });

  it('names the function an abdication gives up', () => {
    const data = encodeFunctionData({
      abi,
      functionName: 'abdicate',
      args: [toFunctionSelector('setPerformanceFee(uint256)')],
    });
    expect(decodeSubmittedCall(data)?.decodedData).toEqual({ functionName: 'setPerformanceFee' });
  });

  it('feeds mapVaultV2Pending the same way Morpho GraphQL did', () => {
    const data = encodeFunctionData({ abi, functionName: 'setPerformanceFee', args: [BigInt(1e17)] });
    const call = decodeSubmittedCall(data)!;
    const [change] = mapVaultV2Pending({
      performanceFee: 0.05,
      pendingConfigs: { items: [{ ...call, data, txHash: '0x1', validAt: 100 }] },
    });
    expect(change).toMatchObject({ direction: 'add', title: 'Set the performance fee to 10%', validAt: 100 });
  });

  it('returns null for calldata it cannot decode', () => {
    expect(decodeSubmittedCall('0xdeadbeef')).toBeNull();
    expect(capTypeFromIdData('0x12')).toBeNull();
  });
});
