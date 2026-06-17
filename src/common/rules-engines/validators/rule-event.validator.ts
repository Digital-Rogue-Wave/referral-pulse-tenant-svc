import { registerDecorator, ValidationOptions, ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments } from 'class-validator';

@ValidatorConstraint({ name: 'isRuleEvent', async: false })
export class IsRuleEventConstraint implements ValidatorConstraintInterface {
    validate(value: unknown, _args: ValidationArguments): boolean {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return false;
        }

        const event = value as Record<string, unknown>;
        return typeof event.type === 'string' && event.type.trim().length > 0;
    }

    defaultMessage(args: ValidationArguments): string {
        return `${args.property} must be a valid json-rules-engine event object with a 'type' string field`;
    }
}

export function IsRuleEvent(validationOptions?: ValidationOptions) {
    return function (object: object, propertyName: string) {
        registerDecorator({
            target: object.constructor,
            propertyName: propertyName,
            options: validationOptions,
            constraints: [],
            validator: IsRuleEventConstraint
        });
    };
}
