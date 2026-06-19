import { HttpStatus } from '@nestjs/common';

import { BaseException } from './base.exceptions';

/**
 * Not found exception for missing resources.
 * HTTP Status: 404 Not Found
 */
export class NotFoundException extends BaseException {
    constructor(resource: string, identifier: string | number) {
        super('resource_not_found', `${resource} with ID ${identifier} not found`, HttpStatus.NOT_FOUND, resource, {
            resource,
            identifier
        });
    }
}
