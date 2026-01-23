# Generic Mapper Utility - Usage Guide

This guide demonstrates how to use the generic mapper utility for clean, type-safe, and reusable DTO/Entity mapping.

## Table of Contents
- [Basic Usage](#basic-usage)
- [Mapping Entities to DTOs](#mapping-entities-to-dtos)
- [Mapping DTOs to Entities](#mapping-dtos-to-entities)
- [Partial Updates (PATCH)](#partial-updates-patch)
- [Advanced Options](#advanced-options)
- [Real-World Examples](#real-world-examples)

---

## Basic Usage

### Simple Entity to Response DTO

```typescript
import { toDto, toDtoArray } from '@app/common/helper';

// Single entity
const response = toDto(UserResponse, userEntity);

// Array of entities
const responses = toDtoArray(UserResponse, userEntities);
```

**Before (manual mapping):**
```typescript
static toResponse(entity: UserEntity): UserResponse {
    return {
        id: entity.id,
        email: entity.email,
        firstName: entity.firstName,
        lastName: entity.lastName,
        role: entity.role,
        isActive: entity.isActive,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt,
        // ... 50 more fields
    };
}
```

**After (automatic mapping):**
```typescript
static toResponse(entity: UserEntity): UserResponse {
    return toDto(UserResponse, entity);
}
```

---

## Mapping Entities to DTOs

### Full Response
```typescript
import { toDto } from '@app/common/helper';

export class UserResponseMapper {
    static toResponse(entity: UserEntity): UserResponse {
        return toDto(UserResponse, entity);
    }
}
```

### Partial Response (Exclude Fields)
```typescript
import { toDto, omit } from '@app/common/helper';

// Option 1: Using omit helper
static toPublicResponse(entity: UserEntity): Omit<UserResponse, 'password' | 'secretKey'> {
    const response = toDto(UserResponse, entity);
    return omit(response, ['password', 'secretKey']);
}

// Option 2: Using mapper options
static toPublicResponse(entity: UserEntity): UserResponse {
    return toDto(UserResponse, entity, {
        exclude: ['password', 'secretKey']
    });
}
```

### Minimal Response (Include Only Specific Fields)
```typescript
import { pick } from '@app/common/helper';

// Perfect for dropdowns/autocomplete
static toMinimalResponse(entity: UserEntity): Pick<UserResponse, 'id' | 'email'> {
    const response = toDto(UserResponse, entity);
    return pick(response, ['id', 'email']);
}

// Or using mapper options
static toMinimalResponse(entity: UserEntity): UserResponse {
    return toDto(UserResponse, entity, {
        include: ['id', 'email']
    });
}
```

---

## Mapping DTOs to Entities

### Create Entity from DTO
```typescript
import { toEntity } from '@app/common/helper';

// Automatically excludes protected fields (id, createdAt, updatedAt, etc.)
const entity = toEntity(UserEntity, createUserDto);

// Protected fields like 'id', 'createdAt' are automatically skipped
```

### Create with Additional Fields
```typescript
const entity = toEntity(UserEntity, createUserDto);
entity.tenantId = getTenantId(); // Set manually after mapping
await repository.save(entity);
```

---

## Partial Updates (PATCH)

### Update Entity from DTO
```typescript
import { patchEntity } from '@app/common/helper';

async update(id: string, updateDto: UpdateUserDto) {
    const user = await this.repository.findOne({ where: { id } });

    // Automatically:
    // - Skips undefined values (partial update)
    // - Protects system fields (id, createdAt, updatedAt)
    patchEntity(user, updateDto);

    return await this.repository.save(user);
}
```

### Protect Additional Fields
```typescript
// Prevent updating certain fields even if provided in DTO
patchEntity(user, updateDto, {
    exclude: ['email', 'role'] // These won't be updated even if in DTO
});
```

---

## Advanced Options

### Custom Field Transformations
```typescript
import { toDto, dateToISOString, maskSensitiveData } from '@app/common/helper';

const response = toDto(UserResponse, entity, {
    transform: {
        createdAt: dateToISOString,
        updatedAt: (date) => date.toISOString(),
        ssn: (value) => maskSensitiveData(value, 4), // Show only last 4 digits
        metadata: (value) => JSON.stringify(value),   // Serialize objects
    }
});
```

### Deep Cloning
```typescript
// Clone nested objects to avoid reference issues
const clone = toDto(UserResponse, entity, {
    deepClone: true
});
```

### Skip Null/Undefined Values
```typescript
const response = toDto(UserResponse, entity, {
    skipNull: true,      // Exclude null values
    skipUndefined: true, // Exclude undefined values
});
```

### Combine Multiple Options
```typescript
const response = toDto(UserResponse, entity, {
    exclude: ['password', 'secretKey'],
    skipNull: true,
    transform: {
        createdAt: dateToISOString,
        email: (email) => email.toLowerCase(),
    }
});
```

---

## Real-World Examples

### Example 1: User Mapper with Multiple Response Types

```typescript
import { toDto, toDtoArray, pick, omit } from '@app/common/helper';

export class UserResponseMapper {
    // Full response
    static toResponse(entity: UserEntity): UserResponse {
        return toDto(UserResponse, entity);
    }

    // Array mapping
    static toResponseArray(entities: UserEntity[]): UserResponse[] {
        return toDtoArray(UserResponse, entities);
    }

    // Public API response (exclude internal fields)
    static toPublicResponse(entity: UserEntity): Omit<UserResponse, 'tenantId' | 'internalNotes'> {
        return omit(this.toResponse(entity), ['tenantId', 'internalNotes']);
    }

    // List view (only essential fields)
    static toListResponse(entity: UserEntity): Pick<UserResponse, 'id' | 'email' | 'firstName' | 'lastName' | 'role'> {
        return pick(this.toResponse(entity), ['id', 'email', 'firstName', 'lastName', 'role']);
    }

    // Dropdown option
    static toOptionResponse(entity: UserEntity): Pick<UserResponse, 'id' | 'email'> {
        return pick(this.toResponse(entity), ['id', 'email']);
    }

    // With date formatting
    static toResponseWithFormattedDates(entity: UserEntity): UserResponse {
        return toDto(UserResponse, entity, {
            transform: {
                createdAt: (date) => date.toISOString(),
                updatedAt: (date) => date.toISOString(),
            }
        });
    }
}
```

### Example 2: Service with Create/Update Operations

```typescript
import { toEntity, patchEntity } from '@app/common/helper';

@Injectable()
export class ProductService {
    async create(dto: CreateProductDto): Promise<ProductResponse> {
        // Map DTO to entity (auto-excludes id, createdAt, etc.)
        const product = toEntity(ProductEntity, dto);

        // Set tenant context
        product.tenantId = this.tenantContext.getTenantId();

        const saved = await this.repository.save(product);

        return ProductResponseMapper.toResponse(saved);
    }

    async update(id: string, dto: UpdateProductDto): Promise<ProductResponse> {
        const product = await this.repository.findOne({ where: { id } });

        if (!product) {
            throw new NotFoundException();
        }

        // Partial update - only provided fields
        // Auto-protects id, createdAt, updatedAt
        patchEntity(product, dto);

        const updated = await this.repository.save(product);

        return ProductResponseMapper.toResponse(updated);
    }

    async findAll(): Promise<ProductResponse[]> {
        const products = await this.repository.find();

        // Use list response for performance (fewer fields)
        return products.map(p => ProductResponseMapper.toListResponse(p));
    }
}
```

### Example 3: Protected Fields in Sensitive Data

```typescript
import { patchEntity } from '@app/common/helper';

@Injectable()
export class AccountService {
    async updateAccount(id: string, dto: UpdateAccountDto): Promise<AccountResponse> {
        const account = await this.repository.findOne({ where: { id } });

        // Protect sensitive fields from being updated
        patchEntity(account, dto, {
            exclude: [
                'balance',      // Can't update balance directly
                'accountNumber', // Can't change account number
                'status',       // Status changes require approval workflow
            ]
        });

        return await this.repository.save(account);
    }
}
```

### Example 4: Complex Transformation

```typescript
import { toDto, maskSensitiveData } from '@app/common/helper';

export class PaymentMapper {
    static toResponse(entity: PaymentEntity): PaymentResponse {
        return toDto(PaymentResponse, entity, {
            transform: {
                // Mask credit card number
                cardNumber: (num) => maskSensitiveData(num, 4),

                // Format currency
                amount: (amt) => Number(amt).toFixed(2),

                // Convert dates to ISO strings
                processedAt: (date) => date?.toISOString(),

                // Serialize metadata
                metadata: (meta) => JSON.stringify(meta),

                // Custom status formatting
                status: (status) => status.toUpperCase(),
            },

            // Exclude internal fields
            exclude: ['processorRawResponse', 'internalNotes'],
        });
    }
}
```

---

## Benefits

✅ **Type Safety** - Full TypeScript support with IntelliSense
✅ **Zero Boilerplate** - No manual field assignment for 100+ field entities
✅ **Reusable** - Same utility across all mappers
✅ **Maintainable** - Add fields to DTO/Entity, mapping auto-updates
✅ **Flexible** - Support for exclusion, inclusion, transformation
✅ **Safe** - Auto-protects system fields (id, createdAt, etc.)
✅ **Testable** - Pure functions, easy to unit test

---

## Migration Guide

### Before
```typescript
export class UserResponseMapper {
    static toResponse(entity: UserEntity): UserResponse {
        return {
            id: entity.id,
            email: entity.email,
            firstName: entity.firstName,
            // ... manually map 100 fields
        };
    }

    static toResponseArray(entities: UserEntity[]): UserResponse[] {
        return entities.map(e => this.toResponse(e));
    }
}
```

### After
```typescript
import { toDto, toDtoArray } from '@app/common/helper';

export class UserResponseMapper {
    static toResponse(entity: UserEntity): UserResponse {
        return toDto(UserResponse, entity);
    }

    static toResponseArray(entities: UserEntity[]): UserResponse[] {
        return toDtoArray(UserResponse, entities);
    }
}
```

**Result:** 90% less code, same type safety, easier maintenance!