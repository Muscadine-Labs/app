/**
 * Shared transaction types for consistent progress tracking.
 */

export type TransactionProgressStep = 
  | { type: 'planned'; totalSteps: number; stepLabels: string[] }
  | { type: 'signing'; stepIndex: number; totalSteps: number; stepLabel: string }
  | { type: 'approving'; stepIndex: number; totalSteps: number; stepLabel: string; contractAddress: string; txHash?: string }
  | { type: 'confirming'; stepIndex: number; totalSteps: number; stepLabel: string; txHash: string };

export type TransactionProgressCallback = (step: TransactionProgressStep) => void;
