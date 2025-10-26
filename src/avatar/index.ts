/**
 * Public API for the avatar module
 */

// Module
export { AvatarModule } from './avatar.module';

// Services
export { AvatarVerificationService } from './avatar-verification.service';
export { AvatarService } from './avatar.service';

// Types
export { IVerificationMetrics, VerificationResult } from './types/verification-metrics.type';

// Constants
export { MIN_WAIT_TIME_MS, VERIFICATION_CRON_EXPRESSION } from './constants/verification.constants';

