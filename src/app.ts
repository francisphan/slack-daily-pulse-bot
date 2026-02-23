import 'dotenv/config';
import { App, BlockAction, ButtonAction } from '@slack/bolt';
import { loadConfig } from './config';
import { setupSchedules } from './scheduler';
import { registerCommands } from './commands';
import * as db from './db';
import * as messenger from './messenger';
import * as followups from './followups';
import * as store from './store';
import { DailyResponse } from './types';

const config = loadConfig();

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

// Handle percentage button clicks
app.action<BlockAction<ButtonAction>>(
  /^checkin_response_\d+$/,
  async ({ action, ack, body }) => {
    await ack();

    if (!action.value) return;
    const payload = JSON.parse(action.value) as {
      date: string;
      slack_id: string;
      value: number;
    };
    const { date, slack_id, value } = payload;

    if (followups.hasResponded(slack_id, date)) {
      console.log(`Duplicate response from ${slack_id} for ${date} — ignoring`);
      return;
    }

    const freshConfig = loadConfig();
    const member = freshConfig.team.find((m) => m.slack_id === slack_id);
    if (!member) {
      console.warn(`Unknown slack_id in response: ${slack_id}`);
      return;
    }

    const response: DailyResponse = {
      slack_id: member.slack_id,
      name: member.name,
      role: member.role,
      question: member.question,
      date,
      value,
      responded_at: new Date().toISOString(),
    };

    store.addResponse(response);
    followups.markResponded(slack_id, date);

    console.log(`${member.name} responded ${value}% for ${date}`);

    // Replace buttons with confirmation
    try {
      await app.client.chat.update({
        channel: body.channel!.id,
        ts: body.message!.ts,
        text: `You answered *${value}%* for ${date}. :white_check_mark:`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Daily Check-in — ${date}*\n${member.question}\n\nYou answered: *${value}%* :white_check_mark:`,
            },
          },
        ],
      });
    } catch (err) {
      console.warn('Could not update original message:', err);
    }

    await messenger.postScorecardUpdate(app, freshConfig, member, response);
  }
);

(async () => {
  db.initialize();
  await app.start();
  console.log('⚡ Daily Pulse Bot is running.');

  registerCommands(app);
  await messenger.ensureScorecardChannel(app, config);
  setupSchedules(app, config);

  // One-off test: send check-in DM to a specific user
  if (process.env.TEST_USER_ID) {
    const { DateTime } = await import('luxon');
    const today = DateTime.now().setZone(config.timezone).toISODate()!;
    const member = config.team.find((m) => m.slack_id === process.env.TEST_USER_ID);
    if (member) {
      await messenger.sendCheckinDM(app, member, today);
      followups.markCheckinSent(member, today);
      console.log(`TEST: Sent check-in DM to ${member.name}`);
    }
  }
})();
