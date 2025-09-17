import { IsEthereumAddress, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

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
 * Request body for verifying a SIWE signature and issuing a JWT.
 */
// Verify DTO removed: JWT verification no longer used


