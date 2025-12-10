import { HttpException, HttpStatus, ValidationError } from '@nestjs/common';
import { validateOrReject } from 'class-validator';
import { ObjectLiteral, Repository } from 'typeorm';
import crypto from 'crypto';
import { randomStringGenerator } from '@nestjs/common/utils/random-string-generator.util';
import { plainToInstance } from 'class-transformer';

export class Utils {
    static generateErrors(errors: ValidationError[]): Record<string, any> {
        return errors.reduce(
            (accumulator, currentValue) => ({
                ...accumulator,
                [currentValue.property]:
                    (currentValue.children?.length ?? 0) > 0
                        ? this.generateErrors(currentValue.children ?? [])
                        : Object.values(currentValue.constraints ?? {}).join(', ')
            }),
            {}
        );
    }

    /**
     * Validates a DTO instance using class-validator and rejects if invalid.
     * @param dtoClass - The DTO class (e.g. CreateUserDto)
     * @param data - The plain object to validate
     * @returns The validated DTO instance
     */
    static async validateDtoOrFail<T extends object>(dtoClass: new (...args: any[]) => T, data: unknown): Promise<T> {
        const dto = plainToInstance(dtoClass, data);
        try {
            await validateOrReject(dto, {
                whitelist: true,
                forbidNonWhitelisted: true
            });
            return dto;
        } catch (errors) {
            const formattedErrors = Utils.generateErrors(errors as ValidationError[]);

            throw new HttpException(
                {
                    status: HttpStatus.PRECONDITION_FAILED,
                    errors: {
                        validation: Object.values(formattedErrors).join('. ').trim()
                    }
                },
                HttpStatus.PRECONDITION_FAILED
            );
        }
    }
    static getKeyByValue<T>(myEnum: any, value: string) {
        const indexOfS = Object.values(myEnum).indexOf(value as unknown as T);
        return Object.keys(myEnum)[indexOfS];
    }

    static createRepositoryMock<T extends ObjectLiteral>(): Repository<T> {
        return <Repository<T>>Object.getOwnPropertyNames(Repository.prototype).reduce(
            (acc, x) => {
                acc[x] = jest.fn();
                return acc;
            },
            {} as Record<string, any>
        );
    }

    static createSessionHash(): string {
        return crypto.createHash('sha256').update(randomStringGenerator()).digest('hex');
    }
}
