import { ApiProperty } from '@nestjs/swagger';

export class AvatarUploadResponseDto {
  @ApiProperty({ example: 'avatar.offchainsub.eth' })
  subname!: string;

  @ApiProperty({ example: 'https://avatars.namespace.ninja/subname/avatar.offchainsub.eth/avatar?timestamp=1757935476031' })
  avatarUrl!: string;

  @ApiProperty({ example: '2025-09-15T11:24:36.031Z' })
  uploadedAt!: string;

  @ApiProperty({ example: 97500 })
  fileSize!: number;

  @ApiProperty({ example: true })
  isUpdate!: boolean;
}

export class HeaderUploadResponseDto {
  @ApiProperty({ example: 'avatar.offchainsub.eth' })
  subname!: string;

  @ApiProperty({ example: 'https://avatars.namespace.ninja/subname/avatar.offchainsub.eth/header' })
  headerUrl!: string;

  @ApiProperty({ example: '2025-09-15T11:27:08.925Z' })
  uploadedAt!: string;

  @ApiProperty({ example: 131131 })
  fileSize!: number;

  @ApiProperty({ example: false })
  isUpdate!: boolean;
}

export class DeleteResponseDto {
  @ApiProperty({ example: 'avatar.offchainsub.eth' })
  subname!: string;

  @ApiProperty({ example: 'Avatar deleted successfully' })
  message!: string;

  @ApiProperty({ example: '2025-09-15T11:27:50.626Z' })
  deletedAt!: string;
}


