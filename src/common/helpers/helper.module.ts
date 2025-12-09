import { Module } from '@nestjs/common';
import { HelperService } from '@mod/common/helpers/helper.service';

@Module({
    imports: [],
    providers: [HelperService],
    exports: [HelperService],
})
export class HelperModule {}
