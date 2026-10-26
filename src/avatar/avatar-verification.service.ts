import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EnsService } from '../ens/ens.service';
import { StorageService } from '../storage/storage.service';
import { PendingUploadQueueService, IPendingUploadEntry } from '../queue';
import { IVerificationMetrics } from './types/verification-metrics.type';
import { MIN_WAIT_TIME_MS } from './constants/verification.constants';
import { AvatarObservabilityService } from '../observability/avatar-observability.service';

/**
 * Service responsible for verifying pending avatar uploads via cron job.
 * Runs every 5 minutes to check if ENS records have been set for pending uploads.
 *
 * @remarks
 * This service ensures that:
 * - Uploads with verified ENS records are confirmed and removed from the queue
 * - Uploads without ENS records or mismatched owners are deleted
 * - The queue remains clean and up-to-date
 */
@Injectable()
export class AvatarVerificationService {
  private readonly logger = new Logger(AvatarVerificationService.name);
  private isProcessing = false;
  private readonly minWaitTimeMs = MIN_WAIT_TIME_MS;

  constructor(
    private readonly queueService: PendingUploadQueueService,
    private readonly ensService: EnsService,
    private readonly storageService: StorageService,
    private readonly observability: AvatarObservabilityService,
  ) {}

  /**
   * Cron job that runs every 5 minutes to verify pending uploads.
   * Uses CronExpression.EVERY_5_MINUTES (equivalent to '0 *\/5 * * * *')
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async processVerifications(): Promise<void> {
    // Prevent concurrent cron runs
    if (this.isProcessing) {
      this.logger.warn(
        'Previous verification process still running, skipping this cycle',
      );
      return;
    }

    this.isProcessing = true;
    const startTime = Date.now();
    this.logger.log('Starting pending upload verification process');

    try {
      await this.verifyPendingUploads();
    } catch (error) {
      this.logger.error({
        msg: 'Error in verification process',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    } finally {
      this.isProcessing = false;
      const duration = Date.now() - startTime;
      this.observability.recordPendingCycle(duration / 1000);
      this.logger.log({
        msg: 'Completed pending upload verification process',
        durationMs: duration,
      });
    }
  }

  /**
   * Process all pending uploads that are old enough to be verified
   */
  private async verifyPendingUploads(): Promise<void> {
    const cutoffTime = new Date(Date.now() - this.minWaitTimeMs);
    const itemsToProcess =
      await this.queueService.getItemsOlderThan(cutoffTime);

    if (itemsToProcess.length === 0) {
      this.logger.log('No pending uploads to verify');
      return;
    }

    this.logger.log({
      msg: 'Processing pending uploads',
      count: itemsToProcess.length,
      cutoffTime: cutoffTime.toISOString(),
    });

    const metrics: IVerificationMetrics = {
      processed: itemsToProcess.length,
      verified: 0,
      deleted: 0,
      superseded: 0,
      errors: 0,
    };

    for (const item of itemsToProcess) {
      try {
        const outcome = await this.verifyItem(item);
        metrics[outcome]++;
      } catch (error) {
        metrics.errors++;
        this.logger.error({
          msg: 'Error verifying item',
          subname: item.subname,
          network: item.network,
          fileType: item.fileType,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue processing other items even if one fails
      }
    }

    this.logger.log({
      msg: 'Verification cycle complete',
      ...metrics,
    });
  }

  /**
   * Verify a single pending upload item
   * - If the uploader is authorized: Remove from queue (success)
   * - If authorization is still pending or denied: Delete the pending upload
   * - If a lookup fails: Leave the upload queued for retry
   *
   * Cleanup only applies to the queued storage generation.
   */
  private async verifyItem(
    item: IPendingUploadEntry,
  ): Promise<'verified' | 'deleted' | 'superseded'> {
    const { subname, network, address, fileType, uploadedAt } = item;

    this.logger.log({
      msg: 'Verifying pending upload',
      subname,
      network,
      fileType,
      address,
      uploadedAt: uploadedAt.toISOString(),
      ageMinutes: Math.floor((Date.now() - uploadedAt.getTime()) / 60000),
    });

    try {
      const authorization = await this.ensService.getUploadAuthorization({
        subname,
        network,
        address,
        recordKey: fileType,
      });

      if (authorization === 'pending') {
        this.logger.log({
          msg: 'ENS authorization still pending, deleting pending upload',
          subname,
          network,
          fileType,
        });
        const deleted = await this.deleteUploadAndRemoveFromQueue(item);
        this.recordOutcome(
          item,
          deleted ? 'discarded_no_record' : 'superseded',
        );
        return deleted ? 'deleted' : 'superseded';
      }

      if (authorization === 'allowed') {
        this.logger.log({
          msg: 'ENS authorization verified, upload confirmed',
          subname,
          network,
          fileType,
          address,
        });
        const removed = await this.queueService.remove(
          subname,
          network,
          fileType,
          item.generation,
        );
        this.recordOutcome(item, removed ? 'confirmed' : 'superseded');
        return removed ? 'verified' : 'superseded';
      }

      this.logger.log({
        msg: 'Uploader is not authorized, deleting pending upload',
        subname,
        network,
        fileType,
        uploader: address,
      });
      const deleted = await this.deleteUploadAndRemoveFromQueue(item);
      this.recordOutcome(
        item,
        deleted ? 'discarded_owner_mismatch' : 'superseded',
      );
      return deleted ? 'deleted' : 'superseded';
    } catch (error) {
      // Log error and rethrow - let caller handle it
      this.logger.error({
        msg: 'Failed to verify item',
        subname,
        network,
        fileType,
        error: error instanceof Error ? error.message : String(error),
      });
      this.recordOutcome(item, 'error');
      throw error;
    }
  }

  /**
   * Delete file from storage and remove from queue
   */
  private async deleteUploadAndRemoveFromQueue(
    item: IPendingUploadEntry,
  ): Promise<boolean> {
    const { subname, network, fileType, generation } = item;
    const deleted = await this.storageService.delete(
      subname,
      network,
      fileType,
      generation,
    );
    await this.queueService.remove(subname, network, fileType, generation);
    return deleted;
  }

  private recordOutcome(
    item: IPendingUploadEntry,
    outcome:
      | 'confirmed'
      | 'discarded_no_record'
      | 'discarded_owner_mismatch'
      | 'superseded'
      | 'error',
  ): void {
    this.observability.recordPending(item.fileType, item.network, outcome);
    this.observability.logEvent('avatar.pending_verification.completed', {
      outcome,
      media_type: item.fileType,
      ens_name: item.subname,
      network: item.network,
      wallet_address: item.address,
      siwe_signed_domain: item.signedDomain,
      domain_evidence: 'signed_siwe_message',
      age_seconds: Math.floor((Date.now() - item.uploadedAt.getTime()) / 1000),
    });
  }
}
