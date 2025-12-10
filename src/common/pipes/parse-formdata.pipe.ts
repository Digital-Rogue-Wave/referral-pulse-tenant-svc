import { PipeTransform, Injectable } from '@nestjs/common';

@Injectable()
export class ParseFormdataPipe implements PipeTransform<any> {
    // eslint-disable-next-line @typescript-eslint/require-await
    async transform(value: unknown) {
        return typeof value === 'string' ? JSON.parse(value) : value;
    }
}
