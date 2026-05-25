'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { VAULTS } from '@/lib/vaults';
import { calculateYAxisDomain } from '@/lib/vault-utils';
import {
  aggregatePortfolioHistory,
  mapPortfolioHistoryToChartData,
  PositionHistoryPoint,
} from '@/lib/portfolio-utils';
import { formatCurrency, formatNumber } from '@/lib/formatter';
import { logger } from '@/lib/logger';
import { useUnixTimestamp } from '@/hooks/useClientOnly';
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
  version: 'v1' | 'v2';
  chainId: number;
}

async function fetchVaultHistory(
  vault: PortfolioVault,
  userAddress: string,
  period: string,
  signal?: AbortSignal
): Promise<PositionHistoryPoint[]> {
  const response = await fetch(
    `/api/vault/${vault.version}/${vault.address}/position-history?chainId=${vault.chainId}&userAddress=${userAddress}&period=${period}`,
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
  const [dailyHistory, setDailyHistory] = useState<PositionHistoryPoint[]>([]);
  const [hourly7dHistory, setHourly7dHistory] = useState<PositionHistoryPoint[]>([]);
  const [hourly30dHistory, setHourly30dHistory] = useState<PositionHistoryPoint[]>([]);

  const portfolioVaults = useMemo<PortfolioVault[]>(
    () =>
      Object.values(VAULTS).map((vault) => ({
        address: vault.address,
        version: vault.version,
        chainId: vault.chainId,
      })),
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
        const histories = await Promise.all(
          portfolioVaults.map((vault) =>
            fetchVaultHistory(vault, address, period, signal)
          )
        );
        setter(aggregatePortfolioHistory(histories));
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
        logger.warn('Failed to fetch portfolio position history', {
          error: error instanceof Error ? error.message : String(error),
        });
        setter([]);
      }
    },
    [address, portfolioVaults]
  );

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
    <div className="flex flex-col rounded-lg bg-[var(--surface)] h-full min-h-[320px] w-full overflow-hidden">
      <div className="px-4 sm:px-6 py-4 border-b border-[var(--border)]">
        <h2 className="text-md text-[var(--foreground)]">Portfolio Value</h2>
        <p className="text-sm text-[var(--foreground-secondary)] mt-1">
          Combined USD value across your vault deposits
        </p>
      </div>

      <div className="flex-1 p-2 sm:p-4 min-h-0">
        {!isConnected ? (
          <div className="h-full min-h-[280px] flex items-center justify-center bg-[var(--surface-elevated)] rounded-lg">
            <p className="text-sm text-[var(--foreground-muted)]">Connect wallet to view portfolio history</p>
          </div>
        ) : loading ? (
          <div className="bg-[var(--surface-elevated)] rounded-lg p-4 h-full min-h-[280px]">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Skeleton width="3rem" height="2rem" />
                <Skeleton width="3rem" height="2rem" />
              </div>
            </div>
            <div className="h-64">
              <Skeleton width="100%" height="100%" />
            </div>
          </div>
        ) : fullChartHistory.length > 0 ? (
          <div className="bg-[var(--surface-elevated)] rounded-lg p-2 sm:p-4 h-full min-h-[280px] flex flex-col">
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
                    onClick={() => setIsTimeFrameMenuOpen(!isTimeFrameMenuOpen)}
                    className="flex items-center gap-2 px-3 py-2 bg-[var(--surface)] rounded-lg border border-[var(--border)] hover:bg-[var(--surface-hover)] transition-colors"
                  >
                    <span className="text-sm font-medium text-[var(--foreground)]">
                      {selectedTimeFrame === 'all' ? 'All' : selectedTimeFrame}
                    </span>
                  </button>

                  {isTimeFrameMenuOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
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

            <div className="flex-1 min-h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
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
          <div className="h-full min-h-[280px] flex items-center justify-center bg-[var(--surface-elevated)] rounded-lg px-6 text-center">
            <p className="text-sm text-[var(--foreground-muted)]">
              No deposit history available yet. Make your first deposit to see your portfolio over time.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
