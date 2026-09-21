import { HttpStatus, ValidationError } from '@nestjs/common';

import { BaseException } from '@common/exceptions/base.exceptions';

/** Every failed constraint with its full property path (`branding.primary_color`, `items[0].amount`). */
function flatten(errors: ValidationError[], parentPath = ''): Array<{ field: string; message: string }> {
    return errors.flatMap((error) => {
        const path = parentPath
            ? /^\d+$/.test(error.property)
                ? `${parentPath}[${error.property}]`
                : `${parentPath}.${error.property}`
            : error.property;
        const own = Object.values(error.constraints ?? {}).map((message) => ({ field: path, message }));
        return [...own, ...flatten(error.children ?? [], path)];
    });
}

/**
 * ValidationPipe → API Contract v1.3 `invalid_request` error: `param` is the first failing field and
 * `details` lists them all (the filter snake-cases the paths for the wire).
 */
export function validationExceptionFactory(errors: ValidationError[]): BaseException {
    const failures = flatten(errors);
    return new BaseException(
        'validation_failed',
        failures.map((f) => f.message).join('; ') || 'Validation failed',
        HttpStatus.BAD_REQUEST,
        failures[0]?.field,
        {
            errors: failures
        }
    );
}
