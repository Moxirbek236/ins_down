import { Update, Ctx, On, Start, Action } from 'nestjs-telegraf';
import { Context, Markup } from 'telegraf';
import { PrismaService } from 'src/prisma/prisma.service';
import { VideoQueueService } from '../queue/video-queue.service';
import { UserProcessingService } from './user-processing.service';
import { InstagramService } from './instagram.service';
import { Redis } from 'ioredis';



@Update()
export class BotUpdate {
  private readonly redis = new Redis({ host: 'localhost', port: 6379 });

  constructor(
    private readonly prisma: PrismaService,
    private readonly videoQueue: VideoQueueService,
    private readonly userProcessing: UserProcessingService,
    private readonly instagramService: InstagramService,
  ) {}

  @Start()
  async onStart(@Ctx() ctx: Context) {
    await this.saveUser(ctx);
    await ctx.replyWithHTML(this.welcomeText(), this.mainMenuKeyboard());
  }

  @Action('how_to_use')
  async onHowToUse(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();

    const text =
      `📖 <b>Qanday ishlatish kerak?</b>\n\n` +
      `1️⃣ Instagram ilovasida kerakli Reel yoki postni oching\n` +
      `2️⃣ <b>Ulashish</b> (Share) tugmasini bosing\n` +
      `3️⃣ <b>Havolani nusxalash</b> (Copy link) ni tanlang\n` +
      `4️⃣ Linkni shu botga yuboring\n` +
      `5️⃣ Bir necha soniyada video tayyor bo'ladi! 🎉`;

    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      ...this.backKeyboard(),
    });
  }

  @Action('show_stats')
  async onShowStats(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();

    const userCount = await this.prisma.user.count();
    const videoCount = await this.prisma.cachedVideo.count();

    const text =
      `📊 <b>Bot statistikasi</b>\n\n` +
      `👥 Foydalanuvchilar: <b>${userCount}</b>\n` +
      `🎬 Keshdagi videolar: <b>${videoCount}</b>`;

    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      ...this.backKeyboard(),
    });
  }

  @Action('delete_video')
  async onDeleteVideo(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    await ctx.deleteMessage().catch(() => {});
  }

  @Action(/^show_description:(\d+)$/)
  async onShowDescription(@Ctx() ctx: Context) {
    const match = (ctx as any).match;
    const videoId = parseInt(match[1], 10);

    const cachedVideo = await this.prisma.cachedVideo.findUnique({
      where: { id: videoId },
    });

    if (!cachedVideo || !cachedVideo.description) {
      await ctx.answerCbQuery('Tavsif topilmadi 😔', { show_alert: true });
      return;
    }

    await ctx.answerCbQuery();

    const description = cachedVideo.description.length > 900
      ? cachedVideo.description.slice(0, 900) + '...'
      : cachedVideo.description;

    await ctx.reply(`📝 <b>Post tavsifi:</b>\n\n${description}`, {
      parse_mode: 'HTML',
    });
  }

  @Action(/^download_audio:(\d+)$/)
  async onDownloadAudio(@Ctx() ctx: Context) {
    const match = (ctx as any).match;
    const videoId = parseInt(match[1], 10);
    const userId = ctx.from!.id;

    const cachedVideo = await this.prisma.cachedVideo.findUnique({
      where: { id: videoId },
    });

    if (!cachedVideo) {
      await ctx.answerCbQuery('Video topilmadi 😔', { show_alert: true });
      return;
    }

    // Keshdan audio bor bo'lsa — to'g'ridan yuborish
    if (cachedVideo.audioFileId) {
      await ctx.answerCbQuery('🎵 MP3 tayyor!');
      await ctx.replyWithAudio(cachedVideo.audioFileId, {
        caption: '🎵 MP3 tayyor!',
      });
      return;
    }

    if (this.userProcessing.isDuplicate(userId, cachedVideo.instagramUrl)) {
      await ctx.answerCbQuery();
      return;
    }

    await ctx.answerCbQuery('🎵 MP3 ajratilmoqda...');

    const loadingMsg = await ctx.reply('⏳ MP3 ajratilmoqda...');

    await this.videoQueue.addAudioJob({
      url: cachedVideo.instagramUrl,
      normalizedUrl: cachedVideo.instagramUrl,
      chatId: ctx.chat!.id,
      loadingMessageId: loadingMsg.message_id,
      videoId: cachedVideo.id,
      userId,
    });
  }

  @Action('back_to_start')
  async onBackToStart(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    await ctx.editMessageText(this.welcomeText(), {
      parse_mode: 'HTML',
      ...this.mainMenuKeyboard(),
    });
  }


  @On('text')
  async onText(@Ctx() ctx: Context) {
    await this.saveUser(ctx);

    const message = ctx.message as any;
    const text = message.text;

    if (!this.isInstagramLink(text)) {
      return ctx.reply('Iltimos, to\'g\'ri Instagram link yuboring.');
    }

    const normalizedUrl = this.normalizeUrl(text);
    const startTime = Date.now();

    // 1. Fast Redis Lookup (O(1))
    const redisKey = `cached_video:${normalizedUrl}`;
    const redisDataStr = await this.redis.get(redisKey);
    let cached: any = null;

    if (redisDataStr) {
      cached = JSON.parse(redisDataStr);
    } else {
      // 2. Fallback to Postgres if not in Redis
      cached = await this.prisma.cachedVideo.findUnique({
        where: { instagramUrl: normalizedUrl },
      });
    }

    if (cached && cached.telegramFileId) {
      const userCount = await this.prisma.user.count();
      await ctx.replyWithVideo(cached.telegramFileId, {
        caption: `✅ Video tayyor!`,
        // caption: `✅ Video tayyor! (keshdan, ${((Date.now() - startTime) / 1000).toFixed(1)}s)\n\n👥 Bot foydalanuvchilari: ${userCount}`,

        reply_markup: {
          inline_keyboard: [
            [
              { text: '🗑 O\'chirish', callback_data: 'delete_video' },
              { text: '📝 Tavsif', callback_data: `show_description:${cached.id}` },
            ],
            [
              { text: '🎵 MP3', callback_data: `download_audio:${cached.id}` },
            ],
          ],
        },
      });
      return;
    }

    const userId = ctx.from!.id;

    if (this.userProcessing.isDuplicate(userId, normalizedUrl)) {
      return;
    }

    const loadingMsg = await ctx.reply('⏳ Media yuklanmoqda ...');

    // ULTRA FAST BYPASS (Nano-Method Multi-Mirror)
    const shortcodeMatch = normalizedUrl.match(/\/reel\/([A-Za-z0-9_-]+)/);
    if (shortcodeMatch) {
      const fastUrls = this.instagramService.getFastStreamUrls(normalizedUrl);
      let success = false;
      for (const ddUrl of fastUrls) {
        try {
          const sent = await ctx.replyWithVideo(ddUrl, {
            caption: `✅ Video tayyor!`,
          });

          await ctx.telegram.deleteMessage(ctx.chat!.id, loadingMsg.message_id).catch(() => {});

          if (sent.video?.file_id) {
            const fileId = sent.video.file_id;
            
            this.prisma.cachedVideo.upsert({
              where: { instagramUrl: normalizedUrl },
              create: {
                instagramUrl: normalizedUrl,
                telegramFileId: fileId,
              },
              update: { telegramFileId: fileId },
            }).then(async (dbRes) => {
              await this.redis.set(`cached_video:${normalizedUrl}`, JSON.stringify(dbRes), 'EX', 604800);
              
              await ctx.telegram.editMessageReplyMarkup(
                ctx.chat!.id,
                sent.message_id,
                undefined,
                {
                  inline_keyboard: [
                    [
                      { text: '🗑 O\'chirish', callback_data: 'delete_video' },
                      { text: '📝 Tavsif', callback_data: `show_description:${dbRes.id}` },
                    ],
                    [
                      { text: '🎵 MP3', callback_data: `download_audio:${dbRes.id}` },
                    ],
                  ],
                }
              ).catch(() => {});
            }).catch(() => {});
          }
          success = true;
          break;
        } catch (err: any) {
          // ddinstagram mirror ishlamadi, keyingisiga urinib ko'ramiz
        }
      }
      
      if (success) return; // Muvaffaqiyatli, navbatga qatnashmaydi!
    }

    // ddinstagram orqali darhol topilmasa, BullMQ navbatiga (kuki orqali) qo'shamiz
    await this.videoQueue.addVideoJob({
      url: text,
      normalizedUrl,
      chatId: ctx.chat!.id,
      loadingMessageId: loadingMsg.message_id,
      userId,
    });
  }

  private welcomeText(): string {
    return (
      `👋 <b>Assalomu alaykum!</b>\n\n` +
      `🎬 Men Instagram'dan video yuklab beruvchi botman.\n\n` +
      `📥 Menga Instagram Reel yoki post linkini yuboring — men sizga videoni tez orada jo'natib beraman.\n\n` +
      `⚡️ Tez, oson va bepul!`
    );
  }

  private mainMenuKeyboard() {
    return Markup.inlineKeyboard([
      [Markup.button.callback('📖 Qanday ishlatish', 'how_to_use')],
      [Markup.button.callback('📊 Statistika', 'show_stats')],
    ]);
  }

  private backKeyboard() {
    return Markup.inlineKeyboard([
      [Markup.button.callback('⬅️ Orqaga', 'back_to_start')],
    ]);
  }

  private normalizeUrl(url: string): string {
    const storiesMatch = url.match(/\/stories\/([^/]+)\/(\d+)/);
    if (storiesMatch) return `https://www.instagram.com/stories/${storiesMatch[1]}/${storiesMatch[2]}/`;
    const match = url.match(/\/(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/);
    if (match) return `https://www.instagram.com/reel/${match[2]}/`;
    return url.split('?')[0].trim();
  }

  private async saveUser(ctx: Context) {
    const from = ctx.from;
    if (!from) return;

    await this.prisma.user.upsert({
      where: { telegramId: from.id.toString() },
      update: {},
      create: {
        telegramId: from.id.toString(),
        username: from.username,
        firstName: from.first_name,
      },
    });
  }

  private isInstagramLink(text: string): boolean {
    return /(instagram\.com|instagr\.am)\/(p|reel|reels|tv|stories\/[^/]+)\//.test(text);
  }
}
