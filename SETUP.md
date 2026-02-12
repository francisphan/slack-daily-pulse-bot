# Daily Pulse Bot — Setup & Development Guide

## What This Is

A Slack bot that sends daily check-in questions to team members, follows up if they don't respond, and posts results to a shared scorecard channel. Designed to feed the EOS Scorecard with real data instead of relying on self-reporting at L10 meetings.

## What It Does Today

- **5:00 PM ART (weekdays):** DMs each team member their assigned question with quick-tap percentage buttons (20/40/60/80/100).
- **9:00 AM, 11:00 AM, 1:00 PM next day:** If no response, follows up. Stops after 3 attempts or when they respond.
- **On response:** Logs the answer, posts to a shared `#daily-scorecard` channel with today's value, weekly average, monthly average, and on/off target indicator.
- **Monday 8:00 AM:** Posts a weekly scorecard summary (daily breakdown + averages for each person).
- **Modular config:** Adding a new person = adding a block to `config.json`. No code changes.

## Current Team Config

| Person | Role | Question | Target |
|--------|------|----------|--------|
| Bryan | Sales | What % of your day was actual selling? | ≥60% |
| Karla | Integrator | What % of your day was scheduling/coordination? | None set |

---

## Step 1: Create the Slack App

1. Go to https://api.slack.com/apps and click **Create New App** → **From scratch**.
2. Name it `Daily Pulse Bot`. Select The Vines workspace.
3. Enable **Socket Mode** (left sidebar → Socket Mode → toggle on). Create an App-Level Token with `connections:write` scope. Save this token (`xapp-...`).

### Bot Token Scopes (OAuth & Permissions)

Add these Bot Token scopes:

- `chat:write` — Send messages
- `im:write` — Open DMs
- `im:history` — Read DM responses
- `channels:manage` — Create the scorecard channel
- `channels:read` — List channels
- `groups:write` — Invite to channels
- `users:read` — Look up user info

### Event Subscriptions

Enable Events and subscribe to:

- `message.im` — To receive DM responses

### Install to Workspace

Click **Install to Workspace** and authorize. Copy:

- **Bot User OAuth Token** (`xoxb-...`)
- **Signing Secret** (under Basic Information)
- **App-Level Token** (`xapp-...` from Socket Mode step)

---

## Step 2: Get Slack User IDs

For each person (Bryan, Karla, and their manager):

1. In Slack, click on their profile.
2. Click the three dots menu → **Copy member ID**.
3. Update `config.json` with these IDs.

---

## Step 3: Deploy

### Option A: Railway (recommended, simplest)

1. Push this repo to GitHub.
2. Go to https://railway.app → New Project → Deploy from GitHub repo.
3. Add environment variables in Railway dashboard:
   - `SLACK_BOT_TOKEN`
   - `SLACK_SIGNING_SECRET`
   - `SLACK_APP_TOKEN`
4. Railway will auto-deploy on push. ~$5/month.

### Option B: Render

1. Push to GitHub.
2. Render.com → New Web Service → Connect repo.
3. Build command: `npm install`
4. Start command: `npm start`
5. Add env vars. Free tier works but sleeps after inactivity (will miss scheduled messages). Paid tier ~$7/month.

### Option C: VPS / Existing Server

```bash
git clone <repo-url>
cd daily-pulse-bot
npm install
cp .env.example .env
# Edit .env with your tokens
npm start
```

Use `pm2` to keep it running:

```bash
npm install -g pm2
pm2 start app.js --name daily-pulse
pm2 save
pm2 startup
```

---

## Step 4: Verify

1. Start the bot. You should see `⚡ Daily Pulse Bot is running.` in logs.
2. The bot will create `#daily-scorecard` channel and invite everyone.
3. To test without waiting until 5 PM, temporarily change `daily_checkin_time` in `config.json` to a few minutes from now. Restart.
4. Confirm the DM arrives, tap a percentage, and verify it posts to `#daily-scorecard`.

---

## Adding New People

Edit `config.json` and add a new entry to the `team` array:

```json
{
  "name": "Sofia",
  "slack_id": "U0XXXXXXX",
  "manager_slack_id": "U0XXXXXXX",
  "role": "Marketing",
  "question": "What percentage of your day did you spend on campaign execution?",
  "input_type": "percentage",
  "target": 50,
  "target_label": "≥50%"
}
```

Restart the bot. That's it.

---

## Adjusting Questions

Change the `question` field for any team member. The question is what gets sent as the DM. Keep it specific and answerable with a percentage.

Good questions: "What % of your day was [specific activity]?"
Bad questions: "How productive were you?" (too vague, not measurable)

---

## Data Storage

Currently uses a local JSON file (`data/history.json`). This is fine for a small team. If you want durability and querying:

### Upgrade Path: SQLite or PostgreSQL

The bot stores two things: daily responses and follow-up state. A simple table:

```sql
CREATE TABLE responses (
  id SERIAL PRIMARY KEY,
  slack_id VARCHAR(20) NOT NULL,
  name VARCHAR(100),
  role VARCHAR(100),
  date DATE NOT NULL,
  value INTEGER NOT NULL,
  question TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(slack_id, date)
);
```

This would let you query historical trends, export to spreadsheets, or build dashboards later.

---

## What to Build Next (prioritized)

### 1. Custom Input (not just 20/40/60/80/100)

The current buttons give quick taps but limit precision. Add a "Other %" button that opens a modal with a number input for exact values. This is a Slack modal (views.open) triggered by a button action.

### 2. Blocker/Issue Flag

Add an optional second question: "Anything stuck or blocked?" with a text input. If someone flags something, post it immediately to the scorecard channel tagged as an Issue. This feeds the EOS Issues List for IDS in the L10.

### 3. Persistent Database

Replace `data/history.json` with SQLite (for simple deploys) or PostgreSQL (for Railway/Render). The `responseHistory` object maps directly to the table schema above.

### 4. Response Rate Tracking

Monthly metric per person: what % of check-ins did they actually respond to? Post this with the weekly summary. Low response rate is itself a conversation worth having.

### 5. Threshold Alerts

When someone falls below their target for 3+ consecutive days, DM their manager directly instead of just posting to the channel.

### 6. Dashboard / Export

A simple web page or Google Sheets integration that pulls from the database and shows trends over time. Useful for quarterly reviews and EOS Scorecard printouts for L10.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Bot doesn't start | Check all three tokens in `.env` are correct |
| No DMs sent | Verify Socket Mode is enabled in Slack app settings |
| DMs sent but responses not captured | Ensure `message.im` event subscription is active |
| Channel not created | Bot needs `channels:manage` scope. Reinstall to workspace after adding scope. |
| Follow-ups not working | Check that the server time zone matches `config.timezone`. Use `TZ=America/Argentina/Buenos_Aires` env var if needed. |
| Scheduled jobs not firing | On Railway/Render, ensure the service stays alive (not on free tier sleep). Use health checks. |

---

## Architecture Notes

- **Slack Bolt** (Node.js) for all Slack interaction
- **Socket Mode** — no need for a public URL or webhook endpoint. Simpler setup, works behind firewalls.
- **node-schedule** for cron-like job scheduling with timezone support
- **Luxon** for timezone-aware date handling (critical for ART)

The bot runs as a single long-lived process. No external dependencies beyond Slack and the hosting provider.

---

## Working with Claude on This

This project was built with Claude (Anthropic). Your IT person can continue development by pasting any of the source files into a conversation with Claude and asking for modifications. Some useful prompts:

- "Add a modal for custom percentage input to this Slack bot" (paste app.js)
- "Replace the JSON file storage with SQLite" (paste app.js)
- "Add a blocker/issue flag as an optional second question" (paste app.js + config.json)
- "Add a Slack slash command /pulse-status that shows the current week's scorecard" (paste app.js)

Claude has full context on the EOS methodology and can align any additions to Scorecard, Issues List, and Rock tracking patterns.
