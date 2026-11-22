# TradingView Pine Script v5 Strategy Integration Guide

This guide details how to integrate your TradingView alerts directly with ArthQuant's automated execution endpoint via HTTP Webhook.

Before enabling the webhook, configure a unique, random `TRADINGVIEW_WEBHOOK_SECRET` of at least 32 characters in your private `.env` file and restart ArthQuant. The endpoint stays disabled without it. Replace the placeholders below with that value in your TradingView alert configuration; do not publish or reuse the secret.

---

## 1. Webhook Endpoint Specification

- **Target URL:** `https://<YOUR_DOMAIN>/api/webhooks/tradingview`
- **Method:** `POST`
- **Headers:**
  ```http
  Content-Type: application/json
  x-webhook-token: <YOUR_TRADINGVIEW_WEBHOOK_SECRET>
  ```

Use HTTPS for any publicly reachable webhook so the secret is not sent over plaintext. Keep the application behind a TLS-enabled reverse proxy instead of exposing its HTTP port directly. Plain HTTP is suitable only for local testing.

---

## 2. TradingView Alert Webhook Payload Schema

In your TradingView Alert creation modal, paste the following JSON templates into the **Message** field:

### A. Long Entry (BUY) Alert
```json
{
  "secret": "<YOUR_TRADINGVIEW_WEBHOOK_SECRET>",
  "symbol": "{{ticker}}",
  "action": "BUY",
  "price": {{close}},
  "stopLoss": {{plot("Stop Loss")}},
  "target": {{plot("Profit Target")}},
  "strategyName": "ArthQuant-Trend-Follower-v1"
}
```

### B. Short Entry (SELL) Alert
```json
{
  "secret": "<YOUR_TRADINGVIEW_WEBHOOK_SECRET>",
  "symbol": "{{ticker}}",
  "action": "SELL",
  "price": {{close}},
  "stopLoss": {{plot("Stop Loss")}},
  "target": {{plot("Profit Target")}},
  "strategyName": "ArthQuant-Trend-Follower-v1"
}
```

### C. Position Exit / Square-Off (EXIT) Alert
```json
{
  "secret": "<YOUR_TRADINGVIEW_WEBHOOK_SECRET>",
  "symbol": "{{ticker}}",
  "action": "EXIT",
  "strategyName": "ArthQuant-Trend-Follower-v1"
}
```

### D. Live 5-Minute Candle Bar Feed (Zero Broker Account Needed)
Set an alert on TradingView to fire **Once Per Bar Close**:
```json
{
  "secret": "<YOUR_TRADINGVIEW_WEBHOOK_SECRET>",
  "action": "CANDLE",
  "symbol": "{{ticker}}",
  "time": {{time}},
  "timeframe": "5m",
  "open": {{open}},
  "high": {{high}},
  "low": {{low}},
  "close": {{close}},
  "volume": {{volume}}
}
```
ArthQuant automatically validates and appends this candle to `data/historical_cache/` in real time, recalculates all 15 features, and evaluates ML ensemble conviction without any broker account!

---

## 3. Production Pine Script v5 Strategy Template

Below is a complete Pine Script v5 strategy that matches ArthQuant's triple-barrier (+1.35 ATR / -1.0 ATR) execution logic:

```pinescript
//@version=5
strategy("ArthQuant Tri-Barrier Alpha [Pine v5]", overlay=true, initial_capital=1000000, default_qty_type=strategy.percent_of_equity, default_qty_value=10)

// ── Inputs ──
vwapPeriod = input.int(14, "VWAP / ATR Period")
atrMultiplierTarget = input.float(1.35, "Target Multiplier (ATR)")
atrMultiplierStop = input.float(1.00, "Stop Multiplier (ATR)")
webhookSecret = input.string("", "Webhook Secret Token", confirm=true)

// ── Indicators ──
atr14 = ta.atr(vwapPeriod)
ema9 = ta.ema(close, 9)
ema21 = ta.ema(close, 21)
rsi14 = ta.rsi(close, 14)

// Supertrend
[supertrend, direction] = ta.supertrend(2.8, 14)

// ── Trade Conditions ──
bullishSetup = (close > ta.vwap) and (ema9 > ema21) and (direction < 0) and (rsi14 > 52) and (rsi14 < 70)
bearishSetup = (close < ta.vwap) and (ema9 < ema21) and (direction > 0) and (rsi14 < 48) and (rsi14 > 30)

var float longStop = na
var float longTarget = na
var float shortStop = na
var float shortTarget = na

// ── Execution Logic ──
if (bullishSetup and strategy.position_size == 0)
    longStop := close - (atrMultiplierStop * atr14)
    longTarget := close + (atrMultiplierTarget * atr14)
    strategy.entry("Long", strategy.long)
    strategy.exit("Exit Long", "Long", stop=longStop, limit=longTarget)
    alert('{"secret":"' + webhookSecret + '","symbol":"' + syminfo.ticker + '","action":"BUY","price":' + str.tostring(close) + ',"stopLoss":' + str.tostring(longStop) + ',"target":' + str.tostring(longTarget) + ',"strategyName":"ArthQuant-Pine-v5"}', alert.freq_once_per_bar_close)

if (bearishSetup and strategy.position_size == 0)
    shortStop := close + (atrMultiplierStop * atr14)
    shortTarget := close - (atrMultiplierTarget * atr14)
    strategy.entry("Short", strategy.short)
    strategy.exit("Exit Short", "Short", stop=shortStop, limit=shortTarget)
    alert('{"secret":"' + webhookSecret + '","symbol":"' + syminfo.ticker + '","action":"SELL","price":' + str.tostring(close) + ',"stopLoss":' + str.tostring(shortStop) + ',"target":' + str.tostring(shortTarget) + ',"strategyName":"ArthQuant-Pine-v5"}', alert.freq_once_per_bar_close)

// Visual Plots for Alert Hook
plot(longStop, "Stop Loss", color=color.red, style=plot.style_linebr)
plot(longTarget, "Profit Target", color=color.green, style=plot.style_linebr)
```
