import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogEntity } from './audit-log.entity';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { BullModule } from '@nestjs/bullmq';
import { AUDIT_QUEUE } from '@mod/common/bullmq/queues/audit.queue';
import { AuditProcessor } from './audit.processor';
import { AuditQueueService } from './audit-queue.service';
import { AuditInterceptor } from './audit.interceptor';

@Module({
    imports: [
        TypeOrmModule.forFeature([AuditLogEntity]),
        BullModule.registerQueue({
            name: AUDIT_QUEUE
        })
    ],
    controllers: [AuditController],
    providers: [AuditService, AuditProcessor, AuditQueueService, AuditInterceptor],
    exports: [AuditService, AuditInterceptor]
})
export class AuditModule {}
