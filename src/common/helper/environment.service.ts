import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AllConfigType } from '@app/config/config.type';
import { Environment } from '@app/types';

/**
 * Environment Service
 *
 * Centralized service for environment-related checks and AWS configuration.
 * Eliminates duplicate nodeEnv checking code across the application.
 */
@Injectable()
export class EnvironmentService {
    private readonly nodeEnv: Environment;

    constructor(private readonly configService: ConfigService<AllConfigType>) {
        this.nodeEnv = this.configService.getOrThrow('app.nodeEnv', { infer: true });
    }

    /**
     * Get current environment
     */
    getEnvironment(): Environment {
        return this.nodeEnv;
    }

    /**
     * Check if running in development
     */
    isDevelopment(): boolean {
        return this.nodeEnv === Environment.Development;
    }

    /**
     * Check if running in test
     */
    isTest(): boolean {
        return this.nodeEnv === Environment.Test;
    }

    /**
     * Check if running in staging
     */
    isStaging(): boolean {
        return this.nodeEnv === Environment.Staging;
    }

    /**
     * Check if running in production
     */
    isProduction(): boolean {
        return this.nodeEnv === Environment.Production;
    }

    /**
     * Check if running in local environment (development or test)
     * Used for determining if AWS credentials should be provided explicitly
     */
    isLocal(): boolean {
        return this.isDevelopment() || this.isTest();
    }

    /**
     * Check if running in cloud environment (staging or production)
     * Uses IAM roles instead of explicit credentials
     */
    isCloud(): boolean {
        return this.isStaging() || this.isProduction();
    }

    /**
     * Get AWS credentials configuration
     * Returns credentials object for local environments (LocalStack)
     * Returns undefined for cloud environments (uses IAM roles)
     */
    getAwsCredentials(): { accessKeyId: string; secretAccessKey: string } | undefined {
        if (this.isLocal()) {
            return {
                accessKeyId: this.configService.getOrThrow('aws.accessKeyId', { infer: true }),
                secretAccessKey: this.configService.getOrThrow('aws.secretAccessKey', { infer: true }),
            };
        }
        return undefined;
    }

    /**
     * Get AWS region
     */
    getAwsRegion(): string {
        return this.configService.getOrThrow('aws.region', { infer: true });
    }

    /**
     * Get AWS endpoint (for LocalStack)
     * Returns undefined in cloud environments
     */
    getAwsEndpoint(): string | undefined {
        return this.configService.get('aws.endpoint', { infer: true }) || undefined;
    }

    /**
     * Get complete AWS client configuration
     * Convenience method for initializing AWS SDK clients
     */
    getAwsClientConfig(): {
        region: string;
        endpoint?: string;
        credentials?: { accessKeyId: string; secretAccessKey: string };
    } {
        return {
            region: this.getAwsRegion(),
            endpoint: this.getAwsEndpoint(),
            credentials: this.getAwsCredentials(),
        };
    }
}