import { Module } from '@nestjs/common';
import { PendingUploadQueueService } from './services';

/**
 * Queue module for managing pending operations across the application.
 *
 * @remarks
 * This module provides queue services that can be shared across multiple features.
 * Currently implements an in-memory queue for pending avatar uploads, but can be
 * extended to support Redis, BullMQ, or other queue implementations.
 */
@Module({
  providers: [PendingUploadQueueService],
  exports: [PendingUploadQueueService],
})
export class QueueModule {}
