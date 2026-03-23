import { IsRuleEventConstraint } from './rule-event.validator';
import { ValidationArguments } from 'class-validator';

describe('IsRuleEventConstraint', () => {
    let constraint: IsRuleEventConstraint;
    const args = {} as ValidationArguments;

    beforeEach(() => {
        constraint = new IsRuleEventConstraint();
    });

    it('should return false for non-object values', () => {
        expect(constraint.validate('invalid', args)).toBe(false);
        expect(constraint.validate(123, args)).toBe(false);
        expect(constraint.validate(null, args)).toBe(false);
    });

    it('should return true for valid event', () => {
        const validEvent = {
            type: 'payout',
            params: {
                amount: 10,
            },
        };
        expect(constraint.validate(validEvent, args)).toBe(true);
    });

    it('should return true for event with only type', () => {
        const validEvent = {
            type: 'payout',
        };
        expect(constraint.validate(validEvent, args)).toBe(true);
    });

    it('should return false for event missing type', () => {
        const invalidEvent = {
            params: {
                amount: 10,
            },
        };
        expect(constraint.validate(invalidEvent, args)).toBe(false);
    });

    it('should return false for event with non-string type', () => {
        const invalidEvent = {
            type: 123,
        };
        expect(constraint.validate(invalidEvent, args)).toBe(false);
    });
});
