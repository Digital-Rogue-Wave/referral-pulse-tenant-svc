import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments } from 'class-validator';
import { DataSource, ObjectLiteral } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { HttpResponseException } from '../exceptions/http-response.exception';
import { ExistsConstraintTuple } from '@mod/types/app.type';

@Injectable()
@ValidatorConstraint({ name: 'IsExist', async: true })
export class IsExist implements ValidatorConstraintInterface {
    constructor(
        @InjectDataSource()
        private readonly dataSource: DataSource
    ) {}

    async validate(rawValue: unknown, args: ValidationArguments): Promise<boolean> {
        try {
            const [entityTarget, explicitPath] = args.constraints as ExistsConstraintTuple<ObjectLiteral>;
            if (!entityTarget) return false;

            const repository = this.dataSource.getRepository(entityTarget);

            // property name we should search by
            const propertyName = explicitPath ?? args.property;

            // compute lookup value
            let lookupValue: unknown = rawValue;
            if (explicitPath && rawValue !== null && typeof rawValue === 'object') {
                lookupValue = (rawValue as Record<string, unknown>)[explicitPath];
            }

            if (lookupValue === undefined || lookupValue === null) return false;

            // resolve DB column safely
            const column = repository.metadata.findColumnWithPropertyName(propertyName);
            const dbColumn = column?.databaseName ?? propertyName;

            // use query builder to avoid loose FindOptions typing
            const alias = repository.metadata.tableName || repository.metadata.name.toLowerCase();
            const found = await repository.createQueryBuilder(alias).where(`${alias}.${dbColumn} = :value`, { value: lookupValue }).limit(1).getOne();

            return Boolean(found);
        } catch (error) {
            // Do not mutate unknown; throw a proper HttpException wrapped in your domain exception
            throw new HttpResponseException(new UnprocessableEntityException(`Validation failed while checking entity existence ${error}`));
        }
    }
}
