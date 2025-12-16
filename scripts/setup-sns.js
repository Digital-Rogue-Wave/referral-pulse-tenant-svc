const { SNSClient, CreateTopicCommand, ListTopicsCommand } = require('@aws-sdk/client-sns');

const client = new SNSClient({
    region: 'us-east-1',
    endpoint: process.env.SQS_ENDPOINT || 'http://127.0.0.1:4566',
    credentials: {
        accessKeyId: 'test',
        secretAccessKey: 'test'
    }
});

const topics = [{ name: 'tenant-events.fifo', attributes: { FifoTopic: 'true', ContentBasedDeduplication: 'true' } }];

async function main() {
    console.log('Checking SNS topics...');

    // List existing topics
    const listCommand = new ListTopicsCommand({});
    const existing = await client.send(listCommand);
    const existingArns = existing.Topics ? existing.Topics.map((t) => t.TopicArn) : [];
    console.log('Existing topics:', existingArns);

    for (const topic of topics) {
        const command = new CreateTopicCommand({
            Name: topic.name,
            Attributes: topic.attributes
        });

        try {
            const result = await client.send(command);
            console.log(`Created topic ${topic.name}: ${result.TopicArn}`);
        } catch (error) {
            console.error(`Error creating topic ${topic.name}:`, error.message);
        }
    }
}

main().catch(console.error);
