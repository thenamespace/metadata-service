import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { siweConfigsProvider, SIWE_CONFIGS } from './siwe.config';

@Module({
  imports: [],
  controllers: [AuthController],
  providers: [AuthService, siweConfigsProvider],
  exports: [AuthService, SIWE_CONFIGS],
})
export class AuthModule {}
