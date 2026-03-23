export const mockTotoService = {
    findAll: jest.fn().mockResolvedValue({ data: [], meta: {} }),
    findById: jest.fn().mockResolvedValue({ id: '1', name: 'test' })
};

export const mockAppLogger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
};