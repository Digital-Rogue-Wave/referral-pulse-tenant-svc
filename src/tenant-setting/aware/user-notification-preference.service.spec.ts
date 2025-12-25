import { Test, TestingModule } from '@nestjs/testing';
import { UserNotificationPreferenceService } from './user-notification-preference.service';
import { UserNotificationPreferenceEntity } from '../user-notification-preference.entity';
import { TenantAwareRepository } from '@mod/common/tenant/tenant-aware.repository';
import { ClsService } from 'nestjs-cls';
import { SnsPublisher } from '@mod/common/aws-sqs/sns.publisher';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import Stubber from '@mod/common/mock/typeorm-faker';

describe('UserNotificationPreferenceService', () => {
    let service: UserNotificationPreferenceService;
    let repository: DeepMocked<TenantAwareRepository<UserNotificationPreferenceEntity>>;
    let clsService: DeepMocked<ClsService>;
    let snsPublisher: DeepMocked<SnsPublisher>;

    const userId = 'user-123';
    const tenantId = 'tenant-123';

    beforeEach(async () => {
        repository = createMock<TenantAwareRepository<UserNotificationPreferenceEntity>>();
        clsService = createMock<ClsService>();
        snsPublisher = createMock<SnsPublisher>();

        clsService.get.mockReturnValue({ userId, tenantId });

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                UserNotificationPreferenceService,
                {
                    provide: 'TenantAwareRepository_UserNotificationPreferenceEntity',
                    useValue: repository
                },
                {
                    provide: ClsService,
                    useValue: clsService
                },
                {
                    provide: SnsPublisher,
                    useValue: snsPublisher
                }
            ]
        }).compile();

        service = module.get<UserNotificationPreferenceService>(UserNotificationPreferenceService);
    });

    describe('getMyPreferences', () => {
        it('should return existing preferences', async () => {
            const pref = Stubber.stubOne(UserNotificationPreferenceEntity, {
                id: '550e8400-e29b-41d4-a716-446655440000',
                userId,
                tenantId,
                overrides: {}
            });
            repository.findOneTenantContext.mockResolvedValue(pref);

            const result = await service.getMyPreferences();
            expect(result).toBe(pref);
        });

        it('should create and return default preferences if none exist', async () => {
            repository.findOneTenantContext.mockResolvedValue(null);
            const newPref = Stubber.stubOne(UserNotificationPreferenceEntity, {
                id: '550e8400-e29b-41d4-a716-446655440001',
                userId,
                tenantId,
                overrides: {}
            });
            repository.createTenantContext.mockReturnValue(newPref);
            repository.saveTenantContext.mockResolvedValue(newPref);

            const result = await service.getMyPreferences();
            expect(result).toBe(newPref);
            expect(repository.createTenantContext).toHaveBeenCalled();
        });
    });

    describe('updateMyPreferences', () => {
        it('should update overrides and publish event', async () => {
            const pref = Stubber.stubOne(UserNotificationPreferenceEntity, {
                id: '550e8400-e29b-41d4-a716-446655440002',
                userId,
                tenantId,
                overrides: { emailEnabled: true }
            });
            repository.findOneTenantContext.mockResolvedValue(pref);
            repository.saveTenantContext.mockImplementation(async (p) => await (p as UserNotificationPreferenceEntity));

            const updateDto = { overrides: { emailEnabled: false, smsEnabled: true } };
            const result = await service.updateMyPreferences(updateDto);

            expect(result.overrides.emailEnabled).toBe(false);
            expect(result.overrides.smsEnabled).toBe(true);
            expect(snsPublisher.publish).toHaveBeenCalledWith(
                expect.objectContaining({
                    eventType: 'notification-preference.updated',
                    data: expect.objectContaining({
                        userId,
                        tenantId
                    })
                }),
                expect.objectContaining({
                    topic: 'tenant-events'
                })
            );
        });
    });
});
