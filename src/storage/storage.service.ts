import { Injectable, Logger } from '@nestjs/common';
import { Storage } from '@google-cloud/storage';
import { FileType } from '../common/enums/file-type.enum';
import { ConfigService } from '@nestjs/config';
import { Network, getNetworkPath } from '../common/enums/network.enum';

// Local structural types to avoid broad 'any' and unstable upstream types
type GoogleStorageLike = {
  bucket: (name: string) => {
    file: (path: string) => {
      save: (buffer: Buffer, opts: { metadata: { contentType: string; cacheControl?: string }; resumable?: boolean }) => Promise<void>;
      delete: () => Promise<void>;
      exists: () => Promise<[boolean]>;
      download: () => Promise<[Buffer]>;
      getMetadata: () => Promise<[{ contentType?: string }]>;
    };
  };
};

/**
 * Storage service for saving, reading, and deleting avatar and header files.
 * Supports Google Cloud Storage.
 */
@Injectable()
export class StorageService {
  private storage: GoogleStorageLike | null = null;
  private bucketName: string;
  private readonly logger = new Logger(StorageService.name);

  constructor(private readonly configService: ConfigService) {
    this.bucketName = this.configService.get<string>('GCLOUD_BUCKET_NAME') || 'avatars.namespace.ninja';
    this.initializeGCS();
  }

  private initializeGCS(): void {
    const projectId = this.configService.get<string>('GCLOUD_PROJECT_ID');
    const clientEmail = this.configService.get<string>('GCLOUD_BUCKET_CLIENT_EMAIL');
    const privateKeyBase64 = this.configService.get<string>('GCLOUD_BUCKET_PRIVATE_KEY');
    const privateKeyId = this.configService.get<string>('GCLOUD_BUCKET_PRIVATE_KEY_ID');
    if (!projectId) {
      throw new Error('GCLOUD_PROJECT_ID environment variable is required for GCS mode');
    }
    if (!clientEmail) {
      throw new Error('GCLOUD_BUCKET_CLIENT_EMAIL environment variable is required for GCS mode');
    }
    if (!privateKeyBase64) {
      throw new Error('GCLOUD_BUCKET_PRIVATE_KEY environment variable is required for GCS mode');
    }
    if (!privateKeyId) {
      throw new Error('GCLOUD_BUCKET_PRIVATE_KEY_ID environment variable is required for GCS mode');
    }
    
    // Decode base64-encoded private key to get proper PEM format
    const privateKey = Buffer.from(privateKeyBase64, 'base64').toString('utf-8');
    
    this.storage = new Storage({
      projectId,
      credentials: {
        client_email: clientEmail,
        private_key: privateKey,
        private_key_id: privateKeyId,
      },
    }) as unknown as GoogleStorageLike;
  }

  /**
   * Build a public URL for the stored file; adds a cache-busting timestamp on updates.
   */
  getPublicUrl(subname: string, network: Network, type: FileType = FileType.AVATAR, timestamp?: string): string {
    const basePath = this.getFilePath(subname, network, type);
    const baseUrl = `https://${this.bucketName}/${basePath}`;
    return timestamp ? `${baseUrl}?timestamp=${timestamp}` : baseUrl;
  }

  /**
   * Save a file to the configured storage backend with content type metadata.
   */
  async save(subname: string, network: Network, buffer: Buffer, type: FileType = FileType.AVATAR, contentType: string): Promise<void> {
    const filePath = this.getFilePath(subname, network, type);
    
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
    const filePath = this.getFilePath(subname, network, type);
    
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
    const filePath = this.getFilePath(subname, network, type);
    
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

  private getFilePath(
    subname: string,
    network: Network,
    type: FileType,
  ): string {
    const networkPath = getNetworkPath(network);
    return type === FileType.HEADER
      ? `${networkPath}${subname}/h`
      : `${networkPath}${subname}`;
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
