import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import type { AllConfigType } from '@app/config/config.type';
import { AppLoggerService } from '@app/common/logging/app-logger.service';

/**
 * ElastiCache IAM Authentication Provider
 *
 * Generates AWS IAM authentication tokens for ElastiCache Redis.
 * Tokens are valid for 15 minutes and are automatically refreshed.
 *
 * How it works:
 * 1. Uses AWS SigV4 signing process to generate authentication tokens
 * 2. Tokens are derived from IAM role credentials (EC2/ECS instance role)
 * 3. Tokens expire after 15 minutes, so we refresh them every 10 minutes
 * 4. Works with both standalone and cluster ElastiCache configurations
 *
 * References:
 * - https://docs.aws.amazon.com/AmazonElastiCache/latest/red-ug/auth-iam.html
 * - https://github.com/aws/aws-sdk-js-v3/tree/main/packages/credential-provider-node
 */
@Injectable()
export class ElastiCacheIamAuthProvider {
    private currentToken: string | null = null;
    private tokenExpiresAt: number = 0;
    private refreshInterval: NodeJS.Timeout | null = null;
    private readonly region: string;
    private readonly iamAuthEnabled: boolean;
    private readonly tokenRefreshIntervalMs: number = 10 * 60 * 1000; // 10 minutes

    constructor(
        private readonly configService: ConfigService<AllConfigType>,
        private readonly logger: AppLoggerService,
    ) {
        this.logger.setContext(ElastiCacheIamAuthProvider.name);
        this.region = this.configService.getOrThrow('aws.region', { infer: true });
        this.iamAuthEnabled = this.configService.getOrThrow('redis.iamAuthEnabled', { infer: true });
    }

    /**
     * Check if IAM authentication is enabled
     */
    isEnabled(): boolean {
        return this.iamAuthEnabled;
    }

    /**
     * Get current auth token or generate a new one if expired
     */
    async getAuthToken(username: string, host: string): Promise<string> {
        if (!this.iamAuthEnabled) {
            throw new Error('IAM authentication is not enabled');
        }

        const now = Date.now();
        if (this.currentToken && now < this.tokenExpiresAt) {
            this.logger.debug('Using cached IAM auth token');
            return this.currentToken;
        }

        this.logger.log('Generating new IAM auth token for ElastiCache');
        this.currentToken = await this.generateAuthToken(username, host);
        this.tokenExpiresAt = now + 15 * 60 * 1000; // Token valid for 15 minutes

        return this.currentToken;
    }

    /**
     * Generate IAM authentication token using AWS SigV4
     *
     * Token format: {AWS4-HMAC-SHA256-signed-string}
     */
    private async generateAuthToken(username: string, host: string): Promise<string> {
        try {
            // Dynamically import AWS SDK (only when needed)
            const { defaultProvider } = await import('@aws-sdk/credential-provider-node');
            const { SignatureV4 } = await import('@smithy/signature-v4');
            const { HttpRequest } = await import('@smithy/protocol-http');
            const { Sha256 } = await import('@aws-crypto/sha256-js');

            // Get AWS credentials from the default credential chain
            // This uses IAM roles in production (EC2/ECS instance role)
            const credentialsProvider = defaultProvider();
            const credentials = await credentialsProvider();

            // Create the canonical request for ElastiCache authentication
            const request = new HttpRequest({
                method: 'GET',
                protocol: 'https:',
                hostname: host,
                path: '/',
                query: {
                    Action: 'connect',
                    User: username,
                },
                headers: {
                    host: host,
                },
            });

            // Sign the request with AWS SigV4
            const signer = new SignatureV4({
                service: 'elasticache',
                region: this.region,
                credentials,
                sha256: Sha256,
            });

            const signedRequest = await signer.sign(request);

            // Extract the auth token from signed request
            // The token is the query string with signature parameters
            const token = this.buildAuthTokenFromSignedRequest(signedRequest, username);

            this.logger.log('IAM auth token generated successfully', {
                host,
                username,
                region: this.region,
                expiresIn: '15 minutes',
            });

            return token;
        } catch (error) {
            this.logger.error(
                'Failed to generate IAM auth token',
                error instanceof Error ? error.stack : undefined,
                {
                    error: error instanceof Error ? error.message : 'Unknown error',
                    host,
                    username,
                },
            );
            throw error;
        }
    }

    /**
     * Build auth token from signed request
     *
     * ElastiCache expects the token in a specific format:
     * {username}?Action=connect&User={username}&X-Amz-Algorithm=...&X-Amz-Signature=...
     */
    private buildAuthTokenFromSignedRequest(signedRequest: any, username: string): string {
        const query = signedRequest.query || {};
        const params = new URLSearchParams({
            Action: 'connect',
            User: username,
            'X-Amz-Algorithm': signedRequest.headers['x-amz-algorithm'] || 'AWS4-HMAC-SHA256',
            'X-Amz-Credential': signedRequest.headers['x-amz-credential'] || query['X-Amz-Credential'] || '',
            'X-Amz-Date': signedRequest.headers['x-amz-date'] || query['X-Amz-Date'] || '',
            'X-Amz-Expires': '900', // 15 minutes
            'X-Amz-SignedHeaders': signedRequest.headers['x-amz-signedheaders'] || query['X-Amz-SignedHeaders'] || 'host',
            'X-Amz-Signature': query['X-Amz-Signature'] || '',
        });

        return `${username}?${params.toString()}`;
    }

    /**
     * Start automatic token refresh
     * Refreshes token every 10 minutes (tokens expire after 15 minutes)
     */
    async startTokenRefresh(username: string, host: string): Promise<void> {
        if (!this.iamAuthEnabled) {
            return;
        }

        // Generate initial token
        await this.getAuthToken(username, host);

        // Set up periodic refresh
        this.refreshInterval = setInterval(async () => {
            try {
                this.logger.debug('Refreshing IAM auth token');
                await this.getAuthToken(username, host);
            } catch (error) {
                this.logger.error(
                    'Failed to refresh IAM auth token',
                    error instanceof Error ? error.stack : undefined,
                    {
                        error: error instanceof Error ? error.message : 'Unknown error',
                    },
                );
            }
        }, this.tokenRefreshIntervalMs);

        this.logger.log('IAM auth token refresh started', {
            refreshInterval: `${this.tokenRefreshIntervalMs / 1000 / 60} minutes`,
        });
    }

    /**
     * Stop automatic token refresh
     */
    stopTokenRefresh(): void {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
            this.logger.log('IAM auth token refresh stopped');
        }
    }

    /**
     * Cleanup on module destroy
     */
    onModuleDestroy(): void {
        this.stopTokenRefresh();
    }
}