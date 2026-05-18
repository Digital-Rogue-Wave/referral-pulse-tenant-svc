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

const schema = z.object({
    region: z.string().min(1).default('eu-central-1'),
    accessKeyId: z.string().optional(),
    secretAccessKey: z.string().optional(),
    endpoint: z.string().url().optional(),
    sqs: z.object({
        queues: z
            .string()
            .default('')
            .transform((val) => {
                if (!val) {
                    return [];
                }
                return val.split(',').map((pair) => {
                    const [name, url] = pair.split('|');
                    return { name: name?.trim() ?? '', url: url?.trim() ?? '' };
                });
            })
            .pipe(z.array(queueConfigSchema)),
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
                if (!val) {
                    return [];
                }
                return val.split(',').map((pair) => {
                    const [name, arn] = pair.split('|');
                    return { name: name?.trim() ?? '', arn: arn?.trim() ?? '' };
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
    ses: z
        .object({
            fromEmail: z.string().email().optional(),
            region: z.string().optional(),
        })
        .default({}),
    cloudfront: z
        .object({
            distributionId: z.string().optional(),
        })
        .default({}),
});

export type AwsConfig = z.infer<typeof schema>;

export default registerAs('aws', (): AwsConfig => {
    const result = schema.safeParse({
        region: process.env.AWS_REGION,
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        endpoint: process.env.AWS_ENDPOINT,
        sqs: {
            queues: process.env.SQS_QUEUES,
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
        ses: {
            fromEmail: process.env.AWS_SES_FROM_EMAIL,
            region: process.env.AWS_REGION, // Default to global region if not specified separately
        },
        cloudfront: {
            distributionId: process.env.CLOUDFRONT_DISTRIBUTION_ID,
        },
    });

    if (!result.success) {
        throw new Error(`AWS config validation failed: ${result.error.message}`);
    }
    return result.data;
});
