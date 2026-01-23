export class TotoResponse {
    id: string;
    tenantId: string;
    name: string;
    description?: string;
    status: 'active' | 'inactive' | 'archived';
    processCount: number;
    fileUrl?: string;
    externalData?: Record<string, any>;
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Lightweight response for list views
 * Use this when you don't need all fields (e.g., 100+ field entities)
 */
export class TotoListItemResponse {
    id: string;
    name: string;
    status: 'active' | 'inactive' | 'archived';
    processCount: number;
    createdAt: Date;
}

/**
 * Paginated response is provided by nestjs-paginate library
 * Import with: import { Paginated } from 'nestjs-paginate'
 *
 * Response structure:
 * {
 *   data: T[],
 *   meta: {
 *     itemsPerPage: number,
 *     totalItems: number,
 *     currentPage: number,
 *     totalPages: number,
 *     sortBy: [string, string][],
 *     searchBy: string[],
 *     filter?: Record<string, string>
 *   },
 *   links: {
 *     first: string,
 *     previous: string,
 *     current: string,
 *     next: string,
 *     last: string
 *   }
 * }
 */