import { IsRuleConditionsConstraint } from './rule-conditions.validator';
import { ValidationArguments } from 'class-validator';

describe('IsRuleConditionsConstraint', () => {
    let constraint: IsRuleConditionsConstraint;
    const args = {} as ValidationArguments;

    beforeEach(() => {
        constraint = new IsRuleConditionsConstraint();
    });

    it('should return false for non-object values', () => {
        expect(constraint.validate('invalid', args)).toBe(false);
        expect(constraint.validate(123, args)).toBe(false);
        expect(constraint.validate(null, args)).toBe(false);
    });

    it('should return true for valid simple condition', () => {
        const validCondition = {
            fact: 'conversionValue',
            operator: 'greaterThan',
            value: 100,
        };
        expect(constraint.validate(validCondition, args)).toBe(true);
    });

    it('should return true for valid "all" condition', () => {
        const validAllCondition = {
            all: [
                {
                    fact: 'conversionValue',
                    operator: 'greaterThan',
                    value: 100,
                },
                {
                    fact: 'isFirstPurchase',
                    operator: 'equal',
                    value: true,
                },
            ],
        };
        expect(constraint.validate(validAllCondition, args)).toBe(true);
    });

    it('should return true for valid "any" condition', () => {
        const validAnyCondition = {
            any: [
                {
                    fact: 'conversionValue',
                    operator: 'greaterThan',
                    value: 100,
                },
            ],
        };
        expect(constraint.validate(validAnyCondition, args)).toBe(true);
    });

    it('should return false for condition missing required fields', () => {
        const invalidCondition = {
            fact: 'conversionValue',
            // operator missing
            value: 100,
        };
        expect(constraint.validate(invalidCondition, args)).toBe(false);
    });

    it('should return false for "all" condition with non-array value', () => {
        const invalidAll = {
            all: { fact: 'foo', operator: 'eq', value: 'bar' },
        };
        expect(constraint.validate(invalidAll, args)).toBe(false);
    });

    it('should return false for empty "all" or "any" array', () => {
        expect(constraint.validate({ all: [] }, args)).toBe(false);
        expect(constraint.validate({ any: [] }, args)).toBe(false);
    });

    it('should return true for nested conditions', () => {
        const nestedCondition = {
            all: [
                {
                    fact: 'age',
                    operator: 'greaterThan',
                    value: 18,
                },
                {
                    any: [
                        { fact: 'country', operator: 'equal', value: 'US' },
                        { fact: 'country', operator: 'equal', value: 'CA' },
                    ],
                },
            ],
        };
        expect(constraint.validate(nestedCondition, args)).toBe(true);
    });
});
