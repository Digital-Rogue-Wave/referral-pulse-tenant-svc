import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TotoEntity } from './toto.entity';
import { createTenantAwareRepositoryProvider } from '@app/common/tenant/tenant-aware-repository';
import { MessagingModule } from '@app/common/messaging';
import { HttpModule } from '@app/common/http/http.module';
import { StorageModule } from '@app/common/storage/storage.module';
import { RedisModule } from '@app/common/redis/redis.module';
import { TotoController } from './toto.controller';
import { TotoService } from './toto.service';
import { TotoConsumer } from './toto.consumer';

@Module({
    imports: [
        TypeOrmModule.forFeature([TotoEntity]),
        MessagingModule.forRoot(),
        HttpModule,
        StorageModule,
        RedisModule,
    ],
    controllers: [TotoController],
    providers: [
        TotoService,
        TotoConsumer,
        createTenantAwareRepositoryProvider(TotoEntity),
    ],
    exports: [TotoService],
})
export class TotoModule {}