import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import axios from 'axios';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import UserAgent from 'user-agents';
import { exec } from 'child_process';
import { promisify } from 'util';
import { InstagramAuthService } from './instagram-auth.service';

const execAsync = promisify(exec);
const keepAliveAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60000,
  scheduling: 'fifo',
});

export interface InstagramMedia {
  type: 'video' | 'image';
  url: string;
}

export interface InstagramPostResult {
  type: string;
  caption: string;
  media: InstagramMedia[];
}

interface CookieProfile {
  cookie: string;
  lastUsed: number;
}

@Injectable()
export class InstagramService {
  private readonly logger = new Logger(InstagramService.name);
  private readonly cookiesDir = path.join(process.cwd(), 'cookies');
  private cookiesPool: CookieProfile[] = [];
  private cookieIndex = 0;
  private readonly COOKIE_DELAY_MS = 2000; // Har bir kuki uchun mustaqil kutish vaqti
  
  // Rate Limiter Mutex for Cookies (Kukilarni himoya qilish)
  private cookieLock: Promise<void> = Promise.resolve();

  constructor(private readonly authService: InstagramAuthService) {
    this.loadCookiesFromFiles();
  }

  private getRandomUserAgent(): string {
    try {
      const userAgent = new UserAgent({ deviceCategory: 'mobile' });
      return userAgent.toString();
    } catch {
      return 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
    }
  }

  // Netscape formatidagi .txt fayllardan Cookie qatorini yaratish
  private loadCookiesFromFiles() {
    try {
      if (!fs.existsSync(this.cookiesDir)) {
        this.logger.warn("Cookies papkasi topilmadi!");
        return;
      }
      
      const files = fs.readdirSync(this.cookiesDir).filter(f => f.endsWith('.txt'));
      
      for (const file of files) {
        const filePath = path.join(this.cookiesDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        
        const cookiePairs: string[] = [];
        for (const line of lines) {
          if (line.trim() === '' || line.startsWith('#')) continue;
          
          const parts = line.split('\t');
          // Netscape format: domain, flag, path, secure, expiration, name, value
          if (parts.length >= 7) {
            const name = parts[5];
            const value = parts[6].trim();
            cookiePairs.push(`${name}=${value}`);
          }
        }
        
        if (cookiePairs.length > 0) {
          this.cookiesPool.push({ cookie: cookiePairs.join('; '), lastUsed: 0 });
        }
      }
      
      this.logger.log(`${this.cookiesPool.length} ta cookie profil yuklandi.`);
    } catch (error) {
      this.logger.error(`Cookielarni yuklashda xato: ${error}`);
    }
  }

  private async getSmartCookie(forceRefresh: boolean = false): Promise<string> {
    if (forceRefresh) {
      this.cookiesPool = [];
      this.loadCookiesFromFiles();
    }

    if (this.cookiesPool.length === 0) {
      this.logger.warn("Cookie'lar mavjud emas. So'rov cookiesiz yuborilmoqda.");
      return '';
    }
    
    // Eng uzoq vaqt ishlatilmagan (yoki tezroq bo'shaydigan) kukini topamiz
    let selected = this.cookiesPool.reduce((prev, curr) => prev.lastUsed < curr.lastUsed ? prev : curr);
    
    const now = Date.now();
    let waitTime = 0;
    
    // Bu kuki qachon bo'shashini hisoblaymiz
    const earliestAvailableTime = selected.lastUsed + this.COOKIE_DELAY_MS;
    
    if (earliestAvailableTime <= now) {
      // Hozir bo'sh, darhol o'zlashtiramiz (boshqa parallel so'rovlar olmasligi uchun)
      selected.lastUsed = now;
    } else {
      // Band, uni kutish kerak. Kutish vaqtini bron qilib qo'yamiz
      waitTime = earliestAvailableTime - now;
      selected.lastUsed = earliestAvailableTime;
    }

    if (waitTime > 0) {
      // this.logger.log(`[Cookie Load-Balancer] Kuki bo'shashigacha ${waitTime}ms kutilmoqda...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    return selected.cookie;
  }

  private async acquireCookieLock(): Promise<() => void> {
    let resolveLock: () => void;
    const nextLock = new Promise<void>(res => { resolveLock = res; });
    const currentLock = this.cookieLock;
    this.cookieLock = currentLock.then(() => nextLock);
    await currentLock;
    
    // Cookie is blocked for next 8 seconds to prevent Instagram ban
    return () => {
      setTimeout(resolveLock, 8000);
    };
  }

  private extractShortcode(url: string): string {
    const match = url.match(/(?:p|reels|reel|tv)\/([A-Za-z0-9_-]+)/);
    if (!match) throw new HttpException("Noto'g'ri Instagram havolasi", HttpStatus.BAD_REQUEST);
    return match[1];
  }

  // Har 2 soatda barcha aktiv kukilar orqali Instagram bosh sahifasini chaqirib qo'yish (Cookie Warming)
  @Cron('0 */2 * * *')
  async warmUpCookies() {
    this.logger.log('Kukilarni isitish (Cookie Warming) boshlandi...');
    
    for (const profile of this.cookiesPool) {
      try {
        await axios.get('https://www.instagram.com/', {
          headers: {
            'Cookie': profile.cookie,
            'User-Agent': this.getRandomUserAgent(),
          },
          httpsAgent: keepAliveAgent,
          timeout: 10000,
        });
        this.logger.log(`Cookie muvaffaqiyatli isitildi`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error: any) {
        this.logger.warn(`Kukini isitishda xato: ${error.message}`);
      }
    }
    this.logger.log('Kukilarni isitish tugadi.');
  }

  /**
   * Nano-soniyali usul zaxiralari (Multi-Mirror Public APIs)
   */
  getFastStreamUrls(url: string): string[] {
    const shortcode = this.extractShortcode(url);
    return [
      `https://ddinstagram.com/reel/${shortcode}/`,
      `https://instagramez.com/reel/${shortcode}/`,
      `https://ig.vxtwitter.com/reel/${shortcode}/`
    ];
  }

  /**
   * yt-dlp orqali qidirish (Eng ishonchli ochiq zaxira)
   */
  async downloadWithYtDlp(url: string): Promise<InstagramPostResult> {
    this.logger.log(`yt-dlp orqali yuklashga urinilmoqda...`);
    const os = require('os');
    const isWindows = os.platform() === 'win32';
    const ytdlpPath = path.join(process.cwd(), isWindows ? 'yt-dlp.exe' : 'yt-dlp');
    
    if (!fs.existsSync(ytdlpPath)) {
       throw new Error(`yt-dlp dasturi topilmadi (${ytdlpPath}). Ulanish qoldirildi.`);
    }

    let cookieArg = '';
    try {
       const files = fs.readdirSync(this.cookiesDir).filter(f => f.endsWith('.txt'));
       for (const file of files) {
          const filePath = path.join(this.cookiesDir, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          if (content.includes('sessionid')) {
             cookieArg = `--cookies "${filePath}"`;
             break; // Valid kuki topildi, uni yt-dlp ga ulaymiz
          }
       }
    } catch(e) {}

    try {
      let stdoutData = '';
      try {
        // -f "best[ext=mp4]" ensures we get the merged video URL.
        // --ignore-errors outputs JSON for successfully parsed slides (like videos) even if images fail.
        const { stdout } = await execAsync(`"${ytdlpPath}" -f "best[ext=mp4]" ${cookieArg} -j --ignore-errors "${url}"`, { maxBuffer: 10 * 1024 * 1024 });
        stdoutData = stdout;
      } catch (e: any) {
        // yt-dlp rasmli karuselda xato (code 1) berishi mumkin, lekin baribir stdout ga video JSON ini yozadi!
        if (e.stdout) {
          stdoutData = e.stdout;
        } else {
          throw e;
        }
      }

      if (!stdoutData.trim()) {
        throw new Error("yt-dlp bo'sh ma'lumot qaytardi");
      }

      // Karusel bo'lsa, har bir slayd alohida JSON qatorda keladi.
      const lines = stdoutData.trim().split('\n');
      let data: any = null;
      for (const line of lines) {
         try {
           const parsed = JSON.parse(line);
           // Bizga url mavjud bo'lgan video kerak
           if (parsed && parsed.url) {
              data = parsed;
              break;
           }
         } catch(err) {}
      }

      if (!data) {
        throw new Error("Yaroqli video topilmadi (ehtimol bu faqat rasm postidir)");
      }
      
      return {
        type: 'GraphVideo',
        caption: data.description || data.title || '',
        media: [{ type: 'video', url: data.url }]
      };
    } catch (e: any) {
      this.logger.warn(`yt-dlp xatosi: ${e.message}`);
      throw new Error(`yt-dlp orqali yuklab bo'lmadi`);
    }
  }

  /**
   * Kuki (Cookie) orqali oxirgi zaxira yuklash (Yopiq postlar uchun)
   */
  async downloadPostWithCookies(url: string, isRetry: boolean = false): Promise<InstagramPostResult> {
    const shortcode = this.extractShortcode(url);
    const selectedCookie = await this.getSmartCookie(isRetry);

    this.logger.log(`Kuki zaxirasi ishga tushdi. Rate-limit navbatiga qo'yildi...`);
    const releaseLock = await this.acquireCookieLock();

    try {
      const response = await axios.get(
        `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`,
        {
          headers: {
            'Cookie': selectedCookie,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Upgrade-Insecure-Requests': '1',
            'x-ig-app-id': '936619743392459',
          },
          timeout: 15000,
          httpsAgent: keepAliveAgent,
        },
      );

      const items = response.data?.items;
      if (!items || !items[0]) {
        throw new Error("Instagram ma'lumoti noto'g'ri (items topilmadi). Kuki eskirgan yoki bloklangan bo'lishi mumkin.");
      }

      const item = items[0];
      const result: InstagramPostResult = {
        type: 'Unknown',
        caption: item.caption?.text || '',
        media: [],
      };

      if (item.carousel_media) {
        result.type = 'GraphSidecar';
        for (const mediaItem of item.carousel_media) {
          if (mediaItem.media_type === 2) {
            result.media.push({ type: 'video', url: mediaItem.video_versions[0].url });
          } else if (mediaItem.media_type === 1) {
            result.media.push({ type: 'image', url: mediaItem.image_versions2.candidates[0].url });
          }
        }
      } else if (item.media_type === 2) {
        result.type = 'GraphVideo';
        result.media.push({ type: 'video', url: item.video_versions[0].url });
      } else if (item.media_type === 1) {
        result.type = 'GraphImage';
        result.media.push({ type: 'image', url: item.image_versions2.candidates[0].url });
      }

      return result;
    } catch (error: any) {
      // Agar kuki bloklangan bo'lsa (404/401) yoki eskirgan bo'lsa, avtomatik yangilashga urinib ko'ramiz
      if (error.response && (error.response.status === 404 || error.response.status === 401 || error.response.status === 400) && !isRetry) {
        this.logger.warn(`Kuki xatosi (${error.response.status}). Avto-login jarayoni ishga tushirilmoqda...`);
        const newCookieFile = await this.authService.autoLoginAndGenerateCookie();
        
        if (newCookieFile) {
           this.logger.log(`Yangi kuki yaratildi, so'rov qayta yuborilmoqda...`);
           return this.downloadPostWithCookies(url, true);
        }
      }

      this.logger.error(`Instagram yuklashda xato: ${error.message}`);
      throw new HttpException(
        `Instagram-dan yuklashda xatolik: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    } finally {
      releaseLock(); // 8 soniyalik taymerni ishga tushirib qulfni ochadi
    }
  }

}
