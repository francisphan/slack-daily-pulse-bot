import { getDb } from './db';

export interface OooEntry {
  id: number;
  slack_id: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  set_by: string;
  created_at: string;
}

export function isOoo(slackId: string, date: string): boolean {
  const row = getDb()
    .prepare('SELECT 1 FROM ooo WHERE slack_id = ? AND start_date <= ? AND end_date >= ?')
    .get(slackId, date, date);
  return !!row;
}

export function getOooForMember(slackId: string, asOfDate: string): OooEntry[] {
  return getDb()
    .prepare('SELECT * FROM ooo WHERE slack_id = ? AND end_date >= ? ORDER BY start_date')
    .all(slackId, asOfDate) as OooEntry[];
}

export function addOoo(slackId: string, startDate: string, endDate: string, reason: string | null, setBy: string): number {
  const result = getDb()
    .prepare('INSERT INTO ooo (slack_id, start_date, end_date, reason, set_by) VALUES (?, ?, ?, ?, ?)')
    .run(slackId, startDate, endDate, reason, setBy);
  return result.lastInsertRowid as number;
}

export function removeOoo(id: number): boolean {
  const result = getDb()
    .prepare('DELETE FROM ooo WHERE id = ?')
    .run(id);
  return result.changes > 0;
}

export function clearOoo(slackId: string, asOfDate: string): number {
  const result = getDb()
    .prepare('DELETE FROM ooo WHERE slack_id = ? AND end_date >= ?')
    .run(slackId, asOfDate);
  return result.changes;
}
