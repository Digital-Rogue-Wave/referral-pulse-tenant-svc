import { HttpException, HttpStatus, ValidationError, ValidationPipeOptions } from '@nestjs/common';

const validationOptions: ValidationPipeOptions = {
    whitelist: true,
    transform: true,
    forbidUnknownValues: true,
    forbidNonWhitelisted: true,
    errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    exceptionFactory: (errors: ValidationError[]) => {
        return new HttpException(
            {
                status: HttpStatus.UNPROCESSABLE_ENTITY,
                errors
            },
            HttpStatus.UNPROCESSABLE_ENTITY
        );
    }
};

export default validationOptions;
