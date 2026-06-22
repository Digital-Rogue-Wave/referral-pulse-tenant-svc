import { Test, TestingModule } from '@nestjs/testing';
import { mock, MockProxy } from 'jest-mock-extended';
import { I18nService } from 'nestjs-i18n';

import { DatabaseService } from '@app/database/database.service';
import { S3Service } from '@common/storage/s3.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { BaseException } from '@common/exceptions/base.exceptions';

import { FilesService } from './files.service';

describe('FilesService', () => {
    let service: FilesService;
    let prisma: MockProxy<DatabaseService>;
    let s3: MockProxy<S3Service>;
    let tenantContext: MockProxy<TenantContextService>;

    const tenantId = 'tenant-123';

    beforeEach(async () => {
        prisma = mock<DatabaseService>();
        s3 = mock<S3Service>();
        tenantContext = mock<TenantContextService>();

        prisma.file = { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() } as never;
        tenantContext.getTenantId.mockReturnValue(tenantId);

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                FilesService,
                { provide: DatabaseService, useValue: prisma },
                { provide: S3Service, useValue: s3 },
                { provide: I18nService, useValue: mock<I18nService>() },
                { provide: TenantContextService, useValue: tenantContext },
                { provide: AppLoggerService, useValue: mock<AppLoggerService>() }
            ]
        }).compile();

        service = module.get(FilesService);
    });

    it('findOneForTenant scopes the lookup to the current tenant', async () => {
        (prisma.file.findFirst as jest.Mock).mockResolvedValue({ id: 'file-1', tenantId });

        await service.findOneForTenant('file-1');

        expect(prisma.file.findFirst).toHaveBeenCalledWith({ where: { id: 'file-1', tenantId, deletedAt: null } });
    });

    it('uploadFile stores via S3Service and stamps the tenant + returned location', async () => {
        s3.upload.mockResolvedValue({ key: `tenants/${tenantId}/x.png`, bucket: 'b', location: 's3://b/tenants/t/x.png', etag: 'e' });
        (prisma.file.create as jest.Mock).mockImplementation(({ data }: { data: Record<string, unknown> }) =>
            Promise.resolve({ id: 'file-1', ...data })
        );

        const file = { mimetype: 'image/png', buffer: Buffer.from('img') } as Express.Multer.File;
        await service.uploadFile(file);

        expect(s3.upload).toHaveBeenCalledWith(expect.stringMatching(/\.png$/), file.buffer, { contentType: 'image/png' });
        const createArg = (prisma.file.create as jest.Mock).mock.calls[0][0];
        expect(createArg.data).toEqual(expect.objectContaining({ tenantId, mimeType: 'image/png', path: 's3://b/tenants/t/x.png' }));
    });

    it('mutating a file without tenant context is refused (no cross-tenant bypass)', async () => {
        tenantContext.getTenantId.mockReturnValue(undefined);
        const file = { mimetype: 'image/png', buffer: Buffer.from('img') } as Express.Multer.File;

        await expect(service.updateFile('file-1', file)).rejects.toBeInstanceOf(BaseException);
    });
});
