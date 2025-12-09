export const REDIS_CLIENT = 'REDIS_CLIENT';
export const REDIS_SUBSCRIBER = 'REDIS_SUBSCRIBER';

// Optional: provide to enable IAM auth token generation (SigV4)
export const REDIS_IAM_AUTH_PROVIDER = 'REDIS_IAM_AUTH_PROVIDER';
export interface RedisIamAuthProvider {
    getToken(): Promise<string>; // short-lived token used as "password"
    getUsername(): string;       // IAM-enabled ElastiCache user
}

export const S3_KEY_BUILDER = 'S3_KEY_BUILDER';

export const OTEL_SDK = 'OTEL_SDK';
