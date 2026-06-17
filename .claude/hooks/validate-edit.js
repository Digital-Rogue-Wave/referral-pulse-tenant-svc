#!/usr/bin/env node
/**
 * PreToolUse hook: validate file edits
 * - Block files > 100 lines (Object Calisthenics — architecture.md)
 * - Warn about uuid() — must use ulid()
 * - Warn about console.log, 'any' type, hardcoded secrets
 * - Warn about forbidden names
 */
let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(data);
    const toolName = input.tool_name;
    const toolInput = input.tool_input || {};

    if (toolName === 'Write') {
      const content = toolInput.content || '';
      const lines = content.split('\n').length;
      const filePath = toolInput.file_path || '';
      const isTest = filePath.includes('.spec.') || filePath.includes('.test.');
      const isConfig = filePath.includes('.config.') || filePath.includes('prisma');

      // Block files > 100 lines (skip test and config files)
      if (lines > 100 && !isTest && !isConfig) {
        console.error(`[Hook] BLOCKED: File would be ${lines} lines (max 100 per Object Calisthenics).`);
        console.error('[Hook] Split into smaller, focused modules. See architecture.md.');
        process.exit(2);
      }
    }

    if (toolName === 'Edit' || toolName === 'Write') {
      const newContent = toolInput.new_string || toolInput.content || '';
      const filePath = toolInput.file_path || '';
      const isSrcFile = filePath.includes('/src/') && filePath.endsWith('.ts');
      const isTestFile = filePath.includes('.spec.') || filePath.includes('.test.');

      if (isSrcFile && !isTestFile) {
        if (/console\.(log|debug|info)\(/.test(newContent))
          console.error('[Hook] Warning: console.log detected. Use structured Logger.');

        if (/:\s*any\b/.test(newContent) || /as\s+any\b/.test(newContent))
          console.error('[Hook] BLOCKED: `any` type is forbidden. Use `unknown` + type guards.');

        if (/\buuid\s*\(/.test(newContent))
          console.error('[Hook] Warning: uuid() detected. Use ulid() instead (architecture.md).');

        if (/(password|secret|api.?key|token)\s*[:=]\s*['"][^'"]{8,}/i.test(newContent))
          console.error('[Hook] SECURITY: Possible hardcoded secret! Use env vars.');
      }
    }

    console.log(data);
  } catch (e) {
    console.log(data);
  }
});
