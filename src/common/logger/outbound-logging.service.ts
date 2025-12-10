import { AppLoggingService } from '@mod/common/logger/app-logging.service';
import { Injectable } from '@nestjs/common';

@Injectable()
export class OutboundLoggingService {
    constructor(private readonly logger: AppLoggingService) {}

    requestStart(target: string, method: string, url: string, attempt?: number): void {
        this.logger.info('outbound_request_start', { target, method, url, attempt });
    }

    requestEnd(target: string, method: string, url: string, statusCode: number, durationMs: number): void {
        this.logger.info('outbound_request_end', {
            target,
            method,
            url,
            statusCode,
            durationMs
        });
    }

    requestError(target: string, method: string, url: string, durationMs: number, err: unknown): void {
        this.logger.fatal('outbound_request_error', { target, method, url, durationMs }, err);
    }
}
