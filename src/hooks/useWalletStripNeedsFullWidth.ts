'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';

/** Matches dashboard `min-[1000px]:grid-cols-2` breakpoint. */
const DASHBOARD_SPLIT_MQ = '(min-width: 1000px)';

/** Tailwind `gap-4` between grid columns at the split breakpoint. */
const GRID_GAP_PX = 16;

/**
 * Wallet card horizontal chrome (px-4/sm:px-5 × 2 + border) so we compare
 * strip content against usable half-column width, not raw half viewport.
 */
const WALLET_CHROME_X_PX = 42;

/** Enter/leave wide mode with light hysteresis (avoids flicker without lagging resize). */
const ENTER_SLACK_PX = 8;
const EXIT_SLACK_PX = 24;

/** useLayoutEffect in the browser; useEffect during SSR (avoids React warning). */
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

type Options = {
  /** Outer dashboard content width (full row / grid container). */
  viewportRef: RefObject<HTMLElement | null>;
  /** Wallet strip inner row sized with `w-max` (intrinsic content width). */
  stripRef: RefObject<HTMLElement | null>;
  /** Only relevant when a right column exists on desktop. */
  enabled: boolean;
  /** Remeasure when balances / name / loading change. */
  layoutKey: string;
};

/**
 * Desktop only: if the wallet strip's intrinsic width won't fit in half the
 * dashboard (beside Your Vaults), expand wallet full-width and align vaults
 * with the portfolio chart. Mobile stays a simple stack (never "wide").
 */
export function useWalletStripNeedsFullWidth({
  viewportRef,
  stripRef,
  enabled,
  layoutKey,
}: Options): boolean {
  const [wide, setWide] = useState(false);
  const wideRef = useRef(false);

  useIsomorphicLayoutEffect(() => {
    const apply = (next: boolean) => {
      if (wideRef.current === next) return;
      wideRef.current = next;
      setWide(next);
    };

    if (!enabled) {
      apply(false);
      return;
    }

    const measure = () => {
      if (typeof window === 'undefined') return;

      const isSplitLayout = window.matchMedia(DASHBOARD_SPLIT_MQ).matches;
      if (!isSplitLayout) {
        apply(false);
        return;
      }

      const viewport = viewportRef.current;
      const strip = stripRef.current;
      if (!viewport || !strip) return;

      const availableHalf =
        (viewport.clientWidth - GRID_GAP_PX) / 2 - WALLET_CHROME_X_PX;
      if (availableHalf <= 0) return;

      // Prefer scrollWidth; fall back to offsetWidth if max-w-full collapsed scrollWidth.
      const needed = Math.ceil(Math.max(strip.scrollWidth, strip.offsetWidth));
      const current = wideRef.current;

      if (!current && needed > availableHalf - ENTER_SLACK_PX) {
        apply(true);
        return;
      }
      if (current && needed < availableHalf - EXIT_SLACK_PX) {
        apply(false);
      }
    };

    const ro = new ResizeObserver(() => measure());
    let observedViewport: HTMLElement | null = null;
    let observedStrip: HTMLElement | null = null;
    let raf = 0;
    let tries = 0;

    const syncObservers = () => {
      const viewport = viewportRef.current;
      const strip = stripRef.current;

      if (viewport && viewport !== observedViewport) {
        if (observedViewport) ro.unobserve(observedViewport);
        ro.observe(viewport);
        observedViewport = viewport;
      }
      if (strip && strip !== observedStrip) {
        if (observedStrip) ro.unobserve(observedStrip);
        ro.observe(strip);
        observedStrip = strip;
      }

      measure();

      // WalletOverview may mount measureRef one frame after enabled flips true.
      if ((!viewport || !strip) && tries < 20) {
        tries += 1;
        raf = window.requestAnimationFrame(syncObservers);
      }
    };

    syncObservers();

    const mql = window.matchMedia(DASHBOARD_SPLIT_MQ);
    const onMq = () => measure();
    mql.addEventListener('change', onMq);
    window.addEventListener('resize', measure);

    return () => {
      window.cancelAnimationFrame(raf);
      ro.disconnect();
      mql.removeEventListener('change', onMq);
      window.removeEventListener('resize', measure);
    };
  }, [enabled, layoutKey, viewportRef, stripRef]);

  return wide;
}

/** Desktop two-column dashboard (`min-[1000px]`). Mobile stays a single stack. */
export function useIsDashboardSplitLayout(): boolean {
  const [split, setSplit] = useState(false);

  useIsomorphicLayoutEffect(() => {
    const mql = window.matchMedia(DASHBOARD_SPLIT_MQ);
    const update = () => setSplit(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  return split;
}
