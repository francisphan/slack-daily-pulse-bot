import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { AppConfig } from './types';

const CONFIG_PATH = resolve(__dirname, '..', 'config.json');

export function loadConfig(): AppConfig {
  const raw = readFileSync(CONFIG_PATH, 'utf-8');
  const config: AppConfig = JSON.parse(raw);

  if (!config.timezone) throw new Error('config.json: timezone is required');
  if (!config.team || config.team.length === 0) throw new Error('config.json: team array is empty');

  for (const member of config.team) {
    if (!member.slack_id || member.slack_id.startsWith('REPLACE')) {
      console.warn(`WARNING: ${member.name} has placeholder slack_id — will be skipped`);
    }
  }

  return config;
}

export function saveConfig(config: AppConfig): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}
