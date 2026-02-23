import { App } from '@slack/bolt';
import { loadConfig, saveConfig } from './config';
import { rescheduleAll } from './scheduler';
import { AppConfig, TeamMember } from './types';

// ── Admin access control ─────────────────────────────────────────────

const ADMIN_USER_IDS = new Set([
  'U0ACKBHM2S1', // Francis Phan
  'U02G2MU8A',   // Michael Evans
]);

function isAdmin(userId: string): boolean {
  return ADMIN_USER_IDS.has(userId);
}

// ── Helpers ──────────────────────────────────────────────────────────

function buildTeamListBlocks(config: AppConfig) {
  const blocks: any[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Team Members' },
    },
  ];

  for (let i = 0; i < config.team.length; i++) {
    const m = config.team[i];
    const targetStr = m.target !== null ? `${m.target}% (${m.target_label})` : 'None';
    blocks.push(
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${m.name}* — ${m.role}\n<@${m.slack_id}> | Manager: <@${m.manager_slack_id}>\nQuestion: _${m.question}_\nTarget: ${targetStr}`,
        },
        accessory: {
          type: 'overflow',
          action_id: `team_overflow_${i}`,
          options: [
            {
              text: { type: 'plain_text', text: 'Edit' },
              value: `edit_${i}`,
            },
            {
              text: { type: 'plain_text', text: 'Remove' },
              value: `remove_${i}`,
            },
          ],
        },
      },
      { type: 'divider' }
    );
  }

  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Add Member' },
        action_id: 'team_add_member',
        style: 'primary',
      },
    ],
  });

  return blocks;
}

function buildMemberModal(member?: TeamMember, index?: number) {
  const isEdit = member !== undefined;
  const callbackId = isEdit ? 'modal_edit_member' : 'modal_add_member';
  const title = isEdit ? 'Edit Team Member' : 'Add Team Member';

  return {
    type: 'modal' as const,
    callback_id: callbackId,
    private_metadata: isEdit ? String(index) : '',
    title: { type: 'plain_text' as const, text: title },
    submit: { type: 'plain_text' as const, text: 'Save' },
    close: { type: 'plain_text' as const, text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'name_block',
        label: { type: 'plain_text' as const, text: 'Name' },
        element: {
          type: 'plain_text_input',
          action_id: 'name_input',
          ...(isEdit && { initial_value: member.name }),
        },
      },
      {
        type: 'input',
        block_id: 'slack_id_block',
        label: { type: 'plain_text' as const, text: 'Slack User' },
        element: {
          type: 'users_select',
          action_id: 'slack_id_input',
          ...(isEdit && { initial_user: member.slack_id }),
        },
      },
      {
        type: 'input',
        block_id: 'manager_block',
        label: { type: 'plain_text' as const, text: 'Manager' },
        element: {
          type: 'users_select',
          action_id: 'manager_input',
          ...(isEdit && { initial_user: member.manager_slack_id }),
        },
      },
      {
        type: 'input',
        block_id: 'role_block',
        label: { type: 'plain_text' as const, text: 'Role' },
        element: {
          type: 'plain_text_input',
          action_id: 'role_input',
          ...(isEdit && { initial_value: member.role }),
        },
      },
      {
        type: 'input',
        block_id: 'question_block',
        label: { type: 'plain_text' as const, text: 'Question' },
        element: {
          type: 'plain_text_input',
          action_id: 'question_input',
          ...(isEdit && { initial_value: member.question }),
        },
      },
      {
        type: 'input',
        block_id: 'target_block',
        optional: true,
        label: { type: 'plain_text' as const, text: 'Target %' },
        element: {
          type: 'number_input',
          action_id: 'target_input',
          is_decimal_allowed: false,
          ...(isEdit && member.target !== null && { initial_value: String(member.target) }),
        },
      },
    ],
  };
}

function buildRemoveConfirmModal(index: number, memberName: string) {
  return {
    type: 'modal' as const,
    callback_id: 'modal_remove_member',
    private_metadata: String(index),
    title: { type: 'plain_text' as const, text: 'Remove Member' },
    submit: { type: 'plain_text' as const, text: 'Remove' },
    close: { type: 'plain_text' as const, text: 'Cancel' },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Are you sure you want to remove *${memberName}* from the team?`,
        },
      },
    ],
  };
}

function buildScheduleModal(config: AppConfig) {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const currentDay = config.weekly_summary_day.charAt(0).toUpperCase() + config.weekly_summary_day.slice(1).toLowerCase();

  return {
    type: 'modal' as const,
    callback_id: 'modal_edit_schedule',
    title: { type: 'plain_text' as const, text: 'Edit Schedule' },
    submit: { type: 'plain_text' as const, text: 'Save' },
    close: { type: 'plain_text' as const, text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'checkin_time_block',
        label: { type: 'plain_text' as const, text: 'Check-in Time (HH:MM)' },
        element: {
          type: 'plain_text_input',
          action_id: 'checkin_time_input',
          initial_value: config.schedule.daily_checkin_time,
          placeholder: { type: 'plain_text' as const, text: '17:00' },
        },
      },
      {
        type: 'input',
        block_id: 'followup_time_block',
        label: { type: 'plain_text' as const, text: 'First Follow-up Time (HH:MM)' },
        element: {
          type: 'plain_text_input',
          action_id: 'followup_time_input',
          initial_value: config.schedule.first_followup_time,
          placeholder: { type: 'plain_text' as const, text: '09:00' },
        },
      },
      {
        type: 'input',
        block_id: 'followup_interval_block',
        label: { type: 'plain_text' as const, text: 'Follow-up Interval (hours)' },
        element: {
          type: 'number_input',
          action_id: 'followup_interval_input',
          is_decimal_allowed: false,
          initial_value: String(config.schedule.followup_interval_hours),
        },
      },
      {
        type: 'input',
        block_id: 'max_followups_block',
        label: { type: 'plain_text' as const, text: 'Max Follow-ups Per Day' },
        element: {
          type: 'number_input',
          action_id: 'max_followups_input',
          is_decimal_allowed: false,
          initial_value: String(config.schedule.max_followups_per_day),
        },
      },
      {
        type: 'input',
        block_id: 'summary_day_block',
        label: { type: 'plain_text' as const, text: 'Weekly Summary Day' },
        element: {
          type: 'static_select',
          action_id: 'summary_day_input',
          initial_option: {
            text: { type: 'plain_text' as const, text: currentDay },
            value: currentDay.toLowerCase(),
          },
          options: days.map((d) => ({
            text: { type: 'plain_text' as const, text: d },
            value: d.toLowerCase(),
          })),
        },
      },
      {
        type: 'input',
        block_id: 'summary_time_block',
        label: { type: 'plain_text' as const, text: 'Weekly Summary Time (HH:MM)' },
        element: {
          type: 'plain_text_input',
          action_id: 'summary_time_input',
          initial_value: config.weekly_summary_time,
          placeholder: { type: 'plain_text' as const, text: '08:00' },
        },
      },
      {
        type: 'input',
        block_id: 'timezone_block',
        label: { type: 'plain_text' as const, text: 'Timezone' },
        element: {
          type: 'plain_text_input',
          action_id: 'timezone_input',
          initial_value: config.timezone,
        },
      },
    ],
  };
}

function buildConfigSummaryBlocks(config: AppConfig) {
  const memberLines = config.team
    .map(
      (m) =>
        `- *${m.name}* (${m.role}) — <@${m.slack_id}> | Target: ${m.target !== null ? `${m.target}%` : 'None'}`
    )
    .join('\n');

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Pulse Bot Configuration' },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          '*Schedule*',
          `> Check-in: ${config.schedule.daily_checkin_time} (Mon-Fri)`,
          `> First follow-up: ${config.schedule.first_followup_time}`,
          `> Follow-up interval: ${config.schedule.followup_interval_hours}h`,
          `> Max follow-ups/day: ${config.schedule.max_followups_per_day}`,
          `> Weekly summary: ${config.weekly_summary_day} at ${config.weekly_summary_time}`,
          `> Timezone: ${config.timezone}`,
        ].join('\n'),
      },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Team (${config.team.length} members)*\n${memberLines}`,
      },
    },
  ];
}

function buildScheduleBlocks(config: AppConfig) {
  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Schedule Settings' },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          `*Check-in Time:* ${config.schedule.daily_checkin_time} (Mon-Fri)`,
          `*First Follow-up:* ${config.schedule.first_followup_time}`,
          `*Follow-up Interval:* ${config.schedule.followup_interval_hours} hours`,
          `*Max Follow-ups/Day:* ${config.schedule.max_followups_per_day}`,
          `*Weekly Summary:* ${config.weekly_summary_day} at ${config.weekly_summary_time}`,
          `*Timezone:* ${config.timezone}`,
        ].join('\n'),
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Edit Schedule' },
          action_id: 'schedule_edit',
          style: 'primary',
        },
      ],
    },
  ];
}

// ── Time validation helper ───────────────────────────────────────────

function isValidTime(value: string): boolean {
  return /^\d{2}:\d{2}$/.test(value);
}

// ── Register all command/action/view handlers ────────────────────────

export function registerCommands(app: App): void {
  // ── /pulse-config ──────────────────────────────────────────────────

  app.command('/pulse-config', async ({ ack, respond, command }) => {
    await ack();
    if (!isAdmin(command.user_id)) {
      await respond({ response_type: 'ephemeral', text: 'Sorry, only admins can use this command.' });
      return;
    }
    const config = loadConfig();
    await respond({
      response_type: 'ephemeral',
      blocks: buildConfigSummaryBlocks(config),
    });
  });

  // ── /pulse-team ────────────────────────────────────────────────────

  app.command('/pulse-team', async ({ ack, respond, command }) => {
    await ack();
    if (!isAdmin(command.user_id)) {
      await respond({ response_type: 'ephemeral', text: 'Sorry, only admins can use this command.' });
      return;
    }
    const config = loadConfig();
    await respond({
      response_type: 'ephemeral',
      blocks: buildTeamListBlocks(config),
    });
  });

  // ── /pulse-schedule ────────────────────────────────────────────────

  app.command('/pulse-schedule', async ({ ack, respond, command }) => {
    await ack();
    if (!isAdmin(command.user_id)) {
      await respond({ response_type: 'ephemeral', text: 'Sorry, only admins can use this command.' });
      return;
    }
    const config = loadConfig();
    await respond({
      response_type: 'ephemeral',
      blocks: buildScheduleBlocks(config),
    });
  });

  // ── Team overflow menu (Edit / Remove) ─────────────────────────────

  app.action(/^team_overflow_\d+$/, async ({ ack, action, body, client }) => {
    await ack();
    if (!isAdmin(body.user.id)) return;
    const config = loadConfig();
    const overflowAction = action as any;
    const selectedValue: string = overflowAction.selected_option.value;
    const [verb, indexStr] = selectedValue.split('_');
    const index = parseInt(indexStr, 10);
    const member = config.team[index];
    if (!member) return;

    const triggerId = (body as any).trigger_id;
    if (!triggerId) return;

    if (verb === 'edit') {
      await client.views.open({
        trigger_id: triggerId,
        view: buildMemberModal(member, index) as any,
      });
    } else if (verb === 'remove') {
      await client.views.open({
        trigger_id: triggerId,
        view: buildRemoveConfirmModal(index, member.name) as any,
      });
    }
  });

  // ── Add Member button ──────────────────────────────────────────────

  app.action('team_add_member', async ({ ack, body, client }) => {
    await ack();
    if (!isAdmin(body.user.id)) return;
    const triggerId = (body as any).trigger_id;
    if (!triggerId) return;

    await client.views.open({
      trigger_id: triggerId,
      view: buildMemberModal() as any,
    });
  });

  // ── Edit Schedule button ───────────────────────────────────────────

  app.action('schedule_edit', async ({ ack, body, client }) => {
    await ack();
    if (!isAdmin(body.user.id)) return;
    const config = loadConfig();
    const triggerId = (body as any).trigger_id;
    if (!triggerId) return;

    await client.views.open({
      trigger_id: triggerId,
      view: buildScheduleModal(config) as any,
    });
  });

  // ── Modal: Add Member submit ───────────────────────────────────────

  app.view('modal_add_member', async ({ ack, view }) => {
    const values = view.state.values;
    const name = values.name_block.name_input.value!;
    const slackId = values.slack_id_block.slack_id_input.selected_user!;
    const managerId = values.manager_block.manager_input.selected_user!;
    const role = values.role_block.role_input.value!;
    const question = values.question_block.question_input.value!;
    const targetRaw = values.target_block.target_input.value;
    const target = targetRaw ? parseInt(targetRaw, 10) : null;

    const config = loadConfig();

    const duplicate = config.team.find((m) => m.slack_id === slackId);
    if (duplicate) {
      await ack({
        response_action: 'errors',
        errors: {
          slack_id_block: `This user is already on the team as "${duplicate.name}".`,
        },
      });
      return;
    }

    await ack();

    const newMember: TeamMember = {
      name,
      slack_id: slackId,
      manager_slack_id: managerId,
      role,
      question,
      input_type: 'percentage',
      target,
      target_label: target !== null ? `\u2265${target}%` : null,
    };

    config.team.push(newMember);
    saveConfig(config);
    console.log(`[commands] Added team member: ${name} (${slackId})`);
  });

  // ── Modal: Edit Member submit ──────────────────────────────────────

  app.view('modal_edit_member', async ({ ack, view }) => {
    const index = parseInt(view.private_metadata, 10);
    const values = view.state.values;
    const name = values.name_block.name_input.value!;
    const slackId = values.slack_id_block.slack_id_input.selected_user!;
    const managerId = values.manager_block.manager_input.selected_user!;
    const role = values.role_block.role_input.value!;
    const question = values.question_block.question_input.value!;
    const targetRaw = values.target_block.target_input.value;
    const target = targetRaw ? parseInt(targetRaw, 10) : null;

    const config = loadConfig();

    const duplicate = config.team.find((m, i) => m.slack_id === slackId && i !== index);
    if (duplicate) {
      await ack({
        response_action: 'errors',
        errors: {
          slack_id_block: `This user is already on the team as "${duplicate.name}".`,
        },
      });
      return;
    }

    await ack();

    config.team[index] = {
      name,
      slack_id: slackId,
      manager_slack_id: managerId,
      role,
      question,
      input_type: 'percentage',
      target,
      target_label: target !== null ? `\u2265${target}%` : null,
    };

    saveConfig(config);
    console.log(`[commands] Updated team member at index ${index}: ${name}`);
  });

  // ── Modal: Remove Member submit ────────────────────────────────────

  app.view('modal_remove_member', async ({ ack, view }) => {
    await ack();
    const index = parseInt(view.private_metadata, 10);
    const config = loadConfig();

    if (index >= 0 && index < config.team.length) {
      const removed = config.team.splice(index, 1)[0];
      saveConfig(config);
      console.log(`[commands] Removed team member: ${removed.name}`);
    }
  });

  // ── Modal: Edit Schedule submit ────────────────────────────────────

  app.view('modal_edit_schedule', async ({ ack, view }) => {
    const values = view.state.values;
    const checkinTime = values.checkin_time_block.checkin_time_input.value!;
    const followupTime = values.followup_time_block.followup_time_input.value!;
    const followupInterval = parseInt(values.followup_interval_block.followup_interval_input.value!, 10);
    const maxFollowups = parseInt(values.max_followups_block.max_followups_input.value!, 10);
    const summaryDay = values.summary_day_block.summary_day_input.selected_option!.value;
    const summaryTime = values.summary_time_block.summary_time_input.value!;
    const timezone = values.timezone_block.timezone_input.value!;

    const errors: Record<string, string> = {};
    if (!isValidTime(checkinTime)) errors.checkin_time_block = 'Use HH:MM format (e.g. 17:00)';
    if (!isValidTime(followupTime)) errors.followup_time_block = 'Use HH:MM format (e.g. 09:00)';
    if (!isValidTime(summaryTime)) errors.summary_time_block = 'Use HH:MM format (e.g. 08:00)';

    if (Object.keys(errors).length > 0) {
      await ack({ response_action: 'errors', errors });
      return;
    }

    await ack();

    const config = loadConfig();
    config.schedule.daily_checkin_time = checkinTime;
    config.schedule.first_followup_time = followupTime;
    config.schedule.followup_interval_hours = followupInterval;
    config.schedule.max_followups_per_day = maxFollowups;
    config.weekly_summary_day = summaryDay;
    config.weekly_summary_time = summaryTime;
    config.timezone = timezone;

    saveConfig(config);
    console.log('[commands] Schedule updated, rescheduling jobs...');
    await rescheduleAll(app, config);
  });
}
