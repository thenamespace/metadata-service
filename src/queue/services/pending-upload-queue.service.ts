import { Injectable, Logger } from '@nestjs/common';
import { Network } from '../../common/enums/network.enum';
import { FileType } from '../../common/enums/file-type.enum';
import { IPendingUploadEntry, IPendingUploadQueue } from '../interfaces';
import { AvatarObservabilityService } from '../../observability/avatar-observability.service';

/**
 * In-memory implementation of pending upload queue.
 * Uses a Map with composite keys for fast lookups.
 *
 * @remarks
 * This implementation loses data on service restart, which is acceptable
 * per requirements. For production with high reliability needs, consider
 * replacing with Redis or a persistent queue solution.
 */
@Injectable()
export class PendingUploadQueueService implements IPendingUploadQueue {
  private readonly logger = new Logger(PendingUploadQueueService.name);
  private readonly queue = new Map<string, IPendingUploadEntry>();

  constructor(private readonly observability: AvatarObservabilityService) {}

  /**
   * Generate a unique composite key for the queue entry
   */
  private getKey(
    subname: string,
    network: Network,
    fileType: FileType,
  ): string {
    return `${network}:${subname.toLowerCase()}:${fileType}`;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async add(entry: IPendingUploadEntry): Promise<void> {
    const key = this.getKey(entry.subname, entry.network, entry.fileType);
    this.queue.set(key, entry);
    this.observability.setPendingQueueSize(this.queue.size);
    this.logger.log({
      msg: 'Added to pending upload queue',
      subname: entry.subname,
      network: entry.network,
      fileType: entry.fileType,
      address: entry.address,
      uploadedAt: entry.uploadedAt.toISOString(),
      queueSize: this.queue.size,
    });
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getItemsOlderThan(date: Date): Promise<IPendingUploadEntry[]> {
    const items: IPendingUploadEntry[] = [];
    for (const entry of this.queue.values()) {
      if (entry.uploadedAt < date) {
        items.push(entry);
      }
    }
    return items;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async remove(
    subname: string,
    network: Network,
    fileType: FileType,
    expectedGeneration?: string,
  ): Promise<boolean> {
    const key = this.getKey(subname, network, fileType);
    if (
      expectedGeneration !== undefined &&
      this.queue.get(key)?.generation !== expectedGeneration
    ) {
      return false;
    }
    const deleted = this.queue.delete(key);
    this.observability.setPendingQueueSize(this.queue.size);
    if (deleted) {
      this.logger.log({
        msg: 'Removed from pending upload queue',
        subname,
        network,
        fileType,
        queueSize: this.queue.size,
      });
    }
    return deleted;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async get(
    subname: string,
    network: Network,
    fileType: FileType,
  ): Promise<IPendingUploadEntry | null> {
    const key = this.getKey(subname, network, fileType);
    return this.queue.get(key) || null;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getAll(): Promise<IPendingUploadEntry[]> {
    return Array.from(this.queue.values());
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async size(): Promise<number> {
    return this.queue.size;
  }
}
