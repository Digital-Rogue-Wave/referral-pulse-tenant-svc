import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const queueConfigSchema = z.object({
    name: z.string().min(1),
    url: z.string().url(),
});

const topicConfigSchema = z.object({
    name: z.string().min(1),
    arn: z.string().min(1),
});

/**
 * Extract SQS queues from individual environment variables
 * Looks for variables matching pattern: SQS_QUEUE_{NAME}
 */
function extractSqsQueues(): Array<{ name: string; url: string }> {
    const queues: Array<{ name: string; url: string }> = [];
    const prefix = 'SQS_QUEUE_';

    for (const [key, value] of Object.entries(process.env)) {
        if (key.startsWith(prefix) && value) {
            // Convert SQS_QUEUE_CAMPAIGN_EVENTS -> campaign-events
            const name = key
                .substring(prefix.length)
                .toLowerCase()
                .replace(/_/g, '-');
            queues.push({ name, url: value });
        }
    }

    return queues;
}

const schema = z.object({
    region: z.string().min(1).default('eu-central-1'),
    accessKeyId: z.string().optional(),
    secretAccessKey: z.string().optional(),
    endpoint: z.string().url().optional(),
    sqs: z.object({
        queues: z.array(queueConfigSchema),
        defaultBatchSize: z.coerce.number().int().positive().max(10).default(10),
        defaultVisibilityTimeout: z.coerce.number().int().positive().default(30),
        defaultWaitTimeSeconds: z.coerce.number().int().min(0).max(20).default(20),
        pollingEnabled: z.preprocess((val) => val === 'true', z.boolean()).default(true),
    }),
    sns: z.object({
        topics: z
            .string()
            .default('')
            .transform((val) => {
                if (!val) return [];
                return val.split(',').map((pair) => {
                    const [name, arn] = pair.split('|');
                    return { name: name.trim(), arn: arn.trim() };
                });
            })
            .pipe(z.array(topicConfigSchema)),
    }),
    s3: z.object({
        bucketName: z.string().min(1).default('campaign-assets'),
        presignedUrlExpiry: z.coerce.number().int().positive().default(3600),
        uploadPartSize: z.coerce.number().int().positive().default(5242880),
        maxConcurrentUploads: z.coerce.number().int().positive().default(4),
    }),
});

export type AwsConfig = z.infer<typeof schema>;

export default registerAs('aws', (): AwsConfig => {
    const result = schema.safeParse({
        region: process.env.AWS_REGION,
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        endpoint: process.env.AWS_ENDPOINT,
        sqs: {
            queues: extractSqsQueues(),
            defaultBatchSize: process.env.SQS_DEFAULT_BATCH_SIZE,
            defaultVisibilityTimeout: process.env.SQS_DEFAULT_VISIBILITY_TIMEOUT,
            defaultWaitTimeSeconds: process.env.SQS_DEFAULT_WAIT_TIME_SECONDS,
            pollingEnabled: process.env.SQS_POLLING_ENABLED,
        },
        sns: {
            topics: process.env.SNS_TOPICS,
        },
        s3: {
            bucketName: process.env.S3_BUCKET_NAME,
            presignedUrlExpiry: process.env.S3_PRESIGNED_URL_EXPIRY,
            uploadPartSize: process.env.S3_UPLOAD_PART_SIZE,
            maxConcurrentUploads: process.env.S3_MAX_CONCURRENT_UPLOADS,
        },
    });

    if (!result.success) {
        throw new Error(`AWS config validation failed: ${result.error.message}`);
    }
    return result.data;
});
