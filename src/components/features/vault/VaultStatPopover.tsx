'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon, InfoCircleIcon } from '@/components/ui/Icon';
import { useLockPageScroll } from '@/hooks/useLockPageScroll';

const PANEL_WIDTH_PX = 288;
const MOBILE_BREAKPOINT_PX = 640;

interface VaultStatPopoverProps {
  ariaLabel: string;
  children: ReactNode;
  /** Prefer end alignment for stats on the right side of the grid. */
  align?: 'start' | 'end';
}

export function VaultStatPopover({
  ariaLabel,
  children,
  align = 'start',
}: VaultStatPopoverProps) {
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useLockPageScroll(open);

  useEffect(() => {
    const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`);
    const update = () => setIsMobile(mediaQuery.matches);
    update();
    mediaQuery.addEventListener('change', update);
    return () => mediaQuery.removeEventListener('change', update);
  }, []);

  const updatePosition = useCallback(() => {
    const button = buttonRef.current;
    const panel = panelRef.current;
    if (!button || isMobile) return;

    const rect = button.getBoundingClientRect();
    const gap = 8;
    const panelHeight = panel?.offsetHeight ?? 240;
    const maxLeft = window.innerWidth - PANEL_WIDTH_PX - 8;
    const left =
      align === 'end'
        ? Math.max(8, Math.min(rect.right - PANEL_WIDTH_PX, maxLeft))
        : Math.max(8, Math.min(rect.left, maxLeft));

    const spaceBelow = window.innerHeight - rect.bottom - gap;
    const spaceAbove = rect.top - gap;
    let top = rect.bottom + gap;

    if (top + panelHeight > window.innerHeight - 8 && spaceAbove > spaceBelow) {
      top = rect.top - gap - panelHeight;
    }

    top = Math.max(8, Math.min(top, window.innerHeight - panelHeight - 8));

    setPosition({ top, left });
  }, [align, isMobile]);

  useEffect(() => {
    if (!open || isMobile) return;

    updatePosition();
    const frame = requestAnimationFrame(updatePosition);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, isMobile, updatePosition]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown, { passive: true });
    window.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const toggle = () => {
    setOpen((prev) => !prev);
  };

  const panelShellClassName =
    'rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] shadow-xl overscroll-contain flex flex-col';

  const panelHeader = (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-3 py-2.5">
      <span className="text-sm font-semibold text-[var(--foreground)]">{ariaLabel}</span>
      {isMobile && (
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md p-1.5 text-[var(--foreground-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)] cursor-pointer touch-manipulation"
          aria-label="Close"
        >
          <CloseIcon size="sm" />
        </button>
      )}
    </div>
  );

  const panelBody = (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">{children}</div>
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--surface)] text-[var(--foreground-secondary)] shadow-sm hover:border-[var(--primary)] hover:text-[var(--primary)] transition-colors cursor-pointer touch-manipulation"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <InfoCircleIcon size="xs" color="secondary" />
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-[100] bg-black/40 touch-none overscroll-none"
              aria-hidden
              onClick={() => setOpen(false)}
            />
            {isMobile ? (
              <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-label={ariaLabel}
                className={`fixed inset-x-0 bottom-0 z-[101] max-h-[min(85dvh,32rem)] ${panelShellClassName} pb-[max(0.75rem,env(safe-area-inset-bottom))] rounded-b-none rounded-t-2xl`}
              >
                {panelHeader}
                {panelBody}
              </div>
            ) : (
              <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-label={ariaLabel}
                className={`fixed z-[101] w-72 max-h-[min(70vh,24rem)] ${panelShellClassName}`}
                style={{ top: position.top, left: position.left }}
              >
                {panelHeader}
                {panelBody}
              </div>
            )}
          </>,
          document.body
        )}
    </>
  );
}
