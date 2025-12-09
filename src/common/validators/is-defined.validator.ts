import { isDefined } from 'class-validator';
import { PreconditionFailedException } from '@nestjs/common';

export const isDefinedValidator = (value: any) => {
    if (!isDefined(value)) {
        throw new PreconditionFailedException('{"validation": "Undefined or Null input data"}');
    }
};
