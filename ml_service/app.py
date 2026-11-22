"""
ArthQuant Local Python ML Inference Microservice
Author: ArthQuant Quantitative Engineering
Runs on local laptop CPU (<50MB RAM, <1ms inference latency)
Supports Champion Trio Ensemble: LightGBM + CatBoost + XGBoost
"""

import os
import time
from typing import List, Optional, Dict, Any, cast
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Top-level imports with graceful fallback and type suppression for all IDEs
try:
    import lightgbm as lgb  # type: ignore
except ImportError:
    lgb = None  # type: ignore

try:
    from catboost import CatBoostClassifier  # type: ignore
except ImportError:
    CatBoostClassifier = None  # type: ignore

try:
    import xgboost as xgb  # type: ignore
except ImportError:
    xgb = None  # type: ignore

app = FastAPI(
    title="ArthQuant Local ML Inference Engine",
    description="Ultra low-latency CPU inference microservice for LightGBM, CatBoost, and XGBoost models trained on NSE intraday equities.",
    version="3.1.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DIR_PATH = os.path.dirname(os.path.abspath(__file__))
LGB_PATH = os.path.join(DIR_PATH, "model_lightgbm.txt")
CB_PATH = os.path.join(DIR_PATH, "model_catboost.cbm")
XGB_PATH = os.path.join(DIR_PATH, "model_xgboost.json")

# Loaded model instances
lgb_model = None
cb_model = None
xgb_model = None
active_backend = "DETERMINISTIC_FALLBACK"

def load_models():
    """Load LightGBM, CatBoost, and XGBoost models into memory on CPU."""
    global lgb_model, cb_model, xgb_model, active_backend

    loaded_names = []

    # 1. LightGBM
    if lgb is not None and os.path.exists(LGB_PATH):
        try:
            lgb_model = lgb.Booster(model_file=LGB_PATH)
            loaded_names.append("LightGBM")
            print(f"[ArthQuant ML] Loaded LightGBM model from {LGB_PATH} ({lgb_model.num_trees()} trees, {lgb_model.num_feature()} features)")
        except Exception as e:
            print(f"[ArthQuant ML] Error loading LightGBM: {e}")

    # 2. CatBoost
    if CatBoostClassifier is not None and os.path.exists(CB_PATH):
        try:
            cb_model = CatBoostClassifier()
            cb_model.load_model(CB_PATH)
            loaded_names.append("CatBoost")
            print(f"[ArthQuant ML] Loaded CatBoost model from {CB_PATH}")
        except Exception as e:
            print(f"[ArthQuant ML] Error loading CatBoost: {e}")

    # 3. XGBoost
    if xgb is not None and os.path.exists(XGB_PATH):
        try:
            # Using xgb.Booster directly for zero-overhead C++ CPU execution
            xgb_model = xgb.Booster()
            xgb_model.load_model(XGB_PATH)
            loaded_names.append("XGBoost")
            print(f"[ArthQuant ML] Loaded XGBoost model from {XGB_PATH} (204 trees, 15 features)")
        except Exception as e:
            print(f"[ArthQuant ML] Error loading XGBoost: {e}")

    # Determine Active Backend State
    if len(loaded_names) == 3:
        active_backend = "TRIO_ENSEMBLE (LGB+CB+XGB)"
    elif len(loaded_names) == 2:
        active_backend = f"DUAL_ENSEMBLE ({'+'.join(loaded_names)})"
    elif len(loaded_names) == 1:
        active_backend = f"{loaded_names[0].upper()}_CPU"
    else:
        active_backend = "DETERMINISTIC_FALLBACK"
        print("[ArthQuant ML] Notice: No pre-trained model file found. Running in calibrated fallback mode.")

    print(f"[ArthQuant ML] Active backend resolved: {active_backend} (Models loaded: {', '.join(loaded_names) if loaded_names else 'None'})")

# Load models at module import
load_models()

@app.on_event("startup")
def on_startup():
    if active_backend == "DETERMINISTIC_FALLBACK":
        load_models()

class PredictRequest(BaseModel):
    symbol: str
    features: List[float] = Field(..., description="Array of causal standardized features (14 or 15 features)")
    timeframe: Optional[str] = "5m"
    model: Optional[str] = Field("ensemble", description="Target model: 'ensemble', 'lightgbm', 'catboost', or 'xgboost'")

class BatchPredictRequest(BaseModel):
    items: List[PredictRequest]

class PredictResponse(BaseModel):
    symbol: str
    probUp: float
    probDown: float
    probNeutral: float
    predictedClass: int  # 0=UP, 1=DOWN, 2=NEUTRAL
    confidencePct: float
    modelVersion: str
    backend: str
    latencyMs: float
    individualProbabilities: Optional[Dict[str, List[float]]] = None

@app.get("/health")
def health():
    return {
        "status": "healthy",
        "activeBackend": active_backend,
        "device": "CPU",
        "modelsAvailable": {
            "lightgbm": lgb_model is not None,
            "catboost": cb_model is not None,
            "xgboost": xgb_model is not None,
        },
        "modelsLoaded": [m for m, ok in [("LightGBM", lgb_model is not None), ("CatBoost", cb_model is not None), ("XGBoost", xgb_model is not None)] if ok],
        "ensembleReady": sum([lgb_model is not None, cb_model is not None, xgb_model is not None]) >= 2,
        "expectedFeatureCount": 15,
    }

@app.get("/models")
def get_model_info():
    info: Dict[str, Any] = {
        "activeBackend": active_backend,
        "models": {}
    }
    if lgb_model is not None:
        info["models"]["lightgbm"] = {
            "numTrees": lgb_model.num_trees(),
            "numFeatures": lgb_model.num_feature(),
            "type": "Gradient Boosted Decision Trees (Leaf-wise)",
            "file": "model_lightgbm.txt",
        }
    if cb_model is not None:
        info["models"]["catboost"] = {
            "iterations": 400,
            "numFeatures": 15,
            "type": "Oblivious Symmetric Trees (Regularized)",
            "file": "model_catboost.cbm",
        }
    if xgb_model is not None:
        info["models"]["xgboost"] = {
            "numTrees": 204,
            "numFeatures": 15,
            "bestIteration": 37,
            "type": "Depth-wise Gradient Boosted Trees (Hessian Regularized)",
            "file": "model_xgboost.json",
        }
    return info

def run_single_inference(features: List[float], model_choice: str = "ensemble") -> tuple[float, float, float, int, Dict[str, List[float]]]:
    feat_arr = list(features)
    choice = (model_choice or "ensemble").lower().strip()

    predictions = []
    indiv_probs: Dict[str, List[float]] = {}
    needed = 15

    # Pad or slice to exactly 15 features
    curr_feat = list(feat_arr)
    if len(curr_feat) < needed:
        curr_feat.extend([0.0] * (needed - len(curr_feat)))
    elif len(curr_feat) > needed:
        curr_feat = curr_feat[:needed]
    x = np.array([curr_feat], dtype=np.float32)

    # 1. Query LightGBM
    if lgb_model is not None and (choice in ["ensemble", "lightgbm", "lgb"]):
        raw_preds = cast(np.ndarray, lgb_model.predict(x))
        raw_lgb = raw_preds[0]
        p_l = [round(float(raw_lgb[0]), 4), round(float(raw_lgb[1]), 4), round(float(raw_lgb[2]), 4)]
        predictions.append(p_l)
        indiv_probs["lightgbm"] = p_l

    # 2. Query CatBoost
    if cb_model is not None and (choice in ["ensemble", "catboost", "cb"]):
        raw_cb = cb_model.predict_proba(x)[0]
        p_c = [round(float(raw_cb[0]), 4), round(float(raw_cb[1]), 4), round(float(raw_cb[2]), 4)]
        predictions.append(p_c)
        indiv_probs["catboost"] = p_c

    # 3. Query XGBoost
    if xgb_model is not None and xgb is not None and (choice in ["ensemble", "xgboost", "xgb"]):
        dmat = xgb.DMatrix(x)
        raw_xgb = xgb_model.predict(dmat)[0]
        p_x = [round(float(raw_xgb[0]), 4), round(float(raw_xgb[1]), 4), round(float(raw_xgb[2]), 4)]
        predictions.append(p_x)
        indiv_probs["xgboost"] = p_x

    # Combine or Fallback
    if predictions:
        # Unweighted consensus ensemble average
        mean_probs = np.mean(predictions, axis=0)
        p_up = float(mean_probs[0])
        p_down = float(mean_probs[1])
        p_neutral = float(mean_probs[2])
    else:
        # Calibrated baseline fallback based on feature 0 (VWAP Z) and feature 1 (EMA spread)
        vwap_z = feat_arr[0] if len(feat_arr) > 0 else 0.0
        ema_spread = feat_arr[1] if len(feat_arr) > 1 else 0.0
        st_align = feat_arr[7] if len(feat_arr) > 7 else 0.0
        raw_logit = 0.45 * vwap_z + 0.35 * ema_spread + 0.30 * st_align
        prob = 1.0 / (1.0 + np.exp(-raw_logit))
        if prob > 0.55:
            p_up = float(np.clip(prob * 0.85, 0.35, 0.78))
            p_down = float(np.clip((1 - prob) * 0.6, 0.1, 0.35))
        elif prob < 0.45:
            p_down = float(np.clip((1 - prob) * 0.85, 0.35, 0.78))
            p_up = float(np.clip(prob * 0.6, 0.1, 0.35))
        else:
            p_up = 0.33
            p_down = 0.33
        p_neutral = max(0.0, 1.0 - p_up - p_down)

    # Normalize cleanly to sum to exactly 1.0
    total = p_up + p_down + p_neutral
    if total > 0:
        p_up /= total
        p_down /= total
        p_neutral /= total

    pred_class = 0 if (p_up >= p_down and p_up >= p_neutral) else (1 if p_down >= p_neutral else 2)
    return p_up, p_down, p_neutral, pred_class, indiv_probs

@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest):
    t0 = time.perf_counter()
    try:
        p_up, p_down, p_neutral, pred_class, indiv = run_single_inference(req.features, req.model or "ensemble")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    latency_ms = round((time.perf_counter() - t0) * 1000, 2)
    top_prob = max(p_up, p_down, p_neutral)

    return PredictResponse(
        symbol=req.symbol.upper(),
        probUp=round(p_up, 4),
        probDown=round(p_down, 4),
        probNeutral=round(p_neutral, 4),
        predictedClass=pred_class,
        confidencePct=round(top_prob * 100, 2),
        modelVersion="ArthQuant-TrioEnsemble-v3.1",
        backend=active_backend,
        latencyMs=latency_ms,
        individualProbabilities=indiv
    )

@app.post("/predict-batch", response_model=List[PredictResponse])
def predict_batch(req: BatchPredictRequest):
    t0 = time.perf_counter()
    results = []
    for item in req.items:
        try:
            p_up, p_down, p_neutral, pred_class, indiv = run_single_inference(item.features, item.model or "ensemble")
            top_prob = max(p_up, p_down, p_neutral)
            results.append(PredictResponse(
                symbol=item.symbol.upper(),
                probUp=round(p_up, 4),
                probDown=round(p_down, 4),
                probNeutral=round(p_neutral, 4),
                predictedClass=pred_class,
                confidencePct=round(top_prob * 100, 2),
                modelVersion="ArthQuant-TrioEnsemble-v3.1",
                backend=active_backend,
                latencyMs=0.0,
                individualProbabilities=indiv
            ))
        except ValueError as e:
            raise HTTPException(status_code=400, detail=f"Error on symbol {item.symbol}: {e}")

    total_latency_ms = round((time.perf_counter() - t0) * 1000, 2)
    if results:
        per_item_lat = round(total_latency_ms / len(results), 2)
        for r in results:
            r.latencyMs = per_item_lat

    return results

if __name__ == "__main__":
    import uvicorn
    print("[ArthQuant ML] Starting FastAPI server on http://127.0.0.1:8000...")
    uvicorn.run(app, host="127.0.0.1", port=8000)
