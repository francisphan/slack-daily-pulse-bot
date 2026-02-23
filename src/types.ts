export interface ScheduleConfig {
  daily_checkin_time: string;
  first_followup_time: string;
  followup_interval_hours: number;
  max_followups_per_day: number;
}

export interface TeamMember {
  name: string;
  slack_id: string;
  manager_slack_id: string;
  role: string;
  question: string;
  input_type: string;
  target: number | null;
  target_label: string | null;
}

export interface AppConfig {
  timezone: string;
  schedule: ScheduleConfig;
  scorecard_channel_name: string;
  weekly_summary_day: string;
  weekly_summary_time: string;
  team: TeamMember[];
}

export interface DailyResponse {
  slack_id: string;
  name: string;
  role: string;
  question: string;
  date: string;
  value: number;
  responded_at: string;
  blocker?: string;
}

export interface ResponseHistory {
  responses: DailyResponse[];
}

export interface PendingCheckin {
  slack_id: string;
  name: string;
  date: string;
  followup_count: number;
  responded: boolean;
}
