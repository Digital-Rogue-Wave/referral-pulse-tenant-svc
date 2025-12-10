import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments } from 'class-validator';
import { DataSource, EntityTarget, ObjectLiteral } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { HttpResponseException } from '../exceptions/http-response.exception';
import { ValidationEntity } from '@mod/types/app.type';

@Injectable()
@ValidatorConstraint({ name: 'IsNotExist', async: true })
export class IsNotExist implements ValidatorConstraintInterface {
    constructor(
        @InjectDataSource()
        private readonly dataSource: DataSource
    ) {}

    async validate(rawValue: unknown, validationArgs: ValidationArguments): Promise<boolean> {
        try {
            // constraints[0] should be the entity target (class or name)
            const entityTarget = validationArgs.constraints?.[0] as EntityTarget<ObjectLiteral> | undefined;
            if (!entityTarget) return true; // nothing to check => treat as non-existing

            const repository = this.dataSource.getRepository<ObjectLiteral>(entityTarget);
            const propertyName = validationArgs.property;
            const currentEntity = validationArgs.object as ValidationEntity;

            // Resolve DB column name safely
            const columnMeta = repository.metadata.findColumnWithPropertyName(propertyName);
            const dbColumn = columnMeta?.databaseName ?? propertyName;

            // Build a precise query (avoids loose FindOptions typing)
            const alias = repository.metadata.tableName || repository.metadata.name.toLowerCase();
            const existing = await repository
                .createQueryBuilder(alias)
                .where(`${alias}.${dbColumn} = :value`, { value: rawValue as unknown })
                .limit(1)
                .getOne();

            // Allow when the only match is the same entity (update scenario)
            const existingEntity = existing as ValidationEntity;
            if (existingEntity?.id && currentEntity?.id) {
                return String(existingEntity.id) === String(currentEntity.id);
            }

            // Return true only when no entity exists with that value
            return !existing;
        } catch (_caughtError) {
            throw new HttpResponseException(new UnprocessableEntityException(_caughtError));
        }
    }

    defaultMessage(validationArgs: ValidationArguments): string {
        return validationArgs.constraints?.[1] as string;
    }
}
