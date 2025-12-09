import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantEntity } from './tenant.entity';
import { TenantService } from './tenant.service';
import { TenantController } from './tenant.controller';
import { SnsModule } from '@mod/common/aws-sqs/sns.module';

@Module({
    imports: [TypeOrmModule.forFeature([TenantEntity]), SnsModule],
    controllers: [TenantController],
    providers: [TenantService],
    exports: [TenantService]
})
export class TenantModule {}
