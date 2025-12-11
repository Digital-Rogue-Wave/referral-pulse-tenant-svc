import { SetMetadata } from '@nestjs/common';

export const FeatureFlag = (key: string) => SetMetadata('feature_flag_key', key);
