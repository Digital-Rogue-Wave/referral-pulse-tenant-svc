require('dotenv').config();
const { SNSClient, CreateTopicCommand, ListTopicsCommand } = require('@aws-sdk/client-sns');

const client = new SNSClient({
    region: process.env.AWS_REGION || 'eu-central-1',
    endpoint: process.env.AWS_ENDPOINT || 'http://localhost:4566',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test'
    }
});

// Get topics from environment or use defaults
const topicsEnv = process.env.SNS_TOPICS;
const topics = topicsEnv
    ? topicsEnv.split(',').map((t) => ({
          name: t.trim(),
          attributes: t.includes('.fifo') ? { FifoTopic: 'true', ContentBasedDeduplication: 'true' } : {}
      }))
    : [{ name: 'tenant-events.fifo', attributes: { FifoTopic: 'true', ContentBasedDeduplication: 'true' } }];

async function main() {
    console.log('Checking SNS topics...');

    // List existing topics
    try {
        const listCommand = new ListTopicsCommand({});
        const existing = await client.send(listCommand);
        const existingArns = existing.Topics ? existing.Topics.map((t) => t.TopicArn) : [];
        console.log('Existing topics:', existingArns);
    } catch (error) {
        console.log('Error listing topics:', error.message);
    }

    for (const topic of topics) {
        const command = new CreateTopicCommand({
            Name: topic.name,
            Attributes: topic.attributes
        });

        try {
            const result = await client.send(command);
            console.log(`✓ Created topic ${topic.name}: ${result.TopicArn}`);
        } catch (error) {
            if (error.name === 'TopicLimitExceeded' || error.message.includes('already exists')) {
                console.log(`✓ Topic ${topic.name} already exists`);
            } else {
                console.error(`✗ Error creating topic ${topic.name}:`, error.message);
            }
        }
    }

    console.log('SNS setup complete!');
}

main().catch(console.error);
