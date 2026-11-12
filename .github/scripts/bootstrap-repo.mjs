#!/usr/bin/env node
// Creates Consort's labels and milestones on GitHub if they are missing.
// Dry run by default: prints what exists and what would be created.
//   node .github/scripts/bootstrap-repo.mjs            # dry run
//   node .github/scripts/bootstrap-repo.mjs --apply    # create missing items
//   node .github/scripts/bootstrap-repo.mjs --repo owner/name [--apply]
// Requires the GitHub CLI (`gh`), authenticated with repo scope.
// Never deletes or renames anything.
import { execFileSync } from 'node:child_process';

export const LABELS = {
  coordinator: ['1d76db', 'Project coordinator: Worker + Durable Object'],
  adapter: ['0e8a16', 'Local Claude Code adapter: daemon, MCP tools, hooks'],
  web: ['5319e7', 'React web client'],
  protocol: ['fbca04', 'Shared schemas, envelope, protocol version'],
  checks: ['c2e0c6', 'Combined-check runner and evidence'],
  infra: ['bfd4f2', 'Tooling, CI, deployment'],
  docs: ['0075ca', 'Documentation and decision records'],
  spike: ['d93f0b', 'Real-client capability experiment'],
  security: ['b60205', 'Security, access and content safety'],
  ux: ['f9d0c4', 'Interaction design and usability'],
};

export const MILESTONES = [
  'M0 · Foundations and capability spike',
  'M1 · Identity and first acknowledgement (slice 1)',
  'M2 · Cross-agent exchange (slice 2)',
  'M3 · Shared decisions and reconciliation (slice 3)',
  'M4 · Handoffs (slice 4)',
  'M5 · Combined evidence (slice 5)',
  'M6 · Demo hardening (slice 6)',
  'Pilot gate',
  'Launch gate',
  'Later',
];

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const repoIdx = args.indexOf('--repo');
const gh = (...a) => execFileSync('gh', a, { encoding: 'utf8' }).trim();
const repo =
  repoIdx >= 0 ? args[repoIdx + 1] : gh('repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner');

const haveLabels = new Set(
  JSON.parse(gh('label', 'list', '-R', repo, '--limit', '500', '--json', 'name')).map((l) => l.name),
);
const haveMilestones = new Set(
  JSON.parse(gh('api', `repos/${repo}/milestones?state=all&per_page=100`)).map((m) => m.title),
);

const missingLabels = Object.keys(LABELS).filter((n) => !haveLabels.has(n));
const missingMilestones = MILESTONES.filter((t) => !haveMilestones.has(t));

console.log(`Repository: ${repo}${apply ? '' : '  (dry run; pass --apply to create)'}`);
console.log(
  `Labels: ${Object.keys(LABELS).length - missingLabels.length} present, ${missingLabels.length} missing${missingLabels.length ? ': ' + missingLabels.join(', ') : ''}`,
);
console.log(
  `Milestones: ${MILESTONES.length - missingMilestones.length} present, ${missingMilestones.length} missing${missingMilestones.length ? ': ' + missingMilestones.join(' | ') : ''}`,
);

if (!apply) process.exit(0);

for (const name of missingLabels) {
  const [color, description] = LABELS[name];
  gh('label', 'create', name, '-R', repo, '--color', color, '--description', description);
  console.log(`created label ${name}`);
}
for (const title of missingMilestones) {
  gh('api', `repos/${repo}/milestones`, '-f', `title=${title}`);
  console.log(`created milestone ${title}`);
}
console.log('done');
