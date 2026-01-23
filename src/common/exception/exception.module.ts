import { Global, Module } from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter';

@Global()
@Module({
    providers: [GlobalExceptionFilter],
    exports: [GlobalExceptionFilter],
})
export class ExceptionModule {}
