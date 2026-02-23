import { PendingCheckin, TeamMember } from './types';
import { getDb } from './db';

export function markCheckinSent(member: TeamMember, date: string): void {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO pending_checkins (slack_id, name, date, followup_count, responded)
    VALUES (?, ?, ?, 0, 0)
  `).run(member.slack_id, member.name, date);
}

export function markResponded(slackId: string, date: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE pending_checkins SET responded = 1
    WHERE slack_id = ? AND date = ?
  `).run(slackId, date);
}

export function hasResponded(slackId: string, date: string): boolean {
  const db = getDb();
  const row = db.prepare(`
    SELECT responded FROM pending_checkins
    WHERE slack_id = ? AND date = ?
  `).get(slackId, date) as { responded: number } | undefined;
  return row?.responded === 1;
}

export function getPendingFollowups(
  date: string,
  maxFollowups: number
): PendingCheckin[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT slack_id, name, date, followup_count, responded
    FROM pending_checkins
    WHERE date = ? AND responded = 0 AND followup_count < ?
  `).all(date, maxFollowups) as Array<{
    slack_id: string;
    name: string;
    date: string;
    followup_count: number;
    responded: number;
  }>;

  return rows.map((r) => ({
    slack_id: r.slack_id,
    name: r.name,
    date: r.date,
    followup_count: r.followup_count,
    responded: r.responded === 1,
  }));
}

export function incrementFollowupCount(slackId: string, date: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE pending_checkins SET followup_count = followup_count + 1
    WHERE slack_id = ? AND date = ?
  `).run(slackId, date);
}

export function cleanOldEntries(beforeDate: string): void {
  const db = getDb();
  db.prepare(`
    DELETE FROM pending_checkins WHERE date < ?
  `).run(beforeDate);
}
