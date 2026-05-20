/**
 * Configuration constants for avatar verification
 */

/**
 * Minimum time (in milliseconds) to wait before verifying a pending upload
 * @default 5 minutes
 */
export const MIN_WAIT_TIME_MS = 5 * 60 * 1000;

/**
 * Cron expression for verification job frequency
 * @default Every 5 minutes
 */
export const VERIFICATION_CRON_EXPRESSION = '*/5 * * * *';
