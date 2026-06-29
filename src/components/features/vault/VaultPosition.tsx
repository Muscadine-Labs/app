'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount, useReadContract } from 'wagmi';
import { MorphoVaultData } from '@/types/vault';
import {
  formatCurrency,
  formatNumber,
  formatPositionUsd,
  formatVaultChartTokenAmount,
  formatVaultChartTokenAxisTick,
  formatVaultDetailTokenAmount,
} from '@/lib/formatter';
import { calculateYAxisDomain, isCuratedVaultAddress } from '@/lib/vault-utils';
import { getMorphoVaultUrl } from '@/lib/liquidity-utils';
import {
  buildActivityFlowEvents,
  netDepositRawAtTime,
  splitPositionValueAtPoint,
  type ActivityFlowEvent,
} from '@/lib/interest-utils';
import { ExternalVaultTransactModal } from '@/components/features/vault/ExternalVaultTransactModal';
import { logger } from '@/lib/logger';
import { useToast } from '@/contexts/ToastContext';
import { usePrices } from '@/contexts/PriceContext';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Button } from '@/components/ui';
import { Skeleton } from '@/components/ui/Skeleton';
import { ERC20_BALANCE_ABI, ERC4626_ABI } from '@/lib/abis';
import { useUnixTimestamp } from '@/hooks/useClientOnly';
import { useVaultEarnedInterest } from '@/hooks/useVaultEarnedInterest';
import { useLockPageScroll } from '@/hooks/useLockPageScroll';
import { resolveAssetDecimals } from '@/lib/asset-decimals';
import { BASE_CHAIN_ID } from '@/lib/constants';

interface VaultPositionProps {
  vaultData: MorphoVaultData;
}

type TimeFrame = 'all' | '1Y' | '90D' | '30D' | '7D';

const TIME_FRAME_SECONDS: Record<TimeFrame, number> = {
  all: 0, // 0 means all data
  '1Y': 365 * 24 * 60 * 60,
  '90D': 90 * 24 * 60 * 60,
  '30D': 30 * 24 * 60 * 60,
  '7D': 7 * 24 * 60 * 60,
};

// Minimum timestamp: October 7, 2025 00:00:00 UTC
const MIN_TIMESTAMP = 1759795200;

const formatDate = (timestamp: number) => {
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export default function VaultPosition({ vaultData }: VaultPositionProps) {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { btc: btcPrice, eth: ethPrice } = usePrices();
  const { error: showErrorToast } = useToast();

  const now = useUnixTimestamp();
  const [loading, setLoading] = useState(true);
  const [selectedTimeFrame, setSelectedTimeFrame] = useState<TimeFrame>('all');
  const [valueType, setValueType] = useState<'usd' | 'token'>('token');
  const [isTimeFrameMenuOpen, setIsTimeFrameMenuOpen] = useState(false);
  const [userPositionHistory, setUserPositionHistory] = useState<Array<{
    timestamp: number;
    assets: number;
    assetsUsd: number;
    shares: number;
  }>>([]);
  const [hourly7dPositionHistory, setHourly7dPositionHistory] = useState<Array<{
    timestamp: number;
    assets: number;
    assetsUsd: number;
    shares: number;
  }>>([]);
  const [hourly30dPositionHistory, setHourly30dPositionHistory] = useState<Array<{
    timestamp: number;
    assets: number;
    assetsUsd: number;
    shares: number;
  }>>([]);
  const [activityFlowEvents, setActivityFlowEvents] = useState<ActivityFlowEvent[] | null>(null);
  const [externalTransactAction, setExternalTransactAction] = useState<'deposit' | 'withdraw' | null>(null);

  const isExternalVault =
    vaultData.isCurated === false || !isCuratedVaultAddress(vaultData.address);
  const morphoVaultUrl = getMorphoVaultUrl(vaultData.chainId, vaultData.address);

  // Get shares using balanceOf
  const { data: sharesRaw } = useReadContract({
    address: address ? vaultData.address as `0x${string}` : undefined,
    chainId: vaultData.chainId as typeof BASE_CHAIN_ID,
    abi: ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args: address ? [address as `0x${string}`] : undefined,
    query: { enabled: !!address },
  });

  // Convert shares to assets using convertToAssets
  const { data: assetsRaw } = useReadContract({
    address: sharesRaw !== undefined ? vaultData.address as `0x${string}` : undefined,
    chainId: vaultData.chainId as typeof BASE_CHAIN_ID,
    abi: ERC4626_ABI,
    functionName: 'convertToAssets',
    args: sharesRaw !== undefined ? [sharesRaw] : undefined,
    query: { enabled: sharesRaw !== undefined },
  });

  const currentAssetsRaw = useMemo(() => {
    if (assetsRaw !== undefined) return assetsRaw.toString();
    if (sharesRaw === BigInt(0)) return '0';
    return undefined;
  }, [assetsRaw, sharesRaw]);

  const earnedInterest = useVaultEarnedInterest(
    isConnected ? vaultData.address : undefined,
    vaultData.symbol,
    currentAssetsRaw
  );
  const interestDecimals = resolveAssetDecimals(
    vaultData.symbol,
    earnedInterest.assetDecimals || vaultData.assetDecimals
  );

  const depositAssetDecimals = resolveAssetDecimals(
    vaultData.symbol,
    vaultData.assetDecimals
  );

  const positionRawValue = useMemo(() => {
    return currentAssetsRaw ?? null;
  }, [currentAssetsRaw]);

  const userVaultTotalUsd = useMemo(() => {
    if (currentAssetsRaw === undefined) return 0;
    const assetsDecimal = Number(currentAssetsRaw) / 10 ** depositAssetDecimals;
    const symbolUpper = vaultData.symbol.toUpperCase();
    let assetPrice = 0;
    if (symbolUpper === 'USDC') {
      assetPrice = 1;
    } else if (symbolUpper === 'WETH') {
      assetPrice = ethPrice || 0;
    } else if (symbolUpper === 'CBBTC' || symbolUpper === 'CBTC') {
      assetPrice = btcPrice || 0;
    }
    return assetsDecimal * assetPrice;
  }, [currentAssetsRaw, depositAssetDecimals, vaultData.symbol, ethPrice, btcPrice]);

  useLockPageScroll(isTimeFrameMenuOpen);

  useEffect(() => {
    const fetchPositionHistory = async () => {
      if (!address) {
        setUserPositionHistory([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        // NOTE: Position history graphs use Graph API (via /api/vault/v2/[address]/position-history)
        // This provides historical data points for chart display
        // Current position balance uses RPC (balanceOf + convertToAssets) - see above
        const response = await fetch(
          `/api/vault/${vaultData.version}/${vaultData.address}/position-history?chainId=${vaultData.chainId}&userAddress=${address}&period=all`
        );
        
        // Validate HTTP response
        if (!response.ok) {
          throw new Error(`Failed to fetch position history: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json().catch(() => ({}));
        
        // Check for errors in response body (API returns 200 with error field for graceful errors)
        if (data.error) {
          logger.warn(
            'Position history API returned error',
            { 
              error: data.error,
              vaultAddress: vaultData.address, 
              userAddress: address,
              version: vaultData.version
            }
          );
        }
        
        // Set position history - use empty array if error or invalid response
        // Position history is fetched from Graph API for chart display
        // Current position is fetched via RPC (balanceOf + convertToAssets) - see above
        if (data && typeof data === 'object' && Array.isArray(data.history)) {
          setUserPositionHistory(data.history);
        } else {
          setUserPositionHistory([]);
        }
      } catch (error) {
        logger.error(
          'Failed to fetch vault position history',
          error instanceof Error ? error : new Error(String(error)),
          { vaultAddress: vaultData.address, userAddress: address, chainId: vaultData.chainId }
        );
        setUserPositionHistory([]);
        showErrorToast('Failed to load position data. Please refresh the page.', 5000);
      } finally {
        setLoading(false);
      }
    };

    fetchPositionHistory();
  }, [vaultData, address, showErrorToast]);

  // Fetch hourly data for 7D period
  useEffect(() => {
    const abortController = new AbortController();
    
    const fetch7dHourlyPosition = async () => {
      if (!address) {
        setHourly7dPositionHistory([]);
        return;
      }

      try {
        // Fetch 7D data with hourly intervals
        const response = await fetch(
          `/api/vault/${vaultData.version}/${vaultData.address}/position-history?chainId=${vaultData.chainId}&userAddress=${address}&period=7d`,
          { signal: abortController.signal }
        );
        
        if (!response.ok) {
          return; // Silently fail, will fall back to daily data
        }
        
        const data = await response.json().catch(() => ({}));
        
        // Check for errors in response body
        if (data.error) {
          return; // Silently fail, will fall back to daily data
        }
        
        // Set position history - use empty array if error or invalid response
        if (data && typeof data === 'object' && Array.isArray(data.history)) {
          setHourly7dPositionHistory(data.history);
        } else {
          setHourly7dPositionHistory([]);
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
        // Silently fail, will fall back to daily data
        logger.warn(
          'Failed to fetch 7D hourly position data, falling back to daily',
          { 
            vaultAddress: vaultData.address, 
            userAddress: address, 
            chainId: vaultData.chainId as typeof BASE_CHAIN_ID,
            error: error instanceof Error ? error.message : String(error)
          }
        );
        setHourly7dPositionHistory([]);
      }
    };

    fetch7dHourlyPosition();
    return () => abortController.abort();
  }, [vaultData.address, vaultData.chainId, vaultData.version, address]);

  // Fetch hourly data for 30D period
  useEffect(() => {
    const abortController = new AbortController();
    
    const fetch30dHourlyPosition = async () => {
      if (!address) {
        setHourly30dPositionHistory([]);
        return;
      }

      try {
        // Fetch 30D data with hourly intervals
        const response = await fetch(
          `/api/vault/${vaultData.version}/${vaultData.address}/position-history?chainId=${vaultData.chainId}&userAddress=${address}&period=30d`,
          { signal: abortController.signal }
        );
        
        if (!response.ok) {
          return; // Silently fail, will fall back to daily data
        }
        
        const data = await response.json().catch(() => ({}));
        
        // Check for errors in response body
        if (data.error) {
          return; // Silently fail, will fall back to daily data
        }
        
        // Set position history - use empty array if error or invalid response
        if (data && typeof data === 'object' && Array.isArray(data.history)) {
          setHourly30dPositionHistory(data.history);
        } else {
          setHourly30dPositionHistory([]);
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
        // Silently fail, will fall back to daily data
        logger.warn(
          'Failed to fetch 30D hourly position data, falling back to daily',
          { 
            vaultAddress: vaultData.address, 
            userAddress: address, 
            chainId: vaultData.chainId as typeof BASE_CHAIN_ID,
            error: error instanceof Error ? error.message : String(error)
          }
        );
        setHourly30dPositionHistory([]);
      }
    };

    fetch30dHourlyPosition();
    return () => abortController.abort();
  }, [vaultData.address, vaultData.chainId, vaultData.version, address]);

  useEffect(() => {
    const abortController = new AbortController();

    const fetchActivity = async () => {
      if (!address) {
        setActivityFlowEvents(null);
        return;
      }

      try {
        const response = await fetch(
          `/api/vault/v2/${vaultData.address}/activity?chainId=${vaultData.chainId}&userAddress=${address}`,
          { signal: abortController.signal }
        );

        if (!response.ok) {
          setActivityFlowEvents(null);
          return;
        }

        const data = await response.json().catch(() => ({}));
        if (data.error || !Array.isArray(data.deposits) || !Array.isArray(data.withdrawals)) {
          setActivityFlowEvents(null);
          return;
        }

        const events = buildActivityFlowEvents(data.deposits, data.withdrawals);
        setActivityFlowEvents(events.length > 0 ? events : null);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
        setActivityFlowEvents(null);
      }
    };

    void fetchActivity();
    return () => abortController.abort();
  }, [vaultData.address, vaultData.chainId, address]);

  // Get asset price for calculating USD value when assetsUsd is 0
  const getAssetPrice = useMemo(() => {
    const symbolUpper = vaultData.symbol.toUpperCase();
    if (symbolUpper === 'USDC') {
      return 1;
    } else if (symbolUpper === 'WETH' || symbolUpper === 'ETH') {
      return ethPrice || 0;
    } else if (symbolUpper === 'CBBTC' || symbolUpper === 'CBTC' || symbolUpper === 'BTC') {
      return btcPrice || 0;
    }
    return 0;
  }, [vaultData.symbol, ethPrice, btcPrice]);

  // Helper function to map position history to chart data format
  const mapPositionHistoryToChartData = useCallback((sourceData: Array<{ timestamp: number; assets: number; assetsUsd: number; shares: number }>) => {
    if (sourceData.length === 0) return [];
    
    return sourceData.map((point) => {
      // If assetsUsd is 0 but assets exists, calculate USD value from assets * assetPrice
      let calculatedUsd = point.assetsUsd;
      if (calculatedUsd === 0 && point.assets > 0 && getAssetPrice > 0) {
        calculatedUsd = point.assets * getAssetPrice;
      }
      return {
        timestamp: point.timestamp,
        date: formatDate(point.timestamp),
        valueUsd: Math.max(0, calculatedUsd),
        valueToken: Math.max(0, point.assets),
      };
    });
  }, [getAssetPrice]);

  // Map full position history to chart data format (for determining available time frames)
  // This should always use the full userPositionHistory, not filtered by selectedTimeFrame
  const fullUserDepositHistory = useMemo(() => {
    return mapPositionHistoryToChartData(userPositionHistory);
  }, [userPositionHistory, mapPositionHistoryToChartData]);

  // Calculate available time frames based on FULL data range (not filtered by selectedTimeFrame)
  // Find the minimum timestamp to ensure correctness even if data isn't sorted
  const availableTimeFrames = useMemo(() => {
    if (fullUserDepositHistory.length === 0) return ['all' as TimeFrame];

    // Find minimum timestamp to ensure correctness regardless of sort order
    // Use reduce instead of Math.min spread to avoid potential stack overflow with large arrays
    const oldestTimestamp = fullUserDepositHistory.reduce((min, d) => Math.min(min, d.timestamp), fullUserDepositHistory[0].timestamp);
    const dataRangeSeconds = now - oldestTimestamp;
    
    const frames: TimeFrame[] = ['all'];
    
    // Only add time frames that are <= the available data range
    if (dataRangeSeconds >= TIME_FRAME_SECONDS['1Y']) {
      frames.push('1Y');
    }
    // Only show '90D' if 90 days ago is after Oct 7, 2025
    if (dataRangeSeconds >= TIME_FRAME_SECONDS['90D'] && (now - TIME_FRAME_SECONDS['90D']) >= MIN_TIMESTAMP) {
      frames.push('90D');
    }
    if (dataRangeSeconds >= TIME_FRAME_SECONDS['30D']) {
      frames.push('30D');
    }
    if (dataRangeSeconds >= TIME_FRAME_SECONDS['7D']) {
      frames.push('7D');
    }
    
    return frames;
  }, [fullUserDepositHistory, now]);

  // Use GraphQL position history data directly - no calculation needed
  // This is used for displaying the chart, and switches between hourly/daily based on selectedTimeFrame
  // Reuses fullUserDepositHistory when not using hourly data to avoid redundant mapping
  const userDepositHistory = useMemo(() => {
    // Use hourly data for 7D and 30D periods, otherwise reuse fullUserDepositHistory
    if (selectedTimeFrame === '7D' && hourly7dPositionHistory.length > 0) {
      return mapPositionHistoryToChartData(hourly7dPositionHistory);
    } else if (selectedTimeFrame === '30D' && hourly30dPositionHistory.length > 0) {
      return mapPositionHistoryToChartData(hourly30dPositionHistory);
    }
    
    // Reuse fullUserDepositHistory when using daily data to avoid redundant mapping
    return fullUserDepositHistory;
  }, [selectedTimeFrame, hourly7dPositionHistory, hourly30dPositionHistory, fullUserDepositHistory, mapPositionHistoryToChartData]);

  // Filter chart data based on selected time frame and map to correct value type
  const filteredChartData = useMemo(() => {
    let data = userDepositHistory;
    
    if (selectedTimeFrame !== 'all' && userDepositHistory.length > 0) {
      const cutoffTimestamp = now - TIME_FRAME_SECONDS[selectedTimeFrame];
      data = userDepositHistory.filter(d => d.timestamp >= cutoffTimestamp);
    }
    
    // Map to include the correct value based on valueType
    const mappedData = data.map(item => ({
      ...item,
      value: valueType === 'usd' ? item.valueUsd : item.valueToken,
    }));
    
    // Find the first index with a non-zero value
    const firstNonZeroIndex = mappedData.findIndex(item => item.value > 0);
    
    // If we found a non-zero value, start from that point
    // Otherwise, return all data (user might not have any position yet)
    if (firstNonZeroIndex >= 0) {
      return mappedData.slice(firstNonZeroIndex);
    }
    
    return mappedData;
  }, [userDepositHistory, selectedTimeFrame, valueType, now]);

  const hasActivityBreakdown =
    activityFlowEvents !== null && activityFlowEvents.length > 0;

  const chartData = useMemo(() => {
    if (!hasActivityBreakdown || !activityFlowEvents) {
      return filteredChartData;
    }

    const scale = 10 ** depositAssetDecimals;

    return filteredChartData.map((item) => {
      const positionValueRaw = BigInt(Math.round(item.valueToken * scale));
      const netDepositRaw = netDepositRawAtTime(activityFlowEvents, item.timestamp);
      const { depositedRaw, interestRaw } = splitPositionValueAtPoint({
        positionValueRaw,
        netDepositRaw,
      });

      const depositedToken = Number(depositedRaw) / scale;
      const interestToken = Number(interestRaw) / scale;
      const totalValue = valueType === 'usd' ? item.valueUsd : item.valueToken;

      if (valueType === 'usd') {
        if (item.valueToken > 0) {
          const usdRatio = item.valueUsd / item.valueToken;
          return {
            ...item,
            deposited: depositedToken * usdRatio,
            interest: interestToken * usdRatio,
            value: totalValue,
          };
        }
        return {
          ...item,
          deposited: 0,
          interest: 0,
          value: totalValue,
        };
      }

      return {
        ...item,
        deposited: depositedToken,
        interest: interestToken,
        value: totalValue,
      };
    });
  }, [
    filteredChartData,
    hasActivityBreakdown,
    activityFlowEvents,
    depositAssetDecimals,
    valueType,
  ]);

  // Calculate Y-axis domain for better fit
  const yAxisDomain = useMemo(() => {
    if (chartData.length === 0) return [0, 100];
    
    const values = chartData.map((d) => d.value).filter((v) => v !== null && v !== undefined && !isNaN(v));
    const domain = calculateYAxisDomain(values, {
      bottomPaddingPercent: 0.25,
      topPaddingPercent: 0.2,
      thresholdPercent: 0.02,
    });
    
    return domain || [0, 100];
  }, [chartData]);

  // Helper function to calculate chart ticks based on time frame
  const getChartTicks = useMemo(() => {
    if (chartData.length === 0) return undefined;
    
    // Sort data once for all operations
    const sortedData = [...chartData].sort((a, b) => a.timestamp - b.timestamp);
    
    // Determine interval configuration based on selected time frame
    let dayInterval: number;
    
    if (selectedTimeFrame === '7D') {
      dayInterval = 1; // Every day
    } else if (selectedTimeFrame === '30D') {
      dayInterval = 2; // Every 2 days
    } else if (selectedTimeFrame === '90D') {
      dayInterval = 5; // Every 5 days
    } else if (selectedTimeFrame === '1Y') {
      dayInterval = 30; // Every 30 days
    } else {
      // Calculate dynamic interval based on data range for 'all'
      const firstTimestamp = sortedData[0].timestamp;
      const lastTimestamp = sortedData[sortedData.length - 1].timestamp;
      const totalDays = (lastTimestamp - firstTimestamp) / (24 * 60 * 60);
      
      // Determine interval based on total days
      if (totalDays > 365) {
        dayInterval = 30;
      } else if (totalDays > 180) {
        dayInterval = 12;
      } else if (totalDays > 90) {
        dayInterval = 10;
      } else if (totalDays > 60) {
        dayInterval = 7;
      } else if (totalDays > 30) {
        dayInterval = 5;
      } else {
        dayInterval = 3;
      }
    }
    
    // Generate ticks based on interval
    const ticks: number[] = [];
    const seenDates = new Set<string>();
    let dayCount = 0;
    
    sortedData.forEach((point) => {
      const date = new Date(point.timestamp * 1000);
      const dateKey = date.toDateString();
      
      if (!seenDates.has(dateKey)) {
        seenDates.add(dateKey);
        if (dayCount % dayInterval === 0) {
          ticks.push(point.timestamp);
        }
        dayCount++;
      }
    });
    
    return ticks.length > 0 ? ticks : undefined;
  }, [selectedTimeFrame, chartData]);
  

  const handleDeposit = () => {
    if (isExternalVault) {
      setExternalTransactAction('deposit');
      return;
    }
    router.push(`/transact?vault=${vaultData.address}&action=deposit`);
  };

  const handleWithdraw = () => {
    if (isExternalVault) {
      setExternalTransactAction('withdraw');
      return;
    }
    router.push(`/transact?vault=${vaultData.address}&action=withdraw`);
  };

  const formatChartValue = useCallback(
    (value: number) => {
      if (valueType === 'usd') {
        return formatCurrency(value);
      }
      return formatVaultChartTokenAmount(value, depositAssetDecimals, vaultData.symbol);
    },
    [valueType, depositAssetDecimals, vaultData.symbol]
  );

  return (
    <div className="space-y-6">
      <ExternalVaultTransactModal
        isOpen={externalTransactAction !== null}
        onClose={() => setExternalTransactAction(null)}
        morphoVaultUrl={morphoVaultUrl}
        action={externalTransactAction ?? 'deposit'}
      />
      {/* Position Value */}
      <div>
        <div className="flex flex-col md:flex-row items-start justify-between gap-6 mb-4">
          <div className="flex flex-col md:flex-row flex-1 w-full gap-6 md:gap-10">
            {/* Your Position — on-chain convertToAssets (matches withdraw / MAX) */}
            <div className="flex-1 w-full md:w-auto">
              <p className="text-xs text-[var(--foreground-secondary)] mb-1">Your Position</p>
              {!isConnected ? (
                <p className="text-sm text-[var(--foreground-muted)]">Connect wallet</p>
              ) : positionRawValue === null ? (
                <Skeleton width="8rem" height="2rem" />
              ) : (() => {
                try {
                  return BigInt(positionRawValue) <= BigInt(0);
                } catch {
                  return false;
                }
              })() ? (
                <p className="text-sm text-[var(--foreground-muted)]">No holdings</p>
              ) : (
                <>
                  <p className="text-2xl font-bold text-[var(--foreground)]">
                    {formatVaultDetailTokenAmount(
                      positionRawValue,
                      depositAssetDecimals,
                      vaultData.symbol
                    )}
                  </p>
                  <p className="text-xs text-[var(--foreground-secondary)] mt-1">
                    {formatPositionUsd(userVaultTotalUsd)}
                  </p>
                </>
              )}
            </div>

            {/* Earned Interest */}
            <div className="flex-1 w-full md:w-auto md:text-right">
              <p className="text-xs text-[var(--foreground-secondary)] mb-1">Earned Interest</p>
              {!isConnected ? (
                <p className="text-sm text-[var(--foreground-muted)]">Connect wallet</p>
              ) : earnedInterest.isLoading ? (
                <Skeleton width="8rem" height="2rem" />
              ) : (() => {
                try {
                  const raw = BigInt(earnedInterest.earnedInterestRaw || '0');
                  if (raw <= BigInt(0) && earnedInterest.earnedInterestUsd <= 0) {
                    return (
                      <>
                        <p className="text-2xl font-bold text-[var(--foreground)]">
                          {formatVaultDetailTokenAmount('0', interestDecimals, vaultData.symbol)}
                        </p>
                        <p className="text-xs text-[var(--foreground-secondary)] mt-1">
                          {formatCurrency(0)}
                        </p>
                      </>
                    );
                  }
                  return (
                    <>
                      <p className="text-2xl font-bold text-[var(--foreground)]">
                        {formatVaultDetailTokenAmount(
                          earnedInterest.earnedInterestRaw || '0',
                          interestDecimals,
                          vaultData.symbol
                        )}
                      </p>
                      <p className="text-xs text-[var(--foreground-secondary)] mt-1">
                        {formatCurrency(earnedInterest.earnedInterestUsd)}
                      </p>
                    </>
                  );
                } catch {
                  return <p className="text-sm text-[var(--foreground-muted)]">-</p>;
                }
              })()}
            </div>
          </div>

          {/* Transaction Buttons - Desktop: Show in second column */}
          {isConnected && (
            <div className="hidden md:flex gap-2">
              <Button
                onClick={handleDeposit}
                variant="primary"
                size="sm"
              >
                Deposit
              </Button>
              <Button
                onClick={handleWithdraw}
                variant="secondary"
                size="sm"
              >
                Withdraw
              </Button>
            </div>
          )}
        </div>
        
        {/* Transaction Buttons - Mobile: Show below deposits */}
        {isConnected && (
          <div className="flex md:hidden gap-2 mt-4">
            <Button
              onClick={handleDeposit}
              variant="primary"
              size="sm"
            >
              Deposit
            </Button>
            <Button
              onClick={handleWithdraw}
              variant="secondary"
              size="sm"
            >
              Withdraw
            </Button>
          </div>
        )}
      </div>

      {/* Chart */}
      {isConnected && address && (
        <div>
          {loading ? (
            <div className="bg-[var(--surface-elevated)] rounded-lg p-2 sm:p-4">
              {/* Controls Row Skeleton */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Skeleton width="3rem" height="2rem" />
                  <Skeleton width="3rem" height="2rem" />
                  <Skeleton width="3rem" height="2rem" />
                </div>
                <div className="flex items-center gap-2 bg-[var(--surface)] rounded-lg p-1">
                  <Skeleton width="3rem" height="2rem" />
                  <Skeleton width="4rem" height="2rem" />
                </div>
              </div>
              {/* Chart Skeleton */}
              <div className="h-80 p-4">
                <div className="h-full flex flex-col justify-between">
                  {/* Y-axis labels area */}
                  <div className="flex justify-between mb-2">
                    <Skeleton width="3rem" height="0.75rem" />
                    <Skeleton width="3rem" height="0.75rem" />
                  </div>
                  {/* Chart area with wave pattern */}
                  <div className="flex-1 flex items-end justify-between gap-1 px-2">
                    {[45, 52, 38, 60, 48, 55, 42, 58, 50, 47, 53, 40, 57, 45, 50, 48, 55, 42, 58, 45].map((heightPercent, index) => (
                      <Skeleton
                        key={index}
                        width="100%"
                        height={`${heightPercent}%`}
                        className="rounded-t"
                      />
                    ))}
                  </div>
                  {/* X-axis labels area */}
                  <div className="flex justify-between mt-2">
                    <Skeleton width="4rem" height="0.75rem" />
                    <Skeleton width="4rem" height="0.75rem" />
                  </div>
                </div>
              </div>
            </div>
          ) : fullUserDepositHistory.length > 0 ? (
            <div className="bg-[var(--surface-elevated)] rounded-lg p-2 sm:p-4">
              {/* Controls Row */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
                {/* Time Frame Selector - Desktop: Buttons, Mobile: Hamburger Menu */}
                <div className="relative">
                  {/* Desktop: Show buttons */}
                  <div className="hidden md:flex items-center gap-2">
                    {availableTimeFrames.map((timeFrame) => (
                      <Button
                        key={timeFrame}
                        onClick={() => setSelectedTimeFrame(timeFrame)}
                        variant={selectedTimeFrame === timeFrame ? 'primary' : 'ghost'}
                        size="sm"
                        className="min-w-[3rem]"
                      >
                        {timeFrame === 'all' ? 'All' : timeFrame}
                      </Button>
                    ))}
                  </div>

                  {/* Mobile: Hamburger Menu */}
                  <div className="md:hidden">
                    <button
                      onClick={() => setIsTimeFrameMenuOpen(!isTimeFrameMenuOpen)}
                      className="flex items-center gap-2 px-3 py-2 bg-[var(--surface)] rounded-lg border border-[var(--border)] hover:bg-[var(--surface-hover)] transition-colors"
                    >
                      <span className="text-sm font-medium text-[var(--foreground)]">
                        {selectedTimeFrame === 'all' ? 'All' : selectedTimeFrame}
                      </span>
                      <svg
                        className={`w-4 h-4 text-[var(--foreground-secondary)] transition-transform ${
                          isTimeFrameMenuOpen ? 'rotate-180' : ''
                        }`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {/* Dropdown Menu */}
                    {isTimeFrameMenuOpen && (
                      <>
                        <div
                          className="fixed inset-0 z-10 touch-none overscroll-none bg-black/20"
                          onClick={() => setIsTimeFrameMenuOpen(false)}
                        />
                        <div className="absolute left-0 top-full mt-2 bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg shadow-lg z-20 min-w-[120px]">
                          {availableTimeFrames.map((timeFrame) => (
                            <button
                              key={timeFrame}
                              onClick={() => {
                                setSelectedTimeFrame(timeFrame);
                                setIsTimeFrameMenuOpen(false);
                              }}
                              className={`w-full text-left px-4 py-2 text-sm transition-colors first:rounded-t-lg last:rounded-b-lg ${
                                selectedTimeFrame === timeFrame
                                  ? 'bg-[var(--primary-subtle)] text-[var(--primary)] font-medium'
                                  : 'text-[var(--foreground)] hover:bg-[var(--surface-hover)]'
                              }`}
                            >
                              {timeFrame === 'all' ? 'All' : timeFrame}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
                
                {/* Value Type Toggle */}
                <div className="flex items-center gap-2 bg-[var(--surface)] rounded-lg p-1">
                  <button
                    onClick={() => setValueType('token')}
                    className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all cursor-pointer ${
                      valueType === 'token'
                        ? 'bg-[var(--primary)] text-white'
                        : 'text-[var(--foreground-secondary)] hover:text-[var(--foreground)]'
                    }`}
                  >
                    {vaultData.symbol || 'Token'}
                  </button>
                  <button
                    onClick={() => setValueType('usd')}
                    className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all cursor-pointer ${
                      valueType === 'usd'
                        ? 'bg-[var(--primary)] text-white'
                        : 'text-[var(--foreground-secondary)] hover:text-[var(--foreground)]'
                    }`}
                  >
                    USD
                  </button>
                </div>
              </div>
              <div className="w-full min-w-0 h-80">
                <ResponsiveContainer width="100%" height="100%" minHeight={320} debounce={50}>
                  <AreaChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                    <XAxis 
                      dataKey="timestamp" 
                      tickFormatter={formatDate}
                      stroke="var(--foreground-secondary)"
                      style={{ fontSize: '12px' }}
                      interval="preserveStartEnd"
                      ticks={getChartTicks}
                    />
                    <YAxis 
                      domain={yAxisDomain}
                      tickFormatter={(value) => {
                        if (value === undefined || typeof value !== 'number') return '';
                        if (valueType === 'usd') {
                          if (value < 1000) {
                            return '$' + formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                          }
                          return '$' + formatNumber(value / 1000, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + 'k';
                        } else {
                          return formatVaultChartTokenAxisTick(
                            value,
                            depositAssetDecimals,
                            vaultData.symbol
                          );
                        }
                      }}
                      stroke="var(--foreground-secondary)"
                      style={{ fontSize: '12px' }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--surface-elevated)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '8px',
                      }}
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const point = payload[0]?.payload as {
                          deposited?: number;
                          interest?: number;
                          value?: number;
                        };
                        const timestamp =
                          typeof label === 'number' ? label : parseFloat(String(label));

                        if (
                          hasActivityBreakdown &&
                          point &&
                          (point.deposited !== undefined || point.interest !== undefined)
                        ) {
                          const deposited = point.deposited ?? 0;
                          const interest = point.interest ?? 0;
                          const total = point.value ?? deposited + interest;
                          return (
                            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2 text-sm shadow-sm">
                              <p className="mb-2 font-medium text-[var(--foreground)]">
                                {`Date: ${formatDate(timestamp)}`}
                              </p>
                              <div className="space-y-1 text-[var(--foreground-secondary)]">
                                <p>
                                  <span className="text-[var(--primary)]">Deposited:</span>{' '}
                                  {formatChartValue(deposited)}
                                </p>
                                <p>
                                  <span className="text-[var(--success)]">Earned interest:</span>{' '}
                                  {formatChartValue(interest)}
                                </p>
                                <p className="border-t border-[var(--border-subtle)] pt-1 font-medium text-[var(--foreground)]">
                                  Total: {formatChartValue(total)}
                                </p>
                              </div>
                            </div>
                          );
                        }

                        const value = payload[0]?.value;
                        if (typeof value !== 'number') return null;
                        return (
                          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2 text-sm shadow-sm">
                            <p className="mb-1 font-medium text-[var(--foreground)]">
                              {`Date: ${formatDate(timestamp)}`}
                            </p>
                            <p className="text-[var(--foreground-secondary)]">
                              Your Position: {formatChartValue(value)}
                            </p>
                          </div>
                        );
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="var(--primary)"
                      fill="var(--primary-subtle)"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, fill: 'var(--primary)', stroke: 'var(--primary)', strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <div className="bg-[var(--surface-elevated)] rounded-lg p-6 text-center">
              <p className="text-sm text-[var(--foreground-muted)]">
                No deposit history available. Make your first deposit to see your position over time.
              </p>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
