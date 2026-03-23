# NestJS REST Controllers — DTOs, Mapping & Pagination

DTO mapping patterns, pagination, filtering, and sorting for NestJS 11.x REST APIs with Prisma ORM and TypeScript 5.x.

## 3. DTO Mapping Patterns

### Pattern 1: Static Factory Methods

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { Product } from '@prisma/client';

export class ProductResponseDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  @ApiProperty({ example: 'Wireless Mouse' })
  name: string;

  @ApiProperty({ example: 'MOUSE-001' })
  sku: string;

  @ApiProperty({ example: 29.99 })
  price: number;

  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE', 'ARCHIVED'] })
  status: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
```

### Pattern 2: class-transformer with @Expose/@Exclude

```typescript
import { Expose, Exclude, plainToInstance } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { Product } from '@prisma/client';

@Exclude()
export class ProductResponseDto {
  @Expose()
  @ApiProperty()
  id: string;

  @Expose()
  @ApiProperty()
  name: string;

  @Expose()
  @ApiProperty()
  sku: string;

  @Expose()
  @ApiProperty()
  price: number;

  @Expose()
  @ApiProperty()
  status: string;

  @Expose()
  @ApiProperty()
  createdAt: Date;

  @Expose()
  @ApiProperty()
  updatedAt: Date;

}
```

---

## 4. Pagination, Filtering & Sorting

### Generic Pagination DTO

```typescript
import { IsOptional, IsInt, Min, Max, IsString, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({ default: 'createdAt' })
  @IsOptional()
  @IsString()
  sortBy: string = 'createdAt';

  @ApiPropertyOptional({ enum: SortOrder, default: SortOrder.DESC })
  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder: SortOrder = SortOrder.DESC;

  get skip(): number {
    return (this.page - 1) * this.limit;
  }

  get take(): number {
    return this.limit;
  }
}
```

### Generic Paginated Response

Use nestjs-paginate: https://github.com/ppetzold/nestjs-paginate#readme


### Repository with Pagination Implementation

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/core/prisma/prisma.service';
import { Prisma, Product } from '@prisma/client';
import { ProductFilterDto } from './dto';

@Injectable()
export class ProductRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findManyWithPagination(filter: ProductFilterDto): Promise<[Product[], number]> {
    const where = this.buildWhereClause(filter);
    const orderBy = { [filter.sortBy]: filter.sortOrder };

    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy,
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.product.count({ where }),
    ]);

    return [data, total];
  }

  private buildWhereClause(filter: ProductFilterDto): Prisma.ProductWhereInput {
    const where: Prisma.ProductWhereInput = {};

    if (filter.search) {
      where.OR = [
        { name: { contains: filter.search, mode: 'insensitive' } },
        { sku: { contains: filter.search, mode: 'insensitive' } },
        { description: { contains: filter.search, mode: 'insensitive' } },
      ];
    }

    if (filter.status) {
      where.status = filter.status;
    }

    if (filter.minPrice !== undefined || filter.maxPrice !== undefined) {
      where.price = {};
      if (filter.minPrice !== undefined) {
        where.price.gte = new Prisma.Decimal(filter.minPrice);
      }
      if (filter.maxPrice !== undefined) {
        where.price.lte = new Prisma.Decimal(filter.maxPrice);
      }
    }

    return where;
  }
}
```
