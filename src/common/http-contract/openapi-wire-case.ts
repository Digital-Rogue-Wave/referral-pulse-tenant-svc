import type { OpenAPIObject } from '@nestjs/swagger';

import { toSnakeCase } from './wire-case';

type SchemaNode = { properties?: Record<string, SchemaNode>; required?: string[]; items?: SchemaNode; [key: string]: unknown };

function snakeSchema(schema: SchemaNode | undefined): void {
    if (!schema || typeof schema !== 'object') {
        return;
    }
    if (schema.properties) {
        schema.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [toSnakeCase(key), value]));
        Object.values(schema.properties).forEach(snakeSchema);
    }
    if (schema.required) {
        schema.required = schema.required.map(toSnakeCase);
    }
    snakeSchema(schema.items);
    for (const combinator of ['allOf', 'oneOf', 'anyOf'] as const) {
        (schema[combinator] as SchemaNode[] | undefined)?.forEach(snakeSchema);
    }
}

/**
 * The OpenAPI document describes the wire, not the DTO classes: DTO properties and query parameters are
 * camelCase in code but snake_case on the wire (WireCaseInterceptor), so the document is converted too.
 */
export function toWireCaseDocument(document: OpenAPIObject): OpenAPIObject {
    Object.values(document.components?.schemas ?? {}).forEach((schema) => snakeSchema(schema as SchemaNode));
    for (const pathItem of Object.values(document.paths)) {
        for (const operation of Object.values(pathItem) as Array<{ parameters?: Array<{ in?: string; name: string }> }>) {
            operation?.parameters?.forEach((parameter) => {
                if (parameter.in === 'query') {
                    parameter.name = toSnakeCase(parameter.name);
                }
            });
        }
    }
    return document;
}
