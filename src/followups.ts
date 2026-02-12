import { PendingCheckin, TeamMember } from './types';

const state = new Map<string, PendingCheckin>();

function key(slackId: string, date: string): string {
  return `${slackId}:${date}`;
}

export function markCheckinSent(member: TeamMember, date: string): void {
  state.set(key(member.slack_id, date), {
    slack_id: member.slack_id,
    name: member.name,
    date,
    followup_count: 0,
    responded: false,
  });
}

export function markResponded(slackId: string, date: string): void {
  const entry = state.get(key(slackId, date));
  if (entry) {
    entry.responded = true;
  }
}

export function hasResponded(slackId: string, date: string): boolean {
  const entry = state.get(key(slackId, date));
  return entry?.responded ?? false;
}

export function getPendingFollowups(
  date: string,
  maxFollowups: number
): PendingCheckin[] {
  const pending: PendingCheckin[] = [];
  for (const entry of state.values()) {
    if (entry.date === date && !entry.responded && entry.followup_count < maxFollowups) {
      pending.push(entry);
    }
  }
  return pending;
}

export function incrementFollowupCount(slackId: string, date: string): void {
  const entry = state.get(key(slackId, date));
  if (entry) {
    entry.followup_count++;
  }
}

export function cleanOldEntries(beforeDate: string): void {
  for (const [k, entry] of state.entries()) {
    if (entry.date < beforeDate) {
      state.delete(k);
    }
  }
}
