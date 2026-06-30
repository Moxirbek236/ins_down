import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuid } from 'uuid';
import UserAgent from 'user-agents';
import { exec } from 'child_process';
import { promisify } from 'util';


const execAsync = promisify(exec);

export interface DownloadResult {
  videoPath: string;
  caption?: string | null;
  isPublicFallback?: boolean;
}

@Injectable()
export class DownloaderService {
  private readonly logger = new Logger(DownloaderService.name);
  private tempDir = path.join(__dirname, '..', '..', 'temp');

  private cookieIndex = 0;
  private cookiesDir = path.join(process.cwd(), 'cookies');
  private cookieLastUsed: Map<string, number> = new Map();
  private readonly COOKIE_TIMEOUT_MS = 15000; // Har bir cookie uchun 15 soniya timeout (kutyapti)

  // 2. PROXY ROTATION: Proxy manzillar (Agar proxy bo'lsa kiriting, aks holda bo'sh yoki o'zingizning proxylaringizni yozing)
  private proxies = [
    // 'http://user:pass@ip:port', 
    // hozircha bo'sh qoldiramiz, lekin ishlashi uchun bitta o'zimizning IP bo'lsa ham mayli
  ];
  private proxyIndex = 0;

  constructor() {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
    if (!fs.existsSync(this.cookiesDir)) {
      fs.mkdirSync(this.cookiesDir, { recursive: true });
    }
  }

  // --- ROTATION ALGORITMLARI --- //

  private getDynamicCookies(): string[] {
    try {
      if (!fs.existsSync(this.cookiesDir)) return [];
      const files = fs.readdirSync(this.cookiesDir);
      return files
        .filter(file => file.endsWith('.txt'))
        .map(file => path.join(this.cookiesDir, file));
    } catch (error) {
      this.logger.error(`Cookies papkasini o'qishda xatolik: ${error}`);
      return [];
    }
  }

  private async getNextCookieWithTimeout(): Promise<string> {
    const cookies = this.getDynamicCookies();
    if (cookies.length === 0) return '';
    
    const cookie = cookies[this.cookieIndex % cookies.length];
    this.cookieIndex++;
    
    // Cookie timeout mantig'i: Bir vaqtda 40 ta so'rov kelsa ham, cookie timeout'ni kutadi
    const lastUsed = this.cookieLastUsed.get(cookie) || 0;
    const now = Date.now();
    const timeSinceLastUse = now - lastUsed;
    
    if (timeSinceLastUse < this.COOKIE_TIMEOUT_MS) {
      const waitTime = this.COOKIE_TIMEOUT_MS - timeSinceLastUse;
      this.logger.log(`Cookie (${path.basename(cookie)}) bloklanmasligi uchun ${waitTime}ms kutilmoqda...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    // Yangi vaqtni belgilaymiz
    this.cookieLastUsed.set(cookie, Date.now());
    return cookie;
  }

  private getNextProxy(): string | null {
    if (this.proxies.length === 0) return null;
    const proxy = this.proxies[this.proxyIndex % this.proxies.length];
    this.proxyIndex++;
    return proxy;
  }

  private getRandomUserAgent(): string {
    try {
      const userAgent = new UserAgent({ deviceCategory: 'mobile' });
      return userAgent.toString();
    } catch {
      return 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
    }
  }

  // --- ASOSIY YUKLASH MANTIG'I --- //





  // --- ESKI METODLAR (VIDEO-QUEUE.PROCESSOR UCHUN COMPATIBILITY) --- //
  
  // Agar hikerApi javobidagi CDN url'dan to'g'ridan to'g'ri audio oladigan eski mantiq qolsa:
  async extractAudioFromVideoUrl(videoUrl: string): Promise<string> {
    const fileId = `audio_${Date.now()}`;
    const outputPath = path.join(this.tempDir, `${fileId}.mp3`);

    this.logger.log(`URL dan ffmpeg orqali audio ajratilmoqda: ${fileId}`);
    
    return new Promise((resolve, reject) => {
      ffmpeg(videoUrl)
        .output(outputPath)
        .noVideo()
        .audioCodec('libmp3lame')
        .audioQuality(2)
        .on('end', () => {
          this.logger.log(`Audio muvaffaqiyatli ajratildi: ${outputPath}`);
          resolve(outputPath);
        })
        .on('error', (err: any) => {
          this.logger.error(`Audioni ajratishda xatolik yuz berdi: ${err.message}`);
          reject(err);
        })
        .run();
    });
  }

  cleanup(filePath: string) {
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        this.logger.error(`Faylni o'chirishda xatolik: ${err}`);
      }
    }
  }
}
