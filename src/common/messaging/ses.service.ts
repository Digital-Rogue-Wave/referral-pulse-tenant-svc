import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

import { AppLoggerService } from '../logging/app-logger.service';

@Injectable()
export class SesService {
    private sesClient: SESClient;

    constructor(
        private readonly configService: ConfigService,
        private readonly logger: AppLoggerService,
    ) {
        this.logger.setContext(SesService.name);
        const region = this.configService.getOrThrow('aws.region', { infer: true });
        const accessKeyId = this.configService.get('aws.accessKeyId', {
            infer: true,
        });
        const secretAccessKey = this.configService.get('aws.secretAccessKey', {
            infer: true,
        });

        this.sesClient = new SESClient({
            region,
            credentials:
                accessKeyId && secretAccessKey
                    ? {
                          accessKeyId,
                          secretAccessKey,
                      }
                    : undefined,
        });
    }

    async sendEmail(to: string, subject: string, body: string): Promise<void> {
        const fromEmail = this.configService.get('aws.ses.fromEmail', { infer: true }) || 'noreply@referral-pulse.com';

        const command = new SendEmailCommand({
            Source: fromEmail as string,
            Destination: {
                ToAddresses: [to],
            },
            Message: {
                Subject: {
                    Data: subject,
                },
                Body: {
                    Html: {
                        Data: body,
                    },
                },
            },
        });

        try {
            await this.sesClient.send(command);
            this.logger.log(`Email sent successfully to: ${to}`);
        } catch (error) {
            this.logger.error(`Failed to send email to: ${to}`, (error as Error).stack);
            throw error;
        }
    }
}
