import { HttpStatus } from '@nestjs/common';

import { BaseException } from '@common/exceptions/base.exceptions';
import { JsonService } from '@common/helper/json.service';
import { UpdateTenantDto } from '@domains/tenant';

import { ParseFormdataPipe } from './parse-formdata.pipe';

/** `PUT /v1/tenants` sends its fields as the multipart `data` part; the global ValidationPipe never sees them. */
describe('ParseFormdataPipe (US1.7.1 F1)', () => {
    const pipe = new ParseFormdataPipe(new JsonService());
    const asTenantUpdate = (data: Record<string, unknown>) =>
        pipe.transform(JSON.stringify(data), { type: 'body', metatype: UpdateTenantDto, data: 'data' });

    it('given valid snake_case fields, then it returns the validated camelCase DTO', async () => {
        const dto = await asTenantUpdate({ billing_country: 'DE', retention_months: 12 });

        expect(dto).toBeInstanceOf(UpdateTenantDto);
        expect(dto).toMatchObject({ billingCountry: 'DE', retentionMonths: 12 });
    });

    it.each([
        ['a retention window under 6 months', { retention_months: 5 }],
        ['a retention window over 36 months', { retention_months: 37 }],
        ['a country that does not exist (US1.7.1 F2)', { billing_country: 'ZZ' }],
        ['an unknown invitation channel', { invitation_channel: 'sometimes' }],
        ['a field the route does not take, such as data_region (US1.7.4 F2)', { data_region: 'us-east-1' }]
    ])('given %s, then it refuses with 400 instead of passing it on', async (_case, data) => {
        const error = await asTenantUpdate(data).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(BaseException);
        expect((error as BaseException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
    });
});
