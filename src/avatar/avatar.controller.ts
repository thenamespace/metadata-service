import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { StorageService } from '../storage/storage.service';
import { EnsService } from '../ens/ens.service';
import { DeleteRateLimit, UploadRateLimit } from '../rate-limit/rate-limit.decorators';
import { AuthGuard } from '@nestjs/passport';
import { Logger } from '@nestjs/common';
import { FileType } from '../common/enums/file-type.enum';
import { ErrorCodes } from '../common/enums/error-codes.enum';
import { AvatarUploadResponseDto, DeleteResponseDto, HeaderUploadResponseDto } from './dto/avatar-responses.dto';

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

function isBufferFile(f: unknown): f is MultipartBufferFile {
  return typeof f === 'object' && f !== null && 'data' in f;
}

function isStreamFile(f: unknown): f is MultipartStreamFile {
  return typeof f === 'object' && f !== null && 'toBuffer' in f;
}

interface LocalRequest {
  user?: { address?: string };
  body?: {
    avatar?: MultipartBufferFile | MultipartStreamFile | (MultipartBufferFile | MultipartStreamFile)[];
    header?: MultipartBufferFile | MultipartStreamFile | (MultipartBufferFile | MultipartStreamFile)[];
    file?: MultipartBufferFile | MultipartStreamFile | (MultipartBufferFile | MultipartStreamFile)[];
    image?: MultipartBufferFile | MultipartStreamFile | (MultipartBufferFile | MultipartStreamFile)[];
  };
}

/**
 * Avatar controller for uploading, updating, deleting avatar and header images.
 * Requires JWT auth and ENS ownership for mutations.
 */
@ApiTags('avatar')
@ApiBearerAuth()
@Controller('avatar')
export class AvatarController {
  private readonly logger = new Logger(AvatarController.name);
  constructor(
    private readonly storageService: StorageService,
    private readonly ensService: EnsService,
  ) {}

  @Post(':subname')
  @UploadRateLimit()
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: 'Upload or update avatar for a subname' })
  @ApiParam({ name: 'subname', example: 'avatar.offchainsub.eth' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        avatar: {
          type: 'string',
          format: 'binary',
          description: 'Image file (jpg, jpeg, png, gif, webp)',
        },
      },
      required: ['avatar'],
    },
  })
  @ApiOkResponse({
    description: 'Avatar uploaded or updated',
    type: AvatarUploadResponseDto,
    schema: {
      example: {
        subname: 'avatar.offchainsub.eth',
        avatarUrl: 'https://avatars.namespace.ninja/subname/avatar.offchainsub.eth/avatar?timestamp=1757935476031',
        uploadedAt: '2025-09-15T11:24:36.031Z',
        fileSize: 97500,
        isUpdate: true,
      },
    },
  })
  @HttpCode(HttpStatus.OK)
  async upload(
    @Param('subname') subname: string,
    @Req() req: unknown,
  ) {
    const r = req as LocalRequest;
    this.logger.log({ msg: 'Upload hit', subname, hasBody: !!r.body, fields: r.body ? Object.keys(r.body) : [] });
    const userAddress = r.user?.address;
    this.logger.log({ msg: 'Auth info', userAddressPresent: !!userAddress });
    if (!userAddress) throw new BadRequestException({ code: ErrorCodes.UNAUTHORIZED });
    await this.ensService.assertOwnerOrThrow({ subname, address: userAddress });

    const rawField = r.body?.avatar ?? r.body?.file ?? r.body?.image;
    const fileField = Array.isArray(rawField) ? rawField[0] : rawField;
    this.logger.log({ msg: 'File field check', hasFile: !!fileField });
    if (!fileField) {
      throw new BadRequestException({ code: ErrorCodes.MISSING_FILE, details: { field: 'avatar' } });
    }

    // Support both buffered and streamed multipart objects
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
      throw new BadRequestException({ code: ErrorCodes.MISSING_FILE, details: { field: 'avatar' } });
    }

    // Check if file already exists to determine if this is an update
    const existingFile = await this.storageService.getFileBuffer(subname, FileType.AVATAR);
    const isUpdate = !!existingFile;
    
    // Store original file unchanged
    await this.storageService.save(subname, buffer, FileType.AVATAR, mimetype);

    const timestamp = isUpdate ? Date.now().toString() : undefined;
    const avatarUrl = this.storageService.getPublicUrl(subname, FileType.AVATAR, timestamp);
    this.logger.log({ msg: 'Upload success', subname, avatarUrl, isUpdate });
    return {
      subname,
      avatarUrl,
      uploadedAt: new Date().toISOString(),
      fileSize: buffer.length,
      isUpdate,
    };
  }

  @Delete(':subname')
  @DeleteRateLimit()
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: 'Delete avatar for a subname' })
  @ApiParam({ name: 'subname', example: 'avatar.offchainsub.eth' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    description: 'Avatar deleted',
    type: DeleteResponseDto,
    schema: {
      example: {
        subname: 'avatar.offchainsub.eth',
        message: 'Avatar deleted successfully',
        deletedAt: '2025-09-15T11:27:50.626Z',
      },
    },
  })
  async delete(
    @Param('subname') subname: string,
    @Req() req: unknown,
  ) {
    const r = req as LocalRequest;
    const userAddress = r.user?.address;
    this.logger.log({ msg: 'Delete hit', subname, userAddressPresent: !!userAddress });
    if (!userAddress) throw new BadRequestException({ code: ErrorCodes.UNAUTHORIZED });
    await this.ensService.assertOwnerOrThrow({ subname, address: userAddress });

    const deleted = await this.storageService.delete(subname, FileType.AVATAR);
    this.logger.log({ msg: 'Delete result', subname, deleted });
    if (!deleted) {
      throw new BadRequestException({ code: ErrorCodes.NOT_FOUND });
    }

    return {
      subname,
      message: 'Avatar deleted successfully',
      deletedAt: new Date().toISOString(),
    };
  }

  @Post(':subname/header')
  @UploadRateLimit()
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: 'Upload or update header image for a subname' })
  @ApiParam({ name: 'subname', example: 'avatar.offchainsub.eth' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        header: {
          type: 'string',
          format: 'binary',
          description: 'Header image file (jpg, jpeg, png, gif, webp)',
        },
      },
      required: ['header'],
    },
  })
  @ApiOkResponse({
    description: 'Header uploaded or updated',
    type: HeaderUploadResponseDto,
    schema: {
      example: {
        subname: 'avatar.offchainsub.eth',
        headerUrl: 'https://avatars.namespace.ninja/subname/avatar.offchainsub.eth/header',
        uploadedAt: '2025-09-15T11:27:08.925Z',
        fileSize: 131131,
        isUpdate: false,
      },
    },
  })
  @HttpCode(HttpStatus.OK)
  async uploadHeader(
    @Param('subname') subname: string,
    @Req() req: unknown,
  ) {
    const r = req as LocalRequest;
    this.logger.log({ msg: 'Header upload hit', subname, hasBody: !!r.body, fields: r.body ? Object.keys(r.body) : [] });
    const userAddress = r.user?.address;
    this.logger.log({ msg: 'Auth info', userAddressPresent: !!userAddress });
    if (!userAddress) throw new BadRequestException({ code: ErrorCodes.UNAUTHORIZED });
    await this.ensService.assertOwnerOrThrow({ subname, address: userAddress });

    const rawField = r.body?.header ?? r.body?.file ?? r.body?.image;
    const fileField = Array.isArray(rawField) ? rawField[0] : rawField;
    this.logger.log({ msg: 'File field check', hasFile: !!fileField });
    if (!fileField) {
      throw new BadRequestException({ code: ErrorCodes.MISSING_FILE, details: { field: 'header' } });
    }

    // Support both buffered and streamed multipart objects
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
      throw new BadRequestException({ code: ErrorCodes.MISSING_FILE, details: { field: 'header' } });
    }

    // Check if file already exists to determine if this is an update
    const existingFile = await this.storageService.getFileBuffer(subname, FileType.HEADER);
    const isUpdate = !!existingFile;
    
    // Store original file unchanged
    await this.storageService.save(subname, buffer, FileType.HEADER, mimetype);

    const timestamp = isUpdate ? Date.now().toString() : undefined;
    const headerUrl = this.storageService.getPublicUrl(subname, FileType.HEADER, timestamp);
    this.logger.log({ msg: 'Header upload success', subname, headerUrl, isUpdate });
    return {
      subname,
      headerUrl,
      uploadedAt: new Date().toISOString(),
      fileSize: buffer.length,
      isUpdate,
    };
  }

  @Delete(':subname/header')
  @DeleteRateLimit()
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: 'Delete header image for a subname' })
  @ApiParam({ name: 'subname', example: 'avatar.offchainsub.eth' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    description: 'Header deleted',
    type: DeleteResponseDto,
    schema: {
      example: {
        subname: 'avatar.offchainsub.eth',
        message: 'Header deleted successfully',
        deletedAt: '2025-09-15T11:27:50.626Z',
      },
    },
  })
  async deleteHeader(
    @Param('subname') subname: string,
    @Req() req: unknown,
  ) {
    const r = req as LocalRequest;
    const userAddress = r.user?.address;
    this.logger.log({ msg: 'Header delete hit', subname, userAddressPresent: !!userAddress });
    if (!userAddress) throw new BadRequestException({ code: ErrorCodes.UNAUTHORIZED });
    await this.ensService.assertOwnerOrThrow({ subname, address: userAddress });

    const deleted = await this.storageService.delete(subname, FileType.HEADER);
    this.logger.log({ msg: 'Header delete result', subname, deleted });
    if (!deleted) {
      throw new BadRequestException({ code: ErrorCodes.NOT_FOUND });
    }

    return {
      subname,
      message: 'Header deleted successfully',
      deletedAt: new Date().toISOString(),
    };
  }
}


