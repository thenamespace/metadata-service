import { Module } from '@nestjs/common';
import { AvatarController } from './avatar.controller';
import { StorageModule } from '../storage/storage.module';
import { EnsService } from '../ens/ens.service';
import { AvatarService } from './avatar.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [StorageModule, AuthModule],
  controllers: [AvatarController],
  providers: [EnsService, AvatarService],
})
export class AvatarModule {}


