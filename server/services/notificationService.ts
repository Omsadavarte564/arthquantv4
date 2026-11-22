/**
 * ArthQuant Multi-User Instant Trade & Signal Notification Service
 * Supports:
 * - Multi-subscriber Telegram alerts (Direct Messages to unlimited users)
 * - Telegram Group & Channel broadcasts (@channel_name or -100xxxxxxxxxx)
 * - Auto-registration via bot commands (/start, /subscribe, /stop, /status)
 * - Multi-user WhatsApp alerts (via CallMeBot API)
 */

import fs from 'node:fs';
import path from 'node:path';

export interface TelegramSubscriber {
  chatId: string;
  name: string;
  username?: string;
  subscribedAt: string;
  active: boolean;
  role?: 'admin' | 'trader';
}

export interface WhatsAppSubscriber {
  phone: string;
  apiKey: string;
  name: string;
  active: boolean;
}

export interface SubscriberRegistry {
  telegram: TelegramSubscriber[];
  whatsapp: WhatsAppSubscriber[];
}

export interface TradeAlertPayload {
  symbol: string;
  action: 'BUY' | 'SELL';
  price: number;
  stopLoss?: number;
  target?: number;
  confidence?: number;
  strategy?: string;
  regime?: string;
  notes?: string;
}

export interface ExecutionAlertPayload {
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  type: 'ENTRY' | 'EXIT' | 'STOP_LOSS' | 'TARGET';
  realizedPnl?: number;
  reason?: string;
}

const SUBSCRIBERS_FILE = path.resolve(process.cwd(), 'data', 'subscribers.json');

export class NotificationService {
  private subscribers: SubscriberRegistry = { telegram: [], whatsapp: [] };
  private lastUpdateId: number = 0;
  private isPolling: boolean = false;
  private pollTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.loadSubscribers();
    this.syncEnvSubscribers();
    this.startPolling();
  }

  private loadSubscribers(): void {
    try {
      if (fs.existsSync(SUBSCRIBERS_FILE)) {
        const raw = fs.readFileSync(SUBSCRIBERS_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        this.subscribers = {
          telegram: Array.isArray(parsed.telegram) ? parsed.telegram : [],
          whatsapp: Array.isArray(parsed.whatsapp) ? parsed.whatsapp : [],
        };
      } else {
        this.saveSubscribers();
      }
    } catch (err) {
      console.error('[NotificationService] Error loading subscribers:', err);
      this.subscribers = { telegram: [], whatsapp: [] };
    }
  }

  private saveSubscribers(): void {
    try {
      const dir = path.dirname(SUBSCRIBERS_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(SUBSCRIBERS_FILE, JSON.stringify(this.subscribers, null, 2), 'utf-8');
    } catch (err) {
      console.error('[NotificationService] Error saving subscribers:', err);
    }
  }

  /**
   * Sync static chat IDs defined in .env (single or comma-separated list)
   */
  public syncEnvSubscribers(): void {
    const rawIds = process.env.TELEGRAM_CHAT_IDS || process.env.TELEGRAM_CHAT_ID || '';
    if (rawIds.trim()) {
      const ids = rawIds.split(',').map((s) => s.trim()).filter(Boolean);
      for (const id of ids) {
        if (!this.subscribers.telegram.some((sub) => sub.chatId === id)) {
          this.subscribers.telegram.push({
            chatId: id,
            name: id.startsWith('-') || id.startsWith('@') ? 'Broadcast Channel/Group' : 'Primary User',
            subscribedAt: new Date().toISOString(),
            active: true,
            role: 'admin',
          });
        }
      }
      this.saveSubscribers();
    }

    const waPhone = process.env.WHATSAPP_PHONE || '';
    const waKey = process.env.WHATSAPP_API_KEY || '';
    if (waPhone.trim() && waKey.trim()) {
      const cleanPhone = waPhone.replace(/[^\d+]/g, '');
      if (!this.subscribers.whatsapp.some((sub) => sub.phone === cleanPhone)) {
        this.subscribers.whatsapp.push({
          phone: cleanPhone,
          apiKey: waKey.trim(),
          name: 'Primary Trader WhatsApp',
          active: true,
        });
        this.saveSubscribers();
      }
    }
  }

  public getSubscribers(): SubscriberRegistry {
    this.syncEnvSubscribers();
    return this.subscribers;
  }

  public addTelegramSubscriber(chatId: string, name: string = 'Trader', username?: string): boolean {
    const cleanId = chatId.trim();
    if (!cleanId) return false;

    const existing = this.subscribers.telegram.find((s) => s.chatId === cleanId);
    if (existing) {
      existing.active = true;
      if (name) existing.name = name;
      if (username) existing.username = username;
    } else {
      this.subscribers.telegram.push({
        chatId: cleanId,
        name: name || 'Trader',
        username,
        subscribedAt: new Date().toISOString(),
        active: true,
      });
    }
    this.saveSubscribers();
    return true;
  }

  public removeTelegramSubscriber(chatId: string): boolean {
    const cleanId = chatId.trim();
    const idx = this.subscribers.telegram.findIndex((s) => s.chatId === cleanId);
    if (idx !== -1) {
      this.subscribers.telegram[idx].active = false;
      this.saveSubscribers();
      return true;
    }
    return false;
  }

  public addWhatsAppSubscriber(phone: string, apiKey: string, name: string = 'Trader'): boolean {
    const cleanPhone = phone.replace(/[^\d+]/g, '');
    if (!cleanPhone || !apiKey) return false;

    const existing = this.subscribers.whatsapp.find((s) => s.phone === cleanPhone);
    if (existing) {
      existing.active = true;
      existing.apiKey = apiKey.trim();
      existing.name = name;
    } else {
      this.subscribers.whatsapp.push({
        phone: cleanPhone,
        apiKey: apiKey.trim(),
        name,
        active: true,
      });
    }
    this.saveSubscribers();
    return true;
  }

  public getStatus() {
    this.syncEnvSubscribers();
    const activeTg = this.subscribers.telegram.filter((s) => s.active);
    const activeWa = this.subscribers.whatsapp.filter((s) => s.active);

    return {
      telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      whatsappConfigured: activeWa.length > 0,
      totalTelegramSubscribers: activeTg.length,
      totalWhatsAppSubscribers: activeWa.length,
      isAutoRegistrationActive: this.isPolling,
      subscribers: {
        telegram: activeTg.map((s) => ({
          chatId: s.chatId.startsWith('-') || s.chatId.startsWith('@') ? s.chatId : `...${s.chatId.slice(-4)}`,
          name: s.name,
          username: s.username,
          role: s.role || 'trader',
        })),
        whatsapp: activeWa.map((s) => ({
          phone: `...${s.phone.slice(-4)}`,
          name: s.name,
        })),
      },
    };
  }

  /**
   * Broadcast Telegram message to all active users and channels
   */
  public async broadcastTelegram(message: string, parseMode: 'Markdown' | 'HTML' = 'HTML'): Promise<{ sent: number; failed: number }> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return { sent: 0, failed: 0 };

    this.syncEnvSubscribers();
    const targets = this.subscribers.telegram.filter((s) => s.active);
    if (targets.length === 0) return { sent: 0, failed: 0 };

    let sent = 0;
    let failed = 0;

    await Promise.allSettled(
      targets.map(async (target) => {
        try {
          const url = `https://api.telegram.org/bot${token}/sendMessage`;
          const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: target.chatId,
              text: message,
              parse_mode: parseMode,
              disable_web_page_preview: true,
            }),
            signal: AbortSignal.timeout(6000),
          });
          if (resp.ok) {
            sent++;
          } else {
            failed++;
          }
        } catch {
          failed++;
        }
      })
    );

    return { sent, failed };
  }

  /**
   * Broadcast WhatsApp message to all active recipients
   */
  public async broadcastWhatsApp(message: string): Promise<{ sent: number; failed: number }> {
    this.syncEnvSubscribers();
    const targets = this.subscribers.whatsapp.filter((s) => s.active);
    if (targets.length === 0) return { sent: 0, failed: 0 };

    let sent = 0;
    let failed = 0;

    await Promise.allSettled(
      targets.map(async (target) => {
        try {
          const encodedMsg = encodeURIComponent(message);
          const url = `https://api.callmebot.com/whatsapp.php?phone=${target.phone}&text=${encodedMsg}&apikey=${target.apiKey}`;
          const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
          if (resp.ok) sent++;
          else failed++;
        } catch {
          failed++;
        }
      })
    );

    return { sent, failed };
  }

  /**
   * Broadcast high-conviction trade alert to ALL users
   */
  public async notifyTradeSignal(trade: TradeAlertPayload): Promise<{ telegramSent: number; whatsappSent: number }> {
    const isBuy = trade.action === 'BUY';
    const actionEmoji = isBuy ? '🟢' : '🔴';
    const actionColor = isBuy ? 'BUY / LONG' : 'SELL / SHORT';

    const tgMsg = `
${actionEmoji} <b>ARTHQUANT MULTI-USER TRADE ALERT</b>
━━━━━━━━━━━━━━━━━━━━━
<b>Stock:</b> <code>${trade.symbol}</code> (NSE)
<b>Action:</b> <b>${actionColor}</b>
<b>Entry Price:</b> ₹${trade.price.toFixed(2)}
${trade.stopLoss ? `<b>Stop Loss:</b> ₹${trade.stopLoss.toFixed(2)}` : ''}
${trade.target ? `<b>Target:</b> ₹${trade.target.toFixed(2)}` : ''}
${trade.confidence ? `<b>ML Conviction:</b> <b>${trade.confidence.toFixed(1)}%</b>` : ''}
<b>Model:</b> Trio Ensemble (LightGBM + CatBoost + XGBoost)
<b>Strategy:</b> ${trade.strategy || 'Multi-Model Alpha'}
${trade.regime ? `<b>Regime:</b> ${trade.regime}` : ''}
${trade.notes ? `<i>${trade.notes}</i>` : ''}
━━━━━━━━━━━━━━━━━━━━━
⏰ <i>${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</i>
`;

    const waMsg = `*ARTHQUANT TRADE ALERT*
${actionEmoji} ${actionColor} ${trade.symbol}
Price: Rs. ${trade.price.toFixed(2)}
${trade.stopLoss ? `SL: Rs. ${trade.stopLoss.toFixed(2)}\n` : ''}${trade.target ? `Target: Rs. ${trade.target.toFixed(2)}\n` : ''}${trade.confidence ? `Conviction: ${trade.confidence.toFixed(1)}%\n` : ''}Strategy: ${trade.strategy || 'Trio Ensemble ML'}`;

    const [tgRes, waRes] = await Promise.all([
      this.broadcastTelegram(tgMsg.trim(), 'HTML'),
      this.broadcastWhatsApp(waMsg.trim()),
    ]);

    return { telegramSent: tgRes.sent, whatsappSent: waRes.sent };
  }

  /**
   * Broadcast execution / close alert to ALL users
   */
  public async notifyExecution(exec: ExecutionAlertPayload): Promise<{ telegramSent: number; whatsappSent: number }> {
    const pnlText = exec.realizedPnl !== undefined
      ? `\n<b>Realized P&L:</b> ${exec.realizedPnl >= 0 ? '🟢 +₹' : '🔴 -₹'}${Math.abs(exec.realizedPnl).toFixed(2)}`
      : '';

    const tgMsg = `
⚡ <b>ORDER ${exec.type}: ${exec.side} ${exec.symbol}</b>
━━━━━━━━━━━━━━━━━━━━━
<b>Quantity:</b> ${exec.quantity} shares
<b>Price:</b> ₹${exec.price.toFixed(2)}${pnlText}
${exec.reason ? `<b>Reason:</b> ${exec.reason}` : ''}
━━━━━━━━━━━━━━━━━━━━━
⏰ <i>${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</i>
`;

    const waMsg = `ARTHQUANT EXECUTION: ${exec.type}
${exec.side} ${exec.quantity} ${exec.symbol} @ Rs. ${exec.price.toFixed(2)}
${exec.realizedPnl !== undefined ? `P&L: Rs. ${exec.realizedPnl.toFixed(2)}` : ''}`;

    const [tgRes, waRes] = await Promise.all([
      this.broadcastTelegram(tgMsg.trim(), 'HTML'),
      this.broadcastWhatsApp(waMsg.trim()),
    ]);

    return { telegramSent: tgRes.sent, whatsappSent: waRes.sent };
  }

  /**
   * Send test alert to all subscribed users
   */
  public async sendTestAlert(): Promise<{ telegramSent: number; whatsappSent: number; totalRecipients: number }> {
    const res = await this.notifyTradeSignal({
      symbol: 'RELIANCE',
      action: 'BUY',
      price: 1742.50,
      stopLoss: 1725.00,
      target: 1768.00,
      confidence: 68.4,
      strategy: 'Trio Ensemble ML (LGB+CB+XGB)',
      regime: 'STRONG_TREND_BULL',
      notes: 'Multi-user test alert dispatched to all active subscribers.',
    });

    const total = this.subscribers.telegram.filter((s) => s.active).length + this.subscribers.whatsapp.filter((s) => s.active).length;
    return { ...res, totalRecipients: total };
  }

  /**
   * Background polling for Telegram Bot commands (/start, /subscribe, /stop, /status)
   * This allows any user to subscribe simply by opening the bot and pressing Start!
   */
  public startPolling(): void {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token || this.isPolling) return;

    this.isPolling = true;
    console.log('[NotificationService] Starting Telegram multi-user subscriber auto-registration polling...');

    const poll = async () => {
      const activeToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!activeToken) {
        this.pollTimer = setTimeout(poll, 15000);
        return;
      }

      try {
        const url = `https://api.telegram.org/bot${activeToken}/getUpdates?offset=${this.lastUpdateId + 1}&limit=20&timeout=2`;
        const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (resp.ok) {
          const data = (await resp.json()) as { ok: boolean; result?: any[] };
          if (data.ok && Array.isArray(data.result)) {
            for (const upd of data.result) {
              if (upd.update_id >= this.lastUpdateId) {
                this.lastUpdateId = upd.update_id;
              }

              const msg = upd.message;
              if (!msg || !msg.text) continue;

              const text = String(msg.text).trim().toLowerCase();
              const chatId = String(msg.chat.id);
              const name = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || msg.chat.title || 'Trader';
              const username = msg.from?.username || msg.chat.username;

              if (text === '/start' || text === '/subscribe') {
                this.addTelegramSubscriber(chatId, name, username);
                const reply = `
🎉 <b>Welcome to ArthQuant Multi-User Signals, ${name}!</b>

You are now subscribed to real-time algorithmic trade alerts for NSE stocks.

<b>Active Model:</b> Trio Ensemble ML (LightGBM + CatBoost + XGBoost)
<b>Conviction Gate:</b> P &ge; 62%
<b>Frequency:</b> Real-time on 5m / 15m candle triggers

<i>Commands:</i>
/status - Check engine and subscription status
/stop - Unsubscribe from alerts
/help - View information
                `.trim();
                await this.sendSingleTelegram(chatId, reply, activeToken);
              } else if (text === '/stop' || text === '/unsubscribe') {
                this.removeTelegramSubscriber(chatId);
                await this.sendSingleTelegram(
                  chatId,
                  '❌ <b>You have unsubscribed from ArthQuant alerts.</b>\nSend /start anytime to re-subscribe.',
                  activeToken
                );
              } else if (text === '/status' || text === '/info') {
                const total = this.subscribers.telegram.filter((s) => s.active).length;
                const statusMsg = `
🤖 <b>ArthQuant System Status</b>
━━━━━━━━━━━━━━━━━━━━━
<b>Engine:</b> Online (Port 3000)
<b>ML Microservice:</b> Trio Ensemble v3.1 (LGB+CB+XGB)
<b>Your Chat ID:</b> <code>${chatId}</code>
<b>Active Subscribers:</b> ${total} traders
<b>Status:</b> Subscribed & Listening 🟢
━━━━━━━━━━━━━━━━━━━━━
                `.trim();
                await this.sendSingleTelegram(chatId, statusMsg, activeToken);
              } else if (text === '/help') {
                const helpMsg = `
📚 <b>ArthQuant Bot Help</b>
━━━━━━━━━━━━━━━━━━━━━
/start - Subscribe to trade signals
/stop - Unsubscribe from signals
/status - Check model engine status
/help - Show this message
━━━━━━━━━━━━━━━━━━━━━
                `.trim();
                await this.sendSingleTelegram(chatId, helpMsg, activeToken);
              }
            }
          }
        }
      } catch {
        // Suppress transient network timeouts during polling
      } finally {
        this.pollTimer = setTimeout(poll, 6000);
      }
    };

    // Kick off first cycle
    this.pollTimer = setTimeout(poll, 2000);
  }

  private async sendSingleTelegram(chatId: string, message: string, token: string): Promise<boolean> {
    try {
      const url = `https://api.telegram.org/bot${token}/sendMessage`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(5000),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }
}

export const notificationService = new NotificationService();
