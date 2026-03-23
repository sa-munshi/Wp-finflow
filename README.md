# FinFlow WhatsApp Bot

Production WhatsApp bot for FinFlow — add transactions, check balances, and manage finances via natural language.

## Features

- 💬 **Natural language parsing** — "spent 500 on lunch" → instant transaction (English, Hindi, Bengali)
- 📷 **Receipt scanning** — Send a photo and Gemini AI extracts the details
- ✅ **Confirm before saving** — Preview with Save/Cancel buttons
- 💰 **Balance & history** — Check all-time or monthly summary, view recent transactions
- 🔔 **Budget alerts** — Automatic alerts when expenses approach budget limits
- 🔗 **Account linking** — Connect/disconnect WhatsApp from the FinFlow app

## Architecture

```
WhatsApp User → Meta Cloud API → Express Server (Render)
                                      ├── Sarvam AI (text parsing)
                                      ├── Gemini AI (receipt scanning)
                                      ├── Supabase (PostgreSQL database)
                                      └── FinFlow App (budget alerts API)
```

## Setup

### 1. Clone and install
```bash
git clone https://github.com/sa-munshi/Wp-finflow.git
cd Wp-finflow
npm install
cp .env.example .env
# Fill in your .env values
```

### 2. Run Supabase SQL setup
Run the contents of `setup.sql` in Supabase SQL Editor:
```bash
# Open Supabase Dashboard → SQL Editor → New query
# Paste contents of setup.sql and run
```

This will:
- Add `whatsapp_phone` column to the `settings` table
- Create a unique index for fast phone lookups
- Add RLS policies for service role access

### 3. Environment Variables

| Variable | Description | Where to get |
|---|---|---|
| `WHATSAPP_TOKEN` | Meta Cloud API access token | Meta Developer Console → WhatsApp → API Setup |
| `WHATSAPP_PHONE_ID` | WhatsApp phone number ID | Meta Developer Console → WhatsApp → API Setup |
| `WHATSAPP_VERIFY_TOKEN` | Webhook verification token | Any string you choose (e.g. `finflow_verify_2026`) |
| `SARVAM_API_KEY` | Sarvam AI key for text parsing | dashboard.sarvam.ai |
| `GEMINI_API_KEY` | Google Gemini key for receipt scanning | aistudio.google.com |
| `SUPABASE_URL` | Supabase project URL | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | Supabase → Settings → API → service_role |
| `APP_URL` | FinFlow Next.js app URL | Your Vercel deployment URL |
| `WEBHOOK_SECRET` | Shared secret for budget alert API | Same secret configured in FinFlow app |
| `PORT` | Server port (auto-set by Render) | Default: `3000` |

### 4. Deploy to Render

1. **Create Web Service** → Connect this GitHub repository
2. **Build Command:** `npm install`
3. **Start Command:** `node src/index.js`
4. **Add all environment variables** from the table above
5. **Instance type:** Free or Starter

### 5. Set Webhook in Meta Developer Console

1. Go to **WhatsApp → Configuration**
2. **Webhook URL:** `https://your-bot.onrender.com/webhook`
3. **Verify Token:** Same value as your `WHATSAPP_VERIFY_TOKEN`
4. **Subscribe to:** `messages`

### 6. Keep Alive (Optional)

Add a health check ping on [UptimeRobot](https://uptimerobot.com):
- URL: `https://your-bot.onrender.com`
- Interval: 5 minutes

## Usage

### Commands
| Command | Action |
|---|---|
| `help` or `/help` | Show help message |
| `balance` or `/balance` | All-time balance summary |
| `monthly` or `/monthly` | This month's summary |
| `recent` or `/recent` | Last 5 transactions |
| `disconnect` or `/disconnect` | Unlink WhatsApp account |

### Adding Transactions
Type naturally in English, Hindi, or Bengali:
- _"spent 500 on lunch"_
- _"received 50000 salary"_
- _"Kal 3000 ki grocery li"_
- _"paid 1200 electricity"_

Or send a 📷 **receipt photo** — Gemini AI will extract the details.

### Icebreaker Buttons
- **"Add a transaction"** → Shows examples
- **"Check my balance"** → Shows balance
- **"Check balance"** → Shows balance
- **"Help"** → Shows help

## Next.js App Integration

### Connect WhatsApp (Settings page)
When a user connects WhatsApp in the FinFlow app, save their phone number:
```typescript
// For +91 98765 43210 → store as "919876543210"
await supabase
  .from('settings')
  .update({ whatsapp_phone: phoneNumber })
  .eq('user_id', userId)
```

### Budget Alert API
The bot calls `POST /api/notifications/budget-alert` after saving expenses.
Ensure the API endpoint validates the `x-bot-secret` header matches `WEBHOOK_SECRET`.

## Testing End to End

1. Deploy bot to Render with all env vars configured
2. Run `setup.sql` in Supabase SQL Editor
3. In FinFlow app Settings, connect a WhatsApp number
4. Send "help" to the WhatsApp bot number — should see help message
5. Send "balance" — should see balance from Supabase
6. Send "spent 200 on coffee" — should see preview with Save/Cancel
7. Tap Save — transaction appears in FinFlow app
8. Send a receipt photo — should parse and show preview
9. Send "recent" — should list the saved transactions
10. Send "disconnect" — should unlink account
