import { Test, TestingModule } from '@nestjs/testing';
import { RulesEngineService } from './rules-engine.service';
import { Engine, RuleProperties } from 'json-rules-engine';

describe('RulesEngineService (Common)', () => {
    let service: RulesEngineService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                RulesEngineService,
                {
                    provide: 'ENGINE_FACTORY',
                    useValue: () => new Engine()
                }
            ]
        }).compile();

        service = module.get<RulesEngineService>(RulesEngineService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('should trigger a reward event when conditions are met', async () => {
        interface MyFacts {
            score: number;
        }

        const rules: RuleProperties[] = [
            {
                conditions: {
                    all: [
                        {
                            fact: 'score',
                            operator: 'greaterThanInclusive',
                            value: 100
                        }
                    ]
                },
                event: {
                    type: 'test-event',
                    params: {
                        foo: 'bar'
                    }
                }
            }
        ];

        const facts: MyFacts = {
            score: 150
        };

        const events = await service.evaluate(rules, facts);
        expect(events).toHaveLength(1);
        expect(events[0]!.type).toBe('test-event');
        expect(events[0]!.params?.foo).toBe('bar');
    });

    it('should NOT trigger an event when conditions are NOT met', async () => {
        interface MyFacts {
            score: number;
        }

        const rules: RuleProperties[] = [
            {
                conditions: {
                    all: [
                        {
                            fact: 'score',
                            operator: 'greaterThanInclusive',
                            value: 100
                        }
                    ]
                },
                event: {
                    type: 'test-event'
                }
            }
        ];

        const facts: MyFacts = {
            score: 50
        };

        const events = await service.evaluate(rules, facts);
        expect(events).toHaveLength(0);
    });
});
