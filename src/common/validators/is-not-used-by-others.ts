import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ValidationArguments, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';
import { DataSource, EntityTarget, ObjectLiteral } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { HttpResponseException } from '../exceptions/http-response.exception';
import { ValidationEntity } from '@mod/types/app.type';

@Injectable()
@ValidatorConstraint({ name: 'IsNotUsedByOthers', async: true })
export class IsNotUsedByOthers implements ValidatorConstraintInterface {
    constructor(
        @InjectDataSource() private readonly dataSource: DataSource,
    ) {}

    async validate(rawValue: unknown, validationArgs: ValidationArguments): Promise<boolean> {
        try {
            // constraints[0] must be the EntityTarget (class or table name)
            const entityTarget = validationArgs.constraints?.[0] as EntityTarget<ObjectLiteral> | undefined;
            if (!entityTarget) return true; // nothing to check

            const repository = this.dataSource.getRepository<ObjectLiteral>(entityTarget);
            const propertyName = validationArgs.property;
            const currentEntity = validationArgs.object as ValidationEntity;

            // Resolve actual DB column name for the property
            const columnMeta = repository.metadata.findColumnWithPropertyName(propertyName);
            const dbColumnName = columnMeta?.databaseName ?? propertyName;

            const alias = repository.metadata.tableName || repository.metadata.name.toLowerCase();
            const query = repository
                .createQueryBuilder(alias)
                .where(`${alias}.${dbColumnName} = :value`, { value: rawValue as unknown });

            // If we’re updating the same entity, exclude its current id
            if (currentEntity?.id != null) {
                query.andWhere(`${alias}.id != :currentId`, { currentId: currentEntity.id });
            }

            const existing = await query.limit(1).getOne();
            return !existing;
        } catch (_caughtError) {
            throw new HttpResponseException(new UnprocessableEntityException(_caughtError));
        }
    }

    defaultMessage(validationArgs: ValidationArguments): string {
        return validationArgs.constraints?.[1] as string;
    }
}
