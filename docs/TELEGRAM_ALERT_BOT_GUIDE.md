# ArthQuant Multi-User Mobile Alert Bot Setup Guide (Telegram & WhatsApp)

Get real-time trading alerts pushed directly to multiple users or an entire group/channel when:
- TradingView fires an entry/exit alert.
- The **Trio Ensemble ML model** (LightGBM + CatBoost + XGBoost) detects a high-conviction breakout ($P \ge 62\%$).
- An order is executed or closed with profit/loss details.

---

## 1. How Multi-User Delivery Works

Your bot supports two powerful multi-user modes simultaneously:

```
                      ┌────────────────────────────────────────┐
                      │      ArthQuant Signal Engine           │
                      │  (Trio Ensemble ML / TradingView)      │
                      └──────────────────┬─────────────────────┘
                                         │
                                         ▼
                             Multi-User Alert Service
                                         │
        ┌────────────────────────────────┼──────────────────────────────┐
        ▼                                ▼                              ▼
Private Direct Messages          Telegram Group / Channel        WhatsApp Alerts
(Unlimited individual users)    (Broadcasting to 1000s)         (CallMeBot recipients)
  • Trader 1 (Chat ID 1)          • @MyAlphaSignals              • Phone 1
  • Trader 2 (Chat ID 2)          • Private VIP Group            • Phone 2
  • Trader 3 (Chat ID 3)
```

---

## 2. Setting Up Your Telegram Bot (100% Free Forever)

### Step 1: Create Your Bot via @BotFather
1. Open Telegram and search for **`@BotFather`** (official verified bot with the blue checkmark).
2. Click **Start** and send:
   ```text
   /newbot
   ```
3. Enter a friendly name, e.g. `ArthQuant Signal Bot`.
4. Enter a unique username ending in `bot`, e.g. `arthquant_alpha_bot`.
5. Copy the **Bot Token** returned by `@BotFather` (e.g. `7123456789:AAFnkX9xYzAbCdEfGhIjKlMnOpQrStUvWxY`).

### Step 2: Add Token to [`.env`](file:///d:/codingprojects/arthquant/arthquant%20(2)/arthquant%20(1)/.env)
```env
TELEGRAM_BOT_TOKEN="7123456789:AAFnkX9xYzAbCdEfGhIjKlMnOpQrStUvWxY"
```

---

## 3. How Other Users Subscribe (Zero Work for You!)

### Method A: Self-Subscription (Direct Messages)
You simply share your bot link with your friends, team, or clients:
> **`https://t.me/<your_bot_username>`**

When any user opens the link and taps **Start** (or sends `/start`):
1. ArthQuant automatically registers their `Chat ID`, `Name`, and `Username` in `data/subscribers.json`.
2. The bot instantly sends them a personalized welcome message:
   > *"Welcome to ArthQuant Multi-User Signals! You are now subscribed to real-time algorithmic trade alerts."*
3. From that moment on, whenever a trade signal triggers, every registered user receives the alert directly in their private Telegram chat!

**Available User Commands:**
- `/start` or `/subscribe` - Subscribe to alerts
- `/status` - Check active model status & their personal subscription ID
- `/stop` or `/unsubscribe` - Opt out of alerts
- `/help` - View bot commands

---

### Method B: Telegram Channel or Group Broadcast (Recommended for Large Audiences)
If you want to broadcast alerts to hundreds of people in a single channel:

1. Create a Telegram Channel or Group (e.g. *ArthQuant VIP Signals*).
2. Add your bot as an **Administrator** to the channel/group with "Post Messages" permission.
3. Add the channel username or group ID to [`.env`](file:///d:/codingprojects/arthquant/arthquant%20(2)/arthquant%20(1)/.env):
   ```env
   # Comma-separated list of user IDs, channel names, or group IDs:
   TELEGRAM_CHAT_IDS="@MyAlphaSignalsChannel,-100192837482,123456789"
   ```
4. Every trade signal will automatically post directly into the channel!

---

## 4. Multi-User Management API

Management endpoints require an `ALERTS_ADMIN_TOKEN` configured in your private `.env` file. Use a unique random token with at least 32 characters, and send it in the `x-admin-token` header. These endpoints are disabled until a valid token is configured. Do not commit `.env` or share this token.

For the PowerShell examples below, set the header value to your locally configured token:
```powershell
$headers = @{ "x-admin-token" = "<your ALERTS_ADMIN_TOKEN>" }
```

### 1. View All Active Subscribers
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/alerts/subscribers" -Method Get -Headers $headers | ConvertTo-Json -Depth 4
```

### 2. Manually Add a Telegram Subscriber
```powershell
$body = @{
    chatId = "987654321"
    name = "Rohan Sharma"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3000/api/alerts/subscribers/add" -Method Post -Headers $headers -Body $body -ContentType "application/json"
```

### 3. Broadcast Custom Market Announcement to ALL Users
```powershell
$body = @{
    message = "📢 <b>Market Notice:</b> High volatility expected today due to RBI Interest Rate decision. Max risk per trade reduced to 1%."
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3000/api/alerts/broadcast" -Method Post -Headers $headers -Body $body -ContentType "application/json"
```

### 4. Test Multi-User Dispatch Instantly
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/alerts/test" -Method Post -Headers $headers | ConvertTo-Json
```
Sends a test alert to every active user, group, and channel simultaneously.

---

## 5. What Multi-User Alerts Look Like

```text
🟢 ARTHQUANT MULTI-USER TRADE ALERT
━━━━━━━━━━━━━━━━━━━━━
Stock: RELIANCE (NSE)
Action: BUY / LONG
Entry Price: ₹1,742.50
Stop Loss: ₹1,725.00
Target: ₹1,768.00
ML Conviction: 68.4%
Model: Trio Ensemble (LightGBM + CatBoost + XGBoost)
Strategy: Multi-Model Alpha
Regime: STRONG_TREND_BULL
━━━━━━━━━━━━━━━━━━━━━
⏰ 10:15:00 IST
```
