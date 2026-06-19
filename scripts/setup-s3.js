require('dotenv').config();
const { S3Client, CreateBucketCommand, ListBucketsCommand, HeadBucketCommand } = require('@aws-sdk/client-s3');

const client = new S3Client({
    region: process.env.AWS_REGION || process.env.S3_REGION || 'eu-central-1',
    endpoint: process.env.AWS_ENDPOINT || process.env.S3_ENDPOINT || 'http://localhost:4566',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test'
    },
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true' || true
});

// Get bucket name from environment or use default
const bucketName = process.env.S3_BUCKET || 'referral-pulse';
const buckets = [{ name: bucketName }];

async function bucketExists(bucketName) {
    try {
        await client.send(new HeadBucketCommand({ Bucket: bucketName }));
        return true;
    } catch (error) {
        if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
            return false;
        }
        throw error;
    }
}

async function main() {
    console.log('Setting up S3 buckets...');

    // List existing buckets
    try {
        const listCommand = new ListBucketsCommand({});
        const existing = await client.send(listCommand);
        const existingNames = existing.Buckets ? existing.Buckets.map((b) => b.Name) : [];
        console.log('Existing buckets:', existingNames);
    } catch (error) {
        console.log('Error listing buckets:', error.message);
    }

    // Create each bucket
    for (const bucket of buckets) {
        try {
            const exists = await bucketExists(bucket.name);

            if (exists) {
                console.log(`✓ Bucket ${bucket.name} already exists`);
                continue;
            }

            const command = new CreateBucketCommand({
                Bucket: bucket.name
            });

            const result = await client.send(command);
            console.log(`✓ Created bucket ${bucket.name}: ${result.Location || bucket.name}`);
        } catch (error) {
            if (error.name === 'BucketAlreadyOwnedByYou' || error.name === 'BucketAlreadyExists' || error.message.includes('already exists')) {
                console.log(`✓ Bucket ${bucket.name} already exists`);
            } else {
                console.error(`✗ Error creating bucket ${bucket.name}:`, error.message);
            }
        }
    }

    console.log('S3 setup complete!');
}

main().catch(console.error);
