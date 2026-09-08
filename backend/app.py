"""
DEPTHWIZARD — FastAPI Backend
Real Depth Anything V2 Small inference server.

Start:
    cd E:\\SIH_2026\\UI_FINAL
    venv\\Scripts\\activate
    uvicorn backend.app:app --host 127.0.0.1 --port 8000

Endpoints:
    GET  /health   — Model/server status
    POST /predict  — Run depth inference on an uploaded image
"""

import logging
import os
import time

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .inference import DepthInferenceEngine
from .image_utils import (
    validate_file,
    load_image,
    extract_geotiff_metadata,
    downsample_raster,
    raster_to_base64,
)
from .response_schema import (
    HealthResponse,
    PredictResponse,
    DepthData,
    ProcessingInfo,
    ImageMetadata,
    ErrorResponse,
)

# ── Logging ──
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("depthwizard")

# ── FastAPI App ──
app = FastAPI(
    title="DEPTHWIZARD API",
    description="Real Depth Anything V2 Small inference backend",
    version="1.0.0",
)

# ── CORS — allow local dev origins ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Global engine (loaded once at startup) ──
engine = DepthInferenceEngine()

# ── Max raster dimension for frontend transfer ──
FRONTEND_RASTER_MAX_DIM = 512


@app.on_event("startup")
async def startup():
    """Load the model once when the server starts."""
    try:
        engine.load_model()
    except Exception as e:
        logger.error("[DepthWizard] FATAL: Failed to load model: %s", e)
        raise


# ═══════════════════════════════════════════
# GET /health
# ═══════════════════════════════════════════
@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(
        status="ok" if engine.is_loaded else "error",
        model=engine.model_name,
        encoder=engine.encoder,
        device=engine.device,
        model_loaded=engine.is_loaded,
    )


# ═══════════════════════════════════════════
# POST /predict
# ═══════════════════════════════════════════
@app.post("/predict")
async def predict(file: UploadFile = File(...)):
    """
    Run Depth Anything V2 Small inference on an uploaded image.
    Returns relative depth raster (NOT metric elevation).
    """
    total_start = time.time()

    # ── 1. Validate ──
    filename = file.filename or "unknown"
    file_bytes = await file.read()
    file_size = len(file_bytes)

    valid, error_msg = validate_file(filename, file_size)
    if not valid:
        raise HTTPException(status_code=400, detail=error_msg)

    logger.info(
        "[DepthWizard] Received image: %s  (%d bytes)", filename, file_size
    )

    # ── 2. Load image ──
    try:
        img_bgr = load_image(file_bytes, filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    img_h, img_w = img_bgr.shape[:2]

    # ── 3. Extract GeoTIFF metadata (only for real TIFF with CRS) ──
    geo_meta = extract_geotiff_metadata(file_bytes, filename)

    # ── 4. Run inference ──
    try:
        depth_raw, depth_normalized = engine.infer(img_bgr)
    except Exception as e:
        logger.error("[DepthWizard] Inference failed: %s", e, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Depth inference failed: {str(e)}",
        )

    # ── 5. Prepare raster for frontend (downsampled) ──
    raster_for_frontend = downsample_raster(
        depth_normalized, max_dim=FRONTEND_RASTER_MAX_DIM
    )
    raster_b64 = raster_to_base64(raster_for_frontend)
    raster_h, raster_w = raster_for_frontend.shape

    # Depth min/max from the full-resolution normalized raster
    d_min = 0.0
    d_max = 1.0

    total_elapsed = time.time() - total_start

    # ── 6. Build response ──
    ext = os.path.splitext(filename)[1].lower()
    fmt_map = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".tif": "image/tiff",
        ".tiff": "image/tiff",
    }

    response = PredictResponse(
        success=True,
        image=ImageMetadata(
            filename=filename,
            format=fmt_map.get(ext, "application/octet-stream"),
            file_size=file_size,
            width=img_w,
            height=img_h,
            georeferenced=geo_meta["georeferenced"],
            crs=geo_meta["crs"],
            resolution=geo_meta["resolution"],
            extent=geo_meta["extent"],
        ),
        depth=DepthData(
            min=d_min,
            max=d_max,
            raster_b64=raster_b64,
            raster_width=raster_w,
            raster_height=raster_h,
            full_width=int(depth_normalized.shape[1]),
            full_height=int(depth_normalized.shape[0]),
        ),
        processing=ProcessingInfo(
            model="Depth Anything V2",
            variant="Small",
            encoder="vits",
            device="cpu",
            mode="real",
            duration_ms=round(total_elapsed * 1000, 1),
            input_size=518,
        ),
    )

    logger.info(
        "[DepthWizard] Response ready — total %.2fs  "
        "Raster: %d×%d (frontend) / %d×%d (full)",
        total_elapsed, raster_w, raster_h,
        depth_normalized.shape[1], depth_normalized.shape[0],
    )

    return response


# ── Error handlers ──
@app.exception_handler(HTTPException)
async def http_error_handler(request, exc):
    return JSONResponse(
        status_code=exc.status_code,
        content={"success": False, "error": exc.detail},
    )


@app.exception_handler(Exception)
async def general_error_handler(request, exc):
    logger.error("[DepthWizard] Unhandled error: %s", exc, exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"success": False, "error": "Internal server error"},
    )
