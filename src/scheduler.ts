import * as schedule from 'node-schedule';
import { App } from '@slack/bolt';
import { DateTime } from 'luxon';
import { AppConfig } from './types';
import * as messenger from './messenger';
import * as followups from './followups';
import { loadConfig } from './config';

function getPreviousBusinessDay(now: DateTime): DateTime {
  if (now.weekday === 1) return now.minus({ days: 3 }); // Monday -> Friday
  if (now.weekday === 7) return now.minus({ days: 2 }); // Sunday -> Friday
  return now.minus({ days: 1 });
}

function dayNameToNumber(day: string): number {
  const map: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };
  return map[day.toLowerCase()] ?? 1;
}

export function setupSchedules(app: App, config: AppConfig): void {
  const tz = config.timezone;

  // Daily check-in (weekdays at configured time)
  const [checkinHour, checkinMinute] = config.schedule.daily_checkin_time
    .split(':')
    .map(Number);

  const checkinRule = new schedule.RecurrenceRule();
  checkinRule.dayOfWeek = [1, 2, 3, 4, 5];
  checkinRule.hour = checkinHour;
  checkinRule.minute = checkinMinute;
  checkinRule.tz = tz;

  schedule.scheduleJob('daily-checkin', checkinRule, async () => {
    const freshConfig = loadConfig();
    const now = DateTime.now().setZone(tz);
    const todayDate = now.toISODate()!;

    console.log(`[${now.toISO()}] Running daily check-in for ${todayDate}`);

    for (const member of freshConfig.team) {
      if (member.slack_id.startsWith('REPLACE')) continue;
      try {
        await messenger.sendCheckinDM(app, member, todayDate);
        followups.markCheckinSent(member, todayDate);
        console.log(`  Sent check-in DM to ${member.name}`);
      } catch (err) {
        console.error(`  Failed to send check-in to ${member.name}:`, err);
      }
    }
  });

  // Follow-ups (next business day at configured intervals)
  const [firstFollowHour, firstFollowMinute] = config.schedule.first_followup_time
    .split(':')
    .map(Number);

  for (let attempt = 0; attempt < config.schedule.max_followups_per_day; attempt++) {
    const followHour = firstFollowHour + attempt * config.schedule.followup_interval_hours;
    const followMinute = firstFollowMinute;

    const followupRule = new schedule.RecurrenceRule();
    followupRule.dayOfWeek = [1, 2, 3, 4, 5];
    followupRule.hour = followHour;
    followupRule.minute = followMinute;
    followupRule.tz = tz;

    schedule.scheduleJob(`followup-${attempt}`, followupRule, async () => {
      const freshConfig = loadConfig();
      const now = DateTime.now().setZone(tz);
      const previousBusinessDay = getPreviousBusinessDay(now);
      const targetDate = previousBusinessDay.toISODate()!;

      console.log(`[${now.toISO()}] Running follow-up #${attempt + 1} for ${targetDate}`);

      const pending = followups.getPendingFollowups(
        targetDate,
        config.schedule.max_followups_per_day
      );

      for (const entry of pending) {
        const member = freshConfig.team.find((m) => m.slack_id === entry.slack_id);
        if (!member) continue;

        try {
          await messenger.sendFollowupDM(app, member, targetDate, entry.followup_count + 1);
          followups.incrementFollowupCount(entry.slack_id, targetDate);
          console.log(`  Follow-up #${entry.followup_count + 1} sent to ${member.name}`);
        } catch (err) {
          console.error(`  Failed follow-up to ${member.name}:`, err);
        }
      }
    });
  }

  // Weekly summary
  const [summaryHour, summaryMinute] = config.weekly_summary_time.split(':').map(Number);
  const summaryDayNum = dayNameToNumber(config.weekly_summary_day);

  const summaryRule = new schedule.RecurrenceRule();
  summaryRule.dayOfWeek = summaryDayNum;
  summaryRule.hour = summaryHour;
  summaryRule.minute = summaryMinute;
  summaryRule.tz = tz;

  schedule.scheduleJob('weekly-summary', summaryRule, async () => {
    const freshConfig = loadConfig();
    const now = DateTime.now().setZone(tz);
    console.log(`[${now.toISO()}] Running weekly summary`);

    try {
      await messenger.postWeeklySummary(app, freshConfig);
    } catch (err) {
      console.error('Failed to post weekly summary:', err);
    }

    const cutoff = now.minus({ days: 7 }).toISODate()!;
    followups.cleanOldEntries(cutoff);
  });

  console.log('Scheduled jobs registered:');
  console.log(`  Daily check-in: ${config.schedule.daily_checkin_time} ${tz} (Mon-Fri)`);
  for (let i = 0; i < config.schedule.max_followups_per_day; i++) {
    const h = firstFollowHour + i * config.schedule.followup_interval_hours;
    console.log(
      `  Follow-up #${i + 1}: ${String(h).padStart(2, '0')}:${String(firstFollowMinute).padStart(2, '0')} ${tz} (Mon-Fri)`
    );
  }
  console.log(`  Weekly summary: ${config.weekly_summary_day} ${config.weekly_summary_time} ${tz}`);
}

export async function rescheduleAll(app: App, config: AppConfig): Promise<void> {
  console.log('Cancelling all scheduled jobs...');
  await schedule.gracefulShutdown();
  console.log('Re-registering scheduled jobs with updated config...');
  setupSchedules(app, config);
}
