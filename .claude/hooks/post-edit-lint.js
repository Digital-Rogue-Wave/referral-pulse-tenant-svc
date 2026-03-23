#!/usr/bin/env node
/**
 * PostToolUse hook: run Prettier + ESLint on edited TypeScript files
 * Non-blocking — warns but doesn't block the operation.
 * Prettier runs first (format), then ESLint (check).
 */
const { execSync } = require('child_process');

let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(data);
    const filePath = input.tool_input?.file_path || '';

    // Only lint TypeScript source files (not tests, not configs)
    if (filePath.endsWith('.ts') && filePath.includes('/src/') && !filePath.includes('.spec.')) {
      // 1. Prettier — auto-format
      try {
        execSync(`npx prettier --write "${filePath}" 2>/dev/null`, {
          timeout: 10000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (prettierError) {
        console.error(`[Hook] Prettier failed on ${filePath}`);
      }

      // 2. ESLint — check for issues
      try {
        execSync(`npx eslint "${filePath}" --no-error-on-unmatched-pattern --quiet 2>/dev/null`, {
          timeout: 10000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (lintError) {
        const output = lintError.stdout?.toString() || '';
        if (output.trim()) {
          console.error(`[Hook] ESLint issues in ${filePath}:`);
          const lines = output.trim().split('\n').slice(0, 5);
          lines.forEach(l => console.error(`  ${l}`));
        }
      }
    }

    console.log(data);
  } catch (e) {
    console.log(data);
  }
});
