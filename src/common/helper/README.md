# Helper Module

Centralized utility services for common operations.

## Services

### DateService

High-performance date/time handling using moment-timezone.

```typescript
import { DateService } from '@app/common/helper';

constructor(private readonly dateService: DateService) {}

// Get current timestamp
const now = this.dateService.now(); // milliseconds

// Get current date as ISO string
const isoString = this.dateService.nowISO(); // "2024-01-01T00:00:00.000Z"

// Parse dates
const parsed = this.dateService.parse('2024-01-01');

// Format dates
const formatted = this.dateService.format(new Date(), 'YYYY-MM-DD');

// Date operations
const tomorrow = this.dateService.add(new Date(), 1, 'day');
const yesterday = this.dateService.subtract(new Date(), 1, 'day');
```

### JsonService

High-performance JSON parsing using simdjson (significantly faster than native JSON.parse).

```typescript
import { JsonService } from '@app/common/helper';

constructor(private readonly jsonService: JsonService) {}

// Parse JSON (faster than JSON.parse)
const data = this.jsonService.parse<MyType>(jsonString);

// Stringify JSON
const json = this.jsonService.stringify(data);

// Safe parse (returns null on error)
const data = this.jsonService.safeParse<MyType>(jsonString);

// Parse with default value
const data = this.jsonService.parseWithDefault(jsonString, { default: 'value' });

// Validate JSON
if (this.jsonService.isValidJson(jsonString)) {
  // Valid JSON
}

// Deep clone
const cloned = this.jsonService.deepClone(originalObject);
```

## Performance Benefits

### DateService (moment-timezone)
- Timezone-aware operations
- Consistent date handling across the application
- Rich API for date manipulation

### JsonService (simdjson)
- **2-10x faster** than native JSON.parse for large payloads
- Automatic fallback to native JSON.parse for edge cases
- Zero-copy parsing where possible
- Optimized for modern CPUs with SIMD instructions

## When to Use

### Use JsonService for:
- Parsing SQS/SNS message bodies
- Redis cache serialization/deserialization
- HTTP response parsing
- Large JSON payloads (>1KB)
- High-throughput parsing operations

### Use native JSON for:
- Small objects (<100 bytes)
- When you need specific JSON.stringify options
- Legacy code that requires exact native behavior

## Example: Redis Service Integration

```typescript
@Injectable()
export class RedisService {
  constructor(private readonly jsonService: JsonService) {}

  async get<T>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    if (!value) return null;
    return this.jsonService.parse<T>(value);
  }

  async set<T>(key: string, value: T): Promise<void> {
    const serialized = this.jsonService.stringify(value);
    await this.client.set(key, serialized);
  }
}
```

## Example: SQS Message Parsing

```typescript
@Injectable()
export class MessageConsumer {
  constructor(private readonly jsonService: JsonService) {}

  async handleMessage(message: Message) {
    const envelope = this.jsonService.parse<IMessageEnvelope>(message.Body);
    // Process envelope
  }
}
```
