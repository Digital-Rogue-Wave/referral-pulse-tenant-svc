# Coding Style (Always Active)

TypeScript-specific rules. Architecture, naming, OOP, and file limits are in `architecture.md`.

- `strict: true`. No `any` — use `unknown` + type narrowing.
- Prefer `readonly`, `as const`, exhaustive switch with `never` default.
- Interface for object shapes, type for unions/intersections/utilities.
- Path aliases: `@app/*`, `@domains/*`, `@common/*`, `@config/*`.
- One class per file. Filename matches class name (kebab-case).
- Barrel exports (`index.ts`) only at module boundaries.
- JSDoc on public API methods. TODO: `// TODO(ticket-123): description`.
