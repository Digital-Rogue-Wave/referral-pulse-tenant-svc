import { registerDecorator, ValidationArguments, ValidationOptions, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

@ValidatorConstraint({ name: 'IsGreaterThanOrEqual', async: false })
export class IsGreaterThanOrEqualConstraint implements ValidatorConstraintInterface {
    validate(maxValue: number, args: ValidationArguments) {
        const [relatedPropertyName] = args.constraints;
        const relatedValue = (args.object as any)[relatedPropertyName];
        return typeof relatedValue === 'number' && relatedValue <= maxValue;
    }

    defaultMessage(args: ValidationArguments) {
        const [relatedPropertyName] = args.constraints;
        return `$property must be greater than or equal to ${relatedPropertyName}`;
    }
}

export function IsGreaterThanOrEqual(property: string, validationOptions?: ValidationOptions) {
    return (object: any, propertyName: string) => {
        registerDecorator({
            target: object.constructor,
            propertyName,
            options: validationOptions,
            constraints: [property],
            validator: IsGreaterThanOrEqualConstraint
        });
    };
}
