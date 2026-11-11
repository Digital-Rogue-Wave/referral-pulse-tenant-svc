import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { JsonService } from '@common/helper/json.service';
import { validationExceptionFactory } from '@common/http-contract/validation-exception.factory';
import { camelCaseKeys } from '@common/http-contract/wire-case';

/**
 * Parses the JSON `data` part of a multipart request (its keys are snake_case on the wire like any body) and validates
 * it against the route's DTO with the global pipe's rules. The global ValidationPipe runs first and sees only the raw
 * string, so without this a multipart body reached the service unvalidated (US1.7.1 F1).
 */
@Injectable()
export class ParseFormdataPipe implements PipeTransform<unknown> {
    constructor(private readonly jsonService: JsonService) {}

    async transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
        const body = typeof value === 'string' ? camelCaseKeys(this.jsonService.parse(value)) : value;
        const dto = metadata.metatype;
        if (!dto || [String, Boolean, Number, Array, Object].includes(dto as never)) {
            return body;
        }
        const instance = plainToInstance(dto, body ?? {}, { enableImplicitConversion: true }) as object;
        const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
        if (errors.length > 0) {
            throw validationExceptionFactory(errors);
        }
        return instance;
    }
}
