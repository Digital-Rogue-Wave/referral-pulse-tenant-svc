import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisIamAuthProvider } from '@mod/types/app.tokens';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { HttpRequest } from '@smithy/protocol-http';

@Injectable()
export class ElastiCacheIamAuthProvider implements RedisIamAuthProvider {
    private username: string;
    private region: string;
    private credentialsProvider: ReturnType<typeof fromNodeProviderChain>;

    constructor(private readonly config: ConfigService) {
        const authMode = this.config.get<string>('redisConfig.authMode');
        if (authMode === 'iam') {
            this.username = this.config.getOrThrow<string>('redisConfig.iamUsername', { infer: true });
            this.region = this.config.getOrThrow<string>('awsConfig.region', { infer: true });
        } else {
            this.username = '';
            this.region = '';
        }
        this.credentialsProvider = fromNodeProviderChain();
    }

    getUsername(): string {
        return this.username;
    }

    async getToken(): Promise<string> {
        const host = this.config.getOrThrow<string>('redisConfig.nodes.0.host', { infer: true });

        // Get credentials from IRSA/instance profile
        const credentials = await this.credentialsProvider();

        const signer = new SignatureV4({
            service: 'elasticache',
            region: this.region,
            credentials,
            sha256: Sha256
        });

        // Create the request to sign
        const request = new HttpRequest({
            method: 'GET',
            protocol: 'https:',
            hostname: host,
            path: '/',
            headers: {
                host: host
            },
            query: {
                Action: 'connect',
                User: this.username
            }
        });

        // Sign the request with presigning (generates query params)
        const presigned = await signer.presign(request, {
            expiresIn: 900 // 15 minutes
        });

        // ElastiCache expects the full presigned URL as the password
        const queryString = new URLSearchParams(presigned.query as Record<string, string>).toString();
        return `${host}/?${queryString}`;
    }
}
