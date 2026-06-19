require('dotenv').config();
const { SQSClient, CreateQueueCommand, ListQueuesCommand, GetQueueAttributesCommand } = require('@aws-sdk/client-sqs');

const client = new SQSClient({
    region: process.env.SQS_REGION || 'eu-central-1',
    endpoint: process.env.SQS_ENDPOINT || 'http://localhost:4566',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test'
    }
});

/**
 * Extract SQS queue names from the SQS_QUEUES environment variable
 */
function extractQueueNamesFromEnv() {
    const queuesStr = process.env.SQS_QUEUES || '';
    if (!queuesStr) return [];

    return queuesStr
        .split(',')
        .map((pair) => {
            const [name] = pair.split('|');
            return name?.trim();
        })
        .filter(Boolean);
}

// Also support legacy format with SQS_*_QUEUE_URL variables
const legacyQueueUrls = [
    process.env.SQS_CAMPAIGN_EVENTS_QUEUE_URL,
    process.env.SQS_REWARD_EVENTS_QUEUE_URL,
    process.env.SQS_ANALYTICS_EVENTS_QUEUE_URL,
    process.env.SQS_CONTENT_EVENTS_QUEUE_URL,
    process.env.SQS_WORKFLOW_EVENTS_QUEUE_URL,
    process.env.SQS_SDK_CONFIG_EVENTS_QUEUE_URL,
    process.env.SQS_CLIENT_IDENTITY_EVENTS_QUEUE_URL,
    process.env.SQS_EVENT_TRACKING_INGESTION_QUEUE_URL
].filter(Boolean);

// Parse consumers and producers from JSON config
const consumers = process.env.SQS_CONSUMERS_JSON ? JSON.parse(process.env.SQS_CONSUMERS_JSON) : [];
const producers = process.env.SQS_PRODUCERS_JSON ? JSON.parse(process.env.SQS_PRODUCERS_JSON) : [];

// Get queue names from new SQS_QUEUE_* format
const queueNamesFromEnv = extractQueueNamesFromEnv();

// Extract unique queue names from legacy URLs
const queueNamesFromUrls = legacyQueueUrls.map((url) => {
    const parts = url.split('/');
    return parts[parts.length - 1];
});

// Combine all queue configurations
const allQueues = [...consumers, ...producers];

// Combine with named queues - deduplicate
const uniqueQueueNames = [...new Set([...queueNamesFromEnv, ...allQueues.map((q) => q.name + (q.fifo ? '.fifo' : '')), ...queueNamesFromUrls])];

async function main() {
    console.log('Setting up SQS queues...');

    // List existing queues
    try {
        const listCommand = new ListQueuesCommand({});
        const existing = await client.send(listCommand);
        console.log('Existing queues:', existing.QueueUrls || []);
    } catch (error) {
        console.log('No existing queues found or error listing:', error.message);
    }

    // Create each queue
    for (const queueName of uniqueQueueNames) {
        const isFifo = queueName.endsWith('.fifo');

        const attributes = {
            ...(isFifo && {
                FifoQueue: 'true',
                ContentBasedDeduplication: 'true'
            }),
            VisibilityTimeout: String(process.env.SQS_DEFAULT_VISIBILITY || process.env.SQS_DEFAULT_VISIBILITY_TIMEOUT || '30'),
            ReceiveMessageWaitTimeSeconds: String(process.env.SQS_DEFAULT_WAIT || process.env.SQS_DEFAULT_WAIT_TIME_SECONDS || '20')
        };

        const command = new CreateQueueCommand({
            QueueName: queueName,
            Attributes: attributes
        });

        try {
            const result = await client.send(command);
            console.log(`✓ Created queue ${queueName}: ${result.QueueUrl}`);
        } catch (error) {
            if (error.name === 'QueueAlreadyExists' || error.message.includes('already exists')) {
                console.log(`✓ Queue ${queueName} already exists`);
            } else {
                console.error(`✗ Error creating queue ${queueName}:`, error.message);
            }
        }
    }

    console.log('SQS setup complete!');
}

main().catch(console.error);
