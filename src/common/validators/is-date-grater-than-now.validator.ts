import { ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';
import { UnprocessableEntityException } from '@nestjs/common';
import { HttpResponseException } from '../exceptions/http-response.exception';
import dayjs, { type ConfigType as DayjsConfigType } from 'dayjs';

@ValidatorConstraint({ name: 'IsDateGreaterThanNowValidator', async: false })
export class IsDateGreaterThanNowValidator implements ValidatorConstraintInterface {
    validate(rawDate: unknown): boolean {
        try {
            const inputDate = dayjs(rawDate as DayjsConfigType);
            if (!inputDate.isValid()) return false;

            const now = dayjs();
            return inputDate.isAfter(now);
        } catch (_caughtError) {
            // Do not touch unknown; wrap a proper HttpException
            throw new HttpResponseException(
                new UnprocessableEntityException('Date must be greater than the current date'),
            );
        }
    }

    defaultMessage(): string {
        return 'Date must be greater than the current date';
    }
}
