import { Module } from '@nestjs/common';
import { SnsFactory } from './sns.factory';
import { SnsPublisher } from './sns.publisher';

@Module({
    imports: [],
    providers: [SnsFactory, SnsPublisher],
    exports: [SnsPublisher]
})
export class SnsModule {}
