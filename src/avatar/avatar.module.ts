import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AvatarController } from './avatar.controller';
import { StorageModule } from '../storage/storage.module';
import { EnsService } from '../ens/ens.service';
import { AvatarService } from './avatar.service';
import { AuthModule } from '../auth/auth.module';
import { QueueModule } from '../queue';
import { AvatarVerificationService } from './avatar-verification.service';

/**
 * Avatar module handles profile image uploads (avatars and headers)
 * 
 * @remarks
 * Supports both immediate uploads (for existing ENS names) and pending uploads
 * (for pre-registration). Pending uploads are verified via a cron job that checks
 * ENS records.
 */
@Module({
  imports: [
    StorageModule,
    AuthModule,
    QueueModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [AvatarController],
  providers: [EnsService, AvatarService, AvatarVerificationService],
})
export class AvatarModule {}


