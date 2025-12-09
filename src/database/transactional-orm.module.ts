import { Global, Module, OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
    initializeTransactionalContext,
    addTransactionalDataSource,
} from 'typeorm-transactional';

let transactionalRegistered = false;

@Global()
@Module({})
export class TransactionalOrmModule implements OnApplicationBootstrap {
    constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

    onApplicationBootstrap(): void {
        if (transactionalRegistered) return;

        // required before using @Transactional()
        initializeTransactionalContext();

        try {
            addTransactionalDataSource(this.dataSource); // registers the Nest-managed DataSource ("default")
        } catch (error) {
            const isDuplicate =
                error instanceof Error && /DataSource with name ".*" has already added/i.test(error.message);
            if (!isDuplicate) throw error;
        }

        transactionalRegistered = true;
    }
}
