import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { DownloaderService } from '../downloader/downloader.service';
import { UserProcessingService } from '../downloader/user-processing.service';
import { InstagramService } from '../downloader/instagram.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { VideoJobData } from './video-queue.service';
import { Redis } from 'ioredis';

@Processor('video-download', { concurrency: 2 })
export class VideoQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoQueueProcessor.name);

  private readonly redis = new Redis({ host: 'localhost', port: 6379 });

  constructor(
    @InjectBot() private readonly bot: Telegraf,
    private readonly downloader: DownloaderService,
    private readonly instagramService: InstagramService,
    private readonly prisma: PrismaService,
    private readonly userProcessing: UserProcessingService,
  ) {
    super();
  }

  async process(job: Job<VideoJobData>): Promise<void> {
    if (job.data.type === 'audio') {
      return this.processAudio(job);
    }
    return this.processVideo(job);
  }

  private async processVideo(job: Job<VideoJobData>): Promise<void> {
    const { url, normalizedUrl, chatId, loadingMessageId } = job.data;
    const downloadStart = Date.now();

    try {
      // 1. Dastlab Nano-Method (ddinstagram) orqali yuborishga urinamiz
      let data: any = null;
      let sentMsg: any = null;
      let firstVideoFileId = '';
      let isFallback = true;

      const fastUrls = this.instagramService.getFastStreamUrls(url);
      for (const fastUrl of fastUrls) {
        try {
          const uploadStart = Date.now();
          sentMsg = await this.bot.telegram.sendVideo(
            chatId,
            fastUrl,
            {
              caption: `✅ Video tayyor!`,
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🗑 O\'chirish', callback_data: 'delete_video' }],
                ],
              },
            }
          );
          firstVideoFileId = sentMsg.video?.file_id || '';
          const uploadTime = ((Date.now() - uploadStart) / 1000).toFixed(1);
          this.logger.log(`Nano-Method orqali jo'natildi (${fastUrl}): ${uploadTime}s`);
          isFallback = false;
          break; // Muvaffaqiyatli jo'natildi!
        } catch (tgError: any) {
          // Agar Telegram joriy oyna orqali yubora olmasa, keyingisiga o'tadi
          this.logger.warn(`Nano-Method (${fastUrl}) ishlamadi: ${tgError.message}`);
        }
      }

      // 2. yt-dlp orqali zaxira qidirish
      if (isFallback) {
        try {
          data = await this.instagramService.downloadWithYtDlp(url);
          const uploadStart = Date.now();
          sentMsg = await this.bot.telegram.sendVideo(
            chatId,
            data.media[0].url,
            {
              caption: `✅ Video tayyor!`,
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🗑 O\'chirish', callback_data: 'delete_video' }],
                ],
              },
            }
          );
          firstVideoFileId = sentMsg.video?.file_id || '';
          const uploadTime = ((Date.now() - uploadStart) / 1000).toFixed(1);
          this.logger.log(`yt-dlp orqali jo'natildi: ${uploadTime}s`);
          isFallback = false;
        } catch (ytError: any) {
          this.logger.warn(`yt-dlp orqali olinmadi, Kuki zaxirasiga o'tilmoqda...`);
        }
      }

      // 2. Agar ddinstagram ishlamasa, Cookie orqali haqiqiy skraping qilamiz
      if (isFallback) {
        data = await this.instagramService.downloadPostWithCookies(url);

        const uploadStart = Date.now();
        if (data.media.length > 1) {
          const mediaGroup = data.media.map((item, index) => ({
            type: item.type === 'video' ? 'video' : 'photo',
            media: item.url,
            caption: index === 0 ? `✅ Tayyor!\n\n${data.caption.slice(0, 900)}` : undefined,
          }));
          const msgs = await this.bot.telegram.sendMediaGroup(chatId, mediaGroup as any);
          sentMsg = msgs[0];
          firstVideoFileId = sentMsg.video?.file_id || '';
        } else if (data.media[0].type === 'video') {
          sentMsg = await this.bot.telegram.sendVideo(
            chatId,
            data.media[0].url,
            {
              caption: `✅ Video tayyor!`,
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🗑 O\'chirish', callback_data: 'delete_video' }],
                ],
              },
            }
          );
          firstVideoFileId = sentMsg.video?.file_id || '';
        } else {
          sentMsg = await this.bot.telegram.sendPhoto(chatId, data.media[0].url, {
            caption: `✅ Tayyor!`,
            reply_markup: {
              inline_keyboard: [
                [{ text: '🗑 O\'chirish', callback_data: 'delete_video' }],
              ],
            },
          });
        }
        const uploadTime = ((Date.now() - uploadStart) / 1000).toFixed(1);
        this.logger.log(`Kuki orqali jo'natildi: ${uploadTime}s`);
      }

      // 4. Bazaga va keshga saqlash
      const cachedVideo = await this.prisma.cachedVideo.upsert({
        where: { instagramUrl: normalizedUrl },
        update: { 
          description: data?.caption || '',
          telegramFileId: firstVideoFileId || undefined,
        },
        create: {
          instagramUrl: normalizedUrl,
          description: data?.caption || '',
          telegramFileId: firstVideoFileId || '',
        },
      });

      if (firstVideoFileId) {
        const redisKey = `cached_video:${normalizedUrl}`;
        await this.redis.set(redisKey, JSON.stringify({ id: cachedVideo.id, telegramFileId: firstVideoFileId }), 'EX', 86400 * 7);
      }

      await this.bot.telegram.deleteMessage(chatId, loadingMessageId).catch(() => {});
    } catch (error: any) {
      this.logger.error(error);
      await this.bot.telegram.deleteMessage(chatId, loadingMessageId).catch(() => {});
      await this.bot.telegram.sendMessage(
        chatId,
        '❌ Xatolik yuz berdi. Linkni tekshirib qaytadan urinib ko\'ring.'
      );
    }
  }

  private async processAudio(job: Job<VideoJobData>): Promise<void> {
    const { url, chatId, loadingMessageId, videoId } = job.data;

    try {
      let localFilePath: string | null = null;
      
      // 1. Agar oldin videoni Telegramga yuklagan bo'lsak, file_id si orqali Telegram serveridan videoni oqim (stream) qilib olamiz
      const cachedVideo = videoId ? await this.prisma.cachedVideo.findUnique({ where: { id: videoId } }) : null;
      
      if (cachedVideo && cachedVideo.telegramFileId) {
        this.logger.log('Telegram file_id topildi. Instagramga kirmasdan Telegram orqali MP3 ajratilmoqda...');
        const fileLink = await this.bot.telegram.getFileLink(cachedVideo.telegramFileId);
        localFilePath = await this.downloader.extractAudioFromVideoUrl(fileLink.href);
      } else {
        this.logger.log('Telegram file_id yo\'q. InstagramService orqali olinmoqda...');
        const data = await this.instagramService.downloadPostWithCookies(url);
        
        if (!data.media || data.media.length === 0) {
          throw new Error('Postda media mavjud emas yoki havola eskirgan.');
        }

        const videoMedia = data.media.find(m => m.type === 'video');
        if (videoMedia) {
          try {
            localFilePath = await this.downloader.extractAudioFromVideoUrl(videoMedia.url);
          } catch (e) {
            throw new Error('Havola eskirgan bo\'lishi mumkin. Videoni qaytadan botga yuboring.');
          }
        } else {
          throw new Error('Bu postda video mavjud emas, audio ajratib bo\'lmaydi.');
        }
      }

      // 2. Ajratib olingan mp3 ni Telegramga yuborish
      const sentAudio = await this.bot.telegram.sendAudio(
        chatId,
        { source: localFilePath },
        { caption: `🎵 MP3 tayyor!` },
      );

      const audio = sentAudio.audio as any;
      if (audio?.file_id && videoId) {
        await this.prisma.cachedVideo.update({
          where: { id: videoId },
          data: { audioFileId: audio.file_id },
        });
      }

      if (localFilePath) this.downloader.cleanup(localFilePath);
      await this.bot.telegram.deleteMessage(chatId, loadingMessageId).catch(() => {});
    } catch (error) {
      this.logger.error(error);

      await this.bot.telegram
        .deleteMessage(chatId, loadingMessageId)
        .catch(() => {});

      await this.bot.telegram.sendMessage(
        chatId,
        '❌ MP3 ajratib bo\'lmadi. Qaytadan urinib ko\'ring.',
      );
    }
  }
}
