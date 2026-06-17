import { registerAs } from '@nestjs/config';

import { z } from 'zod';

const schema = z.object({
    address: z.string().default('localhost:7233'),
    namespace: z.string().default('default'),
    taskQueue: z.string().default('referral-task-queue')
});

export type TemporalConfig = z.infer<typeof schema>;

export default registerAs('temporal', (): TemporalConfig => {
    const result = schema.safeParse({
        address: process.env.TEMPORAL_ADDRESS,
        namespace: process.env.TEMPORAL_NAMESPACE,
        taskQueue: process.env.TEMPORAL_TASK_QUEUE
    });

    if (!result.success) {
        throw new Error(`Temporal config validation failed: ${result.error.message}`);
    }
    return result.data;
});
