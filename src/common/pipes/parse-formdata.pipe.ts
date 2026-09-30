import { PipeTransform, Injectable } from '@nestjs/common';

import { JsonService } from '@common/helper/json.service';
import { camelCaseKeys } from '@common/http-contract/wire-case';

/** Parses the JSON `data` part of a multipart request; its keys are snake_case on the wire like any body. */
@Injectable()
export class ParseFormdataPipe implements PipeTransform<unknown> {
    constructor(private readonly jsonService: JsonService) {}

    async transform(value: unknown) {
        return typeof value === 'string' ? camelCaseKeys(this.jsonService.parse(value)) : value;
    }
}
