import { Controller, Post, Body, Res } from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';

@Controller('telegram-webhook')
export class WebhookController {
  constructor(@InjectBot() private readonly bot: Telegraf) {}

  @Post()
  async handleWebhook(@Body() update: any, @Res() res: any) {
    try {
      await this.bot.handleUpdate(update);
    } catch (error) {
      console.error('Webhook error:', error);
    }
    // Fastify reply yuborilishi kerak
    res.status(200).send('OK');
  }
}
