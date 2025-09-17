import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { FileType, SupportedMimeTypes } from '../common/enums/file-type.enum';
import { StorageService } from '../storage/storage.service';
import { Network } from '../common/enums/network.enum';

type MultipartBufferFile = {
  filename: string;
  mimetype: string;
  data: Buffer;
  size: number;
};

type MultipartStreamFile = {
  type?: 'file';
  fieldname?: string;
  filename: string;
  encoding?: string;
  mimetype: string;
  toBuffer?: () => Promise<Buffer>;
};

type Uploadable = MultipartBufferFile | MultipartStreamFile | (MultipartBufferFile | MultipartStreamFile)[];

interface LocalRequest {
  body?: {
    avatar?: Uploadable;
    header?: Uploadable;
    file?: Uploadable;
    image?: Uploadable;
  };
}

function isBufferFile(f: unknown): f is MultipartBufferFile {
  return typeof f === 'object' && f !== null && 'data' in f;
}

function isStreamFile(f: unknown): f is MultipartStreamFile {
  return typeof f === 'object' && f !== null && 'toBuffer' in f;
}

export interface UploadResult {
  url: string;
  uploadedAt: string;
  fileSize: number;
  isUpdate: boolean;
}

@Injectable()
export class AvatarService {
  private readonly logger = new Logger(AvatarService.name);

  // Defaults can be overridden by env vars
  private readonly maxAvatarBytes = Number(process.env.MAX_AVATAR_BYTES_IN_MB || 2 * 1024 * 1024); // 2MB
  private readonly maxHeaderBytes = Number(process.env.MAX_HEADER_BYTES_IN_MB || 5 * 1024 * 1024); // 5MB

  constructor(private readonly storageService: StorageService) {}

  async upload(subname: string, network: Network, req: unknown, type: FileType): Promise<UploadResult> {
    const { buffer, mimetype } = await this.extractFileFromRequest(req, type);
    this.validate(buffer, mimetype, type);

    const existingFile = await this.storageService.getFileBuffer(subname, network, type);
    const isUpdate = !!existingFile;

    await this.storageService.save(subname, network, buffer, type, mimetype);
    const timestamp = isUpdate ? Date.now().toString() : undefined;
    const url = this.storageService.getPublicUrl(subname, network, type, timestamp);

    this.logger.log({ msg: 'Stored image', subname, network, type, url, isUpdate, size: buffer.length });
    return { url, uploadedAt: new Date().toISOString(), fileSize: buffer.length, isUpdate };
  }

  async delete(subname: string, network: Network, type: FileType): Promise<boolean> {
    const deleted = await this.storageService.delete(subname, network, type);
    return deleted;
  }

  private async extractFileFromRequest(req: unknown, type: FileType): Promise<{ buffer: Buffer; mimetype: string }> {
    const r = req as LocalRequest;
    const preferredField = type === FileType.HEADER ? 'header' : 'avatar';
    const rawField = r.body?.[preferredField as 'avatar'] ?? r.body?.file ?? r.body?.image;
    const fileField = Array.isArray(rawField) ? rawField[0] : rawField;
    if (!fileField) {
      throw new BadRequestException({ code: 'MISSING_FILE', details: { field: preferredField } });
    }

    let buffer: Buffer | undefined;
    let mimetype: string | undefined;
    if (isBufferFile(fileField)) {
      buffer = fileField.data;
      mimetype = fileField.mimetype;
    } else if (isStreamFile(fileField)) {
      buffer = await fileField.toBuffer!();
      mimetype = fileField.mimetype;
    }

    if (!buffer || !mimetype) {
      throw new BadRequestException({ code: 'MISSING_FILE', details: { field: preferredField } });
    }

    return { buffer, mimetype };
  }

  private validate(buffer: Buffer, mimetype: string, type: FileType): void {
    const allowed = new Set<string>([
      SupportedMimeTypes.JPEG,
      SupportedMimeTypes.PNG,
      SupportedMimeTypes.GIF,
      SupportedMimeTypes.WEBP,
    ]);
    if (!allowed.has(mimetype)) {
      throw new BadRequestException({ code: 'UNSUPPORTED_MIME', details: { mimetype } });
    }

    const maxBytes = type === FileType.HEADER ? this.maxHeaderBytes : this.maxAvatarBytes;
    if (buffer.length > maxBytes) {
      throw new BadRequestException({ code: 'FILE_TOO_LARGE', details: { maxBytes, actual: buffer.length, type } });
    }
  }
}


