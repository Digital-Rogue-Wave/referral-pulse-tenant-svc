import { Test, TestingModule } from '@nestjs/testing';
import { AuditProcessor } from './audit.processor';
import { AuditService } from './audit.service';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Job } from 'bullmq';
import { AUDIT_LOG_CLEANUP_JOB } from '@mod/common/bullmq/queues/audit.queue';

describe('AuditProcessor', () => {
    let processor: AuditProcessor;
    let service: DeepMocked<AuditService>;

    beforeEach(async () => {
        service = createMock<AuditService>();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AuditProcessor,
                {
                    provide: AuditService,
                    useValue: service
                }
            ]
        }).compile();

        processor = module.get<AuditProcessor>(AuditProcessor);
    });

    it('should handle cleanup job', async () => {
        const job = { name: AUDIT_LOG_CLEANUP_JOB } as Job;
        service.deleteOlderThan.mockResolvedValue(10);

        const result = await processor.process(job);

        expect(result.deletedCount).toBe(10);
        expect(service.deleteOlderThan).toHaveBeenCalledWith(expect.any(Date));
    });
});
