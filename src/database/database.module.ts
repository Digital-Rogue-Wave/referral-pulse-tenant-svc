import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { PrivilegedDatabaseService } from './privileged-database.service';

@Global()
@Module({
    providers: [DatabaseService, PrivilegedDatabaseService],
    exports: [DatabaseService, PrivilegedDatabaseService]
})
export class DatabaseModule {}
