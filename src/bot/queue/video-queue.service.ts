import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export interface VideoJobData {
  type: 'video' | 'audio';
  videoId?: number;
  userId?: number;
  url: string;
  normalizedUrl: string;
  chatId: number;
  loadingMessageId: number;
}

@Injectable()
export class VideoQueueService {
  constructor(
    @InjectQueue('video-download') private readonly videoQueue: Queue<VideoJobData>,
  ) {}

  async addVideoJob(data: Omit<VideoJobData, 'type'>) {
    await this.videoQueue.add('download', { ...data, type: 'video' }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: true,
      removeOnFail: true,
    });
  }

  async addAudioJob(data: Omit<VideoJobData, 'type'>) {
    await this.videoQueue.add('download', { ...data, type: 'audio' }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: true,
      removeOnFail: true,
    });
  }
}
