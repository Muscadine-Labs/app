'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { InfoCircleIcon } from '@/components/ui/Icon';

const PANEL_WIDTH_PX = 288;

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
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const gap = 8;
    const maxLeft = window.innerWidth - PANEL_WIDTH_PX - 8;
    const left =
      align === 'end'
        ? Math.max(8, Math.min(rect.right - PANEL_WIDTH_PX, maxLeft))
        : Math.max(8, Math.min(rect.left, maxLeft));

    setPosition({ top: rect.bottom + gap, left });
  }, [align]);

  useEffect(() => {
    if (!open) return;

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [open]);

  const toggle = () => {
    if (!open) {
      updatePosition();
    }
    setOpen((prev) => !prev);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--surface)] text-[var(--foreground-secondary)] shadow-sm hover:border-[var(--primary)] hover:text-[var(--primary)] transition-colors cursor-pointer"
        aria-label={ariaLabel}
        aria-expanded={open}
      >
        <InfoCircleIcon size="xs" color="secondary" />
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[100]" aria-hidden onClick={() => setOpen(false)} />
            <div
              ref={panelRef}
              className="fixed z-[101] w-72 max-h-[min(70vh,24rem)] overflow-y-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] shadow-xl p-3"
              style={{ top: position.top, left: position.left }}
            >
              {children}
            </div>
          </>,
          document.body
        )}
    </>
  );
}
