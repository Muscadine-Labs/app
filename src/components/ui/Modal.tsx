'use client';

import React, { useEffect } from 'react';
import { CloseIcon } from './Icon';
import { useLockPageScroll } from '@/hooks/useLockPageScroll';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  showCloseButton?: boolean;
  closeOnOverlayClick?: boolean;
  /** Override default max-w-2xl panel width (e.g. max-w-md). */
  panelClassName?: string;
  headerClassName?: string;
  titleClassName?: string;
  contentClassName?: string;
  /** Bottom sheet on mobile, centered dialog from sm+. */
  layout?: 'center' | 'sheet';
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  showCloseButton = true,
  closeOnOverlayClick = false,
  panelClassName,
  headerClassName,
  titleClassName,
  contentClassName,
  layout = 'center',
}: ModalProps) {
  useLockPageScroll(isOpen);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleOverlayClick = () => {
    if (closeOnOverlayClick) {
      onClose();
    }
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-center ${
        layout === 'sheet'
          ? 'items-end p-0 sm:items-center sm:p-4'
          : 'items-center p-2 sm:p-4'
      }`}
      onClick={handleOverlayClick}
    >
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
      
      {/* Modal */}
      <div 
        className={`relative w-full flex flex-col overflow-hidden ${
          panelClassName ??
          `max-h-[95vh] sm:max-h-[90vh] ${
            layout === 'sheet'
              ? 'max-w-none rounded-t-2xl rounded-b-none sm:max-w-2xl sm:rounded-2xl'
              : 'max-w-2xl rounded-lg sm:rounded-2xl'
          } bg-[var(--surface)] shadow-xl border border-[var(--border)]`
        }`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'modal-title' : undefined}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div className={`flex items-center justify-between px-4 py-3 sm:px-6 sm:py-4 border-b border-[var(--border-subtle)] ${headerClassName ?? ''}`}>
            {title && (
              <h2 id="modal-title" className={`text-lg sm:text-xl font-semibold text-[var(--foreground)] ${titleClassName ?? ''}`}>
                {title}
              </h2>
            )}
            {showCloseButton && (
              <button
                onClick={onClose}
                className="ml-auto -mr-1 min-h-11 min-w-11 flex items-center justify-center hover:bg-[var(--surface-hover)] active:bg-[var(--surface-active)] rounded-md transition-colors text-[var(--foreground-secondary)] hover:text-[var(--foreground)] cursor-pointer touch-manipulation"
                aria-label="Close modal"
              >
                <CloseIcon size="md" />
              </button>
            )}
          </div>
        )}
        
        {/* Content */}
        <div className={`flex-1 overflow-y-auto overscroll-contain px-4 py-3 sm:px-6 sm:py-4 ${contentClassName ?? ''}`}>
          {children}
        </div>
      </div>
    </div>
  );
}
