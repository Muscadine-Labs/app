'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useAdvisoryAgreement } from '@/contexts/AdvisoryAgreementContext';

export function AdvisoryAgreementModal() {
  const { shouldShowModal, acceptAgreement, closeModal } = useAdvisoryAgreement();
  
  // Track previous modal state to detect when it opens
  const prevModalOpenRef = useRef(false);
  
  // Initialize checkboxes state
  const [checkboxes, setCheckboxes] = useState({
    agreement: false,
    risks: false,
    jurisdiction: false,
  });
  
  // Reset checkboxes when modal opens
  // Using setTimeout(0) is a standard React pattern for resetting form state after render
  // This avoids blocking the render cycle while ensuring state resets when modal opens
  useEffect(() => {
    if (shouldShowModal && !prevModalOpenRef.current) {
      // Modal just opened - reset checkboxes asynchronously
      const timeoutId = setTimeout(() => {
        setCheckboxes({
          agreement: false,
          risks: false,
          jurisdiction: false,
        });
      }, 0);
      prevModalOpenRef.current = true;
      return () => clearTimeout(timeoutId);
    }
    if (!shouldShowModal) {
      prevModalOpenRef.current = false;
    }
  }, [shouldShowModal]);

  const allChecked = checkboxes.agreement && checkboxes.risks && checkboxes.jurisdiction;

  const handleCheckboxChange = (key: keyof typeof checkboxes) => {
    setCheckboxes(prev => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleAccept = () => {
    if (allChecked) {
      acceptAgreement();
    }
  };

  const handleClose = () => {
    // Just close the modal without declining - user can reopen it later
    closeModal();
  };

  return (
    <Modal
      isOpen={shouldShowModal}
      onClose={handleClose}
      showCloseButton={true}
      closeOnOverlayClick={false}
    >
      <div className="space-y-3 sm:space-y-4">
        {/* Header Content */}
        <div>
          <h2 className="text-base sm:text-lg font-semibold text-[var(--foreground)] mb-1">
            Advisory Agreement
          </h2>
          <p className="text-xs sm:text-sm text-[var(--foreground-secondary)]">
            Please review and accept the following terms before connecting your wallet.
          </p>
        </div>

        {/* Main Content */}
        <div className="space-y-1.5 sm:space-y-2">
          <p className="text-xs sm:text-sm text-[var(--foreground)] leading-relaxed">
            By connecting your wallet, you access Muscadine Labs curated Morpho vault strategies configured under our disclosed strategy and risk parameters. You retain custody at all times—we do not hold your keys or take possession of your assets.
          </p>

          <p className="text-xs sm:text-sm text-[var(--foreground)] leading-relaxed">
            You sign your own deposits and withdrawals into non-custodial smart contracts. Third-party DeFi protocols (including Morpho) provide infrastructure only; they do not custody assets or provide investment advice. Muscadine provides risk curation and this interface—not financial, tax, or legal advice.
          </p>

          <p className="text-xs sm:text-sm text-[var(--foreground)] leading-relaxed">
            Returns are not guaranteed; losses, liquidations, and smart-contract risks are possible, including total loss of principal.
          </p>

          {/* Links */}
          <div className="pt-1 flex flex-col sm:flex-row gap-4 sm:gap-6">
            {/* Legal Documents Section */}
            <div className="px-0 flex-1">
              <h3 className="text-xs font-semibold text-[var(--foreground-secondary)] uppercase tracking-wider mb-1.5 sm:mb-2">
                Legal Documents
              </h3>
              <div className="space-y-0">
                <a
                  href="https://muscadine.io/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block py-1 sm:py-1.5 text-xs sm:text-sm text-[var(--foreground)] hover:text-[var(--primary)] transition-colors cursor-pointer"
                >
                  Terms of Use
                </a>
                <a
                  href="https://muscadine.io/legal"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block py-1 sm:py-1.5 text-xs sm:text-sm text-[var(--foreground)] hover:text-[var(--primary)] transition-colors cursor-pointer"
                >
                  Legal Disclaimer
                </a>
                <a
                  href="https://muscadine.io/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block py-1 sm:py-1.5 text-xs sm:text-sm text-[var(--foreground)] hover:text-[var(--primary)] transition-colors cursor-pointer"
                >
                  Privacy Policy
                </a>
                <a
                  href="https://muscadine.io/risk"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block py-1 sm:py-1.5 text-xs sm:text-sm text-[var(--foreground)] hover:text-[var(--primary)] transition-colors cursor-pointer"
                >
                  Risk Framework
                </a>
              </div>
            </div>

            {/* Company Section */}
            <div className="px-0 flex-1">
              <h3 className="text-xs font-semibold text-[var(--foreground-secondary)] uppercase tracking-wider mb-1.5 sm:mb-2">
                Company
              </h3>
              <div className="space-y-0">
                <a
                  href="https://analytics.muscadine.io"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block py-1 sm:py-1.5 text-xs sm:text-sm text-[var(--foreground)] hover:text-[var(--primary)] transition-colors cursor-pointer"
                >
                  Risk Analytics
                </a>
                <a
                  href="https://docs.muscadine.io"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block py-1 sm:py-1.5 text-xs sm:text-sm text-[var(--foreground)] hover:text-[var(--primary)] transition-colors cursor-pointer"
                >
                  Documentation
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Checkboxes */}
        <div className="space-y-1.5 sm:space-y-2 pt-1">
          <label className="flex items-start gap-2 sm:gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={checkboxes.agreement}
              onChange={() => handleCheckboxChange('agreement')}
              className="mt-0.5 sm:mt-1 w-4 h-4 rounded border-[var(--border)] text-[var(--primary)] focus:ring-[var(--primary)] focus:ring-offset-0 cursor-pointer flex-shrink-0"
            />
            <span className="text-xs sm:text-sm text-[var(--foreground)] group-hover:text-[var(--foreground-secondary)] leading-relaxed">
              I have read and agree with the{' '}
              <a
                href="https://muscadine.io/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--primary)] hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                Terms of Use
              </a>
              .
            </span>
          </label>

          <label className="flex items-start gap-2 sm:gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={checkboxes.risks}
              onChange={() => handleCheckboxChange('risks')}
              className="mt-0.5 sm:mt-1 w-4 h-4 rounded border-[var(--border)] text-[var(--primary)] focus:ring-[var(--primary)] focus:ring-offset-0 cursor-pointer flex-shrink-0"
            />
            <span className="text-xs sm:text-sm text-[var(--foreground)] group-hover:text-[var(--foreground-secondary)] leading-relaxed">
              I have read the{' '}
              <a
                href="https://muscadine.io/risk"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--primary)] hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                risk framework
              </a>
              {' '}and understand that returns are not guaranteed.
            </span>
          </label>

          <label className="flex items-start gap-2 sm:gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={checkboxes.jurisdiction}
              onChange={() => handleCheckboxChange('jurisdiction')}
              className="mt-0.5 sm:mt-1 w-4 h-4 rounded border-[var(--border)] text-[var(--primary)] focus:ring-[var(--primary)] focus:ring-offset-0 cursor-pointer flex-shrink-0"
            />
            <span className="text-xs sm:text-sm text-[var(--foreground)] group-hover:text-[var(--foreground-secondary)] leading-relaxed">
              I am not located in a country or region subject to{' '}
              <a
                href="https://ofac.treasury.gov/sanctions-programs-and-country-information"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--primary)] hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                U.S. economic sanctions
              </a>
              .
            </span>
          </label>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 pt-2 sm:pt-3 border-t border-[var(--border-subtle)]">
          <Button
            variant="primary"
            onClick={handleAccept}
            disabled={!allChecked}
            fullWidth
            className="flex-1"
          >
            Agree & Continue
          </Button>
        </div>
      </div>
    </Modal>
  );
}
