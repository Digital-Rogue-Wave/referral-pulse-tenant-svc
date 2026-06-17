import { registerDecorator, ValidationOptions, ValidationArguments } from 'class-validator';

export function IsLocalizedString(validationOptions?: ValidationOptions) {
    return function (object: NonNullable<unknown>, propertyName: string) {
        registerDecorator({
            name: 'isLocalizedString',
            target: object.constructor,
            propertyName: propertyName,
            options: validationOptions,
            validator: {
                validate(value: unknown, _args: ValidationArguments) {
                    // Check if value is an object
                    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
                        return false;
                    }

                    // Check if object has at least one property
                    const keys = Object.keys(value);
                    if (keys.length === 0) {
                        return false;
                    }

                    // Check if all values are non-empty strings
                    const obj = value as Record<string, unknown>;
                    return keys.every((key) => typeof obj[key] === 'string' && (obj[key] as string).trim().length > 0);
                },
                defaultMessage(args: ValidationArguments) {
                    return `${args.property} must be an object with at least one locale key containing a non-empty string value`;
                }
            }
        });
    };
}
