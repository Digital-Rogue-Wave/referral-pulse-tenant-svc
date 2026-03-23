import {
    registerDecorator,
    ValidationOptions,
    ValidatorConstraint,
    ValidatorConstraintInterface,
    ValidationArguments,
} from 'class-validator';
import moment, { MomentInput } from 'moment';

export enum DateComparisonMethod {
    GREATER = 'greater',
    LESS = 'less',
    EQUAL = 'equal',
}

@ValidatorConstraint({ async: false })
export class CompareDateConstraint implements ValidatorConstraintInterface {
    validate(value: unknown, args: ValidationArguments): boolean {
        const [relatedPropertyOrDate, method] = args.constraints as [string | Date, DateComparisonMethod];

        // Get the related value or use the provided Date
        const relatedValue =
            relatedPropertyOrDate instanceof Date
                ? relatedPropertyOrDate
                : (args.object as Record<string, unknown>)[relatedPropertyOrDate];

        if (!relatedValue || !moment(relatedValue).isValid()) {
            return false;
        }

        // Handle arrays
        if (Array.isArray(value)) {
            return value.every((item) => this.compareDates(item as MomentInput, relatedValue as MomentInput, method));
        }

        // Handle single values
        return this.compareDates(value as MomentInput, relatedValue as MomentInput, method);
    }

    private compareDates(value: MomentInput, relatedValue: MomentInput, method: DateComparisonMethod): boolean {
        if (!value || !moment(value).isValid()) {
            return false;
        }

        const currentDate = moment(value);
        const compareDate = moment(relatedValue);

        switch (method) {
            case DateComparisonMethod.GREATER:
                return currentDate.isAfter(compareDate);
            case DateComparisonMethod.LESS:
                return currentDate.isBefore(compareDate);
            case DateComparisonMethod.EQUAL:
                return currentDate.isSame(compareDate);
            default:
                return false;
        }
    }

    defaultMessage(args: ValidationArguments): string {
        const [relatedPropertyOrDate, method] = args.constraints as [string | Date, DateComparisonMethod];
        const isDate = relatedPropertyOrDate instanceof Date;
        const reference = isDate ? relatedPropertyOrDate.toISOString() : `the value of ${relatedPropertyOrDate}`;

        return `Each date must be ${method} than ${isDate ? `the date ${reference}` : reference}`;
    }
}

export function CompareDate(
    relatedPropertyOrDate: string | Date,
    method: DateComparisonMethod,
    validationOptions?: ValidationOptions,
) {
    return function (object: NonNullable<unknown>, propertyName: string) {
        registerDecorator({
            target: object.constructor,
            propertyName: propertyName,
            options: validationOptions,
            constraints: [relatedPropertyOrDate, method],
            validator: CompareDateConstraint,
        });
    };
}
