import { ApiProperty } from '@nestjs/swagger';

export class NonceResponseDto {
  @ApiProperty({
    example:
      '5e3239f5a23becc104aa740d93083559a29707119f5f18643a502a2c122b2d8157402df9385b30f1b4cd8f583017ac27',
  })
  nonce!: string;

  @ApiProperty({ example: 1758039223689 })
  expiresAt!: number;
}
