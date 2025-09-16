import { Injectable, Logger } from '@nestjs/common';
import { Storage } from '@google-cloud/storage';
import fs from 'node:fs/promises';
import path from 'node:path';
import { FileType, StorageMode } from '../common/enums/file-type.enum';
import { Network, getNetworkPath } from '../common/enums/network.enum';

/**
 * Storage service for saving, reading, and deleting avatar and header files.
 * Supports local filesystem and Google Cloud Storage modes.
 */
@Injectable()
export class StorageService {
  private storage: Storage | null = null;
  private bucketName: string;
  private mode: StorageMode;
  private readonly logger = new Logger(StorageService.name);

  constructor() {
    this.bucketName = process.env.GCLOUD_BUCKET_NAME || 'avatars.namespace.ninja';
    this.mode = process.env.STORAGE_MODE === StorageMode.LOCAL ? StorageMode.LOCAL : StorageMode.GCS;
    
    if (this.mode === StorageMode.GCS) {
      this.initializeGCS();
    }
  }

  private initializeGCS(): void {
    const projectId = process.env.GCLOUD_PROJECT_ID;
    const clientEmail = process.env.GCLOUD_BUCKET_CLIENT_EMAIL;
    const privateKeyB64 = process.env.GCLOUD_BUCKET_PRIVATE_KEY;
    const scopes = process.env.GCLOUD_SCOPES;

    if (!privateKeyB64) {
      throw new Error('GCLOUD_BUCKET_PRIVATE_KEY environment variable is required for GCS mode');
    }
    if (!projectId) {
      throw new Error('GCLOUD_PROJECT_ID environment variable is required for GCS mode');
    }
    if (!clientEmail) {
      throw new Error('GCLOUD_BUCKET_CLIENT_EMAIL environment variable is required for GCS mode');
    }
    if (!scopes) {
      throw new Error('GCLOUD_SCOPES environment variable is required for GCS mode');
    }

    const privateKey = Buffer.from(privateKeyB64, 'base64').toString('utf8').replace(/\\n/g, '\n');

    this.storage = new Storage({
      projectId,
      scopes: [scopes],
      credentials: {
        client_email: clientEmail,
        private_key: privateKey,
      },
    });
  }

  /**
   * Build a public URL for the stored file; adds a cache-busting timestamp on updates.
   */
  getPublicUrl(subname: string, network: Network, type: FileType = FileType.AVATAR, timestamp?: string): string {
    const networkPath = getNetworkPath(network);
    const basePath = `${networkPath}subname/${subname}/${type === FileType.HEADER ? 'header' : 'avatar'}`;
    const baseUrl = this.mode === StorageMode.LOCAL
      ? `/static/${networkPath}subname/${subname}/${type === FileType.HEADER ? 'header' : 'avatar'}`
      : `https://${this.bucketName}/${basePath}`;
    return timestamp ? `${baseUrl}?timestamp=${timestamp}` : baseUrl;
  }

  /**
   * Save a file to the configured storage backend with content type metadata.
   */
  async save(subname: string, network: Network, buffer: Buffer, type: FileType = FileType.AVATAR, contentType: string): Promise<void> {
    const fileName = type === FileType.HEADER ? 'header' : 'avatar';
    const networkPath = getNetworkPath(network);
    const filePath = `${networkPath}subname/${subname}/${fileName}`;
    
    if (this.mode === StorageMode.LOCAL) {
      const root = path.resolve(process.cwd(), 'public', networkPath, 'subname', subname);
      await fs.mkdir(root, { recursive: true });
      await fs.writeFile(path.join(root, fileName), buffer);
      return;
    }

    if (!this.storage) {
      throw new Error('GCS storage not initialized');
    }

    const file = this.storage.bucket(this.bucketName).file(filePath);
    await file.save(buffer, {
      metadata: {
        contentType,
        cacheControl: 'max-age=3600',
      },
      resumable: false,
    });
  }

  /**
   * Delete a stored file; returns true if deleted or existed, false if missing.
   */
  async delete(subname: string, network: Network, type: FileType = FileType.AVATAR): Promise<boolean> {
    const fileName = type === FileType.HEADER ? 'header' : 'avatar';
    const networkPath = getNetworkPath(network);
    const filePath = `${networkPath}subname/${subname}/${fileName}`;
    
    if (this.mode === StorageMode.LOCAL) {
      const p = path.resolve(process.cwd(), 'public', networkPath, 'subname', subname, fileName);
      try {
        await fs.rm(p, { force: true });
        return true;
      } catch {
        return false;
      }
    }

    if (!this.storage) {
      throw new Error('GCS storage not initialized');
    }

    const file = this.storage.bucket(this.bucketName).file(filePath);
    const [exists] = await file.exists();
    if (!exists) return false;
    await file.delete();
    return true;
  }

  /**
   * Download a stored file and return its buffer and content type if present.
   */
  async getFileBuffer(subname: string, network: Network, type: FileType): Promise<{ buffer: Buffer; contentType: string } | null> {
    const fileName = type === FileType.HEADER ? 'header' : 'avatar';
    const networkPath = getNetworkPath(network);
    const filePath = `${networkPath}subname/${subname}/${fileName}`;
    
    if (this.mode === StorageMode.LOCAL) {
      const p = path.resolve(process.cwd(), 'public', networkPath, 'subname', subname, fileName);
      try {
        const buffer = await fs.readFile(p);
        // Try to detect content type from file extension or use default
        const contentType = this.detectContentType(buffer);
        return { buffer, contentType };
      } catch (error) {
        this.logger.warn(`Local file not found: ${p}, error: ${error}`);
        return null;
      }
    }

    if (!this.storage) {
      throw new Error('GCS storage not initialized');
    }

    const file = this.storage.bucket(this.bucketName).file(filePath);
    const [exists] = await file.exists();
    if (!exists) return null;

    try {
      const [buffer] = await file.download();
      const [metadata] = await file.getMetadata();
      const contentType = metadata.contentType || this.detectContentType(buffer);
      return { buffer, contentType };
    } catch (error) {
      this.logger.error(`Failed to download file from GCS: ${filePath}, error: ${error}`);
      return null;
    }
  }

  private detectContentType(buffer: Buffer): string {
    // Simple content type detection based on file signatures
    if (buffer.length >= 4) {
      // PNG signature
      if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
        return 'image/png';
      }
      // JPEG signature
      if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
        return 'image/jpeg';
      }
      // WebP signature
      if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
        return 'image/webp';
      }
      // GIF signature
      if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
        return 'image/gif';
      }
    }
    
    // Check for SVG (text-based)
    const text = buffer.toString('utf8', 0, Math.min(100, buffer.length));
    if (text.includes('<svg') || text.includes('<?xml')) {
      return 'image/svg+xml';
    }
    
    // Default fallback
    return 'image/jpeg';
  }
}