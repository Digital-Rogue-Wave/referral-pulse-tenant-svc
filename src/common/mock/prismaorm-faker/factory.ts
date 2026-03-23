import { FakerHelpers } from './faker-helpers';

/**
 * Factory for generating fake Prisma entities
 *
 * @example
 * ```typescript
 * const totoFactory = createFactory<Toto>({
 *   id: () => FakerHelpers.cuid(),
 *   tenantId: () => FakerHelpers.tenantId(),
 *   name: () => faker.person.fullName(),
 *   status: () => 'active',
 *   processCount: () => 0
 * });
 *
 * const fakeToto = totoFactory.build();
 * const customToto = totoFactory.build({ name: 'Custom Name' });
 * const multipleTodos = totoFactory.buildList(10);
 * ```
 */
export interface Factory<T> {
    /**
     * Build a single entity with optional overrides
     */
    build(overrides?: Partial<T>): T;

    /**
     * Build multiple entities
     */
    buildList(count: number, overrides?: Partial<T>): T[];
}

/**
 * Create a factory for a Prisma model
 *
 * @param defaults - Default value generators for each field
 * @returns Factory instance
 */
export function createFactory<T extends Record<string, any>>(defaults: {
    [K in keyof T]: T[K] | (() => T[K]);
}): Factory<T> {
    return {
        build(overrides?: Partial<T>): T {
            const entity = {} as T;

            // Generate default values
            for (const [key, value] of Object.entries(defaults)) {
                entity[key as keyof T] = typeof value === 'function' ? (value as () => any)() : value;
            }

            // Apply overrides
            if (overrides) {
                Object.assign(entity, overrides);
            }

            return entity;
        },

        buildList(count: number, overrides?: Partial<T>): T[] {
            return Array.from({ length: count }, () => this.build(overrides));
        },
    };
}

/**
 * Auto-generate a factory from a Prisma model type
 * Uses field names to infer appropriate faker methods
 *
 * @example
 * ```typescript
 * const totoFactory = autoFactory<Toto>({
 *   id: 'String',
 *   tenantId: 'String',
 *   name: 'String',
 *   status: 'String',
 *   processCount: 'Int'
 * });
 * ```
 */
export function autoFactory<T extends Record<string, any>>(schema: Record<keyof T, string>): Factory<T> {
    const defaults = {} as { [K in keyof T]: () => T[K] };

    for (const [fieldName, fieldType] of Object.entries(schema)) {
        defaults[fieldName as keyof T] = () => FakerHelpers.generateValue(fieldName, fieldType) as T[keyof T];
    }

    return createFactory(defaults);
}
