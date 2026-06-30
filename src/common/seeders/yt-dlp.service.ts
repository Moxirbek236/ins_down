import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface MediaInfo {
    videoUrl: string;
    audioUrl?: string;
    thumbnailUrl?: string;
    caption?: string;
}

/** yt-dlp dan kelgan xato — post mavjud emas yoki private */
export class MediaNotFoundError extends Error {
    constructor(shortcode: string, reason: string) {
        super(`[${shortcode}] topilmadi: ${reason}`);
    }
}

@Injectable()
export class YtdlpService implements OnModuleInit {
    private readonly logger = new Logger(YtdlpService.name);

    // Windows: to'liq path, Linux/Mac: 'yt-dlp'
    private readonly BIN = process.env.YTDLP_PATH ?? 'yt-dlp';

    async onModuleInit() {
        try {
            const { stdout } = await execAsync(`"${this.BIN}" --version`);
            this.logger.log(`✅ yt-dlp v${stdout.trim()}`);
        } catch {
            throw new Error(
                'yt-dlp topilmadi!\n' +
                '  Windows: winget install yt-dlp\n' +
                '  Linux:   pip install yt-dlp\n' +
                '  .env ga: YTDLP_PATH=C:\\full\\path\\to\\yt-dlp.exe',
            );
        }
    }

    async getMediaInfo(instagramUrl: string): Promise<MediaInfo> {
        const shortcode = this.extractShortcode(instagramUrl);

        // Muhim: BIN ni qo'shtirnoq ichida — Windows path bo'shliqlari uchun
        const cmd = [
            `"${this.BIN}"`,
            '--dump-json',
            '--no-playlist',
            '--no-warnings',
            '--socket-timeout', '20',
            `"${instagramUrl}"`,
        ].join(' ');

        let stdout = '';
        let stderr = '';

        try {
            ({ stdout, stderr } = await execAsync(cmd, {
                timeout: 30_000,
                maxBuffer: 10 * 1024 * 1024,
            }));
        } catch (err: any) {
            // execAsync xato: stderr dan sababni aniqlaymiz
            const errText: string = err.stderr ?? err.message ?? '';

            // Post mavjud emas yoki private — bu normal holat (debug level)
            if (
                errText.includes('404') ||
                errText.includes('does not exist') ||
                errText.includes('This content isn') ||
                errText.includes('Sorry') ||
                errText.includes('login') ||
                errText.includes('private')
            ) {
                throw new MediaNotFoundError(shortcode, 'post yo\'q yoki private');
            }

            // Boshqa xato — to'liq stderr ni log qilish
            this.logger.debug(`yt-dlp stderr [${shortcode}]:\n${errText.slice(0, 500)}`);
            throw new MediaNotFoundError(shortcode, errText.slice(0, 200));
        }

        // stderr bor lekin stdout ham bor — ogohlantirish
        if (stderr) {
            this.logger.debug(`yt-dlp warning [${shortcode}]: ${stderr.slice(0, 200)}`);
        }

        // JSON parse
        let json: any;
        try {
            json = JSON.parse(stdout.trim());
        } catch {
            throw new MediaNotFoundError(shortcode, 'JSON parse xatolik');
        }

        const videoUrl = this.pickVideoUrl(json);
        if (!videoUrl) {
            throw new MediaNotFoundError(shortcode, 'video URL topilmadi');
        }

        return {
            videoUrl,
            audioUrl: this.pickAudioUrl(json),
            thumbnailUrl: json.thumbnail ?? json.thumbnails?.at(-1)?.url,
            caption: json.description ?? json.title,
        };
    }

    private pickVideoUrl(json: any): string | null {
        if (json.url) return json.url;

        const formats: any[] = json.formats ?? [];
        const best = formats
            .filter(f => f.vcodec && f.vcodec !== 'none' && f.url)
            .sort((a, b) => (b.quality ?? 0) - (a.quality ?? 0));

        return best[0]?.url ?? null;
    }

    private pickAudioUrl(json: any): string | undefined {
        const formats: any[] = json.formats ?? [];
        const audio = formats.find(
            f => f.url && f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'),
        );
        return audio?.url;
    }

    private extractShortcode(url: string): string {
        return url.match(/\/(reel|p|tv)\/([A-Za-z0-9_-]+)/)?.[2] ?? url;
    }
}