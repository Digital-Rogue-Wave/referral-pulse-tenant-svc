import { Injectable, Inject } from '@nestjs/common';

import { Engine, RuleProperties, Event } from 'json-rules-engine';

@Injectable()
export class RulesEngineService {
    constructor(
        @Inject('ENGINE_FACTORY')
        private readonly createEngine: () => Engine
    ) {}

    /**
     * Evaluates a set of facts against a collection of rules.
     *
     * @param rules - Array of rules to be added to the engine.
     * @param facts - The facts to evaluate against the rules.
     * @returns A promise that resolves to an array of triggered events.
     */
    async evaluate<TRule extends RuleProperties, TFacts extends Record<string, any>>(rules: TRule[], facts: TFacts): Promise<Event[]> {
        const engine = this.createEngine();

        for (const rule of rules) {
            engine.addRule(rule);
        }

        const { events } = await engine.run(facts);
        return events;
    }

    /**
     * Validates a rule's syntax by attempting to add it to a fresh engine instance.
     *
     * @param rule - The rule properties to validate.
     * @returns { isValid: boolean; error?: string }
     */
    validateRule(rule: RuleProperties): { isValid: boolean; error?: string } {
        try {
            const engine = this.createEngine();
            engine.addRule(rule);
            return { isValid: true };
        } catch (err) {
            return { isValid: false, error: (err as Error).message };
        }
    }
}
