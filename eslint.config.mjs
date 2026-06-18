import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import prettier from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';
import importPlugin from 'eslint-plugin-import';
import promisePlugin from 'eslint-plugin-promise';
import securityPlugin from 'eslint-plugin-security';
import sonarjsPlugin from 'eslint-plugin-sonarjs';

export default [
    // Base ESLint recommended rules
    eslint.configs.recommended,

    // Prettier config (must be last to override other formatting rules)
    prettier,

    // TypeScript files configuration (excluding test files)
    {
        files: ['src/**/*.ts'],
        ignores: ['**/*.spec.ts', '**/*.test.ts'],
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                project: './tsconfig.json',
                tsconfigRootDir: import.meta.dirname,
                sourceType: 'module',
            },
            globals: {
                node: true,
                jest: true,
            },
        },
        plugins: {
            '@typescript-eslint': tseslint,
            prettier: prettierPlugin,
            import: importPlugin,
            promise: promisePlugin,
            security: securityPlugin,
            sonarjs: sonarjsPlugin,
        },
        rules: {
            // TypeScript rules
            ...tseslint.configs['recommended'].rules,
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/explicit-function-return-type': 'off',
            '@typescript-eslint/explicit-module-boundary-types': 'off',
            '@typescript-eslint/no-unused-vars': 'warn',
            '@typescript-eslint/no-empty-function': 'warn',
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/await-thenable': 'error',
            '@typescript-eslint/no-misused-promises': 'error',
            '@typescript-eslint/require-await': 'warn',

            // Prettier
            'prettier/prettier': 'error',

            // Import rules - disabled due to complexity with path aliases
            'import/order': 'off',
            'import/no-duplicates': 'error',
            'import/no-unresolved': 'off', // TypeScript handles this
            'import/named': 'off', // TypeScript handles this

            // Promise rules
            'promise/always-return': 'warn',
            'promise/no-return-wrap': 'error',
            'promise/param-names': 'error',
            'promise/catch-or-return': 'warn',
            'promise/no-nesting': 'warn',
            'promise/no-promise-in-callback': 'warn',
            'promise/no-callback-in-promise': 'warn',
            'promise/no-new-statics': 'error',
            'promise/valid-params': 'error',

            // Security rules
            'security/detect-object-injection': 'off', // Too many false positives
            'security/detect-non-literal-regexp': 'warn',
            'security/detect-unsafe-regex': 'error',
            'security/detect-buffer-noassert': 'error',
            'security/detect-eval-with-expression': 'error',
            'security/detect-no-csrf-before-method-override': 'error',
            'security/detect-possible-timing-attacks': 'warn',

            // SonarJS rules (code quality)
            'sonarjs/cognitive-complexity': ['warn', 15],
            'sonarjs/no-duplicate-string': ['warn', { threshold: 3 }],
            'sonarjs/no-identical-functions': 'error',
            'sonarjs/no-collapsible-if': 'error',
            'sonarjs/prefer-immediate-return': 'error',
            'sonarjs/no-redundant-jump': 'error',

            // General rules
            'no-console': 'warn',
            'no-debugger': 'error',
            'no-undef': 'off', // TypeScript handles this
            'no-unused-vars': 'off', // Using @typescript-eslint/no-unused-vars
            'prefer-const': 'error',
            'no-var': 'error',
            eqeqeq: ['error', 'always'],
            curly: ['error', 'all'],
        },
    },

    // Test files - relax rules and use basic parsing (no type-checking)
    {
        files: ['**/*.spec.ts', '**/*.test.ts', 'test/**/*.ts'],
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                sourceType: 'module',
            },
            globals: {
                describe: 'readonly',
                it: 'readonly',
                expect: 'readonly',
                beforeEach: 'readonly',
                afterEach: 'readonly',
                beforeAll: 'readonly',
                afterAll: 'readonly',
                jest: 'readonly',
            },
        },
        plugins: {
            '@typescript-eslint': tseslint,
            prettier: prettierPlugin,
        },
        rules: {
            ...tseslint.configs['recommended'].rules,
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': 'warn',
            'prettier/prettier': 'error',
            'no-undef': 'off',
        },
    },

    // Ignore patterns
    {
        ignores: [
            'dist/**',
            'node_modules/**',
            'coverage/**',
            'scripts/**',
            'src/prisma/generated/**',
            '*.js',
            '*.mjs',
            '*.cjs',
        ],
    },
];