import { PipeTransform, Injectable } from '@nestjs/common';

import { JsonService } from '@common/helper/json.service';

@Injectable()
export class ParseFormdataPipe implements PipeTransform<unknown> {
    constructor(private readonly jsonService: JsonService) {}

    async transform(value: unknown) {
        return typeof value === 'string' ? this.jsonService.parse(value) : value;
    }
}
