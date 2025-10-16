import { IsEthereumAddress, IsNotEmpty, IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AvatarUploadDto {
  @ApiProperty({
    description: 'SIWE message string',
    example: 'namespace.ninja wants you to sign in with your Ethereum account:\n0x54b06711C8022faf11EC347F2bDc68A91eA03a3a\n\nSign in to Avatar Service (local test)\n\nURI: http://namespace.ninja \nVersion: 1\nChain ID: 1\nNonce: 99ba8946989dcd142a5802257a5a68580dadaa9c86d66416508ef8627f6cc291bb81400991750db4dd11aefc77aaa0ef\nIssued At: 2025-09-16T20:00:33.597Z'
  })
  @IsString()
  @IsNotEmpty()
  siweMessage!: string;

  @ApiProperty({
    description: 'Signature for SIWE message',
    example: '0xb6eff78a2f96dfdc01a2cf0555256abca11229e240f44a379cb45eca667566bf4a4d8f2e3eb5dd130ff3b01409e82fe54d00a20e296338ee05c3b040a1f6f8111b'
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[a-fA-F0-9]{130,}$/, { 
    message: 'Invalid signature format - must be at least 130 hex characters (65 bytes) for EOA signatures, or longer for smart contract signatures' 
  })
  siweSignature!: string;

  @ApiProperty({
    description: 'Wallet address (checks against SIWE)',
    example: '0x54b06711C8022faf11EC347F2bDc68A91eA03a3a'
  })
  @IsEthereumAddress()
  address!: string;
}

export class HeaderUploadDto extends AvatarUploadDto {}

export class AvatarDeleteDto extends AvatarUploadDto {}

export class HeaderDeleteDto extends AvatarUploadDto {}
