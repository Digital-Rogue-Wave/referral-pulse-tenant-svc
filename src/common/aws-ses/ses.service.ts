import { Injectable } from '@nestjs/common';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '@mod/config/config.type';

@Injectable()
export class SesService {
    private sesClient: SESv2Client;

    constructor(private readonly configService: ConfigService<AllConfigType>) {
        const region = this.configService.getOrThrow('awsConfig.region', { infer: true });
        const accessKeyId = this.configService.get('s3Config.accessKeyId', { infer: true });
        const secretAccessKey = this.configService.get('s3Config.secretAccessKey', { infer: true });

        this.sesClient = new SESv2Client({
            region,
            credentials:
                accessKeyId && secretAccessKey
                    ? {
                          accessKeyId,
                          secretAccessKey
                      }
                    : undefined
        });
    }

    async sendEmail(to: string, subject: string, body: string): Promise<void> {
        // TODO: Add email config with fromEmail
        const fromEmail = process.env.SES_FROM_EMAIL || 'noreply@referral-pulse.com';

        const command = new SendEmailCommand({
            FromEmailAddress: fromEmail,
            Destination: {
                ToAddresses: [to]
            },
            Content: {
                Simple: {
                    Subject: {
                        Data: subject
                    },
                    Body: {
                        Text: {
                            Data: body
                        }
                    }
                }
            }
        });

        await this.sesClient.send(command);
    }
}
