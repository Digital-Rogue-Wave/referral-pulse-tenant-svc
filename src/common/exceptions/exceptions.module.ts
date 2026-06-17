import { Global, Module } from '@nestjs/common';

import { GlobalExceptionsFilter } from './global-exceptions.filter';

@Global()
@Module({
    providers: [GlobalExceptionsFilter],
    exports: [GlobalExceptionsFilter]
})
export class ExceptionsModule {}
