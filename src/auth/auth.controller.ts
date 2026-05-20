import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthRateLimit } from '../rate-limit/rate-limit.decorators';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { NonceDto } from './dto/auth-requests.dto';
import { NonceResponseDto } from './dto/auth-responses.dto';

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
        scope: {
          type: 'string',
          enum: ['avatar', 'header', 'avatar+header'],
          example: 'avatar+header',
          default: 'avatar+header',
          description: 'Defaults to avatar+header',
        },
      },
      required: ['address'],
    },
  })
  @ApiOkResponse({
    description: 'Nonce generated',
    type: NonceResponseDto,
    schema: {
      example: {
        nonce:
          '5e3239f5a23becc104aa740d93083559a29707119f5f18643a502a2c122b2d8157402df9385b30f1b4cd8f583017ac27',
      },
    },
  })
  @HttpCode(HttpStatus.OK)
  nonce(@Body() dto: NonceDto) {
    return this.authService.generateNonce(dto.address, dto.scope);
  }
}
