/**
 * Mock Prisma Client for testing
 *
 * Creates a mock object that mimics PrismaClient structure with jest.fn() stubs
 *
 * @example
 * ```typescript
 * const prismaMock = mockPrismaClient({
 *   toto: {
 *     findMany: jest.fn().mockResolvedValue([fakeToto1, fakeToto2]),
 *     findUnique: jest.fn().mockResolvedValue(fakeToto1),
 *     create: jest.fn().mockResolvedValue(fakeToto1),
 *     update: jest.fn().mockResolvedValue(fakeToto1),
 *     delete: jest.fn().mockResolvedValue(fakeToto1),
 *     count: jest.fn().mockResolvedValue(2)
 *   }
 * });
 *
 * // Use in tests
 * const service = new TotoService(prismaMock);
 * ```
 */

/** Prisma client-level methods added to every mock */
interface PrismaClientMethods {
    $connect: jest.Mock;
    $disconnect: jest.Mock;
    $transaction: jest.Mock;
    $executeRaw: jest.Mock;
    $queryRaw: jest.Mock;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock factory must accept arbitrary delegate shapes
export function mockPrismaClient<T extends Record<string, any>>(delegates: Partial<T>): T & PrismaClientMethods {
    const mock = {} as T & PrismaClientMethods;

    for (const [delegateName, methods] of Object.entries(delegates)) {
        (mock as Record<string, unknown>)[delegateName] = methods;
    }

    // Add common Prisma client methods
    mock.$connect = jest.fn().mockResolvedValue(undefined);
    mock.$disconnect = jest.fn().mockResolvedValue(undefined);
    mock.$transaction = jest.fn((callback: (tx: T) => unknown) => callback(mock as unknown as T));
    mock.$executeRaw = jest.fn().mockResolvedValue(0);
    mock.$queryRaw = jest.fn().mockResolvedValue([]);

    return mock;
}

/**
 * Create a mock for a single Prisma delegate (e.g., prisma.toto)
 *
 * @example
 * ```typescript
 * const totoMock = mockPrismaDelegate<Toto>([fakeToto1, fakeToto2]);
 *
 * // All methods are stubbed with sensible defaults
 * totoMock.findMany(); // Returns [fakeToto1, fakeToto2]
 * totoMock.findUnique(); // Returns fakeToto1
 * totoMock.count(); // Returns 2
 * ```
 */
export function mockPrismaDelegate<T>(defaultData: T[]): {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    createMany: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
    upsert: jest.Mock;
    delete: jest.Mock;
    deleteMany: jest.Mock;
    count: jest.Mock;
    aggregate: jest.Mock;
    groupBy: jest.Mock;
} {
    return {
        findMany: jest.fn().mockResolvedValue(defaultData),
        findUnique: jest.fn().mockResolvedValue(defaultData[0] || null),
        findFirst: jest.fn().mockResolvedValue(defaultData[0] || null),
        create: jest.fn().mockImplementation((args: { data: Partial<T> }) => Promise.resolve({ ...defaultData[0], ...args.data })),
        createMany: jest.fn().mockResolvedValue({ count: defaultData.length }),
        update: jest.fn().mockImplementation((args: { data: Partial<T> }) => Promise.resolve({ ...defaultData[0], ...args.data })),
        updateMany: jest.fn().mockResolvedValue({ count: defaultData.length }),
        upsert: jest.fn().mockImplementation((args: { create: Partial<T> }) => Promise.resolve({ ...defaultData[0], ...args.create })),
        delete: jest.fn().mockResolvedValue(defaultData[0] || null),
        deleteMany: jest.fn().mockResolvedValue({ count: defaultData.length }),
        count: jest.fn().mockResolvedValue(defaultData.length),
        aggregate: jest.fn().mockResolvedValue({}),
        groupBy: jest.fn().mockResolvedValue([])
    };
}
