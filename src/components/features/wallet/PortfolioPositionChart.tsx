'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAccount } from 'wagmi';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { calculateYAxisDomain } from '@/lib/vault-utils';
import {
  aggregatePortfolioHistory,
  mapPortfolioHistoryToChartData,
  PositionHistoryPoint,
} from '@/lib/portfolio-utils';
import { formatCurrency, formatNumber } from '@/lib/formatter';
import { logger } from '@/lib/logger';
import { useUnixTimestamp } from '@/hooks/useClientOnly';
import { useLockPageScroll } from '@/hooks/useLockPageScroll';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Button } from '@/components/ui';
import { Skeleton } from '@/components/ui/Skeleton';

type TimeFrame = 'all' | '1Y' | '90D' | '30D' | '7D';

const TIME_FRAME_SECONDS: Record<TimeFrame, number> = {
  all: 0,
  '1Y': 365 * 24 * 60 * 60,
  '90D': 90 * 24 * 60 * 60,
  '30D': 30 * 24 * 60 * 60,
  '7D': 7 * 24 * 60 * 60,
};

const MIN_TIMESTAMP = 1759795200;

const formatDate = (timestamp: number) => {
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

interface PortfolioVault {
  address: string;
  chainId: number;
  symbol: string;
}

async function fetchUserPortfolioVaults(
  userAddress: string,
  signal?: AbortSignal
): Promise<PortfolioVault[]> {
  const response = await fetch(
    `/api/user/morpho-positions?address=${userAddress}&chainId=${BASE_CHAIN_ID}&includeEmpty=true`,
    { signal }
  );

  if (!response.ok) return [];

  const data = await response.json().catch(() => ({ positions: [] }));
  const seenAddresses = new Set<string>();

  return (data.positions ?? []).flatMap((p: { vault: { address: string; symbol: string } }) => {
    const key = p.vault.address.toLowerCase();
    if (seenAddresses.has(key)) return [];
    seenAddresses.add(key);
    return [{
      address: p.vault.address,
      chainId: BASE_CHAIN_ID,
      symbol: p.vault.symbol,
    }];
  });
}

async function fetchVaultHistory(
  vault: PortfolioVault,
  userAddress: string,
  period: string,
  signal?: AbortSignal
): Promise<PositionHistoryPoint[]> {
  const response = await fetch(
    `/api/vault/v2/${vault.address}/position-history?chainId=${vault.chainId}&userAddress=${userAddress}&period=${period}`,
    { signal }
  );

  if (!response.ok) return [];

  const data = await response.json().catch(() => ({}));
  if (!Array.isArray(data.history)) return [];

  return data.history.map((point: { timestamp: number; assetsUsd: number }) => ({
    timestamp: point.timestamp,
    assetsUsd: Math.max(0, point.assetsUsd ?? 0),
  }));
}

export default function PortfolioPositionChart() {
  const { address, isConnected } = useAccount();
  const now = useUnixTimestamp();
  const [loading, setLoading] = useState(true);
  const [selectedTimeFrame, setSelectedTimeFrame] = useState<TimeFrame>('all');
  const [isTimeFrameMenuOpen, setIsTimeFrameMenuOpen] = useState(false);
  useLockPageScroll(isTimeFrameMenuOpen);
  const [dailyHistory, setDailyHistory] = useState<PositionHistoryPoint[]>([]);
  const [hourly7dHistory, setHourly7dHistory] = useState<PositionHistoryPoint[]>([]);
  const [hourly30dHistory, setHourly30dHistory] = useState<PositionHistoryPoint[]>([]);
  const portfolioVaultsCache = useRef<{ address: string; vaults: PortfolioVault[] } | null>(null);

  const getPortfolioVaults = useCallback(
    async (userAddress: string, signal: AbortSignal): Promise<PortfolioVault[]> => {
      if (
        portfolioVaultsCache.current?.address === userAddress.toLowerCase()
      ) {
        return portfolioVaultsCache.current.vaults;
      }

      const vaults = await fetchUserPortfolioVaults(userAddress, signal);
      portfolioVaultsCache.current = {
        address: userAddress.toLowerCase(),
        vaults,
      };
      return vaults;
    },
    []
  );

  const fetchAggregatedHistory = useCallback(
    async (
      period: string,
      signal: AbortSignal,
      setter: (history: PositionHistoryPoint[]) => void
    ) => {
      if (!address) {
        setter([]);
        return;
      }

      try {
        const portfolioVaults = await getPortfolioVaults(address, signal);
        if (portfolioVaults.length === 0) {
          setter([]);
          return;
        }

        const vaultHistories = await Promise.all(
          portfolioVaults.map(async (vault) => {
            try {
              return await fetchVaultHistory(vault, address, period, signal);
            } catch (error) {
              if (error instanceof Error && error.name === 'AbortError') {
                throw error;
              }

              logger.warn('Failed to fetch vault position history', {
                vaultAddress: vault.address,
                error: error instanceof Error ? error.message : String(error),
              });

              return [];
            }
          })
        );
        setter(aggregatePortfolioHistory(vaultHistories));
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
        logger.warn('Failed to fetch portfolio position history', {
          error: error instanceof Error ? error.message : String(error),
        });
        setter([]);
      }
    },
    [address, getPortfolioVaults]
  );

  useEffect(() => {
    portfolioVaultsCache.current = null;
  }, [address]);

  useEffect(() => {
    if (!address) {
      return;
    }

    const abortController = new AbortController();
    let cancelled = false;

    const loadDailyHistory = async () => {
      setLoading(true);
      await fetchAggregatedHistory('all', abortController.signal, (history) => {
        if (!cancelled) {
          setDailyHistory(history);
        }
      });
      if (!cancelled) {
        setLoading(false);
      }
    };

    loadDailyHistory();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [address, fetchAggregatedHistory]);

  useEffect(() => {
    if (!address) {
      return;
    }

    const abortController = new AbortController();

    fetchAggregatedHistory('7d', abortController.signal, setHourly7dHistory);

    return () => abortController.abort();
  }, [address, fetchAggregatedHistory]);

  useEffect(() => {
    if (!address) {
      return;
    }

    const abortController = new AbortController();

    fetchAggregatedHistory('30d', abortController.signal, setHourly30dHistory);

    return () => abortController.abort();
  }, [address, fetchAggregatedHistory]);

  const fullChartHistory = useMemo(() => {
    return mapPortfolioHistoryToChartData(dailyHistory, formatDate);
  }, [dailyHistory]);

  const availableTimeFrames = useMemo(() => {
    if (fullChartHistory.length === 0) return ['all' as TimeFrame];

    const oldestTimestamp = fullChartHistory.reduce(
      (min, point) => Math.min(min, point.timestamp),
      fullChartHistory[0].timestamp
    );
    const dataRangeSeconds = now - oldestTimestamp;
    const frames: TimeFrame[] = ['all'];

    if (dataRangeSeconds >= TIME_FRAME_SECONDS['1Y']) frames.push('1Y');
    if (
      dataRangeSeconds >= TIME_FRAME_SECONDS['90D'] &&
      now - TIME_FRAME_SECONDS['90D'] >= MIN_TIMESTAMP
    ) {
      frames.push('90D');
    }
    if (dataRangeSeconds >= TIME_FRAME_SECONDS['30D']) frames.push('30D');
    if (dataRangeSeconds >= TIME_FRAME_SECONDS['7D']) frames.push('7D');

    return frames;
  }, [fullChartHistory, now]);

  const activeHistory = useMemo(() => {
    if (selectedTimeFrame === '7D' && hourly7dHistory.length > 0) {
      return mapPortfolioHistoryToChartData(hourly7dHistory, formatDate);
    }
    if (selectedTimeFrame === '30D' && hourly30dHistory.length > 0) {
      return mapPortfolioHistoryToChartData(hourly30dHistory, formatDate);
    }
    return fullChartHistory;
  }, [selectedTimeFrame, hourly7dHistory, hourly30dHistory, fullChartHistory]);

  const filteredChartData = useMemo(() => {
    let data = activeHistory;

    if (selectedTimeFrame !== 'all' && activeHistory.length > 0) {
      const cutoffTimestamp = now - TIME_FRAME_SECONDS[selectedTimeFrame];
      data = activeHistory.filter((point) => point.timestamp >= cutoffTimestamp);

      // The aggregated series is forward-filled, so if no datapoint falls inside the
      // window (e.g. stale upstream buckets), carry the last known value forward
      // instead of rendering an empty chart.
      if (data.length === 0) {
        const lastPoint = activeHistory[activeHistory.length - 1];
        data = [
          { ...lastPoint, timestamp: cutoffTimestamp, date: formatDate(cutoffTimestamp) },
          { ...lastPoint, timestamp: now, date: formatDate(now) },
        ];
      }
    }

    const firstNonZeroIndex = data.findIndex((point) => point.value > 0);
    if (firstNonZeroIndex >= 0) {
      return data.slice(firstNonZeroIndex);
    }

    return data;
  }, [activeHistory, selectedTimeFrame, now]);

  const yAxisDomain = useMemo(() => {
    if (filteredChartData.length === 0) return [0, 100];

    const values = filteredChartData
      .map((point) => point.value)
      .filter((value) => value !== null && value !== undefined && !Number.isNaN(value));

    return (
      calculateYAxisDomain(values, {
        bottomPaddingPercent: 0.25,
        topPaddingPercent: 0.2,
        thresholdPercent: 0.02,
      }) || [0, 100]
    );
  }, [filteredChartData]);

  const getChartTicks = useMemo(() => {
    if (filteredChartData.length === 0) return undefined;

    const sortedData = [...filteredChartData].sort((a, b) => a.timestamp - b.timestamp);
    let dayInterval: number;

    if (selectedTimeFrame === '7D') dayInterval = 1;
    else if (selectedTimeFrame === '30D') dayInterval = 2;
    else if (selectedTimeFrame === '90D') dayInterval = 5;
    else if (selectedTimeFrame === '1Y') dayInterval = 30;
    else {
      const totalDays =
        (sortedData[sortedData.length - 1].timestamp - sortedData[0].timestamp) /
        (24 * 60 * 60);
      if (totalDays > 365) dayInterval = 30;
      else if (totalDays > 180) dayInterval = 12;
      else if (totalDays > 90) dayInterval = 10;
      else if (totalDays > 60) dayInterval = 7;
      else if (totalDays > 30) dayInterval = 5;
      else dayInterval = 3;
    }

    const ticks: number[] = [];
    const seenDates = new Set<string>();
    let dayCount = 0;

    sortedData.forEach((point) => {
      const dateKey = new Date(point.timestamp * 1000).toDateString();
      if (!seenDates.has(dateKey)) {
        seenDates.add(dateKey);
        if (dayCount % dayInterval === 0) {
          ticks.push(point.timestamp);
        }
        dayCount++;
      }
    });

    return ticks.length > 0 ? ticks : undefined;
  }, [selectedTimeFrame, filteredChartData]);

  return (
    <div className="flex flex-col rounded-lg bg-[var(--surface)] h-full min-h-[280px] sm:min-h-[320px] w-full overflow-hidden">
      <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-[var(--border)]">
        <h2 className="text-sm sm:text-md text-[var(--foreground)]">Portfolio Value</h2>
        <p className="text-xs sm:text-sm text-[var(--foreground-secondary)] mt-0.5 sm:mt-1">
          Combined USD value across your vault deposits
        </p>
      </div>

      <div className="flex-1 p-2 sm:p-4 min-h-0">
        {!isConnected ? (
          <div className="h-[220px] sm:h-full sm:min-h-[280px] flex items-center justify-center bg-[var(--surface-elevated)] rounded-lg px-4">
            <p className="text-sm text-[var(--foreground-muted)]">Connect wallet to view portfolio history</p>
          </div>
        ) : loading ? (
          <div className="bg-[var(--surface-elevated)] rounded-lg p-3 sm:p-4 h-[220px] sm:h-full sm:min-h-[280px]">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Skeleton width="3rem" height="2rem" />
                <Skeleton width="3rem" height="2rem" />
              </div>
            </div>
            <div className="h-48 sm:h-64">
              <Skeleton width="100%" height="100%" />
            </div>
          </div>
        ) : fullChartHistory.length > 0 ? (
          <div className="bg-[var(--surface-elevated)] rounded-lg p-2 sm:p-4 flex flex-col min-h-[280px]">
            <div className="flex items-center justify-between mb-4">
              <div className="relative">
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

                <div className="md:hidden">
                  <button
                    type="button"
                    onClick={() => setIsTimeFrameMenuOpen(!isTimeFrameMenuOpen)}
                    className="flex items-center gap-2 px-3 py-2 min-h-[36px] bg-[var(--surface)] rounded-lg border border-[var(--border)] hover:bg-[var(--surface-hover)] transition-colors touch-manipulation"
                  >
                    <span className="text-sm font-medium text-[var(--foreground)]">
                      {selectedTimeFrame === 'all' ? 'All' : selectedTimeFrame}
                    </span>
                    <svg
                      className={`w-4 h-4 text-[var(--foreground-secondary)] transition-transform ${isTimeFrameMenuOpen ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      strokeWidth="2"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

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
            </div>

            <div className="w-full min-w-0 h-[240px]">
              <ResponsiveContainer width="100%" height="100%" minHeight={240} debounce={50}>
                <AreaChart data={filteredChartData}>
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
                      if (value < 1000) {
                        return '$' + formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                      }
                      return '$' + formatNumber(value / 1000, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + 'k';
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
                    formatter={(value) => {
                      if (value === undefined || typeof value !== 'number') return ['', 'Portfolio'];
                      return [formatCurrency(value), 'Portfolio'];
                    }}
                    labelFormatter={(label) => {
                      const timestamp = typeof label === 'number' ? label : parseFloat(String(label));
                      return `Date: ${formatDate(timestamp)}`;
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
          <div className="h-[220px] sm:h-full sm:min-h-[280px] flex items-center justify-center bg-[var(--surface-elevated)] rounded-lg px-4 text-center">
            <p className="text-sm text-[var(--foreground-muted)]">
              No deposit history available yet. Make your first deposit to see your portfolio over time.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
