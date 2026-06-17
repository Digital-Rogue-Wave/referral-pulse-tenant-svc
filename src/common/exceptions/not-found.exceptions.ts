import { HttpStatus } from '@nestjs/common';

import { BaseException } from '@common/exceptions/base.exceptions';

export class NotFoundException extends BaseException {
    constructor(resource: string, identifier: string | number) {
        super('RESOURCE_NOT_FOUND', `${resource} with ID ${identifier} not found`, HttpStatus.NOT_FOUND, {
            resource,
            identifier
        });
    }
}
