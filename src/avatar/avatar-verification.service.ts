import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EnsService } from '../ens/ens.service';
import { StorageService } from '../storage/storage.service';
import { Network } from '../common/enums/network.enum';
import { FileType } from '../common/enums/file-type.enum';
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
      errors: 0,
    };

    for (const item of itemsToProcess) {
      try {
        const wasDeleted = await this.verifyItem(item);
        if (wasDeleted) {
          metrics.deleted++;
        } else {
          metrics.verified++;
        }
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
   * - If ENS record matches uploader address: Remove from queue (success)
   * - If ENS record is null or different: Delete from storage and remove from queue
   *
   * @returns true if the upload was deleted, false if it was verified
   */
  private async verifyItem(item: IPendingUploadEntry): Promise<boolean> {
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
      // Check current ENS record
      const ensOwner = await this.ensService.getOwnerOrNull({
        subname,
        network,
      });

      if (ensOwner === null) {
        // No ENS record exists - delete the pending upload
        this.logger.log({
          msg: 'No ENS record found, deleting pending upload',
          subname,
          network,
          fileType,
        });
        await this.deleteUploadAndRemoveFromQueue(subname, network, fileType);
        this.recordOutcome(item, 'discarded_no_record');
        return true;
      }

      if (ensOwner.toLowerCase() === address.toLowerCase()) {
        // ENS record matches uploader - verification successful
        this.logger.log({
          msg: 'ENS record verified, upload confirmed',
          subname,
          network,
          fileType,
          address,
        });
        await this.queueService.remove(subname, network, fileType);
        this.recordOutcome(item, 'confirmed');
        return false;
      }

      // ENS record exists but doesn't match uploader - delete the pending upload
      this.logger.log({
        msg: 'ENS record does not match uploader, deleting pending upload',
        subname,
        network,
        fileType,
        uploader: address,
        ensOwner,
      });
      await this.deleteUploadAndRemoveFromQueue(subname, network, fileType);
      this.recordOutcome(item, 'discarded_owner_mismatch');
      return true;
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
    subname: string,
    network: Network,
    fileType: FileType,
  ): Promise<void> {
    try {
      // Delete from storage
      const deleted = await this.storageService.delete(
        subname,
        network,
        fileType,
      );
      this.logger.log({
        msg: 'Deleted pending upload from storage',
        subname,
        network,
        fileType,
        deleted,
      });
    } catch (error) {
      this.logger.error({
        msg: 'Error deleting from storage',
        subname,
        network,
        fileType,
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue to remove from queue even if storage deletion fails
    }

    // Remove from queue
    await this.queueService.remove(subname, network, fileType);
  }

  private recordOutcome(
    item: IPendingUploadEntry,
    outcome:
      | 'confirmed'
      | 'discarded_no_record'
      | 'discarded_owner_mismatch'
      | 'error',
  ): void {
    this.observability.recordPending(
      item.fileType,
      item.network,
      outcome,
      item.parentGroup,
    );
    this.observability.logEvent('avatar.pending_verification.completed', {
      outcome,
      media_type: item.fileType,
      ens_name: item.subname,
      ens_parent_group: item.parentGroup,
      network: item.network,
      wallet_address: item.address,
      siwe_signed_domain: item.signedDomain,
      domain_evidence: 'signed_siwe_message',
      age_seconds: Math.floor((Date.now() - item.uploadedAt.getTime()) / 1000),
    });
  }
}
