import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AllConfigType } from '@app/config/config.type';
import { ClsTenantContextService } from '@app/common/tenant/cls-tenant-context.service';

/**
 * S3 Key Builder Service
 *
 * Builds consistent, sanitized S3 object keys with multi-tenancy support.
 * Ensures keys follow S3 best practices and are free of problematic characters.
 *
 * Key Pattern:
 * - Tenant-scoped: {tenantId}/{category}/{subcategory}/{filename}
 * - Public: public/{category}/{filename}
 *
 * Examples:
 * - tenant_123/uploads/images/avatar_abc.jpg
 * - tenant_456/exports/reports/monthly_report_2024_01.pdf
 * - public/assets/logos/company_logo.png
 *
 * S3 Key Guidelines:
 * - Use forward slashes (/) for hierarchy
 * - Avoid spaces, use hyphens or underscores
 * - Keep keys under 1024 characters
 * - Use lowercase for consistency
 */
@Injectable()
export class S3KeyBuilder {
    constructor(
        private readonly configService: ConfigService<AllConfigType>,
        private readonly tenantContext: ClsTenantContextService,
    ) {}

    /**
     * Build a tenant-scoped key
     * Requires active tenant context
     *
     * @param category - Top-level category (e.g., 'uploads', 'exports', 'backups')
     * @param filename - File name with extension
     * @param subcategory - Optional subcategory for further organization
     * @returns Sanitized S3 key
     */
    buildTenantKey(category: string, filename: string, subcategory?: string): string {
        const tenantId = this.tenantContext.getTenantId();
        if (!tenantId) {
            throw new Error('Tenant context is required for tenant-scoped S3 keys');
        }

        const sanitizedTenantId = this.sanitize(tenantId);
        const sanitizedCategory = this.sanitize(category);
        const sanitizedFilename = this.sanitizeFilename(filename);

        const parts = [sanitizedTenantId, sanitizedCategory];

        if (subcategory) {
            const sanitizedSubcategory = this.sanitize(subcategory);
            parts.push(sanitizedSubcategory);
        }

        parts.push(sanitizedFilename);

        return parts.join('/');
    }

    /**
     * Build a public key (not tenant-scoped)
     * Use for publicly accessible resources
     *
     * @param category - Category (e.g., 'assets', 'static')
     * @param filename - File name with extension
     * @param subcategory - Optional subcategory
     * @returns Sanitized S3 key
     */
    buildPublicKey(category: string, filename: string, subcategory?: string): string {
        const sanitizedCategory = this.sanitize(category);
        const sanitizedFilename = this.sanitizeFilename(filename);

        const parts = ['public', sanitizedCategory];

        if (subcategory) {
            const sanitizedSubcategory = this.sanitize(subcategory);
            parts.push(sanitizedSubcategory);
        }

        parts.push(sanitizedFilename);

        return parts.join('/');
    }

    /**
     * Build an upload key for user uploads
     *
     * @param type - Upload type (e.g., 'images', 'documents', 'videos')
     * @param filename - Original filename
     * @param userId - Optional user ID for user-specific folders
     * @returns Sanitized S3 key
     */
    buildUploadKey(type: string, filename: string, userId?: string): string {
        const sanitizedType = this.sanitize(type);
        const sanitizedFilename = this.sanitizeFilename(filename);

        if (userId) {
            const sanitizedUserId = this.sanitize(userId);
            return this.buildTenantKey('uploads', sanitizedFilename, `${sanitizedType}/${sanitizedUserId}`);
        }

        return this.buildTenantKey('uploads', sanitizedFilename, sanitizedType);
    }

    /**
     * Build an export key for data exports
     *
     * @param exportType - Export type (e.g., 'reports', 'analytics', 'campaigns')
     * @param filename - Export filename
     * @returns Sanitized S3 key
     */
    buildExportKey(exportType: string, filename: string): string {
        const sanitizedType = this.sanitize(exportType);
        const sanitizedFilename = this.sanitizeFilename(filename);

        return this.buildTenantKey('exports', sanitizedFilename, sanitizedType);
    }

    /**
     * Build a backup key
     *
     * @param backupType - Backup type (e.g., 'database', 'files')
     * @param filename - Backup filename
     * @returns Sanitized S3 key
     */
    buildBackupKey(backupType: string, filename: string): string {
        const sanitizedType = this.sanitize(backupType);
        const sanitizedFilename = this.sanitizeFilename(filename);

        return this.buildTenantKey('backups', sanitizedFilename, sanitizedType);
    }

    /**
     * Build a temporary key for temporary files
     * These should be cleaned up after a certain period
     *
     * @param filename - Filename
     * @param tempId - Optional temporary identifier
     * @returns Sanitized S3 key
     */
    buildTempKey(filename: string, tempId?: string): string {
        const sanitizedFilename = this.sanitizeFilename(filename);

        if (tempId) {
            const sanitizedTempId = this.sanitize(tempId);
            return this.buildTenantKey('temp', sanitizedFilename, sanitizedTempId);
        }

        return this.buildTenantKey('temp', sanitizedFilename);
    }

    /**
     * Build a key with date-based hierarchy (useful for logs, archives)
     *
     * @param category - Category
     * @param filename - Filename
     * @param date - Date for organization (defaults to now)
     * @returns Sanitized S3 key with date hierarchy
     */
    buildDateBasedKey(category: string, filename: string, date: Date = new Date()): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');

        const dateHierarchy = `${year}/${month}/${day}`;
        const sanitizedCategory = this.sanitize(category);
        const sanitizedFilename = this.sanitizeFilename(filename);

        return this.buildTenantKey(sanitizedCategory, sanitizedFilename, dateHierarchy);
    }

    /**
     * Build a prefix pattern for listing keys
     *
     * @param category - Category
     * @param subcategory - Optional subcategory
     * @param tenantScoped - Whether prefix is tenant-specific
     * @returns S3 key prefix
     */
    buildPrefix(category: string, subcategory?: string, tenantScoped = true): string {
        const sanitizedCategory = this.sanitize(category);

        if (tenantScoped) {
            const tenantId = this.tenantContext.getTenantId();
            if (!tenantId) {
                throw new Error('Tenant context is required for tenant-scoped prefixes');
            }
            const sanitizedTenantId = this.sanitize(tenantId);

            const parts = [sanitizedTenantId, sanitizedCategory];

            if (subcategory) {
                const sanitizedSubcategory = this.sanitize(subcategory);
                parts.push(sanitizedSubcategory);
            }

            return parts.join('/') + '/';
        }

        const parts = ['public', sanitizedCategory];

        if (subcategory) {
            const sanitizedSubcategory = this.sanitize(subcategory);
            parts.push(sanitizedSubcategory);
        }

        return parts.join('/') + '/';
    }

    /**
     * Extract tenant ID from an S3 key (if tenant-scoped)
     *
     * @param key - S3 key
     * @returns Tenant ID or null
     */
    extractTenantId(key: string): string | null {
        // Public keys don't have tenant ID
        if (key.startsWith('public/')) {
            return null;
        }

        // First segment should be tenant ID
        const parts = key.split('/');
        if (parts.length >= 2) {
            return parts[0];
        }

        return null;
    }

    /**
     * Sanitize path component (category, subcategory, etc.)
     * Removes spaces and problematic characters
     *
     * @param value - Value to sanitize
     * @returns Sanitized value
     */
    private sanitize(value: string): string {
        if (!value) {
            throw new Error('S3 key component cannot be empty');
        }

        return (
            value
                // Replace spaces with hyphens
                .replace(/\s+/g, '-')
                // Remove characters not allowed in S3 keys (keep alphanumeric, hyphens, underscores)
                .replace(/[^a-zA-Z0-9\-_]/g, '')
                // Remove consecutive hyphens
                .replace(/-+/g, '-')
                // Remove leading/trailing hyphens
                .replace(/^-+|-+$/g, '')
                // Convert to lowercase for consistency
                .toLowerCase()
        );
    }

    /**
     * Sanitize filename while preserving extension
     * More lenient than path sanitization
     *
     * @param filename - Filename to sanitize
     * @returns Sanitized filename
     */
    private sanitizeFilename(filename: string): string {
        if (!filename) {
            throw new Error('Filename cannot be empty');
        }

        // Split filename and extension
        const lastDotIndex = filename.lastIndexOf('.');
        const hasExtension = lastDotIndex > 0;
        const name = hasExtension ? filename.substring(0, lastDotIndex) : filename;
        const extension = hasExtension ? filename.substring(lastDotIndex + 1) : '';

        // Sanitize name part
        const sanitizedName = name
            // Replace spaces with underscores
            .replace(/\s+/g, '_')
            // Remove problematic characters but keep more characters than path components
            .replace(/[^a-zA-Z0-9\-_.]/g, '')
            // Remove consecutive underscores/hyphens
            .replace(/[_-]+/g, '_')
            // Remove leading/trailing underscores/hyphens
            .replace(/^[_-]+|[_-]+$/g, '');

        // Sanitize extension (alphanumeric only)
        const sanitizedExtension = extension.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

        if (!sanitizedName) {
            throw new Error('Filename must contain valid characters');
        }

        return sanitizedExtension ? `${sanitizedName}.${sanitizedExtension}` : sanitizedName;
    }

    /**
     * Validate if a key follows expected pattern and S3 rules
     *
     * @param key - Key to validate
     * @returns true if valid
     */
    isValidKey(key: string): boolean {
        // Check length (S3 limit is 1024)
        if (key.length === 0 || key.length > 1024) {
            return false;
        }

        // Must not start or end with slash
        if (key.startsWith('/') || key.endsWith('/')) {
            return false;
        }

        // Must have at least category and filename
        const parts = key.split('/');
        if (parts.length < 2) {
            return false;
        }

        // All parts must be non-empty
        return parts.every((part) => part.length > 0);
    }

    /**
     * Get file extension from key
     *
     * @param key - S3 key
     * @returns File extension (without dot) or empty string
     */
    getExtension(key: string): string {
        const filename = key.split('/').pop() || '';
        const lastDotIndex = filename.lastIndexOf('.');

        if (lastDotIndex > 0) {
            return filename.substring(lastDotIndex + 1).toLowerCase();
        }

        return '';
    }

    /**
     * Get filename from key (last segment)
     *
     * @param key - S3 key
     * @returns Filename
     */
    getFilename(key: string): string {
        return key.split('/').pop() || '';
    }
}