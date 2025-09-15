import { IsEthereumAddress, IsNotEmpty, IsString } from 'class-validator';

/**
 * Request body for generating a SIWE nonce.
 */
export class NonceDto {
  @IsString()
  @IsNotEmpty()
  @IsEthereumAddress()
  address!: string;
}

/**
 * Request body for verifying a SIWE signature and issuing a JWT.
 */
export class VerifyDto {
  @IsString()
  @IsNotEmpty()
  message!: string;

  @IsString()
  @IsNotEmpty()
  signature!: string;

  @IsString()
  @IsNotEmpty()
  @IsEthereumAddress()
  address!: string;
}


