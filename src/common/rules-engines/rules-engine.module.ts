import { Module } from '@nestjs/common';

import { Engine } from 'json-rules-engine';

import { RulesEngineService } from './rules-engine.service';

export const ENGINE_FACTORY = 'ENGINE_FACTORY';

@Module({
    providers: [
        RulesEngineService,
        {
            provide: ENGINE_FACTORY,
            useValue: () => new Engine(),
        },
    ],
    exports: [RulesEngineService],
})
export class RulesEngineModule {}
