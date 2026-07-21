import {
  IsEthereumAddress,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

/**
 * Request body for generating a SIWE nonce.
 */
export class NonceDto {
  @IsString()
  @IsNotEmpty()
  @IsEthereumAddress()
  address!: string;

  @IsOptional()
  @IsString()
  @IsIn(['avatar', 'header', 'avatar+header'])
  scope?: 'avatar' | 'header' | 'avatar+header';
}

/**
 * Request body for verifying a SIWE signature.
 */
export class VerifySignatureDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1, { message: 'SIWE message is required' })
  message!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^0x(?:[a-fA-F0-9]{2})+$/, {
    message:
      'Invalid signature format - must be a non-empty, even-length hex value',
  })
  signature!: string;

  @IsString()
  @IsNotEmpty()
  @IsEthereumAddress()
  address!: string;
}
