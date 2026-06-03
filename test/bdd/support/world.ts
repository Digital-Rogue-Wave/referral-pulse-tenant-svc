/**
 * Cucumber World
 *
 * One instance is created per scenario. Shared state between step definitions.
 * The NestJS app reference is stored as a module-level singleton (set in BeforeAll)
 * and exposed via getTestApp() — not per-World, because app boot is expensive.
 */

import { IWorld, IWorldOptions, setWorldConstructor } from '@cucumber/cucumber';
import type { INestApplication } from '@nestjs/common';
import type { Response } from 'supertest';
import supertest from 'supertest';
import { getTestApp } from './app.bootstrap';

export interface BddWorldInterface extends IWorld {
    /** The last HTTP response — set by When steps, read by Then steps */
    response: Response | null;

    /** JWT token for the current scenario — set by auth Given steps */
    currentToken: string | null;

    /** Tenant ID for fixture-backed scenarios — set by tagged Before hooks */
    currentTenantId: string | null;

    /** Build a supertest agent bound to the test app's HTTP server */
    agent(): supertest.SuperAgentTest;
}

export class BddWorld implements BddWorldInterface {
    response: Response | null = null;
    currentToken: string | null = null;
    currentTenantId: string | null = null;

    constructor(options: IWorldOptions) {
        // IWorldOptions are available for future use (parameters, attach, etc.)
        void options;
    }

    agent(): supertest.SuperAgentTest {
        const app: INestApplication = getTestApp();
        return supertest.agent(app.getHttpServer());
    }
}

setWorldConstructor(BddWorld);
