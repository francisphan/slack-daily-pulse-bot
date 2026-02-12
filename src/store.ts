import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { DateTime } from 'luxon';
import { DailyResponse, ResponseHistory } from './types';

const DATA_DIR = resolve(__dirname, '..', 'data');
const HISTORY_PATH = resolve(DATA_DIR, 'history.json');

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readHistory(): ResponseHistory {
  ensureDataDir();
  if (!existsSync(HISTORY_PATH)) {
    return { responses: [] };
  }
  const raw = readFileSync(HISTORY_PATH, 'utf-8');
  return JSON.parse(raw) as ResponseHistory;
}

function writeHistory(history: ResponseHistory): void {
  ensureDataDir();
  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2), 'utf-8');
}

export function addResponse(entry: DailyResponse): void {
  const history = readHistory();
  const idx = history.responses.findIndex(
    (r) => r.slack_id === entry.slack_id && r.date === entry.date
  );
  if (idx >= 0) {
    history.responses[idx] = entry;
  } else {
    history.responses.push(entry);
  }
  writeHistory(history);
}

export function getResponsesForMember(
  slackId: string,
  fromDate: string,
  toDate: string
): DailyResponse[] {
  const history = readHistory();
  return history.responses.filter(
    (r) => r.slack_id === slackId && r.date >= fromDate && r.date <= toDate
  );
}

export function computeAverage(responses: DailyResponse[]): number | null {
  if (responses.length === 0) return null;
  const sum = responses.reduce((acc, r) => acc + r.value, 0);
  return Math.round(sum / responses.length);
}

export function getWeekStartDate(date: string, timezone: string): string {
  const dt = DateTime.fromISO(date, { zone: timezone });
  return dt.startOf('week').toISODate()!;
}

export function getMonthStartDate(date: string, timezone: string): string {
  const dt = DateTime.fromISO(date, { zone: timezone });
  return dt.startOf('month').toISODate()!;
}
