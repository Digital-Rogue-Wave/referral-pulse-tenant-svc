import { Global, Module } from '@nestjs/common';

import { ClickHouseService } from './clickhouse.service';
import { S3KeyBuilder } from './s3-key.builder';
import { S3Service } from './s3.service';

@Global()
@Module({
    providers: [S3Service, S3KeyBuilder, ClickHouseService],
    exports: [S3Service, S3KeyBuilder, ClickHouseService]
})
export class StorageModule {}
