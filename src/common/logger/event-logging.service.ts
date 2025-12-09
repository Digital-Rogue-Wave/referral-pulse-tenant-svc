import { Injectable } from '@nestjs/common';
import { AppLoggingService } from './app-logging.service';

@Injectable()
export class EventLoggingService {
    constructor(private readonly logger: AppLoggingService) {}

    published(eventName: string, payloadSize?: number): void {
        this.logger.info('event_published', { eventName, payloadSize });
    }

    handled(eventName: string, durationMs?: number): void {
        this.logger.info('event_handled', { eventName, durationMs });
    }

    failed(eventName: string, err: unknown): void {
        this.logger.fatal('event_failed', { eventName }, err);
    }
}
