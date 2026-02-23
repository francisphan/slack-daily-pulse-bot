import Database from 'better-sqlite3';
import { mkdirSync, existsSync, readFileSync, renameSync } from 'fs';
import { resolve } from 'path';
import { ResponseHistory } from './types';

const DATA_DIR = resolve(__dirname, '..', 'data');
const DB_PATH = resolve(DATA_DIR, 'pulse.db');
const LEGACY_HISTORY_PATH = resolve(DATA_DIR, 'history.json');
const CONFIG_JSON_PATH = resolve(__dirname, '..', 'config.json');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized — call initialize() first');
  }
  return db;
}

export function initialize(): void {
  if (db) return;

  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  createSchema();
  migrateSchema();
  migrateFromJson();
  migrateConfigFromJson();
  seedAdminRoles();
}

function createSchema(): void {
  const d = getDb();

  d.exec(`
    CREATE TABLE IF NOT EXISTS responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slack_id TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      question TEXT NOT NULL,
      date TEXT NOT NULL,
      value INTEGER NOT NULL,
      responded_at TEXT NOT NULL,
      blocker TEXT,
      UNIQUE(slack_id, date)
    );
  `);

  d.exec(`
    CREATE TABLE IF NOT EXISTS pending_checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slack_id TEXT NOT NULL,
      name TEXT NOT NULL,
      date TEXT NOT NULL,
      followup_count INTEGER NOT NULL DEFAULT 0,
      responded INTEGER NOT NULL DEFAULT 0,
      UNIQUE(slack_id, date)
    );
  `);

  d.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  d.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      slack_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'manager')),
      added_by TEXT NOT NULL,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (slack_id, role)
    );
  `);
}

function migrateSchema(): void {
  const d = getDb();
  const columns = d.prepare("PRAGMA table_info(responses)").all() as { name: string }[];
  const hasBlocker = columns.some((c) => c.name === 'blocker');
  if (!hasBlocker) {
    d.exec('ALTER TABLE responses ADD COLUMN blocker TEXT');
    console.log('Migrated: added blocker column to responses table');
  }
}

function migrateFromJson(): void {
  if (!existsSync(LEGACY_HISTORY_PATH)) return;

  const d = getDb();
  const count = d.prepare('SELECT COUNT(*) as cnt FROM responses').get() as { cnt: number };
  if (count.cnt > 0) {
    // Already migrated — skip but leave the backup
    return;
  }

  console.log('Migrating data/history.json into SQLite...');

  const raw = readFileSync(LEGACY_HISTORY_PATH, 'utf-8');
  const history: ResponseHistory = JSON.parse(raw);

  const insert = d.prepare(`
    INSERT OR IGNORE INTO responses (slack_id, name, role, question, date, value, responded_at)
    VALUES (@slack_id, @name, @role, @question, @date, @value, @responded_at)
  `);

  const migrate = d.transaction((rows: ResponseHistory['responses']) => {
    for (const r of rows) {
      insert.run(r);
    }
  });

  migrate(history.responses);
  console.log(`  Migrated ${history.responses.length} response(s).`);

  renameSync(LEGACY_HISTORY_PATH, LEGACY_HISTORY_PATH + '.bak');
  console.log('  Renamed history.json -> history.json.bak');
}

function migrateConfigFromJson(): void {
  if (!existsSync(CONFIG_JSON_PATH)) return;

  const d = getDb();
  const existing = d.prepare("SELECT 1 FROM config WHERE key = 'app_config'").get();
  if (existing) return; // already seeded

  console.log('Seeding config from config.json into SQLite...');
  const raw = readFileSync(CONFIG_JSON_PATH, 'utf-8');
  // Validate it's parseable JSON before inserting
  JSON.parse(raw);
  d.prepare("INSERT INTO config (key, value) VALUES ('app_config', ?)").run(raw);
  console.log('  Config seeded successfully.');
}

function seedAdminRoles(): void {
  const d = getDb();
  const count = d.prepare("SELECT COUNT(*) as cnt FROM roles").get() as { cnt: number };
  if (count.cnt > 0) return; // already seeded

  console.log('Seeding initial admin roles...');
  const insert = d.prepare(
    "INSERT OR IGNORE INTO roles (slack_id, role, added_by) VALUES (?, 'admin', 'SYSTEM')"
  );
  insert.run('U0ACKBHM2S1'); // Francis Phan
  insert.run('U02G2MU8A');   // Michael Evans
  console.log('  Seeded 2 admin roles.');
}
