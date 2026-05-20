/**
 * Metrics collected during a verification cycle
 */
export interface IVerificationMetrics {
  processed: number;
  verified: number;
  deleted: number;
  errors: number;
}

/**
 * Result of a single item verification
 */
export enum VerificationResult {
  VERIFIED = 'VERIFIED',
  DELETED_NO_RECORD = 'DELETED_NO_RECORD',
  DELETED_MISMATCH = 'DELETED_MISMATCH',
  ERROR = 'ERROR',
}
