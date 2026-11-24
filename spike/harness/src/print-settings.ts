// Prints the project-local Claude Code settings and the MCP registration command for one participant,
// with absolute paths to this harness, so testers never edit harness code or hand-write paths.
//   node dist/print-settings.js <participant> [--relay http://host:47300] [--deliver SessionStart,PostToolUse]
//                               [--stop-delivery] [--listen] [--token-file <path outside git>]
import path from 'node:path';

import { HARNESS_ROOT, HOOK_EVENTS } from './config.js';

const args = process.argv.slice(2);
const participant = args[0];
if (!participant || participant.startsWith('--')) {
  console.error(
    'usage: print-settings <participant> [--relay URL] [--deliver EVENTS] [--stop-delivery] [--listen] [--token-file PATH]',
  );
  process.exit(1);
}
const option = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const dist = path.join(HARNESS_ROOT, 'dist').split(path.sep).join('/');
const env: Record<string, string> = {
  SPIKE_PARTICIPANT: participant,
  SPIKE_RELAY_URL: option('--relay') ?? 'http://127.0.0.1:47300',
  SPIKE_DELIVER_ON: option('--deliver') ?? '',
};
if (args.includes('--stop-delivery')) env['SPIKE_STOP_DELIVERY'] = '1';
if (args.includes('--listen')) env['SPIKE_ENABLE_LISTEN'] = '1';
const tokenFile = option('--token-file');
if (tokenFile) env['SPIKE_TOKEN_FILE'] = tokenFile;

const hook = (event: string) => ({
  hooks: [{ type: 'command', command: `node "${dist}/hooks/hook.js" ${event}`, timeout: 10 }],
});
const settings = {
  env,
  hooks: Object.fromEntries(
    HOOK_EVENTS.map((event) => [
      event,
      [event === 'PostToolUse' ? { matcher: '*', ...hook(event) } : hook(event)],
    ]),
  ),
};

const envFlags = Object.entries(env)
  .filter(([, value]) => value !== '')
  // Quoted so values with spaces (this repo's own path has one) survive the shell.
  .map(([key, value]) => `-e "${key}=${value}"`)
  .join(' ');

console.log(
  '# 1. Save as .claude/settings.local.json in the scratch checkout (Claude Code keeps it out of git):\n',
);
console.log(JSON.stringify(settings, null, 2));
console.log('\n# 2. Register the MCP server for this checkout only, from inside it:\n');
console.log(`claude mcp add consort-spike --scope local ${envFlags} -- node "${dist}/mcp-server/server.js"`);
console.log('\n# 3. Remove afterwards:\n');
console.log('claude mcp remove consort-spike --scope local   # and delete .claude/settings.local.json');
