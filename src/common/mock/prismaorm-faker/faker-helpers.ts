import { faker } from "@faker-js/faker";

/**
 * Type-specific faker generators
 * Maps Prisma scalar types to faker methods
 */
export class FakerHelpers {
  /**
   * Generate a fake value based on field name and type hints
   */
  static generateValue(
    fieldName: string,
    fieldType: string,
  ): string | number | boolean | Date | Record<string, string> {
    // Try to infer from field name first
    const lowerName = fieldName.toLowerCase();

    // Common field name patterns
    if (lowerName.includes("email")) {
      return faker.internet.email();
    }
    if (lowerName.includes("url") || lowerName.includes("link")) {
      return faker.internet.url();
    }
    if (lowerName.includes("phone")) {
      return faker.phone.number();
    }
    if (lowerName.includes("address")) {
      return faker.location.streetAddress();
    }
    if (lowerName.includes("city")) {
      return faker.location.city();
    }
    if (lowerName.includes("country")) {
      return faker.location.country();
    }
    if (lowerName.includes("zip") || lowerName.includes("postal")) {
      return faker.location.zipCode();
    }
    if (lowerName.includes("firstname")) {
      return faker.person.firstName();
    }
    if (lowerName.includes("lastname")) {
      return faker.person.lastName();
    }
    if (lowerName.includes("name")) {
      return faker.person.fullName();
    }
    if (lowerName.includes("description")) {
      return faker.lorem.paragraph();
    }
    if (lowerName.includes("title")) {
      return faker.lorem.sentence();
    }
    if (lowerName.includes("status")) {
      return faker.helpers.arrayElement(["active", "inactive", "pending"]);
    }
    if (lowerName.includes("color")) {
      return faker.color.human();
    }
    if (lowerName.includes("company")) {
      return faker.company.name();
    }
    if (lowerName.includes("avatar")) {
      return faker.image.avatar();
    }
    if (lowerName.includes("image")) {
      return faker.image.url();
    }

    // Fall back to type-based generation
    return FakerHelpers.generateByType(fieldType);
  }

  /**
   * Generate value based on Prisma field type
   */
  static generateByType(
    fieldType: string,
  ): string | number | boolean | Date | Record<string, string> {
    switch (fieldType.toLowerCase()) {
      case "string":
        return faker.string.alphanumeric(10);
      case "int":
      case "integer":
      case "number":
        return faker.number.int({ min: 1, max: 1000 });
      case "float":
      case "decimal":
        return faker.number.float({ min: 0, max: 1000, fractionDigits: 2 });
      case "boolean":
      case "bool":
        return faker.datatype.boolean();
      case "datetime":
      case "date":
        return faker.date.recent();
      case "json":
      case "jsonb":
        return {
          key: faker.string.alphanumeric(5),
          value: faker.string.alphanumeric(10),
        };
      case "uuid":
        return faker.string.uuid();
      case "cuid":
        return faker.string.nanoid();
      default:
        return faker.string.alphanumeric(10);
    }
  }

  /**
   * Generate a ULID (26-character string)
   */
  static ulid(): string {
    return faker.string.alphanumeric(26).toUpperCase();
  }

  /**
   * Generate a CUID
   */
  static cuid(): string {
    return faker.string.nanoid();
  }

  /**
   * Generate a tenant ID (26-character ULID)
   */
  static tenantId(): string {
    return FakerHelpers.ulid();
  }
}
