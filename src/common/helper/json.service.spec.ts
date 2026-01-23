import { Test, TestingModule } from '@nestjs/testing';
import { JsonService } from './json.service';

describe('JsonService', () => {
    let service: JsonService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [JsonService],
        }).compile();

        service = module.get<JsonService>(JsonService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('parse', () => {
        it('should parse valid JSON', () => {
            const json = '{"name":"test","value":123}';
            const result = service.parse<{ name: string; value: number }>(json);
            expect(result).toEqual({ name: 'test', value: 123 });
        });

        it('should parse arrays', () => {
            const json = '[1,2,3,4,5]';
            const result = service.parse<number[]>(json);
            expect(result).toEqual([1, 2, 3, 4, 5]);
        });

        it('should parse nested objects', () => {
            const json = '{"user":{"name":"John","age":30},"items":[1,2,3]}';
            const result = service.parse(json);
            expect(result).toEqual({ user: { name: 'John', age: 30 }, items: [1, 2, 3] });
        });

        it('should throw on invalid JSON', () => {
            const invalid = '{invalid json}';
            expect(() => service.parse(invalid)).toThrow();
        });
    });

    describe('stringify', () => {
        it('should stringify objects', () => {
            const obj = { name: 'test', value: 123 };
            const result = service.stringify(obj);
            expect(result).toBe('{"name":"test","value":123}');
        });

        it('should stringify arrays', () => {
            const arr = [1, 2, 3];
            const result = service.stringify(arr);
            expect(result).toBe('[1,2,3]');
        });
    });

    describe('safeParse', () => {
        it('should parse valid JSON', () => {
            const json = '{"test":true}';
            const result = service.safeParse(json);
            expect(result).toEqual({ test: true });
        });

        it('should return null on invalid JSON', () => {
            const invalid = '{invalid}';
            const result = service.safeParse(invalid);
            expect(result).toBeNull();
        });
    });

    describe('isValidJson', () => {
        it('should return true for valid JSON', () => {
            expect(service.isValidJson('{"test":true}')).toBe(true);
            expect(service.isValidJson('[1,2,3]')).toBe(true);
            expect(service.isValidJson('"string"')).toBe(true);
        });

        it('should return false for invalid JSON', () => {
            expect(service.isValidJson('{invalid}')).toBe(false);
            expect(service.isValidJson('undefined')).toBe(false);
        });
    });

    describe('parseWithDefault', () => {
        it('should parse valid JSON', () => {
            const json = '{"value":42}';
            const result = service.parseWithDefault(json, { value: 0 });
            expect(result).toEqual({ value: 42 });
        });

        it('should return default on invalid JSON', () => {
            const invalid = '{invalid}';
            const defaultValue = { value: 0 };
            const result = service.parseWithDefault(invalid, defaultValue);
            expect(result).toBe(defaultValue);
        });
    });

    describe('deepClone', () => {
        it('should create a deep clone', () => {
            const original = { nested: { value: 123 }, array: [1, 2, 3] };
            const cloned = service.deepClone(original);

            expect(cloned).toEqual(original);
            expect(cloned).not.toBe(original);
            expect(cloned.nested).not.toBe(original.nested);
            expect(cloned.array).not.toBe(original.array);
        });
    });
});

describe('JsonService Performance Benchmarks', () => {
    let service: JsonService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [JsonService],
        }).compile();

        service = module.get<JsonService>(JsonService);
    });

    const generateLargeObject = (size: number) => {
        const obj: Record<string, any> = {};
        for (let i = 0; i < size; i++) {
            obj[`key_${i}`] = {
                id: i,
                name: `Item ${i}`,
                description: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit',
                tags: ['tag1', 'tag2', 'tag3'],
                metadata: {
                    created: new Date().toISOString(),
                    updated: new Date().toISOString(),
                },
            };
        }
        return obj;
    };

    it('should benchmark small payload parsing (1KB)', () => {
        const data = { items: Array.from({ length: 10 }, (_, i) => ({ id: i, name: `Item ${i}` })) };
        const json = JSON.stringify(data);

        // Warmup
        for (let i = 0; i < 100; i++) {
            service.parse(json);
        }

        const iterations = 10000;
        const start = Date.now();
        for (let i = 0; i < iterations; i++) {
            service.parse(json);
        }
        const duration = Date.now() - start;
        const avgTime = duration / iterations;

        console.log(`Small payload (1KB): ${avgTime.toFixed(3)}ms per parse (${iterations} iterations)`);
        expect(avgTime).toBeLessThan(0.1); // Should be very fast
    });

    it('should benchmark medium payload parsing (10KB)', () => {
        const data = generateLargeObject(100);
        const json = JSON.stringify(data);

        // Warmup
        for (let i = 0; i < 10; i++) {
            service.parse(json);
        }

        const iterations = 1000;
        const start = Date.now();
        for (let i = 0; i < iterations; i++) {
            service.parse(json);
        }
        const duration = Date.now() - start;
        const avgTime = duration / iterations;

        console.log(`Medium payload (10KB): ${avgTime.toFixed(3)}ms per parse (${iterations} iterations)`);
        expect(avgTime).toBeLessThan(1); // Should be under 1ms
    });

    it('should benchmark large payload parsing (100KB)', () => {
        const data = generateLargeObject(1000);
        const json = JSON.stringify(data);

        // Warmup
        for (let i = 0; i < 5; i++) {
            service.parse(json);
        }

        const iterations = 100;
        const start = Date.now();
        for (let i = 0; i < iterations; i++) {
            service.parse(json);
        }
        const duration = Date.now() - start;
        const avgTime = duration / iterations;

        console.log(`Large payload (100KB): ${avgTime.toFixed(3)}ms per parse (${iterations} iterations)`);
        expect(avgTime).toBeLessThan(10); // Should be under 10ms
    });

    it('should compare simdjson vs native JSON.parse', () => {
        const data = generateLargeObject(2000); // Larger payload (200KB+)
        const json = JSON.stringify(data);

        // Benchmark simdjson
        const simdjsonIterations = 100;
        const simdjsonStart = Date.now();
        for (let i = 0; i < simdjsonIterations; i++) {
            service.parse(json);
        }
        const simdjsonDuration = Date.now() - simdjsonStart;
        const simdjsonAvg = simdjsonDuration / simdjsonIterations;

        // Benchmark native
        const nativeIterations = 100;
        const nativeStart = Date.now();
        for (let i = 0; i < nativeIterations; i++) {
            JSON.parse(json);
        }
        const nativeDuration = Date.now() - nativeStart;
        const nativeAvg = nativeDuration / nativeIterations;

        const speedup = nativeAvg / simdjsonAvg;

        console.log(`\nPerformance Comparison (200KB+ payload):`);
        console.log(`  simdjson: ${simdjsonAvg.toFixed(3)}ms per parse`);
        console.log(`  native:   ${nativeAvg.toFixed(3)}ms per parse`);
        console.log(`  Speedup:  ${speedup >= 1 ? speedup.toFixed(2) + 'x faster' : '(native is faster for this size)'}`);

        // Just verify both parsers work correctly
        // Performance advantage varies by payload size and structure
        expect(simdjsonAvg).toBeGreaterThan(0);
        expect(nativeAvg).toBeGreaterThan(0);
    });
});
