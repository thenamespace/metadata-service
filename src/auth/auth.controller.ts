import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthRateLimit } from '../rate-limit/rate-limit.decorators';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { NonceDto, VerifyDto } from './dto/auth-requests.dto';
import { NonceResponseDto, VerifyResponseDto } from './dto/auth-responses.dto';

/**
 * Authentication controller for SIWE-based login and JWT issuance.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Generate a random nonce for the given EVM address to be used in a SIWE message.
   */
  @Post('nonce')
  @AuthRateLimit()
  @ApiOperation({ summary: 'Generate SIWE nonce' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        address: {
          type: 'string',
          example: '0x54b06711C8022faf11EC347F2bDc68A91eA03a3a',
        },
      },
      required: ['address'],
    },
  })
  @ApiOkResponse({
    description: 'Nonce generated',
    type: NonceResponseDto,
    schema: {
      example: { nonce: 'ca5317a91da2a98f5dfbe664cb4d3af6' },
    },
  })
  @HttpCode(HttpStatus.OK)
  nonce(@Body() dto: NonceDto) {
    return this.authService.generateNonce(dto.address);
  }

  /**
   * Verify a SIWE signature using the last issued nonce and return a JWT on success.
   */
  @Post('verify')
  @AuthRateLimit()
  @ApiOperation({ summary: 'Verify SIWE signature and issue JWT' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        message: { 
          type: 'string', 
          example: 'namespace.ninja wants you to sign in with your Ethereum account:\n0x54b06711C8022faf11EC347F2bDc68A91eA03a3a\n\nSign in to Avatar Service (local test)\n\nURI: https://namespace.ninja\nVersion: 1\nChain ID: 1\nNonce: 36a80258ea82b4c6073711e1e37068b1\nIssued At: 2025-09-15T10:40:51.220Z\nExpiration Time: 2025-09-15T10:45:51.220Z' 
        },
        signature: { 
          type: 'string', 
          example: '0xed917547e419b491b08b37afc815d1e76e3599f56f3fd81361919bc0264fd54b51597057605a9646839897aedec9b47ebe9b29c7c8f0079d43bc210f968db6781b' 
        },
        address: {
          type: 'string',
          example: '0x54b06711C8022faf11EC347F2bDc68A91eA03a3a',
        },
      },
      required: ['message', 'signature', 'address'],
    },
  })
  @ApiOkResponse({
    description: 'JWT issued',
    type: VerifyResponseDto,
    schema: {
      example: {
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIweDU0YjA2NzExYzgwMjJmYWYxMWVjMzQ3ZjJiZGM2OGE5MWVhMDNhM2EiLCJhZGRyZXNzIjoiMHg1NGIwNjcxMWM4MDIyZmFmMTFlYzM0N2YyYmRjNjhhOTFlYTAzYTNhIiwiaWF0IjoxNzU3OTM1MzgxLCJleHAiOjE3NTgwMjE3ODF9.NIqJCUf2t_G5s-_C7rysPQXIeXIH8Cs_cg3QzMf7WGI',
        address: '0x54b06711c8022faf11ec347f2bdc68a91ea03a3a',
        expiresIn: 86400,
      },
    },
  })
  @HttpCode(HttpStatus.OK)
  async verify(@Body() dto: VerifyDto) {
    return this.authService.verifySignature(dto);
  }
}


