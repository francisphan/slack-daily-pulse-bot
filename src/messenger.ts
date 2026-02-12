import { App } from '@slack/bolt';
import { DateTime } from 'luxon';
import { TeamMember, DailyResponse, AppConfig } from './types';
import * as store from './store';

let scorecardChannelId: string | null = null;

export async function ensureScorecardChannel(
  app: App,
  config: AppConfig
): Promise<string> {
  if (scorecardChannelId) return scorecardChannelId;

  const result = await app.client.conversations.list({
    types: 'public_channel',
    limit: 1000,
  });
  const existing = result.channels?.find(
    (c) => c.name === config.scorecard_channel_name
  );

  if (existing?.id) {
    scorecardChannelId = existing.id;
  } else {
    const created = await app.client.conversations.create({
      name: config.scorecard_channel_name,
    });
    scorecardChannelId = created.channel!.id!;
  }

  for (const member of config.team) {
    if (member.slack_id.startsWith('REPLACE')) continue;
    try {
      await app.client.conversations.invite({
        channel: scorecardChannelId!,
        users: member.slack_id,
      });
    } catch (e: any) {
      if (e?.data?.error !== 'already_in_channel') {
        console.warn(
          `Could not invite ${member.name} to #${config.scorecard_channel_name}: ${e?.data?.error}`
        );
      }
    }
  }

  return scorecardChannelId!;
}

export async function sendCheckinDM(
  app: App,
  member: TeamMember,
  date: string
): Promise<void> {
  const percentages = [20, 40, 60, 80, 100];

  const buttons = percentages.map((pct) => ({
    type: 'button' as const,
    text: { type: 'plain_text' as const, text: `${pct}%` },
    action_id: `checkin_response_${pct}`,
    value: JSON.stringify({ date, slack_id: member.slack_id, value: pct }),
  }));

  await app.client.chat.postMessage({
    channel: member.slack_id,
    text: member.question,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*Daily Check-in*\n${member.question}` },
      },
      {
        type: 'actions',
        elements: buttons,
      },
    ],
  });
}

export async function sendFollowupDM(
  app: App,
  member: TeamMember,
  date: string,
  attemptNumber: number
): Promise<void> {
  const percentages = [20, 40, 60, 80, 100];

  const buttons = percentages.map((pct) => ({
    type: 'button' as const,
    text: { type: 'plain_text' as const, text: `${pct}%` },
    action_id: `checkin_response_${pct}`,
    value: JSON.stringify({ date, slack_id: member.slack_id, value: pct }),
  }));

  const reminderText =
    attemptNumber === 1
      ? ':wave: Friendly reminder — I still need your check-in for yesterday.'
      : `:bell: Reminder ${attemptNumber}/3 — please submit your check-in.`;

  await app.client.chat.postMessage({
    channel: member.slack_id,
    text: reminderText,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${reminderText}\n\n${member.question}`,
        },
      },
      {
        type: 'actions',
        elements: buttons,
      },
    ],
  });
}

export async function postScorecardUpdate(
  app: App,
  config: AppConfig,
  member: TeamMember,
  response: DailyResponse
): Promise<void> {
  const channelId = await ensureScorecardChannel(app, config);
  const tz = config.timezone;
  const today = response.date;

  const weekStart = store.getWeekStartDate(today, tz);
  const weekResponses = store.getResponsesForMember(member.slack_id, weekStart, today);
  const weeklyAvg = store.computeAverage(weekResponses);

  const monthStart = store.getMonthStartDate(today, tz);
  const monthResponses = store.getResponsesForMember(member.slack_id, monthStart, today);
  const monthlyAvg = store.computeAverage(monthResponses);

  let targetIndicator = '';
  if (member.target !== null) {
    const isOnTarget = response.value >= member.target;
    targetIndicator = isOnTarget ? ':white_check_mark: On target' : ':x: Off target';
    targetIndicator += ` (${member.target_label})`;
  }

  const lines = [
    `*${member.name}* (${member.role}) — ${response.date}`,
    `> Today: *${response.value}%*`,
    weeklyAvg !== null ? `> Weekly avg: *${weeklyAvg}%*` : '> Weekly avg: _N/A_',
    monthlyAvg !== null ? `> Monthly avg: *${monthlyAvg}%*` : '> Monthly avg: _N/A_',
  ];
  if (targetIndicator) {
    lines.push(`> ${targetIndicator}`);
  }

  await app.client.chat.postMessage({
    channel: channelId,
    text: lines.join('\n'),
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: lines.join('\n') },
      },
    ],
  });
}

export async function postWeeklySummary(
  app: App,
  config: AppConfig
): Promise<void> {
  const channelId = await ensureScorecardChannel(app, config);
  const tz = config.timezone;
  const now = DateTime.now().setZone(tz);

  const lastSunday = now.startOf('week').minus({ days: 1 });
  const lastMonday = lastSunday.startOf('week');
  const fromDate = lastMonday.toISODate()!;
  const toDate = lastSunday.toISODate()!;

  const weekdays: string[] = [];
  for (let i = 0; i < 5; i++) {
    weekdays.push(lastMonday.plus({ days: i }).toISODate()!);
  }

  const headerLine = `*:bar_chart: Weekly Scorecard — ${fromDate} to ${toDate}*`;
  const memberBlocks: string[] = [];

  for (const member of config.team) {
    const responses = store.getResponsesForMember(member.slack_id, fromDate, toDate);
    const avg = store.computeAverage(responses);

    const dailyValues = weekdays.map((day) => {
      const r = responses.find((resp) => resp.date === day);
      return r ? `${r.value}%` : '—';
    });

    let targetStatus = '';
    if (member.target !== null && avg !== null) {
      targetStatus =
        avg >= member.target
          ? ` :white_check_mark: (${member.target_label})`
          : ` :x: (${member.target_label})`;
    }

    const line = [
      `*${member.name}* (${member.role})`,
      `> Mon: ${dailyValues[0]} | Tue: ${dailyValues[1]} | Wed: ${dailyValues[2]} | Thu: ${dailyValues[3]} | Fri: ${dailyValues[4]}`,
      `> Weekly avg: *${avg ?? 'N/A'}%*${targetStatus}`,
    ].join('\n');

    memberBlocks.push(line);
  }

  const fullMessage = [headerLine, '', ...memberBlocks].join('\n\n');

  await app.client.chat.postMessage({
    channel: channelId,
    text: fullMessage,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: fullMessage },
      },
    ],
  });
}
