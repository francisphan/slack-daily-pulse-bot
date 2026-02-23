import { DateTime } from 'luxon';
import { DailyResponse } from './types';
import { getDb } from './db';

export function addResponse(entry: DailyResponse): void {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO responses (slack_id, name, role, question, date, value, responded_at, blocker)
    VALUES (@slack_id, @name, @role, @question, @date, @value, @responded_at, @blocker)
  `).run({ ...entry, blocker: entry.blocker ?? null });
}

export function updateBlocker(slackId: string, date: string, blocker: string): void {
  const db = getDb();
  db.prepare('UPDATE responses SET blocker = @blocker WHERE slack_id = @slack_id AND date = @date')
    .run({ slack_id: slackId, date, blocker });
}

export function getResponsesForMember(
  slackId: string,
  fromDate: string,
  toDate: string
): DailyResponse[] {
  const db = getDb();
  return db.prepare(`
    SELECT slack_id, name, role, question, date, value, responded_at
    FROM responses
    WHERE slack_id = ? AND date >= ? AND date <= ?
    ORDER BY date
  `).all(slackId, fromDate, toDate) as DailyResponse[];
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
