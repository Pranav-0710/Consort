// Redacts a captured log or transcript excerpt before it goes into docs/capability/.
//   node dist/redact-cli.js <input> [output]     or     node dist/redact-cli.js < input > output
import { readFileSync, writeFileSync } from 'node:fs';

import { redact } from './redact.js';

const [input, output] = process.argv.slice(2);
const text = readFileSync(input ?? 0, 'utf8');
const cleaned = redact(text);
if (output) writeFileSync(output, cleaned);
else process.stdout.write(cleaned);
