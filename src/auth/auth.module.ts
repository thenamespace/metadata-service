import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { siweConfigsProvider } from './siwe.config';

@Module({
  imports: [],
  controllers: [AuthController],
  providers: [AuthService, siweConfigsProvider],
  exports: [AuthService],
})
export class AuthModule {}
