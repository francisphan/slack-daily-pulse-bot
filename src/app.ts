import 'dotenv/config';
import { App, BlockAction, ButtonAction, ViewSubmitAction } from '@slack/bolt';
import { loadConfig } from './config';
import { setupSchedules } from './scheduler';
import { registerCommands } from './commands';
import * as db from './db';
import * as messenger from './messenger';
import * as followups from './followups';
import * as store from './store';
import { DailyResponse } from './types';

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

// --- Helper: open blocker modal after a check-in response ---

async function openBlockerModal(
  triggerId: string,
  date: string,
  slackId: string
): Promise<void> {
  await app.client.views.open({
    trigger_id: triggerId,
    view: {
      type: 'modal',
      callback_id: 'blocker_modal',
      title: { type: 'plain_text', text: 'Any Blockers?' },
      submit: { type: 'plain_text', text: 'Submit' },
      close: { type: 'plain_text', text: 'Skip' },
      private_metadata: JSON.stringify({ date, slack_id: slackId }),
      blocks: [
        {
          type: 'input',
          optional: true,
          block_id: 'blocker_block',
          label: { type: 'plain_text', text: 'Anything stuck or blocked?' },
          element: {
            type: 'plain_text_input',
            action_id: 'blocker_input',
            multiline: true,
            placeholder: {
              type: 'plain_text',
              text: 'Describe the issue or leave blank to skip...',
            },
          },
        },
      ],
    },
  });
}

// --- Handler: preset percentage button clicks ---

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

    // Open blocker modal
    try {
      await openBlockerModal(body.trigger_id, date, slack_id);
    } catch (err) {
      console.warn('Could not open blocker modal:', err);
    }
  }
);

// --- Handler: "Other %" button → open custom percentage modal ---

app.action<BlockAction<ButtonAction>>(
  'checkin_response_custom',
  async ({ action, ack, body }) => {
    await ack();

    if (!action.value) return;
    const payload = JSON.parse(action.value) as {
      date: string;
      slack_id: string;
    };

    await app.client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'custom_checkin_modal',
        title: { type: 'plain_text', text: 'Custom Check-in' },
        submit: { type: 'plain_text', text: 'Submit' },
        close: { type: 'plain_text', text: 'Cancel' },
        private_metadata: JSON.stringify(payload),
        blocks: [
          {
            type: 'input',
            block_id: 'custom_pct_block',
            label: { type: 'plain_text', text: 'Enter your percentage (0–100)' },
            element: {
              type: 'plain_text_input',
              action_id: 'custom_pct_input',
              placeholder: { type: 'plain_text', text: 'e.g. 35' },
            },
          },
        ],
      },
    });
  }
);

// --- Handler: custom percentage modal submit ---

app.view('custom_checkin_modal', async ({ ack, body, view }) => {
  const rawValue =
    view.state.values['custom_pct_block']['custom_pct_input'].value ?? '';
  const value = Number(rawValue);

  if (isNaN(value) || !Number.isInteger(value) || value < 0 || value > 100) {
    await ack({
      response_action: 'errors',
      errors: {
        custom_pct_block: 'Please enter a whole number between 0 and 100.',
      },
    });
    return;
  }

  await ack();

  const metadata = JSON.parse(view.private_metadata) as {
    date: string;
    slack_id: string;
  };
  const { date, slack_id } = metadata;

  if (followups.hasResponded(slack_id, date)) {
    console.log(`Duplicate response from ${slack_id} for ${date} — ignoring`);
    return;
  }

  const freshConfig = loadConfig();
  const member = freshConfig.team.find((m) => m.slack_id === slack_id);
  if (!member) {
    console.warn(`Unknown slack_id in custom modal: ${slack_id}`);
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

  console.log(`${member.name} responded ${value}% (custom) for ${date}`);

  // Send a DM confirmation
  try {
    await app.client.chat.postMessage({
      channel: slack_id,
      text: `*Daily Check-in — ${date}*\n${member.question}\n\nYou answered: *${value}%* :white_check_mark:`,
    });
  } catch (err) {
    console.warn('Could not send confirmation DM:', err);
  }

  await messenger.postScorecardUpdate(app, freshConfig, member, response);

  // Open blocker modal
  try {
    await openBlockerModal((body as ViewSubmitAction).trigger_id, date, slack_id);
  } catch (err) {
    console.warn('Could not open blocker modal:', err);
  }
});

// --- Handler: blocker modal submit ---

app.view('blocker_modal', async ({ ack, view }) => {
  await ack();

  const blockerText =
    view.state.values['blocker_block']['blocker_input'].value ?? '';

  if (!blockerText.trim()) return;

  const metadata = JSON.parse(view.private_metadata) as {
    date: string;
    slack_id: string;
  };
  const { date, slack_id } = metadata;

  store.updateBlocker(slack_id, date, blockerText.trim());

  const freshConfig = loadConfig();
  const member = freshConfig.team.find((m) => m.slack_id === slack_id);
  if (!member) {
    console.warn(`Unknown slack_id in blocker modal: ${slack_id}`);
    return;
  }

  console.log(`${member.name} flagged a blocker for ${date}`);

  await messenger.postBlockerAlert(app, freshConfig, member, date, blockerText.trim());
});

// --- Boot ---

(async () => {
  db.initialize();
  const config = loadConfig();
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
