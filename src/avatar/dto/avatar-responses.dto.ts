import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AvatarUploadResponseDto {
  @ApiProperty({
    example: 'avatar.offchainsub.eth',
    description: 'ENS subname',
  })
  subname!: string;

  @ApiProperty({
    example: 'mainnet',
    enum: ['mainnet', 'sepolia'],
    description: 'Network identifier',
  })
  network!: string;

  @ApiProperty({
    example: 'https://avtr.cc/avatar.offchainsub.eth',
    description: 'Public URL to access the avatar image',
  })
  avatarUrl!: string;

  @ApiProperty({
    example: '2025-10-24T10:30:00.000Z',
    description: 'ISO 8601 timestamp of upload',
  })
  uploadedAt!: string;

  @ApiProperty({
    example: 97500,
    description: 'File size in bytes',
  })
  fileSize!: number;

  @ApiProperty({
    example: true,
    description: 'Whether this was an update (true) or new upload (false)',
  })
  isUpdate!: boolean;

  @ApiPropertyOptional({
    example: true,
    description:
      'If true, upload is pending ENS record verification (pre-registration upload)',
  })
  pending?: boolean;

  @ApiPropertyOptional({
    example:
      'Upload queued for verification. Set your ENS record within 5 minutes to confirm.',
    description: 'Additional message for pending uploads',
  })
  message?: string;
}

export class HeaderUploadResponseDto {
  @ApiProperty({
    example: 'avatar.offchainsub.eth',
    description: 'ENS subname',
  })
  subname!: string;

  @ApiProperty({
    example: 'mainnet',
    enum: ['mainnet', 'sepolia'],
    description: 'Network identifier',
  })
  network!: string;

  @ApiProperty({
    example: 'https://avtr.cc/avatar.offchainsub.eth/header',
    description: 'Public URL to access the header image',
  })
  headerUrl!: string;

  @ApiProperty({
    example: '2025-10-24T10:30:00.000Z',
    description: 'ISO 8601 timestamp of upload',
  })
  uploadedAt!: string;

  @ApiProperty({
    example: 131131,
    description: 'File size in bytes',
  })
  fileSize!: number;

  @ApiProperty({
    example: false,
    description: 'Whether this was an update (true) or new upload (false)',
  })
  isUpdate!: boolean;

  @ApiPropertyOptional({
    example: true,
    description:
      'If true, upload is pending ENS record verification (pre-registration upload)',
  })
  pending?: boolean;

  @ApiPropertyOptional({
    example:
      'Upload queued for verification. Set your ENS record within 5 minutes to confirm.',
    description: 'Additional message for pending uploads',
  })
  message?: string;
}

export class DeleteResponseDto {
  @ApiProperty({
    example: 'avatar.offchainsub.eth',
    description: 'ENS subname',
  })
  subname!: string;

  @ApiProperty({
    example: 'mainnet',
    enum: ['mainnet', 'sepolia'],
    description: 'Network identifier',
  })
  network!: string;

  @ApiProperty({
    example: 'Avatar deleted successfully',
    description: 'Success message',
  })
  message!: string;

  @ApiProperty({
    example: '2025-10-24T10:35:00.000Z',
    description: 'ISO 8601 timestamp of deletion',
  })
  deletedAt!: string;
}
