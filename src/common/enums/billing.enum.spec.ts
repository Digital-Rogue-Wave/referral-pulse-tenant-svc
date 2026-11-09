import { BillingPlanEnum, canonicalPlanName } from './billing.enum';

describe('canonicalPlanName', () => {
    it.each([
        ['FREE', BillingPlanEnum.FREE],
        ['starter', BillingPlanEnum.STARTER],
        [' Growth ', BillingPlanEnum.GROWTH],
        ['sCaLe', BillingPlanEnum.SCALE],
        ['Enterprise', BillingPlanEnum.ENTERPRISE]
    ])('maps %p to the stored plan name', (input, plan) => {
        expect(canonicalPlanName(input)).toBe(plan);
    });

    it.each(['Acme custom', '', null, undefined])('returns null for %p, which is not one of the five plans', (input) => {
        expect(canonicalPlanName(input)).toBeNull();
    });
});
