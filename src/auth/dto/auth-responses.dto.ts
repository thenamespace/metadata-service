import { ApiProperty } from '@nestjs/swagger';

export class NonceResponseDto {
  @ApiProperty({ example: 'ca5317a91da2a98f5dfbe664cb4d3af6' })
  nonce!: string;
}

export class VerifyResponseDto {
  @ApiProperty({
    example:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIweDU0YjA2NzExYzgwMjJmYWYxMWVjMzQ3ZjJiZGM2OGE5MWVhMDNhM2EiLCJhZGRyZXNzIjoiMHg1NGIwNjcxMWM4MDIyZmFmMTFlYzM0N2YyYmRjNjhhOTFlYTAzYTNhIiwiaWF0IjoxNzU3OTM1MzgxLCJleHAiOjE3NTgwMjE3ODF9.NIqJCUf2t_G5s-_C7rysPQXIeXIH8Cs_cg3QzMf7WGI',
  })
  token!: string;

  @ApiProperty({ example: '0x54b06711c8022faf11ec347f2bdc68a91ea03a3a' })
  address!: string;

  @ApiProperty({ example: 86400 })
  expiresIn!: number;
}


