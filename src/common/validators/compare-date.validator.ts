import { registerDecorator, ValidationOptions, ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments } from 'class-validator';
import dayjs from 'dayjs';

export enum DateComparisonMethod {
    GREATER = 'greater',
    LESS = 'less',
    EQUAL = 'equal'
}

@ValidatorConstraint({ async: false })
export class CompareDateConstraint implements ValidatorConstraintInterface {
    validate(value: any, args: ValidationArguments): boolean {
        const [relatedPropertyOrDate, method] = args.constraints as [string | Date, DateComparisonMethod];

        // Get the related value or use the provided Date
        const relatedValue = relatedPropertyOrDate instanceof Date ? relatedPropertyOrDate : (args.object as any)[relatedPropertyOrDate];

        if (!relatedValue || !dayjs(relatedValue).isValid()) return false;

        // Handle arrays
        if (Array.isArray(value)) {
            return value.every((item) => this.compareDates(item, relatedValue, method));
        }

        // Handle single values
        return this.compareDates(value, relatedValue, method);
    }

    private compareDates(value: any, relatedValue: any, method: DateComparisonMethod): boolean {
        if (!value || !dayjs(value).isValid()) return false;

        const currentDate = dayjs(value);
        const compareDate = dayjs(relatedValue);

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

export function CompareDate(relatedPropertyOrDate: string | Date, method: DateComparisonMethod, validationOptions?: ValidationOptions) {
    return function (object: NonNullable<unknown>, propertyName: string) {
        registerDecorator({
            target: object.constructor,
            propertyName: propertyName,
            options: validationOptions,
            constraints: [relatedPropertyOrDate, method],
            validator: CompareDateConstraint
        });
    };
}
