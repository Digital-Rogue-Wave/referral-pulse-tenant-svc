import { EntitySchema } from 'typeorm';

/** Matches what TypeOrmModule.forFeature expects without relying on a Nest-exported alias */
export type OrmEntity = Function | EntitySchema;
