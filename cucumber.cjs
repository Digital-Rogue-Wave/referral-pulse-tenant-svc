/**
 * Cucumber configuration for BDD test suite.
 *
 * Run with:
 *   pnpm test:bdd             — full suite
 *   pnpm test:bdd:auth        — auth scenarios only (@auth tag)
 *   pnpm test:bdd:billing     — billing scenarios only (@billing tag)
 *   pnpm test:bdd:guards      — tenant guard scenarios only (@guards tag)
 *   pnpm test:bdd:dry         — dry run (parses only, no execution)
 */

module.exports = {
  default: {
    // Register TypeScript (CJS) + path aliases before loading step files
    requireModule: ['ts-node/register', 'tsconfig-paths/register'],
    // Load support files and step definitions via CJS require (not ESM import)
    require: [
      'test/bdd/support/hooks.ts',
      'test/bdd/support/world.ts',
      'test/bdd/step-definitions/**/*.steps.ts',
    ],
    paths: ['test/bdd/features/**/*.feature'],
    format: [
      '@cucumber/pretty-formatter',
      'json:test/bdd/reports/cucumber-report.json',
      'html:test/bdd/reports/cucumber-report.html',
      'junit:test/bdd/reports/cucumber-report.xml',
      'message:test/bdd/reports/cucumber-report.ndjson',
    ],
    formatOptions: { snippetInterface: 'async-await' },
    // Evidence runs are serial, single-attempt, and strict until fixture cleanup is proven.
    parallel: 0,
    retry: 0,
    strict: true,
    timeout: 30000,
  },
};
