import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import * as dns from 'dns';

dns.setDefaultResultOrder('ipv4first');

import { getBotToken } from 'nestjs-telegraf';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter()
  );

  const config = app.get(ConfigService);
  const bot = app.get(getBotToken());
  const webhookDomain = config.get<string>('WEBHOOK_DOMAIN');
  const webhookPath = config.get<string>('WEBHOOK_PATH') || '/telegram-webhook';

  if (webhookDomain) {
    const fullUrl = `${webhookDomain}${webhookPath}`;
    await bot.telegram.setWebhook(fullUrl);
    console.log(`[Webhook] Webhook muvaffaqiyatli o'rnatildi: ${fullUrl}`);
  } else {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    console.log(`[Polling] Webhook o'chirildi, bot polling rejimida ishlaydi.`);
  }

  await app.listen(process.env.PORT ?? 3003, '0.0.0.0');
}
bootstrap();
