#!/usr/bin/env node
//
// Add a team member to config.json (merged into the live DB on next deploy).
//
// Usage:
//   node scripts/add-member.js \
//     --name "Michael Evans" \
//     --slack-id "U02G2MU8A" \
//     --manager "U0ACKBHM2S1" \
//     --role "CEO" \
//     --question "What percentage of your day did you spend on fundraising?" \
//     [--target 60]

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.resolve(__dirname, '..', 'config.json');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    args[key] = argv[i + 1];
  }
  return args;
}

const args = parseArgs(process.argv);

const required = ['name', 'slack-id', 'manager', 'role', 'question'];
const missing = required.filter((k) => !args[k]);
if (missing.length > 0) {
  console.error(`Missing required args: ${missing.map((k) => `--${k}`).join(', ')}`);
  console.error('\nUsage: node scripts/add-member.js --name "Name" --slack-id "U..." --manager "U..." --role "Role" --question "Question?" [--target 60]');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));

if (config.team.some((m) => m.slack_id === args['slack-id'])) {
  console.error(`Member with slack_id ${args['slack-id']} already exists.`);
  process.exit(1);
}

const target = args.target ? parseInt(args.target, 10) : null;

config.team.push({
  name: args.name,
  slack_id: args['slack-id'],
  manager_slack_id: args.manager,
  role: args.role,
  question: args.question,
  input_type: 'percentage',
  target,
  target_label: target !== null ? `\u2265${target}%` : null,
});

fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
console.log(`Added ${args.name} (${args['slack-id']}). Deploy to sync to live DB.`);
