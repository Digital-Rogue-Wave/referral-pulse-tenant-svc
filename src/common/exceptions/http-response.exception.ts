import { HttpException, HttpStatus } from '@nestjs/common';

export class HttpResponseException extends HttpException {
    constructor(error: HttpException) {
        super(error?.message || 'Internal Server Error', error?.getStatus() || HttpStatus.INTERNAL_SERVER_ERROR);
    }
}
