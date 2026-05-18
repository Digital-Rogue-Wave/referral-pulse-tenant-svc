# NestJS Configuration — npm & TypeScript


## package.json

NestJS 11 backend service with enterprise-grade dependencies.

```json
{
  "name": "{project_name}",
  "version": "0.1.0",
  "description": "{description}",
  "author": "",
  "private": true,
  "license": "MIT",
  "scripts": {
    "preinstall": "npx only-allow pnpm",
    "prebuild": "rimraf dist",
    "build": "nest build",
    "format": "prettier --write \"src/**/*.ts\" \"test/**/*.ts\"",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "start:debug": "nest start --debug --watch",
    "start:prod": "node dist/main",
    "lint": "eslint \"{src,apps,libs,test}/**/*.ts\" --fix",
    "lint:check": "eslint \"{src,apps,libs,test}/**/*.ts\"",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:cov": "jest --coverage",
    "test:debug": "node --inspect-brk -r tsconfig-paths/register -r ts-node/register node_modules/.bin/jest --runInBand",
    "test:e2e": "jest --config ./test/jest-e2e.json",
    "pnpm:dedupe": "pnpm dedupe",
    "pnpm:update": "pnpm update --latest",
    "clean": "rimraf dist node_modules coverage",
    "clean:install": "pnpm clean && pnpm install"
  },
  "dependencies": {
    "@aws-crypto/sha256-js": "^5.2.0",
    "@aws-sdk/client-s3": "^3.550.0",
    "@aws-sdk/client-ses": "^3.984.0",
    "@aws-sdk/client-sns": "^3.550.0",
    "@aws-sdk/client-sqs": "^3.550.0",
    "@aws-sdk/credential-provider-node": "^3.962.0",
    "@aws-sdk/lib-storage": "^3.550.0",
    "@aws-sdk/s3-request-presigner": "^3.550.0",
    "@clickhouse/client": "^1.16.0",
    "@faker-js/faker": "^10.2.0",
    "@nestjs/axios": "^4.0.0",
    "@nestjs/common": "^11.0.0",
    "@nestjs/config": "^4.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/event-emitter": "^3.0.1",
    "@nestjs/jwt": "^11.0.0",
    "@nestjs/mapped-types": "^2.1.0",
    "@nestjs/microservices": "^11.0.0",
    "@nestjs/passport": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "@nestjs/schedule": "^5.0.0",
    "@nestjs/swagger": "^8.0.0",
    "@nestjs/terminus": "^11.0.0",
    "@nestjs/throttler": "^6.0.0",
    "@opentelemetry/api": "^1.9.0",
    "@opentelemetry/core": "^1.18.1",
    "@opentelemetry/exporter-metrics-otlp-http": "^0.57.0",
    "@opentelemetry/exporter-trace-otlp-http": "^0.57.0",
    "@opentelemetry/instrumentation-aws-sdk": "^0.48.0",
    "@opentelemetry/instrumentation-express": "^0.46.0",
    "@opentelemetry/instrumentation-http": "^0.57.0",
    "@opentelemetry/instrumentation-ioredis": "^0.46.0",
    "@opentelemetry/instrumentation-pg": "^0.48.0",
    "@opentelemetry/propagator-b3": "^1.18.1",
    "@opentelemetry/resources": "^1.18.1",
    "@opentelemetry/sdk-metrics": "^1.18.1",
    "@opentelemetry/sdk-node": "^0.57.0",
    "@opentelemetry/semantic-conventions": "^1.18.1",
    "@smithy/protocol-http": "^5.3.7",
    "@smithy/signature-v4": "^5.3.7",
    "@ssut/nestjs-sqs": "^3.0.0",
    "axios": "^1.7.9",
    "bcryptjs": "^2.4.3",
    "bullmq": "^5.66.4",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "compression": "^1.7.4",
    "eventemitter2": "^6.4.9",
    "helmet": "^8.0.0",
    "hpp": "^0.2.3",
    "ioredis": "^5.4.2",
    "json-rules-engine": "^7.3.1",
    "jwks-rsa": "^3.2.0",
    "lru-cache": "^10.2.0",
    "moment": "^2.30.1",
    "moment-timezone": "^0.6.0",
    "nestjs-cls": "^5.0.0",
    "nestjs-pino": "^4.0.0",
    "opossum": "^8.1.3",
    "passport": "^0.7.0",
    "passport-jwt": "^4.0.1",
    "pg": "^8.13.0",
    "pino": "^9.6.0",
    "pino-http": "^10.0.0",
    "pino-loki": "^3.0.0",
    "pino-pretty": "^13.0.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "simdjson": "^0.9.2",
    "sinon": "^21.0.1",
    "ulid": "^2.3.0",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.0",
    "@nestjs/schematics": "^11.0.0",
    "@nestjs/testing": "^11.0.0",
    "@swc/cli": "^0.5.0",
    "@swc/core": "^1.10.0",
    "@types/bcryptjs": "^2.4.6",
    "@types/compression": "^1.7.5",
    "@types/express": "^5.0.0",
    "@types/hpp": "^0.2.6",
    "@types/jest": "^29.5.14",
    "@types/moment-timezone": "^0.5.30",
    "@types/node": "^22.0.0",
    "@types/opossum": "^8.1.6",
    "@types/passport-jwt": "^4.0.1",
    "@types/sinon": "^21.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "eslint": "^9.0.0",
    "eslint-config-prettier": "^9.1.0",
    "eslint-plugin-prettier": "^5.1.3",
    "jest": "^29.7.0",
    "node-gyp": "^11.0.0",
    "prettier": "^3.2.5",
    "rimraf": "^6.0.1",
    "source-map-support": "^0.5.21",
    "ts-jest": "^29.1.2",
    "ts-loader": "^9.5.1",
    "ts-node": "^10.9.2",
    "tsconfig-paths": "^4.2.0",
    "typescript": "^5.7.0"
  },
  "engines": {
    "node": ">=22.15.0",
    "pnpm": ">=9.0.0"
  },
  "packageManager": "pnpm@10.0.0",
  "jest": {
    "moduleFileExtensions": [
      "js",
      "json",
      "ts"
    ],
    "rootDir": "src",
    "testRegex": ".*\\.spec\\.ts$",
    "transform": {
      "^.+\\.(t|j)s$": "ts-jest"
    },
    "collectCoverageFrom": [
      "**/*.(t|j)s"
    ],
    "coverageDirectory": "../coverage",
    "testEnvironment": "node",
    "moduleNameMapper": {
      "^@app/(.*)$": "<rootDir>/$1",
      "^@domains/(.*)$": "<rootDir>/domains/$1",
      "^@common/(.*)$": "<rootDir>/common/$1",
      "^@config/(.*)$": "<rootDir>/config/$1",
      "^@common$": "<rootDir>/common",
      "^@config$": "<rootDir>/config",
      "^@domains$": "<rootDir>/domains"
    }
  }
}
```

## tsconfig.json

NestJS uses CommonJS module system with decorators and metadata reflection.

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "target": "ES2022",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "lib": ["ES2022"],
    "allowJs": false,
    "checkJs": false,
    "rootDir": "./src",
    "noEmit": false,
    "strict": true,
    "incremental": true,
    "skipLibCheck": true,
    "strictNullChecks": true,
    "importHelpers": false,
    "downlevelIteration": true,
    "isolatedModules": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "noImplicitAny": true,
    "strictBindCallApply": true,
    "forceConsistentCasingInFileNames": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "moduleResolution": "node",
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": false,
    "declarationMap": false,
    "tsBuildInfoFile": ".tsbuildinfo",
    "paths": {
      "@app/*": ["src/*"],
      "@domains/*": ["src/domains/*"],
      "@common/*": ["src/common/*"],
      "@config/*": ["src/config/*"],
      "@config": ["src/config"]
    }
  },
  "include": [
    "src/**/*"
  ],
  "exclude": ["node_modules", "dist", "test", "**/*.spec.ts"]
}
```
