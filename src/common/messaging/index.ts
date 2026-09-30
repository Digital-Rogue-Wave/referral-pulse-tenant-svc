// Module
export { MessagingModule } from './messaging.module';

// Services (producer side only: tenant-service consumes no queue)
export { SqsProducerService } from './sqs-producer.service';
export { SnsPublisherService } from './sns-publisher.service';
export { MessageEnvelopeService } from './message-envelope.service';
