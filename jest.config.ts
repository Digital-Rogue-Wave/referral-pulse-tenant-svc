import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  rootDir: '.',
  moduleNameMapper: {
    '^@mod/(.*)$': '<rootDir>/src/$1',
    '^@util/(.*)$': '<rootDir>/src/common/$1',
    '^@domains/(.*)$': '<rootDir>/src/domains/$1',
  },
  moduleDirectories: ['node_modules', 'src'], // Allows Jest to resolve modules from 'src' and 'node_modules'
  testMatch: ['**/*.spec.ts', '**/*.test.ts'], // Matches test files
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest', // Transpiles TypeScript files
  },
  collectCoverageFrom: ['src/**/*.(t|j)s'], // Specifies files for coverage
  coverageDirectory: './coverage', // Output directory for coverage reports
  testTimeout: 30000, // Adjust if necessary for long-running tests
};

export default config;
