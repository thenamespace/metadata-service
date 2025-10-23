import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { StorageService } from '../storage/storage.service';
import { EnsService } from '../ens/ens.service';
import { DeleteRateLimit, UploadRateLimit } from '../rate-limit/rate-limit.decorators';
import { Logger } from '@nestjs/common';
import { FileType } from '../common/enums/file-type.enum';
import { ErrorCodes } from '../common/enums/error-codes.enum';
import { AvatarUploadResponseDto, DeleteResponseDto, HeaderUploadResponseDto } from './dto/avatar-responses.dto';
import { AvatarDeleteDto, HeaderDeleteDto } from './dto/avatar-upload.dto';
import { AvatarService, UploadResult } from './avatar.service';
import { AuthService } from '../auth/auth.service';
import { Network, isValidNetwork } from '../common/enums/network.enum';
import { PendingUploadQueueService, IPendingUploadEntry } from '../queue';

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


interface LocalRequest {
  body?: {
    avatar?: MultipartBufferFile | MultipartStreamFile | (MultipartBufferFile | MultipartStreamFile)[];
    header?: MultipartBufferFile | MultipartStreamFile | (MultipartBufferFile | MultipartStreamFile)[];
    file?: MultipartBufferFile | MultipartStreamFile | (MultipartBufferFile | MultipartStreamFile)[];
    image?: MultipartBufferFile | MultipartStreamFile | (MultipartBufferFile | MultipartStreamFile)[];
    siweMessage?: unknown;
    siweSignature?: unknown;
    address?: unknown;
  };
}

/**
 * Profile controller for uploading, updating, deleting avatar and header images.
 * Requires SIWE signature and ENS ownership for mutations.
 */
@ApiTags('profile')
@Controller('profile')
export class AvatarController {
  private readonly logger = new Logger(AvatarController.name);
  constructor(
    private readonly storageService: StorageService,
    private readonly ensService: EnsService,
    private readonly avatarService: AvatarService,
    private readonly authService: AuthService,
    private readonly queueService: PendingUploadQueueService,
  ) {}

  private getTextField(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && 'value' in (value as Record<string, unknown>)) {
      const v = (value as Record<string, unknown>).value;
      return typeof v === 'string' ? v : '';
    }
    return '';
  }

  private normalizeMessageNewlines(message: string): string {
    // Allow users to pass messages with literal \n sequences via curl/Swagger
    // Also normalize \r\n sequences to proper line breaks
    return message.replace(/\\n/g, '\n').replace(/\r\n/g, '\n');
  }

  @Post(':network/:subname/avatar')
  @UploadRateLimit()
  @ApiOperation({ summary: 'Upload or update avatar for a subname' })
  @ApiParam({ name: 'network', enum: Network, example: 'mainnet' })
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
        siweMessage: { 
          type: 'string', 
          description: 'SIWE message string',
          example: 'namespace.ninja wants you to sign in with your Ethereum account:\n0x54b06711C8022faf11EC347F2bDc68A91eA03a3a\n\nSign in to Avatar Service (local test)\n\nURI: http://namespace.ninja \nVersion: 1\nChain ID: 1\nNonce: 99ba8946989dcd142a5802257a5a68580dadaa9c86d66416508ef8627f6cc291bb81400991750db4dd11aefc77aaa0ef\nIssued At: 2025-09-16T20:00:33.597Z'
        },
        siweSignature: { 
          type: 'string', 
          description: 'Signature for SIWE message',
          example: '0xb6eff78a2f96dfdc01a2cf0555256abca11229e240f44a379cb45eca667566bf4a4d8f2e3eb5dd130ff3b01409e82fe54d00a20e296338ee05c3b040a1f6f8111b'
        },
        address: { 
          type: 'string', 
          description: 'Wallet address (checks against SIWE)',
          example: '0x54b06711C8022faf11EC347F2bDc68A91eA03a3a'
        },
      },
      required: ['avatar', 'siweMessage', 'siweSignature', 'address'],
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
    @Param('network') network: Network,
    @Param('subname') subname: string,
    @Req() req: unknown,
  ) {
    if (!isValidNetwork(network)) {
      throw new BadRequestException({ code: ErrorCodes.INVALID_SUBNAME_FORMAT, details: { network } });
    }

    const r = req as LocalRequest;
    const message = this.normalizeMessageNewlines(this.getTextField(r.body?.siweMessage));
    const signature = this.getTextField(r.body?.siweSignature);
    const address = this.getTextField(r.body?.address);
    if (!message || !signature || !address) {
      throw new BadRequestException({ code: ErrorCodes.UNAUTHORIZED });
    }
    const { address: verifiedAddress } = await this.authService.verifySiweAndConsume({ action: 'avatar', message, signature, address });

    // Check if ENS record exists
    const ensOwner = await this.ensService.getOwnerOrNull({ subname, network });

    if (ensOwner === null) {
      // ENS record doesn't exist - pending upload flow
      const existingFile = await this.storageService.getFileBuffer(subname, network, FileType.AVATAR);
      if (existingFile) {
        throw new BadRequestException({
          code: ErrorCodes.PENDING_UPLOAD_EXISTS,
          message: 'Avatar upload pending verification. Wait 5 minutes or set ENS record first.',
        });
      }

      // Upload and queue for verification
      const result: UploadResult = await this.avatarService.upload(subname, network, req, FileType.AVATAR);
      const queueEntry: IPendingUploadEntry = {
        subname,
        network,
        address: verifiedAddress,
        uploadedAt: new Date(),
        fileType: FileType.AVATAR,
      };
      await this.queueService.add(queueEntry);

      this.logger.log({
        msg: 'Avatar upload queued for verification',
        subname,
        network,
        address: verifiedAddress,
      });

      return {
        subname,
        network,
        avatarUrl: result.url,
        uploadedAt: result.uploadedAt,
        fileSize: result.fileSize,
        isUpdate: result.isUpdate,
        pending: true,
        message: 'Upload queued for verification. Set your ENS record within 5 minutes to confirm.',
      };
    } else {
      // ENS record exists - verify ownership
      if (ensOwner.toLowerCase() !== verifiedAddress.toLowerCase()) {
        throw new ForbiddenException({
          code: ErrorCodes.NOT_SUBNAME_OWNER,
          details: { subname, network },
        });
      }

      // Proceed with immediate upload
      const result: UploadResult = await this.avatarService.upload(subname, network, req, FileType.AVATAR);
      return {
        subname,
        network,
        avatarUrl: result.url,
        uploadedAt: result.uploadedAt,
        fileSize: result.fileSize,
        isUpdate: result.isUpdate,
      };
    }
  }

  @Delete(':network/:subname/avatar')
  @DeleteRateLimit()
  @ApiOperation({ summary: 'Delete avatar for a subname' })
  @ApiParam({ name: 'network', enum: Network, example: 'mainnet' })
  @ApiParam({ name: 'subname', example: 'avatar.offchainsub.eth' })
  @ApiBody({ type: AvatarDeleteDto })
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
    @Param('network') network: Network,
    @Param('subname') subname: string,
    @Body() dto: AvatarDeleteDto,
  ) {
    if (!isValidNetwork(network)) {
      throw new BadRequestException({ code: ErrorCodes.INVALID_SUBNAME_FORMAT, details: { network } });
    }

    const message = this.normalizeMessageNewlines(dto.siweMessage);
    const { address: verifiedAddress } = await this.authService.verifySiweAndConsume({ action: 'avatar', message, signature: dto.siweSignature, address: dto.address });
    await this.ensService.assertOwnerOrThrow({ subname, address: verifiedAddress, network: network });

    const deleted = await this.avatarService.delete(subname, network, FileType.AVATAR);
    this.logger.log({ msg: 'Delete result', network, subname, deleted });
    if (!deleted) {
      throw new BadRequestException({ code: ErrorCodes.NOT_FOUND });
    }

    return {
      subname,
      network,
      message: 'Avatar deleted successfully',
      deletedAt: new Date().toISOString(),
    };
  }

  @Post(':network/:subname/header')
  @UploadRateLimit()
  @ApiOperation({ summary: 'Upload or update header image for a subname' })
  @ApiParam({ name: 'network', enum: Network, example: 'mainnet' })
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
        siweMessage: { 
          type: 'string', 
          description: 'SIWE message string',
          example: 'namespace.ninja wants you to sign in with your Ethereum account:\n0x54b06711C8022faf11EC347F2bDc68A91eA03a3a\n\nSign in to Avatar Service (local test)\n\nURI: http://namespace.ninja \nVersion: 1\nChain ID: 1\nNonce: 99ba8946989dcd142a5802257a5a68580dadaa9c86d66416508ef8627f6cc291bb81400991750db4dd11aefc77aaa0ef\nIssued At: 2025-09-16T20:00:33.597Z'
        },
        siweSignature: { 
          type: 'string', 
          description: 'Signature for SIWE message',
          example: '0xb6eff78a2f96dfdc01a2cf0555256abca11229e240f44a379cb45eca667566bf4a4d8f2e3eb5dd130ff3b01409e82fe54d00a20e296338ee05c3b040a1f6f8111b'
        },
        address: { 
          type: 'string', 
          description: 'Wallet address (checks against SIWE)',
          example: '0x54b06711C8022faf11EC347F2bDc68A91eA03a3a'
        },
      },
      required: ['header', 'siweMessage', 'siweSignature', 'address'],
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
    @Param('network') network: Network,
    @Param('subname') subname: string,
    @Req() req: unknown,
  ) {
    if (!isValidNetwork(network)) {
      throw new BadRequestException({ code: ErrorCodes.INVALID_SUBNAME_FORMAT, details: { network } });
    }

    const r = req as LocalRequest;
    this.logger.log({ msg: 'Header upload hit', network, subname, hasBody: !!r.body, fields: r.body ? Object.keys(r.body) : [] });
    const message = this.normalizeMessageNewlines(this.getTextField(r.body?.siweMessage));
    const signature = this.getTextField(r.body?.siweSignature);
    const address = this.getTextField(r.body?.address);
    if (!message || !signature || !address) {
      throw new BadRequestException({ code: ErrorCodes.UNAUTHORIZED });
    }
    const { address: verifiedAddress } = await this.authService.verifySiweAndConsume({ action: 'header', message, signature, address });

    // Check if ENS record exists
    const ensOwner = await this.ensService.getOwnerOrNull({ subname, network });

    if (ensOwner === null) {
      // ENS record doesn't exist - pending upload flow
      const existingFile = await this.storageService.getFileBuffer(subname, network, FileType.HEADER);
      if (existingFile) {
        throw new BadRequestException({
          code: ErrorCodes.PENDING_UPLOAD_EXISTS,
          message: 'Header upload pending verification. Wait 5 minutes or set ENS record first.',
        });
      }

      // Upload and queue for verification
      const result: UploadResult = await this.avatarService.upload(subname, network, req, FileType.HEADER);
      const queueEntry: IPendingUploadEntry = {
        subname,
        network,
        address: verifiedAddress,
        uploadedAt: new Date(),
        fileType: FileType.HEADER,
      };
      await this.queueService.add(queueEntry);

      this.logger.log({
        msg: 'Header upload queued for verification',
        subname,
        network,
        address: verifiedAddress,
      });

      return {
        subname,
        network,
        headerUrl: result.url,
        uploadedAt: result.uploadedAt,
        fileSize: result.fileSize,
        isUpdate: result.isUpdate,
        pending: true,
        message: 'Upload queued for verification. Set your ENS record within 5 minutes to confirm.',
      };
    } else {
      // ENS record exists - verify ownership
      if (ensOwner.toLowerCase() !== verifiedAddress.toLowerCase()) {
        throw new ForbiddenException({
          code: ErrorCodes.NOT_SUBNAME_OWNER,
          details: { subname, network },
        });
      }

      // Proceed with immediate upload
      const result: UploadResult = await this.avatarService.upload(subname, network, req, FileType.HEADER);
      return {
        subname,
        network,
        headerUrl: result.url,
        uploadedAt: result.uploadedAt,
        fileSize: result.fileSize,
        isUpdate: result.isUpdate,
      };
    }
  }

  @Delete(':network/:subname/header')
  @DeleteRateLimit()
  @ApiOperation({ summary: 'Delete header image for a subname' })
  @ApiParam({ name: 'network', enum: Network, example: 'mainnet' })
  @ApiParam({ name: 'subname', example: 'avatar.offchainsub.eth' })
  @ApiBody({ type: HeaderDeleteDto })
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
    @Param('network') network: Network,
    @Param('subname') subname: string,
    @Body() dto: HeaderDeleteDto,
  ) {
    if (!isValidNetwork(network)) {
      throw new BadRequestException({ code: ErrorCodes.INVALID_SUBNAME_FORMAT, details: { network } });
    }

    const message = this.normalizeMessageNewlines(dto.siweMessage);
    const { address: verifiedAddress } = await this.authService.verifySiweAndConsume({ action: 'header', message, signature: dto.siweSignature, address: dto.address });
      await this.ensService.assertOwnerOrThrow({ subname, address: verifiedAddress, network: network });

    const deleted = await this.avatarService.delete(subname, network, FileType.HEADER);
    this.logger.log({ msg: 'Header delete result', network, subname, deleted });
    if (!deleted) {
      throw new BadRequestException({ code: ErrorCodes.NOT_FOUND });
    }

    return {
      subname,
      network,
      message: 'Header deleted successfully',
      deletedAt: new Date().toISOString(),
    };
  }
}


