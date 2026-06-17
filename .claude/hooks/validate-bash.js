#!/usr/bin/env node
/**
 * PreToolUse hook: validate Bash commands
 * - Block destructive database commands
 * - Block rm -rf on critical paths
 * - Warn about production-affecting commands
 *
 * Exit 0 = allow, Exit 2 = block.
 */
let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(data);
    const command = input.tool_input?.command || '';

    // Block destructive database operations
    if (/\b(DROP\s+(DATABASE|TABLE|SCHEMA)|TRUNCATE|DELETE\s+FROM\s+\w+\s*;)/i.test(command)) {
      console.error('[Hook] BLOCKED: Destructive database command detected.');
      console.error('[Hook] Use soft deletes or run in a transaction with rollback.');
      process.exit(2);
    }

    // Block dangerous rm commands
    if (/rm\s+(-rf?|--recursive)\s+(\.|\/|~|\$HOME|node_modules|src|prisma)/i.test(command)) {
      console.error('[Hook] BLOCKED: Dangerous rm command on critical path.');
      process.exit(2);
    }

    // Block pushing to main/master directly
    if (/git\s+push\s+(origin\s+)?(main|master)\b/.test(command)) {
      console.error('[Hook] BLOCKED: Direct push to main/master. Use a feature branch + PR.');
      process.exit(2);
    }

    // Block force push
    if (/git\s+push\s+.*(-f|--force)\b/.test(command)) {
      console.error('[Hook] BLOCKED: Force push is not allowed. Use --force-with-lease if needed.');
      process.exit(2);
    }

    // Warn about npm install (should use pnpm)
    if (/\bnpm\s+install\b/.test(command)) {
      console.error('[Hook] Warning: Use `pnpm install` instead of `npm install`.');
    }

    console.log(data);
  } catch (e) {
    console.log(data);
  }
});
