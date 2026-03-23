import { Global, Module } from '@nestjs/common';

import { DateService } from './date.service';
import { EnvironmentService } from './environment.service';
import { JsonService } from './json.service';

@Global()
@Module({
    providers: [DateService, JsonService, EnvironmentService],
    exports: [DateService, JsonService, EnvironmentService],
})
export class HelperModule {}
