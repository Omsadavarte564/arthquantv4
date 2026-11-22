import os
import subprocess
import time
import httpx
from fastapi import FastAPI, Request, Response
from starlette.responses import StreamingResponse
import uvicorn
import gradio as gr

print("[ArthQuant] Starting free cloud runner on Hugging Face Spaces...")

# Build frontend if dist does not exist
if not os.path.exists("dist"):
    print("[ArthQuant] Installing node modules...")
    subprocess.run(["npm", "install"], check=True)
    print("[ArthQuant] Building Vite production bundle...")
    subprocess.run(["npm", "run", "build"], check=True)

# Launch Node.js Express on internal port 3000
NODE_PORT = 3000
node_env = os.environ.copy()
node_env["PORT"] = str(NODE_PORT)
node_env["NODE_ENV"] = "production"
node_env["PYTHON_BIN"] = "python3"

print(f"[ArthQuant] Launching Node.js Express on internal port {NODE_PORT}...")
node_proc = subprocess.Popen(["npx", "tsx", "server.ts"], env=node_env)

# Setup FastAPI reverse proxy on port 7860
app = FastAPI()
client = httpx.AsyncClient(base_url=f"http://127.0.0.1:{NODE_PORT}", timeout=120.0)

@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"])
async def proxy_all(request: Request, path: str):
    if path == "gradio" or path.startswith("gradio/"):
        return Response(content="ArthQuant Gradio interface", media_type="text/plain")

    url = httpx.URL(path=request.url.path, query=request.url.query.encode("utf-8"))
    content = await request.body()
    headers = dict(request.headers)
    headers.pop("host", None)
    headers.pop("content-length", None)

    for attempt in range(20):
        try:
            req = client.build_request(
                method=request.method,
                url=url,
                headers=headers,
                content=content
            )
            res = await client.send(req, stream=True)
            return StreamingResponse(
                res.aiter_raw(),
                status_code=res.status_code,
                headers=dict(res.headers),
                background=res.aclose
            )
        except Exception:
            time.sleep(1)

    return Response(
        content="""
        <html>
            <head><meta http-equiv="refresh" content="5"><title>ArthQuant Starting...</title></head>
            <body style="background:#0B0F17;color:#38BDF8;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;">
                <h2>🚀 ArthQuant is booting on Hugging Face...</h2>
                <p style="color:#94A3B8;">Loading Trio ML Ensemble (LightGBM + CatBoost + XGBoost)... Refreshing in 5 seconds.</p>
            </body>
        </html>
        """,
        media_type="text/html",
        status_code=503
    )

# Mount a minimal Gradio block so Hugging Face Space detects the Gradio SDK
with gr.Blocks(title="ArthQuant") as demo:
    gr.Markdown("# ArthQuant Cloud Terminal is Live")

app = gr.mount_gradio_app(app, demo, path="/gradio")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=7860)
