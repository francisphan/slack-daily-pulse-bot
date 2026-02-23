import { App } from '@slack/bolt';
import { loadConfig, saveConfig } from './config';
import { rescheduleAll } from './scheduler';
import { AppConfig, TeamMember } from './types';
import { isAdmin, isManager, hasAnyRole, getUserRole, addRole, removeRole, listByRole, adminCount, UserRole } from './roles';

// ── Helpers ──────────────────────────────────────────────────────────

function buildTeamListBlocks(team: TeamMember[], fullTeam: TeamMember[]) {
  const blocks: any[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Team Members' },
    },
  ];

  for (const m of team) {
    const realIndex = fullTeam.findIndex((t) => t.slack_id === m.slack_id);
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
          action_id: `team_overflow_${realIndex}`,
          options: [
            {
              text: { type: 'plain_text', text: 'Edit' },
              value: `edit_${realIndex}`,
            },
            {
              text: { type: 'plain_text', text: 'Remove' },
              value: `remove_${realIndex}`,
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

function buildScheduleBlocks(config: AppConfig, role: UserRole) {
  const blocks: any[] = [
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
  ];

  if (role === 'admin') {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Edit Schedule' },
          action_id: 'schedule_edit',
          style: 'primary',
        },
      ],
    });
  }

  return blocks;
}

// ── Admin panel helpers ──────────────────────────────────────────────

function buildAdminPanelBlocks() {
  const admins = listByRole('admin');
  const managers = listByRole('manager');

  const adminLines = admins.length > 0
    ? admins.map((a) => `• <@${a.slack_id}>`).join('\n')
    : '_None_';
  const managerLines = managers.length > 0
    ? managers.map((m) => `• <@${m.slack_id}>`).join('\n')
    : '_None_';

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Role Management' },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Admins (${admins.length})*\n${adminLines}`,
      },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Managers (${managers.length})*\n${managerLines}`,
      },
    },
    { type: 'divider' },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Add Admin' },
          action_id: 'admin_add_admin',
          style: 'primary',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Remove Admin' },
          action_id: 'admin_remove_admin',
          style: 'danger',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Add Manager' },
          action_id: 'admin_add_manager',
          style: 'primary',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Remove Manager' },
          action_id: 'admin_remove_manager',
          style: 'danger',
        },
      ],
    },
  ];
}

function buildRolePickerModal(action: 'add' | 'remove', role: 'admin' | 'manager') {
  const titleText = `${action === 'add' ? 'Add' : 'Remove'} ${role === 'admin' ? 'Admin' : 'Manager'}`;
  return {
    type: 'modal' as const,
    callback_id: `modal_${action}_${role}`,
    title: { type: 'plain_text' as const, text: titleText },
    submit: { type: 'plain_text' as const, text: titleText },
    close: { type: 'plain_text' as const, text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'user_block',
        label: { type: 'plain_text' as const, text: 'Select User' },
        element: {
          type: 'users_select',
          action_id: 'user_input',
        },
      },
    ],
  };
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
    if (!hasAnyRole(command.user_id)) {
      await respond({ response_type: 'ephemeral', text: 'Sorry, only admins and managers can use this command.' });
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
    const userId = command.user_id;
    const role = getUserRole(userId);
    if (role === 'none') {
      await respond({ response_type: 'ephemeral', text: 'Sorry, only admins and managers can use this command.' });
      return;
    }
    const config = loadConfig();
    const visibleTeam = role === 'admin'
      ? config.team
      : config.team.filter((m) => m.manager_slack_id === userId);
    await respond({
      response_type: 'ephemeral',
      blocks: buildTeamListBlocks(visibleTeam, config.team),
    });
  });

  // ── /pulse-schedule ────────────────────────────────────────────────

  app.command('/pulse-schedule', async ({ ack, respond, command }) => {
    await ack();
    const role = getUserRole(command.user_id);
    if (role === 'none') {
      await respond({ response_type: 'ephemeral', text: 'Sorry, only admins and managers can use this command.' });
      return;
    }
    const config = loadConfig();
    await respond({
      response_type: 'ephemeral',
      blocks: buildScheduleBlocks(config, role),
    });
  });

  // ── /pulse-admin ───────────────────────────────────────────────────

  app.command('/pulse-admin', async ({ ack, respond, command }) => {
    await ack();
    if (!isAdmin(command.user_id)) {
      await respond({ response_type: 'ephemeral', text: 'Sorry, only admins can use this command.' });
      return;
    }
    await respond({
      response_type: 'ephemeral',
      blocks: buildAdminPanelBlocks(),
    });
  });

  // ── Team overflow menu (Edit / Remove) ─────────────────────────────

  app.action(/^team_overflow_\d+$/, async ({ ack, action, body, client }) => {
    await ack();
    const userId = body.user.id;
    if (!hasAnyRole(userId)) return;
    const config = loadConfig();
    const overflowAction = action as any;
    const selectedValue: string = overflowAction.selected_option.value;
    const [verb, indexStr] = selectedValue.split('_');
    const index = parseInt(indexStr, 10);
    const member = config.team[index];
    if (!member) return;

    // Managers can only edit/remove their own reports
    if (!isAdmin(userId) && member.manager_slack_id !== userId) return;

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
    if (!hasAnyRole(body.user.id)) return;
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

  // ── Admin panel buttons ────────────────────────────────────────────

  app.action('admin_add_admin', async ({ ack, body, client }) => {
    await ack();
    if (!isAdmin(body.user.id)) return;
    const triggerId = (body as any).trigger_id;
    if (!triggerId) return;
    await client.views.open({
      trigger_id: triggerId,
      view: buildRolePickerModal('add', 'admin') as any,
    });
  });

  app.action('admin_remove_admin', async ({ ack, body, client }) => {
    await ack();
    if (!isAdmin(body.user.id)) return;
    const triggerId = (body as any).trigger_id;
    if (!triggerId) return;
    await client.views.open({
      trigger_id: triggerId,
      view: buildRolePickerModal('remove', 'admin') as any,
    });
  });

  app.action('admin_add_manager', async ({ ack, body, client }) => {
    await ack();
    if (!isAdmin(body.user.id)) return;
    const triggerId = (body as any).trigger_id;
    if (!triggerId) return;
    await client.views.open({
      trigger_id: triggerId,
      view: buildRolePickerModal('add', 'manager') as any,
    });
  });

  app.action('admin_remove_manager', async ({ ack, body, client }) => {
    await ack();
    if (!isAdmin(body.user.id)) return;
    const triggerId = (body as any).trigger_id;
    if (!triggerId) return;
    await client.views.open({
      trigger_id: triggerId,
      view: buildRolePickerModal('remove', 'manager') as any,
    });
  });

  // ── Modal: Add Admin submit ────────────────────────────────────────

  app.view('modal_add_admin', async ({ ack, view, body }) => {
    const selectedUser = view.state.values.user_block.user_input.selected_user!;
    if (isAdmin(selectedUser)) {
      await ack({
        response_action: 'errors',
        errors: { user_block: 'This user is already an admin.' },
      });
      return;
    }
    await ack();
    addRole(selectedUser, 'admin', body.user.id);
    console.log(`[commands] Admin added: ${selectedUser} by ${body.user.id}`);
  });

  // ── Modal: Remove Admin submit ─────────────────────────────────────

  app.view('modal_remove_admin', async ({ ack, view, body }) => {
    const selectedUser = view.state.values.user_block.user_input.selected_user!;

    if (selectedUser === body.user.id) {
      await ack({
        response_action: 'errors',
        errors: { user_block: 'You cannot remove yourself as admin.' },
      });
      return;
    }

    if (!isAdmin(selectedUser)) {
      await ack({
        response_action: 'errors',
        errors: { user_block: 'This user is not an admin.' },
      });
      return;
    }

    if (adminCount() <= 1) {
      await ack({
        response_action: 'errors',
        errors: { user_block: 'Cannot remove the last admin.' },
      });
      return;
    }

    await ack();
    removeRole(selectedUser, 'admin');
    console.log(`[commands] Admin removed: ${selectedUser} by ${body.user.id}`);
  });

  // ── Modal: Add Manager submit ──────────────────────────────────────

  app.view('modal_add_manager', async ({ ack, view, body }) => {
    const selectedUser = view.state.values.user_block.user_input.selected_user!;
    if (isManager(selectedUser)) {
      await ack({
        response_action: 'errors',
        errors: { user_block: 'This user is already a manager.' },
      });
      return;
    }
    await ack();
    addRole(selectedUser, 'manager', body.user.id);
    console.log(`[commands] Manager added: ${selectedUser} by ${body.user.id}`);
  });

  // ── Modal: Remove Manager submit ───────────────────────────────────

  app.view('modal_remove_manager', async ({ ack, view, body }) => {
    const selectedUser = view.state.values.user_block.user_input.selected_user!;
    if (!isManager(selectedUser)) {
      await ack({
        response_action: 'errors',
        errors: { user_block: 'This user is not a manager.' },
      });
      return;
    }
    await ack();
    removeRole(selectedUser, 'manager');
    console.log(`[commands] Manager removed: ${selectedUser} by ${body.user.id}`);
  });

  // ── Modal: Add Member submit ───────────────────────────────────────

  app.view('modal_add_member', async ({ ack, view, body }) => {
    const userId = body.user.id;
    const values = view.state.values;
    const name = values.name_block.name_input.value!;
    const slackId = values.slack_id_block.slack_id_input.selected_user!;
    let managerId = values.manager_block.manager_input.selected_user!;
    const role = values.role_block.role_input.value!;
    const question = values.question_block.question_input.value!;
    const targetRaw = values.target_block.target_input.value;
    const target = targetRaw ? parseInt(targetRaw, 10) : null;

    // Managers can only add members under themselves
    if (!isAdmin(userId)) {
      managerId = userId;
    }

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

  app.view('modal_edit_member', async ({ ack, view, body }) => {
    const userId = body.user.id;
    const index = parseInt(view.private_metadata, 10);
    const values = view.state.values;
    const name = values.name_block.name_input.value!;
    const slackId = values.slack_id_block.slack_id_input.selected_user!;
    let managerId = values.manager_block.manager_input.selected_user!;
    const role = values.role_block.role_input.value!;
    const question = values.question_block.question_input.value!;
    const targetRaw = values.target_block.target_input.value;
    const target = targetRaw ? parseInt(targetRaw, 10) : null;

    const config = loadConfig();

    // Managers can only edit their own reports
    if (!isAdmin(userId) && config.team[index]?.manager_slack_id !== userId) {
      await ack({
        response_action: 'errors',
        errors: { name_block: 'You can only edit your own direct reports.' },
      });
      return;
    }

    // Managers can only set manager to themselves
    if (!isAdmin(userId)) {
      managerId = userId;
    }

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

  app.view('modal_remove_member', async ({ ack, view, body }) => {
    const userId = body.user.id;
    const index = parseInt(view.private_metadata, 10);
    const config = loadConfig();

    // Managers can only remove their own reports
    if (!isAdmin(userId) && config.team[index]?.manager_slack_id !== userId) {
      await ack();
      return;
    }

    await ack();

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
