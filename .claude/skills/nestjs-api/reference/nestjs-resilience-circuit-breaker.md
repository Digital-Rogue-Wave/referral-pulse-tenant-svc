# NestJS Resilience — Circuit Breaker & Database Fallback

Circuit breaker and database fallback patterns for NestJS 11.x. For request context and correlation IDs, see `nestjs-resilience-context.md`.

## 1. Circuit Breaker Pattern

The circuit breaker prevents cascading failures by failing fast when a service is down. It implements a state machine with three states: CLOSED (normal operation), OPEN (failing fast), and HALF_OPEN (testing recovery).
It is based on opossum library
### Implementation

```typescript
@Injectable()
export class CircuitBreakerService implements OnModuleInit, OnModuleDestroy {
  private circuitBreakers: LRUCache<string, CircuitBreaker<[() => Promise<AxiosResponse>], AxiosResponse>>;
  private readonly enabled: boolean;
  private readonly config: ICircuitBreakerConfig;

  constructor(
    private readonly configService: ConfigService<AllConfigType>,
    private readonly logger: AppLoggerService
  ) {
    this.logger.setContext(CircuitBreakerService.name);

    this.enabled = this.configService.getOrThrow('resilience.circuitBreaker.enabled', { infer: true });
    this.config = {
      failureThreshold: this.configService.getOrThrow('resilience.circuitBreaker.failureThreshold', { infer: true }),
      halfOpenMaxCalls: this.configService.getOrThrow('resilience.circuitBreaker.halfOpenMaxCalls', { infer: true }),
      monitoringPeriod: this.configService.getOrThrow('resilience.circuitBreaker.monitoringPeriod', { infer: true }),
      timeout: this.configService.getOrThrow('resilience.circuitBreaker.timeout', { infer: true }),
      errorThresholdPercentage: this.configService.getOrThrow('resilience.circuitBreaker.errorThresholdPercentage', { infer: true }),
      resetTimeout: this.configService.getOrThrow('resilience.circuitBreaker.resetTimeout', { infer: true }),
      volumeThreshold: this.configService.getOrThrow('resilience.circuitBreaker.volumeThreshold', { infer: true })
    };

    const maxCacheSize = this.configService.getOrThrow('resilience.circuitBreaker.maxCacheSize', { infer: true });
    this.circuitBreakers = new LRUCache({
      max: maxCacheSize,
      dispose: (breaker) => {
        breaker.shutdown();
      }
    });
  }

  async onModuleInit(): Promise<void> {
    this.logger.log('Circuit Breaker Service initialized', {
      enabled: this.enabled,
      config: this.config
    });
  }

  async onModuleDestroy(): Promise<void> {
    for (const [name, breaker] of this.circuitBreakers.entries()) {
      breaker.shutdown();
      this.logger.debug(`Circuit breaker shutdown: ${name}`);
    }
    this.circuitBreakers.clear();
  }

  /**
   * Check if circuit breaker is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get or create a circuit breaker for a service
   */
  getBreaker(serviceName: string): CircuitBreaker<[() => Promise<AxiosResponse>], AxiosResponse> {
    let breaker = this.circuitBreakers.get(serviceName);
    if (!breaker) {
      breaker = new CircuitBreaker(async (fn: () => Promise<AxiosResponse>) => fn(), {
        timeout: this.config.timeout,
        errorThresholdPercentage: this.config.errorThresholdPercentage,
        resetTimeout: this.config.resetTimeout,
        volumeThreshold: this.config.volumeThreshold
      });

      breaker.on('open', () => this.logger.warn(`Circuit breaker OPEN: ${serviceName}`));
      breaker.on('halfOpen', () => this.logger.log(`Circuit breaker HALF_OPEN: ${serviceName}`));
      breaker.on('close', () => this.logger.log(`Circuit breaker CLOSED: ${serviceName}`));

      this.circuitBreakers.set(serviceName, breaker);
    }
    return breaker;
  }

  /**
   * Execute a function through the circuit breaker
   */
  async execute<T>(serviceName: string, fn: () => Promise<T>): Promise<T> {
    if (!this.enabled) {
      return fn();
    }

    const breaker = this.getBreaker(serviceName);
    return (await breaker.fire(fn as () => Promise<AxiosResponse>)) as unknown as Promise<T>;
  }

  /**
   * Get circuit breaker state for a service
   */
  getState(serviceName: string): CircuitBreakerInfo | undefined {
    const breaker = this.circuitBreakers.get(serviceName);
    if (!breaker) {
      return undefined;
    }
    const stats = breaker.stats;
    return {
      name: serviceName,
      state: breaker.opened ? 'OPEN' : breaker.halfOpen ? 'HALF_OPEN' : 'CLOSED',
      failures: stats.failures,
      successes: stats.successes,
      totalCalls: stats.failures + stats.successes,
      consecutiveSuccesses: 0,
      windowStart: Date.now()
    };
  }

  /**
   * Get all circuit breaker states
   */
  getAllStates(): CircuitBreakerInfo[] {
    const states: CircuitBreakerInfo[] = [];
    for (const [name, breaker] of this.circuitBreakers.entries()) {
      const stats = breaker.stats;
      states.push({
        name,
        state: breaker.opened ? 'OPEN' : breaker.halfOpen ? 'HALF_OPEN' : 'CLOSED',
        failures: stats.failures,
        successes: stats.successes,
        totalCalls: stats.failures + stats.successes,
        consecutiveSuccesses: 0,
        windowStart: Date.now()
      });
    }
    return states;
  }

  /**
   * Reset a circuit breaker
   */
  reset(serviceName: string): void {
    const breaker = this.circuitBreakers.get(serviceName);
    if (breaker) {
      breaker.close();
      this.logger.log(`Circuit breaker reset: ${serviceName}`);
    }
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(): void {
    for (const [name, breaker] of this.circuitBreakers.entries()) {
      breaker.close();
      this.logger.log(`Circuit breaker reset: ${name}`);
    }
  }
}
```

### Usage

```typescript
// In a service
let response: AxiosResponse<T>;
const skipCircuitBreaker = options?.skipCircuitBreaker || !this.circuitBreakerService.isEnabled();

if (skipCircuitBreaker) {
  response = await execute();
} else {
  const serviceName = new URL(url).hostname;
  response = await this.circuitBreakerService.execute(serviceName, execute);
}
```

## 3. Best Practices

### Circuit Breaker
- Set `failureThreshold` based on acceptable error rate (typically 50-80%)
- Configure `resetTimeout` to allow downstream services time to recover (30-60 seconds)
- Use `halfOpenMaxCalls` to test recovery with limited traffic (3-5 calls)
- Monitor circuit state via `getMetrics()` and expose via health endpoints
