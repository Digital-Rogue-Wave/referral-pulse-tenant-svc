import { Global, Module } from '@nestjs/common';
import { DateService } from './date.service';
import { JsonService } from './json.service';
import { EnvironmentService } from './environment.service';

@Global()
@Module({
    providers: [DateService, JsonService, EnvironmentService],
    exports: [DateService, JsonService, EnvironmentService],
})
export class HelperModule {}
