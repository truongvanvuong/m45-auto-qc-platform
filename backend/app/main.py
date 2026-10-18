import os
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routers import qc_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("m45.main")

app = FastAPI(
    title="M45 ENGINE v2.8 - Automated 3D Data QC Platform",
    description="Automated 3D LiDAR quality control platform connecting 2-way with CVAT Local (#8080)",
    version="2.8.0"
)

# CORS configuration - Support local dev, custom origins and any Render domain
origins_str = os.getenv("M45_CORS_ORIGINS", "*")
origins = [o.strip() for o in origins_str.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins if origins and origins != ["*"] else ["*"],
    allow_origin_regex=r"https?://.*\.onrender\.com",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Routers
app.include_router(qc_router.router)

@app.get("/")
async def root():
    return {
        "engine": "M45 ENGINE v2.8",
        "description": "Automated 3D Data QC Platform with CVAT 2-way sync",
        "status": "operational",
        "docs_url": "/docs"
    }

@app.get("/health")
@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "2.8.0"}

if __name__ == "__main__":
    import uvicorn
    # Render automatically injects $PORT, fallback to M45_PORT or 8088
    port = int(os.getenv("PORT", os.getenv("M45_PORT", 8088)))
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=False)
