import { Injectable } from '@nestjs/common';

@Injectable()
export class UserProcessingService {
  private recentRequests = new Map<string, number>();
  private readonly DUPLICATE_WINDOW_MS = 5_000; // 5 soniya

  /**
   * Agar shu key (userId + link) so'nggi 5 soniya ichida
   * allaqachon so'ralgan bo'lsa, true qaytaradi (e'tiborsiz qoldirish kerak).
   */
  isDuplicate(userId: number, url: string): boolean {
    const key = `${userId}:${url}`;
    if (this.recentRequests.has(key)) return true;

    this.recentRequests.set(key, Date.now());
    setTimeout(() => this.recentRequests.delete(key), this.DUPLICATE_WINDOW_MS);
    
    return false;
  }
}
