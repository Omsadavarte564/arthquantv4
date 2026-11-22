"""
ArthQuant Kaggle Training Script for LightGBM, CatBoost, and XGBoost
Author: ArthQuant Quantitative Engineering

Run this script inside a Kaggle notebook to train multi-class triple-barrier
models on historical NSE equity 5m/1m data, then download the resulting
`model_lightgbm.txt` and place it into `ml_service/`.
"""

import os
import math
import numpy as np
import pandas as pd
import lightgbm as lgb
import xgboost as xgb
from catboost import CatBoostClassifier
from sklearn.metrics import classification_report, confusion_matrix, roc_auc_score, log_loss

# ── 1. Causal Indicators ───────────────────────────────────────────────────────
def compute_arthquant_indicators(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    if 'datetime' in df.columns:
        df['datetime'] = pd.to_datetime(df['datetime'])
    elif 'time' in df.columns:
        df['datetime'] = pd.to_datetime(df['time'], unit='s', utc=True).dt.tz_convert('Asia/Kolkata')

    df['sessionDate'] = df['datetime'].dt.strftime('%Y-%m-%d')
    df['hour'] = df['datetime'].dt.hour
    df['minute'] = df['datetime'].dt.minute

    # 1. Intraday Session VWAP (Resets every day at 09:15 IST)
    df['typicalPrice'] = (df['high'] + df['low'] + df['close']) / 3.0
    df['cumVol'] = df.groupby('sessionDate')['volume'].cumsum()
    df['cumPV'] = df.groupby('sessionDate').apply(lambda g: (g['typicalPrice'] * g['volume']).cumsum()).reset_index(level=0, drop=True)
    df['vwap'] = np.where(df['cumVol'] > 0, df['cumPV'] / df['cumVol'], df['close'])

    # 2. Exponential Moving Averages
    df['ema9'] = df['close'].ewm(span=9, adjust=False).mean()
    df['ema21'] = df['close'].ewm(span=21, adjust=False).mean()

    # 3. True Range & Wilder ATR(14)
    df['prevClose'] = df['close'].shift(1).fillna(df['close'])
    df['tr'] = np.maximum(
        df['high'] - df['low'],
        np.maximum(np.abs(df['high'] - df['prevClose']), np.abs(df['low'] - df['prevClose']))
    )
    df['atr14'] = df['tr'].ewm(alpha=1/14, min_periods=14, adjust=False).mean().clip(lower=0.05)

    # 4. Wilder RSI(14)
    change = df['close'].diff().fillna(0)
    gain = np.where(change > 0, change, 0.0)
    loss = np.where(change < 0, -change, 0.0)
    avg_gain = pd.Series(gain, index=df.index).ewm(alpha=1/14, min_periods=14, adjust=False).mean()
    avg_loss = pd.Series(loss, index=df.index).ewm(alpha=1/14, min_periods=14, adjust=False).mean()
    rs = np.where(avg_loss > 1e-6, avg_gain / avg_loss, 100.0)
    df['rsi14'] = 100.0 - (100.0 / (1.0 + rs))

    # 5. Wilder ADX(14) & DI+/DI-
    up_move = df['high'] - df['high'].shift(1)
    down_move = df['low'].shift(1) - df['low']
    plus_dm = np.where((up_move > down_move) & (up_move > 0), up_move, 0.0)
    minus_dm = np.where((down_move > up_move) & (down_move > 0), down_move, 0.0)
    smooth_plus_dm = pd.Series(plus_dm, index=df.index).ewm(alpha=1/14, min_periods=14, adjust=False).mean()
    smooth_minus_dm = pd.Series(minus_dm, index=df.index).ewm(alpha=1/14, min_periods=14, adjust=False).mean()
    df['plusDi'] = np.where(df['atr14'] > 0, (smooth_plus_dm / df['atr14']) * 100.0, 0.0)
    df['minusDi'] = np.where(df['atr14'] > 0, (smooth_minus_dm / df['atr14']) * 100.0, 0.0)
    di_sum = df['plusDi'] + df['minusDi']
    dx = np.where(di_sum > 0, (np.abs(df['plusDi'] - df['minusDi']) / di_sum) * 100.0, 0.0)
    df['adx14'] = pd.Series(dx, index=df.index).ewm(alpha=1/14, min_periods=14, adjust=False).mean()

    # 6. Bollinger Bands(20, 2)
    df['bbMid'] = df['close'].rolling(20, min_periods=20).mean()
    df['bbStd'] = df['close'].rolling(20, min_periods=20).std().fillna(0)
    df['bbUpper'] = df['bbMid'] + 2.0 * df['bbStd']
    df['bbLower'] = df['bbMid'] - 2.0 * df['bbStd']

    # 7. Relative Volume (vs 20-period rolling median)
    df['volMedian20'] = df['volume'].rolling(20, min_periods=5).median().clip(lower=1)
    df['relVolume'] = df['volume'] / df['volMedian20']

    # 8. Supertrend(14, 2.8)
    hl2 = (df['high'] + df['low']) / 2.0
    basic_upper = hl2 + 2.8 * df['atr14']
    basic_lower = hl2 - 2.8 * df['atr14']
    supertrend_dir = np.ones(len(df))
    for i in range(1, len(df)):
        if df['close'].iloc[i] > basic_upper.iloc[i-1]:
            supertrend_dir[i] = 1.0
        elif df['close'].iloc[i] < basic_lower.iloc[i-1]:
            supertrend_dir[i] = -1.0
        else:
            supertrend_dir[i] = supertrend_dir[i-1]
    df['supertrendDir'] = supertrend_dir

    # 9. Opening Range (09:15 - 09:30 IST)
    orb_mask = (df['hour'] == 9) & (df['minute'] < 30)
    orb_high = df[orb_mask].groupby('sessionDate')['high'].transform('max')
    orb_low = df[orb_mask].groupby('sessionDate')['low'].transform('min')
    df['orbHigh'] = orb_high.ffill()
    df['orbLow'] = orb_low.ffill()

    return df

# ── 2. Exact 14 Features Extraction ───────────────────────────────────────────
def extract_arthquant_14_features(df: pd.DataFrame, nifty_df: Optional[pd.DataFrame] = None):
    df = compute_arthquant_indicators(df)
    atr = df['atr14'].clip(lower=0.05)

    f1 = np.clip((df['close'] - df['vwap']) / atr, -4.0, 4.0)
    f2 = np.clip((df['ema9'] - df['ema21']) / atr, -3.0, 3.0)
    f3 = np.clip((df['rsi14'] - 50.0) / 25.0, -2.0, 2.0)
    f4 = np.clip((df['adx14'] - 20.0) / 15.0, -1.5, 2.5)
    f5 = np.clip((df['plusDi'] - df['minusDi']) / 40.0, -2.0, 2.0)
    f6 = np.clip(np.log1p(np.maximum(0, df['relVolume'])) - 0.7, -1.5, 2.0)
    bb_denom = np.maximum(0.05, df['bbUpper'] - df['bbLower'])
    f7 = np.clip((df['close'] - df['bbLower']) / bb_denom - 0.5, -1.5, 1.5)
    f8 = df['supertrendDir']
    f9 = np.clip((df['close'] - df['close'].shift(3)) / atr, -3.0, 3.0).fillna(0)
    orb_range = np.maximum(atr, df['orbHigh'] - df['orbLow'])
    f10 = np.clip((df['close'] - 0.5 * (df['orbHigh'] + df['orbLow'])) / orb_range, -3.0, 3.0).fillna(0)
    mins_from_open = np.clip((df['hour'] * 60 + df['minute']) - (9 * 60 + 15), 0, 375)
    f11 = np.clip(mins_from_open / 375.0 - 0.5, -0.5, 0.5)
    f12 = np.clip(((atr / np.maximum(1, df['close'])) * 100.0 - 0.22) / 0.15, -2.0, 3.0)

    if nifty_df is not None:
        nifty = compute_arthquant_indicators(nifty_df)
        merged = pd.merge_asof(
            df[['datetime', 'close']].sort_values('datetime'),
            nifty[['datetime', 'close', 'vwap', 'atr14']].sort_values('datetime'),
            on='datetime',
            suffixes=('', '_nifty')
        )
        n_atr = merged['atr14'].clip(lower=1.0)
        f13 = np.clip((merged['close_nifty'] - merged['vwap']) / n_atr, -3.0, 3.0).fillna(0)
        stock_ret6 = (df['close'] - df['close'].shift(6)) / df['close'].shift(6).clip(lower=1)
        nifty_ret6 = (merged['close_nifty'] - merged['close_nifty'].shift(6)) / merged['close_nifty'].shift(6).clip(lower=1)
        f14 = np.clip((stock_ret6 - nifty_ret6) * 100.0, -3.0, 3.0).fillna(0)
    else:
        f13 = pd.Series(0.0, index=df.index)
        f14 = pd.Series(0.0, index=df.index)

    feat_df = pd.DataFrame({
        'vwapZ': f1, 'emaSpread': f2, 'rsiNorm': f3, 'adxNorm': f4, 'diBias': f5,
        'logRelVol': f6, 'bbPos': f7, 'stAlign': f8, 'mom3Atr': f9, 'orbPos': f10,
        'sessionProgress': f11, 'atrPctNorm': f12, 'niftyAlign': f13, 'relStrengthNifty': f14
    }, index=df.index)

    return df, feat_df

# ── 3. Triple-Barrier Target Labeling ──────────────────────────────────────────
def create_triple_barrier_labels(df: pd.DataFrame, horizon: int = 10) -> np.ndarray:
    labels = np.full(len(df), 2, dtype=int)
    highs = df['high'].values
    lows = df['low'].values
    opens = df['open'].values
    atr = np.maximum(0.1, df['atr14'].values)
    sessions = df['sessionDate'].values

    for i in range(28, len(df) - horizon - 1):
        if sessions[i + 1] != sessions[i]:
            continue

        entry = opens[i + 1]
        curr_atr = atr[i]
        target_up = entry + 1.35 * curr_atr
        stop_up = entry - 1.0 * curr_atr
        target_down = entry - 1.35 * curr_atr
        stop_down = entry + 1.0 * curr_atr

        hit_up = False
        hit_down = False

        for k in range(i + 1, min(i + 1 + horizon, len(df))):
            if sessions[k] != sessions[i]:
                break
            if lows[k] <= stop_up and not hit_up:
                hit_up = False
            elif highs[k] >= target_up:
                hit_up = True
                labels[i] = 0
                break

            if highs[k] >= stop_down and not hit_down:
                hit_down = False
            elif lows[k] <= target_down:
                hit_down = True
                labels[i] = 1
                break

    return labels

# ── 4. Training Runner ────────────────────────────────────────────────────────
def main():
    print("[ArthQuant] Initializing model training pipeline on Kaggle...")
    # NOTE: In Kaggle, replace this with your uploaded dataset path e.g. /kaggle/input/nse-5m-equity/RELIANCE.csv
    # Or download directly using yfinance:
    import yfinance as yf
    print("Downloading 60-day 5m data for RELIANCE.NS from Yahoo Finance...")
    ticker = yf.Ticker("RELIANCE.NS")
    df = ticker.history(period="60d", interval="5m").reset_index()
    df.columns = [c.lower() for c in df.columns]

    df, feat_df = extract_arthquant_14_features(df)
    labels = create_triple_barrier_labels(df)

    valid_mask = (df.index >= 30) & (df.index < len(df) - 12)
    X = feat_df.loc[valid_mask].values
    y = labels[valid_mask]

    n = len(X)
    train_end = int(n * 0.70)
    val_end = int(n * 0.85)
    embargo = 15

    X_train, y_train = X[:train_end - embargo], y[:train_end - embargo]
    X_val, y_val = X[train_end:val_end - embargo], y[train_end:val_end - embargo]
    X_test, y_test = X[val_end:], y[val_end:]

    print(f"Dataset split: Train={len(X_train)}, Val={len(X_val)}, Test={len(X_test)}")

    # 1. LightGBM
    print("\nTraining LightGBM Classifier...")
    lgb_train = lgb.Dataset(X_train, label=y_train)
    lgb_val = lgb.Dataset(X_val, label=y_val, reference=lgb_train)
    params = {
        'objective': 'multiclass',
        'num_class': 3,
        'metric': 'multi_logloss',
        'learning_rate': 0.03,
        'num_leaves': 31,
        'max_depth': 6,
        'verbose': -1,
        'seed': 42
    }
    model_lgb = lgb.train(
        params,
        lgb_train,
        num_boost_round=300,
        valid_sets=[lgb_val],
        callbacks=[lgb.early_stopping(30, verbose=False)]
    )

    out_file = "model_lightgbm.txt"
    model_lgb.save_model(out_file)
    print(f"Successfully saved {out_file} (Ready to download and place into ml_service/)")

    # Evaluation
    preds = model_lgb.predict(X_test)
    y_pred = np.argmax(preds, axis=1)
    print("\nClassification Report (Out of Sample Test):")
    print(classification_report(y_test, y_pred, target_names=['BULL', 'BEAR', 'NEUTRAL']))

if __name__ == "__main__":
    main()
