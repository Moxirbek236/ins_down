import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { VideoQueueService } from './video-queue.service';
import { VideoQueueProcessor } from './video-queue.processor';
import { DownloaderService } from '../downloader/downloader.service';
import { UserProcessingService } from '../downloader/user-processing.service';
import { InstagramService } from '../downloader/instagram.service';
import { InstagramAuthService } from '../downloader/instagram-auth.service';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'video-download',
    }),
    PrismaModule,
    ConfigModule,
  ],
  providers: [
    VideoQueueService,
    VideoQueueProcessor,
    DownloaderService,
    UserProcessingService,
    InstagramService,
    InstagramAuthService,
  ],
  exports: [VideoQueueService, UserProcessingService],
})
export class VideoQueueModule {}
