# NestJS Configuration Basics

Fail-fast configuration patterns with static config reader for NestJS 11.x.


## Individual Config File Pattern

Each config file uses `registerAs()` from `@nestjs/config` and the static config reader for validation.

**Example:** `src/config/http.config.ts`

```typescript
import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const schema = z.object({
  timeout: z.coerce.number().int().positive(),
  maxRedirects: z.coerce.number().int().positive(),
  retryAttempts: z.coerce.number().int().positive(),
  retryDelay: z.coerce.number().int().positive(),
  retryMaxDelay: z.coerce.number().int().positive(),
  retryExponential: z.preprocess((val) => val === 'true', z.boolean()),
  internalServiceDomains: z
    .preprocess(
      (val) => (typeof val === 'string' ? val.split(',').map((s) => s.trim()) : []),
      z.array(z.string()),
    )
    .default([]),
  circuitBreaker: z.object({
    enabled: z.preprocess((val) => val === 'true', z.boolean()),
    timeout: z.coerce.number().int().positive(),
    errorThresholdPercentage: z.coerce.number().int().min(0).max(100),
    resetTimeout: z.coerce.number().int().positive(),
    volumeThreshold: z.coerce.number().int().positive(),
    maxCacheSize: z.coerce.number().int().positive(),
  }),
});

export type HttpConfig = z.infer<typeof schema>;

export default registerAs('http', (): HttpConfig => {
  const result = schema.safeParse({
    timeout: process.env.HTTP_CLIENT_TIMEOUT,
    maxRedirects: process.env.HTTP_CLIENT_MAX_REDIRECTS,
    retryAttempts: process.env.HTTP_CLIENT_RETRY_ATTEMPTS,
    retryDelay: process.env.HTTP_CLIENT_RETRY_DELAY,
    retryMaxDelay: process.env.HTTP_CLIENT_RETRY_MAX_DELAY,
    retryExponential: process.env.HTTP_CLIENT_RETRY_EXPONENTIAL,
    internalServiceDomains: process.env.HTTP_INTERNAL_SERVICE_DOMAINS,
    circuitBreaker: {
      enabled: process.env.CIRCUIT_BREAKER_ENABLED,
      timeout: process.env.CIRCUIT_BREAKER_TIMEOUT,
      errorThresholdPercentage: process.env.CIRCUIT_BREAKER_ERROR_THRESHOLD,
      resetTimeout: process.env.CIRCUIT_BREAKER_RESET_TIMEOUT,
      volumeThreshold: process.env.CIRCUIT_BREAKER_VOLUME_THRESHOLD,
      maxCacheSize: process.env.CIRCUIT_BREAKER_MAX_CACHE_SIZE,
    },
  });

  if (!result.success) {
    throw new Error(`HTTP config validation failed: ${result.error.message}`);
  }
  return result.data;
});
```

## Key Patterns

| Pattern | Description |
|---------|-------------|
| Fail-fast validation | All required env vars validated at startup via static config reader |
| No hardcoded defaults | Every value comes from environment or explicit fallback in config |
| Type-safe configs | Use `registerAs()` for namespaced, type-safe config access |
| Global config module | `isGlobal: true` makes ConfigService available everywhere |

## Usage in Services

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MyService {
  constructor(private readonly configService: ConfigService) {}

  someMethod() {
    // Access namespaced config
    const circuitBreakerEnabled = this.configService.getOrThrow<boolean>('http.circuitBreaker.enabled', { infer: true });
    const dbUrl = this.configService.get<string>('database.url');
  }
}
```
