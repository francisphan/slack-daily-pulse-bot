import { getDb } from './db';
import { AppConfig } from './types';

function validateConfig(config: AppConfig): void {
  if (!config.timezone) throw new Error('config: timezone is required');
  if (!config.team || config.team.length === 0) throw new Error('config: team array is empty');

  for (const member of config.team) {
    if (!member.slack_id || member.slack_id.startsWith('REPLACE')) {
      console.warn(`WARNING: ${member.name} has placeholder slack_id — will be skipped`);
    }
  }
}

export function loadConfig(): AppConfig {
  const row = getDb()
    .prepare("SELECT value FROM config WHERE key = 'app_config'")
    .get() as { value: string } | undefined;

  if (!row) {
    throw new Error('No config found in database — ensure config.json exists for initial seed');
  }

  const config: AppConfig = JSON.parse(row.value);
  validateConfig(config);
  return config;
}

export function saveConfig(config: AppConfig): void {
  validateConfig(config);
  getDb()
    .prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('app_config', ?)")
    .run(JSON.stringify(config, null, 2));
}
