import { ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments } from 'class-validator';
import { UnprocessableEntityException } from '@nestjs/common';
import { HttpResponseException } from '../exceptions/http-response.exception';
import dayjs, { type ConfigType as DayjsConfigType } from 'dayjs';

@ValidatorConstraint({ name: 'EndLaterThanStartDateValidator', async: false })
export class EndLaterThanStartDateValidator implements ValidatorConstraintInterface {
    validate(rawEndDate: unknown, args: ValidationArguments): boolean {
        try {
            const startDateKey = String(args.constraints?.[0] ?? '');
            if (!startDateKey) return false;

            // Safely index the target object
            const targetObject = args.object as Record<string, unknown>;
            const rawStartDate = targetObject[startDateKey];

            // Parse with dayjs (supports Date | string | number | Dayjs)
            const startDate = dayjs(rawStartDate as DayjsConfigType);
            const endDate = dayjs(rawEndDate as DayjsConfigType);

            if (!startDate.isValid() || !endDate.isValid()) return false;
            return endDate.isAfter(startDate);
        } catch (_caughtError) {
            // Pass a proper Nest HttpException to your wrapper to satisfy TS
            const httpException = new UnprocessableEntityException('End date should be later than start date');
            throw new HttpResponseException(httpException);
        }
    }

    defaultMessage(): string {
        return 'End date should be later than start date';
    }
}
