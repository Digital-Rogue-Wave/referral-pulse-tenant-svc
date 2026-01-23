# BaseResponseMapper - Usage Guide

This guide shows how to use the `BaseResponseMapper` class to create reusable mappers across all your resources.

## Table of Contents
- [Why Use BaseResponseMapper](#why-use-baseresponsemapper)
- [Basic Usage](#basic-usage)
- [Complete Examples](#complete-examples)
- [Customization](#customization)
- [Best Practices](#best-practices)

---

## Why Use BaseResponseMapper?

**Before** - Manual mapping for every resource:
```typescript
export class UserResponseMapper {
    static toResponse(entity: UserEntity): UserResponse {
        return { id: entity.id, email: entity.email, /* ... 98 more fields */ };
    }

    static toResponseArray(entities: UserEntity[]): UserResponse[] {
        return entities.map(e => this.toResponse(e));
    }

    static toListResponse(entity: UserEntity): Pick<UserResponse, 'id' | 'email'> {
        return { id: entity.id, email: entity.email };
    }

    // ... repeat for every resource
}
```

**After** - Extend base class, zero boilerplate:
```typescript
export class UserResponseMapper extends BaseResponseMapper<UserEntity, UserResponse> {
    constructor() {
        super(UserResponse);
    }
    // Done! All methods available: toResponse, toResponseArray, toListResponse, etc.
}
```

---

## Basic Usage

### Step 1: Create Your Mapper Class

```typescript
import { BaseResponseMapper } from '@app/common/helper';
import { UserEntity } from './user.entity';
import { UserResponse } from './user.response';

export class UserResponseMapper extends BaseResponseMapper<UserEntity, UserResponse> {
    constructor() {
        super(UserResponse); // Pass the response class
    }
}

// Create singleton instance for convenience
export const userResponseMapper = new UserResponseMapper();
```

### Step 2: Use in Your Service

```typescript
import { userResponseMapper } from '@domains/user/mappers/user-response.mapper';

@Injectable()
export class UserService {
    async findById(id: string): Promise<UserResponse> {
        const user = await this.repository.findOne({ where: { id } });
        return userResponseMapper.toResponse(user);
    }

    async findAll(): Promise<UserResponse[]> {
        const users = await this.repository.find();
        return userResponseMapper.toResponseArray(users);
    }
}
```

---

## Complete Examples

### Example 1: Minimal Mapper (Zero Customization)

For simple entities where you just need basic mapping:

```typescript
// mappers/product-response.mapper.ts
import { BaseResponseMapper } from '@app/common/helper';
import { ProductEntity } from '../product.entity';
import { ProductResponse } from '../product.response';

export class ProductResponseMapper extends BaseResponseMapper<ProductEntity, ProductResponse> {
    constructor() {
        super(ProductResponse);
    }
}

export const productResponseMapper = new ProductResponseMapper();
```

**Usage:**
```typescript
// In your service
const response = productResponseMapper.toResponse(productEntity);
const responses = productResponseMapper.toResponseArray(productEntities);
const listItem = productResponseMapper.toListResponse(productEntity, ['id', 'name', 'price']);
const publicData = productResponseMapper.toPublicResponse(productEntity, ['cost', 'vendorId']);
```

### Example 2: Custom List & Public Responses

Override methods to define default fields for list and public views:

```typescript
// mappers/order-response.mapper.ts
import { BaseResponseMapper } from '@app/common/helper';
import { OrderEntity } from '../order.entity';
import { OrderResponse } from '../order.response';

export class OrderResponseMapper extends BaseResponseMapper<OrderEntity, OrderResponse> {
    constructor() {
        super(OrderResponse);
    }

    /**
     * Default list response shows essential order info
     */
    toListResponse(
        entity: OrderEntity,
    ): Pick<OrderResponse, 'id' | 'orderNumber' | 'status' | 'totalAmount' | 'createdAt'>;
    toListResponse<K extends keyof OrderResponse>(
        entity: OrderEntity,
        fields: K[],
    ): Pick<OrderResponse, K>;
    toListResponse<K extends keyof OrderResponse>(
        entity: OrderEntity,
        fields?: K[],
    ): Pick<OrderResponse, K> {
        const defaultFields = ['id', 'orderNumber', 'status', 'totalAmount', 'createdAt'] as K[];
        return super.toListResponse(entity, fields || defaultFields);
    }

    /**
     * Public response excludes internal fields
     */
    toPublicResponse(
        entity: OrderEntity,
    ): Omit<OrderResponse, 'tenantId' | 'internalNotes' | 'vendorCost'> {
        return super.toPublicResponse(entity, ['tenantId', 'internalNotes', 'vendorCost']);
    }

    /**
     * Minimal response for dropdown/references
     */
    toMinimalResponse(entity: OrderEntity): Pick<OrderResponse, 'id' | 'orderNumber'> {
        return this.toListResponse(entity, ['id', 'orderNumber']);
    }
}

export const orderResponseMapper = new OrderResponseMapper();
```

**Usage:**
```typescript
// List view - uses default fields
const listItems = orderResponseMapper.toListResponse(orderEntity);
// Returns: { id, orderNumber, status, totalAmount, createdAt }

// Custom fields
const customList = orderResponseMapper.toListResponse(orderEntity, ['id', 'status']);
// Returns: { id, status }

// Public API
const publicData = orderResponseMapper.toPublicResponse(orderEntity);
// Automatically excludes: tenantId, internalNotes, vendorCost

// Dropdown
const dropdown = orderResponseMapper.toMinimalResponse(orderEntity);
// Returns: { id, orderNumber }
```

### Example 3: Custom Transformations

Override `toResponse` to add computed fields or transformations:

```typescript
// mappers/user-response.mapper.ts
import { BaseResponseMapper } from '@app/common/helper';
import { UserEntity } from '../user.entity';
import { UserResponse } from '../user.response';

export class UserResponseMapper extends BaseResponseMapper<UserEntity, UserResponse> {
    constructor() {
        super(UserResponse);
    }

    /**
     * Override toResponse to add computed fields
     */
    toResponse(entity: UserEntity): UserResponse {
        const response = super.toResponse(entity);

        // Add computed field
        response.fullName = `${entity.firstName} ${entity.lastName}`;

        // Format dates
        response.createdAt = entity.createdAt.toISOString() as any;
        response.updatedAt = entity.updatedAt.toISOString() as any;

        return response;
    }

    /**
     * List response for admin users
     */
    toAdminListResponse(
        entity: UserEntity,
    ): Pick<UserResponse, 'id' | 'email' | 'role' | 'isActive' | 'lastLogin'> {
        return this.toListResponse(entity, ['id', 'email', 'role', 'isActive', 'lastLogin']);
    }

    /**
     * List response for regular users
     */
    toUserListResponse(entity: UserEntity): Pick<UserResponse, 'id' | 'email' | 'fullName'> {
        return this.toListResponse(entity, ['id', 'email', 'fullName']);
    }
}

export const userResponseMapper = new UserResponseMapper();
```

### Example 4: Multiple Response Variants

Create different response methods for different contexts:

```typescript
// mappers/payment-response.mapper.ts
import { BaseResponseMapper } from '@app/common/helper';
import { PaymentEntity } from '../payment.entity';
import { PaymentResponse } from '../payment.response';

export class PaymentResponseMapper extends BaseResponseMapper<PaymentEntity, PaymentResponse> {
    constructor() {
        super(PaymentResponse);
    }

    /**
     * Full admin response with sensitive data
     */
    toAdminResponse(entity: PaymentEntity): PaymentResponse {
        return super.toResponse(entity);
    }

    /**
     * Customer response - mask card number, hide processor data
     */
    toCustomerResponse(
        entity: PaymentEntity,
    ): Omit<PaymentResponse, 'processorResponse' | 'internalNotes'> {
        const response = super.toResponse(entity);
        const { processorResponse, internalNotes, ...customerResponse } = response;

        // Mask card number (show last 4 digits)
        customerResponse.cardNumber = `****-****-****-${entity.cardNumber.slice(-4)}`;

        return customerResponse;
    }

    /**
     * Receipt response - minimal info for receipts
     */
    toReceiptResponse(
        entity: PaymentEntity,
    ): Pick<PaymentResponse, 'id' | 'amount' | 'status' | 'createdAt'> {
        return this.toListResponse(entity, ['id', 'amount', 'status', 'createdAt']);
    }

    /**
     * Transaction history - summary for lists
     */
    toHistoryResponse(
        entity: PaymentEntity,
    ): Pick<PaymentResponse, 'id' | 'amount' | 'status' | 'paymentMethod' | 'createdAt'> {
        return this.toListResponse(entity, [
            'id',
            'amount',
            'status',
            'paymentMethod',
            'createdAt',
        ]);
    }
}

export const paymentResponseMapper = new PaymentResponseMapper();
```

---

## Customization

### Override Methods

You can override any method from the base class:

```typescript
export class CustomMapper extends BaseResponseMapper<MyEntity, MyResponse> {
    constructor() {
        super(MyResponse);
    }

    // Override toResponse for custom logic
    toResponse(entity: MyEntity): MyResponse {
        const response = super.toResponse(entity);
        // Add custom logic
        response.computedField = this.calculateSomething(entity);
        return response;
    }

    // Override toResponseArray for batch optimizations
    toResponseArray(entities: MyEntity[]): MyResponse[] {
        // Custom batch processing logic
        return super.toResponseArray(entities);
    }

    // Add custom methods
    toSpecialResponse(entity: MyEntity): Partial<MyResponse> {
        return this.toListResponse(entity, ['id', 'specialField']);
    }
}
```

### Add Domain-Specific Methods

```typescript
export class ArticleResponseMapper extends BaseResponseMapper<ArticleEntity, ArticleResponse> {
    constructor() {
        super(ArticleResponse);
    }

    /**
     * Response for article preview/cards
     */
    toPreviewResponse(
        entity: ArticleEntity,
    ): Pick<ArticleResponse, 'id' | 'title' | 'summary' | 'coverImage' | 'publishedAt'> {
        return this.toListResponse(entity, [
            'id',
            'title',
            'summary',
            'coverImage',
            'publishedAt',
        ]);
    }

    /**
     * RSS feed response
     */
    toRssResponse(
        entity: ArticleEntity,
    ): Pick<ArticleResponse, 'id' | 'title' | 'content' | 'publishedAt' | 'author'> {
        return this.toListResponse(entity, ['id', 'title', 'content', 'publishedAt', 'author']);
    }

    /**
     * SEO metadata response
     */
    toSeoResponse(
        entity: ArticleEntity,
    ): Pick<ArticleResponse, 'id' | 'title' | 'summary' | 'keywords' | 'publishedAt'> {
        return this.toListResponse(entity, [
            'id',
            'title',
            'summary',
            'keywords',
            'publishedAt',
        ]);
    }
}
```

---

## Best Practices

### 1. Use Singleton Instances

Always export a singleton instance for convenience:

```typescript
export class UserResponseMapper extends BaseResponseMapper<UserEntity, UserResponse> {
    constructor() {
        super(UserResponse);
    }
}

// Singleton for service injection
export const userResponseMapper = new UserResponseMapper();
```

### 2. Define Default List Fields

Override `toListResponse` to set sensible defaults:

```typescript
toListResponse(
    entity: MyEntity,
): Pick<MyResponse, 'id' | 'name' | 'status' | 'createdAt'>;
toListResponse<K extends keyof MyResponse>(entity: MyEntity, fields: K[]): Pick<MyResponse, K>;
toListResponse<K extends keyof MyResponse>(
    entity: MyEntity,
    fields?: K[],
): Pick<MyResponse, K> {
    const defaultFields = ['id', 'name', 'status', 'createdAt'] as K[];
    return super.toListResponse(entity, fields || defaultFields);
}
```

### 3. Create Context-Specific Methods

Add methods for different use cases:

```typescript
export class ProductMapper extends BaseResponseMapper<ProductEntity, ProductResponse> {
    // Admin view
    toAdminResponse(entity: ProductEntity): ProductResponse {
        return super.toResponse(entity);
    }

    // Customer view (hide cost, vendor details)
    toCustomerResponse(entity: ProductEntity): Omit<ProductResponse, 'cost' | 'vendorId'> {
        return super.toPublicResponse(entity, ['cost', 'vendorId']);
    }

    // Search results
    toSearchResponse(entity: ProductEntity): Pick<ProductResponse, 'id' | 'name' | 'price' | 'imageUrl'> {
        return this.toListResponse(entity, ['id', 'name', 'price', 'imageUrl']);
    }

    // Cart item
    toCartItemResponse(entity: ProductEntity): Pick<ProductResponse, 'id' | 'name' | 'price' | 'stock'> {
        return this.toListResponse(entity, ['id', 'name', 'price', 'stock']);
    }
}
```

### 4. Organize by Module

Follow this structure:

```
src/domains/user/
├── dto/
│   ├── create-user.dto.ts
│   └── update-user.dto.ts
├── responses/
│   └── user.response.ts
├── mappers/
│   └── user-response.mapper.ts  ← Extend BaseResponseMapper here
├── user.entity.ts
├── user.service.ts
├── user.controller.ts
└── index.ts                      ← Export singleton
```

### 5. Import and Use

```typescript
// In index.ts
export * from './mappers/user-response.mapper';

// In service
import { userResponseMapper } from '@domains/user';

const response = userResponseMapper.toResponse(entity);
```

---

## Comparison: Before vs After

### Before (Manual)
```typescript
export class UserResponseMapper {
    static toResponse(entity: UserEntity): UserResponse {
        return {
            id: entity.id,
            email: entity.email,
            firstName: entity.firstName,
            lastName: entity.lastName,
            // ... 96 more fields
        };
    }

    static toResponseArray(entities: UserEntity[]): UserResponse[] {
        return entities.map(e => this.toResponse(e));
    }

    static toListResponse(entity: UserEntity): Pick<UserResponse, 'id' | 'email'> {
        return {
            id: entity.id,
            email: entity.email,
        };
    }

    static toPublicResponse(entity: UserEntity): Omit<UserResponse, 'password'> {
        const { password, ...rest } = this.toResponse(entity);
        return rest;
    }
}
```

### After (Base Class)
```typescript
export class UserResponseMapper extends BaseResponseMapper<UserEntity, UserResponse> {
    constructor() {
        super(UserResponse);
    }

    // Optional: Override for custom behavior
    toMinimalResponse(entity: UserEntity): Pick<UserResponse, 'id' | 'email'> {
        return this.toListResponse(entity, ['id', 'email']);
    }
}

export const userResponseMapper = new UserResponseMapper();
```

**Result:** 95% less code, same type safety, consistent API!

---

## Benefits Summary

✅ **Zero Boilerplate** - No manual field mapping
✅ **Type Safe** - Full TypeScript support
✅ **Consistent API** - Same methods across all mappers
✅ **Easy Customization** - Override methods as needed
✅ **Maintainable** - Add fields to DTO, mapping auto-updates
✅ **Reusable** - One base class for all resources
✅ **Flexible** - Support for list, public, minimal, custom responses