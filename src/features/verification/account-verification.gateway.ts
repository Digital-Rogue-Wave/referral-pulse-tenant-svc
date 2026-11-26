import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, Connection } from '@temporalio/client';

import type { AllConfigType } from '@config/config.type';

import { AccountVerificationInput, decidedSignal } from './workflows';

export interface StartedWorkflow {
    workflowId: string;
    runId: string;
}

/**
 * tenant-service's Temporal client for `account_verification`. Connected on first use, so the service boots — and the
 * BDD suite runs — without a Temporal server; a call made while Temporal is down throws, and the caller decides
 * whether that matters.
 */
@Injectable()
export class AccountVerificationGateway {
    private client: Promise<Client> | null = null;

    constructor(private readonly configService: ConfigService<AllConfigType>) {}

    /** One execution per verification, so a re-delivered provider callback cannot start a second one. */
    static workflowId(verificationId: string): string {
        return `account-verification-${verificationId}`;
    }

    async start(input: AccountVerificationInput): Promise<StartedWorkflow> {
        const handle = await (
            await this.connect()
        ).workflow.start('accountVerification', {
            taskQueue: this.configService.getOrThrow('temporal', { infer: true }).taskQueue,
            workflowId: AccountVerificationGateway.workflowId(input.verificationId),
            args: [input]
        });
        return { workflowId: handle.workflowId, runId: handle.firstExecutionRunId };
    }

    async signalDecided(workflowId: string, status: 'verified' | 'rejected'): Promise<void> {
        await (await this.connect()).workflow.getHandle(workflowId).signal(decidedSignal, { status });
    }

    private connect(): Promise<Client> {
        if (!this.client) {
            const { address, namespace } = this.configService.getOrThrow('temporal', { infer: true });
            this.client = Connection.connect({ address }).then((connection) => new Client({ connection, namespace }));
            // A failed connect is retried on the next call instead of being cached.
            this.client.catch(() => (this.client = null));
        }
        return this.client;
    }
}
