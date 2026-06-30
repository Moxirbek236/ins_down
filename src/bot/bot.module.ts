import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BotUpdate } from './downloader/bot.update';
import { DownloaderService } from './downloader/downloader.service';
import { VideoQueueModule } from './queue/video-queue.module';
import { InstagramService } from './downloader/instagram.service';

import { ConfigModule } from '@nestjs/config';

import { InstagramAuthService } from './downloader/instagram-auth.service';

import { WebhookController } from './webhook.controller';

@Module({
  imports: [PrismaModule, VideoQueueModule, ConfigModule],
  controllers: [WebhookController],
  providers: [BotUpdate, DownloaderService, InstagramService, InstagramAuthService],
  exports: [InstagramService],
})
export class BotModule {}
