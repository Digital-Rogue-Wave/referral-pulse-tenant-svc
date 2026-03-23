import {
    registerDecorator,
    ValidationOptions,
    ValidatorConstraint,
    ValidatorConstraintInterface,
    ValidationArguments,
} from 'class-validator';

interface IRuleCondition {
    all?: IRuleCondition[];
    any?: IRuleCondition[];
    fact?: string;
    operator?: string;
    value?: unknown;
}

@ValidatorConstraint({ name: 'isRuleConditions', async: false })
export class IsRuleConditionsConstraint implements ValidatorConstraintInterface {
    validate(value: unknown, _args: ValidationArguments): boolean {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return false;
        }

        return this.validateConditions(value as IRuleCondition);
    }

    private validateConditions(conditions: IRuleCondition): boolean {
        if (!conditions || typeof conditions !== 'object') {
            return false;
        }

        if (conditions.all) {
            if (!Array.isArray(conditions.all) || conditions.all.length === 0) {
                return false;
            }
            return conditions.all.every((c: IRuleCondition) => this.validateConditions(c));
        }

        if (conditions.any) {
            if (!Array.isArray(conditions.any) || conditions.any.length === 0) {
                return false;
            }
            return conditions.any.every((c: IRuleCondition) => this.validateConditions(c));
        }

        // It's a simple condition
        return this.validateSimpleCondition(conditions);
    }

    private validateSimpleCondition(condition: IRuleCondition): boolean {
        return (
            Object.prototype.hasOwnProperty.call(condition, 'fact') &&
            Object.prototype.hasOwnProperty.call(condition, 'operator') &&
            Object.prototype.hasOwnProperty.call(condition, 'value')
        );
    }

    defaultMessage(args: ValidationArguments): string {
        return `${args.property} must be a valid json-rules-engine conditions object with 'all', 'any' or 'fact', 'operator', 'value' fields`;
    }
}

export function IsRuleConditions(validationOptions?: ValidationOptions) {
    return function (object: NonNullable<unknown>, propertyName: string) {
        registerDecorator({
            target: object.constructor,
            propertyName: propertyName,
            options: validationOptions,
            constraints: [],
            validator: IsRuleConditionsConstraint,
        });
    };
}
