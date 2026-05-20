import { Network } from '../../common/enums/network.enum';
import { FileType } from '../../common/enums/file-type.enum';

/**
 * Represents a pending upload awaiting ENS verification
 */
export interface IPendingUploadEntry {
  subname: string;
  network: Network;
  address: string;
  uploadedAt: Date;
  fileType: FileType;
}

/**
 * Interface for pending upload queue operations.
 * Allows for easy replacement with other queue implementations (Redis, BullMQ, etc.)
 */
export interface IPendingUploadQueue {
  /**
   * Add a new pending upload to the queue
   */
  add(entry: IPendingUploadEntry): Promise<void>;

  /**
   * Get all items that were uploaded before the specified date
   */
  getItemsOlderThan(date: Date): Promise<IPendingUploadEntry[]>;

  /**
   * Remove an item from the queue
   */
  remove(
    subname: string,
    network: Network,
    fileType: FileType,
  ): Promise<boolean>;

  /**
   * Get a specific item from the queue
   */
  get(
    subname: string,
    network: Network,
    fileType: FileType,
  ): Promise<IPendingUploadEntry | null>;

  /**
   * Get all items in the queue (useful for debugging)
   */
  getAll(): Promise<IPendingUploadEntry[]>;

  /**
   * Get the total number of items in the queue
   */
  size(): Promise<number>;
}
