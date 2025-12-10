import { Module } from '@nestjs/common';
import { S3Factory } from './s3.factory';
import { S3Service } from './s3.service';
import { S3KeyBuilder } from './s3-key.builder';

@Module({
    imports: [],
    providers: [S3Factory, S3Service, S3KeyBuilder],
    exports: [S3Service]
})
export class S3Module {}
