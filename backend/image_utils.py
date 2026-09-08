"""
DEPTHWIZARD — Image Utilities
Image loading, validation, raster encoding, and optional GeoTIFF metadata.
"""

import base64
import io
import logging
import struct
from typing import Optional, Tuple

import cv2
import numpy as np

logger = logging.getLogger("depthwizard")

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff"}
ALLOWED_MIME_PREFIXES = {"image/jpeg", "image/png", "image/tiff"}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB


def validate_file(filename: str, file_size: int) -> Tuple[bool, str]:
    """Validate file extension and size. Returns (valid, error_message)."""
    ext = _get_extension(filename)
    if ext not in ALLOWED_EXTENSIONS:
        return False, f"Unsupported format '{ext}'. Supported: JPG, PNG, TIFF."
    if file_size > MAX_FILE_SIZE:
        return False, f"File exceeds 50 MB limit ({file_size / (1024*1024):.1f} MB)."
    return True, ""


def load_image(file_bytes: bytes, filename: str) -> np.ndarray:
    """
    Load image bytes into BGR numpy array via OpenCV.
    Supports JPG, PNG, and TIFF (including multi-channel TIFF).
    Raises ValueError on failure.
    """
    arr = np.frombuffer(file_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError(f"Failed to decode image: {filename}")
    logger.info(
        "[DepthWizard] Loaded image: %s  Size: %d×%d  Channels: %d",
        filename, img.shape[1], img.shape[0], img.shape[2] if len(img.shape) > 2 else 1,
    )
    return img


def extract_geotiff_metadata(file_bytes: bytes, filename: str) -> dict:
    """
    Attempt to read real GeoTIFF metadata using rasterio.
    Only reports georeferenced=True when actual CRS/transform exists.
    Falls back gracefully if rasterio is not installed.
    """
    meta = {
        "georeferenced": False,
        "crs": None,
        "resolution": None,
        "extent": None,
    }

    ext = _get_extension(filename)
    if ext not in {".tif", ".tiff"}:
        return meta

    try:
        import rasterio
        from rasterio.io import MemoryFile

        with MemoryFile(file_bytes) as memfile:
            with memfile.open() as dataset:
                if dataset.crs is not None:
                    meta["georeferenced"] = True
                    meta["crs"] = str(dataset.crs)
                    transform = dataset.transform
                    if transform:
                        meta["resolution"] = round(abs(transform.a), 6)
                        bounds = dataset.bounds
                        meta["extent"] = {
                            "minX": bounds.left,
                            "minY": bounds.bottom,
                            "maxX": bounds.right,
                            "maxY": bounds.top,
                        }
                    logger.info(
                        "[DepthWizard] GeoTIFF metadata: CRS=%s  Res=%.4f",
                        meta["crs"], meta["resolution"] or 0,
                    )
                else:
                    logger.info("[DepthWizard] TIFF has no CRS — not georeferenced")

    except ImportError:
        logger.info("[DepthWizard] rasterio not installed — skipping GeoTIFF metadata")
    except Exception as e:
        logger.warning("[DepthWizard] Failed to read GeoTIFF metadata: %s", e)

    return meta


def downsample_raster(raster: np.ndarray, max_dim: int = 512) -> np.ndarray:
    """
    Downsample a 2D float32 raster so the largest dimension is at most max_dim.
    Uses bilinear interpolation. Returns the downsampled raster.
    If the raster is already smaller, returns a copy.
    """
    h, w = raster.shape
    if max(h, w) <= max_dim:
        return raster.copy()

    if w >= h:
        new_w = max_dim
        new_h = max(1, int(round(h * max_dim / w)))
    else:
        new_h = max_dim
        new_w = max(1, int(round(w * max_dim / h)))

    downsampled = cv2.resize(
        raster, (new_w, new_h), interpolation=cv2.INTER_LINEAR
    )
    logger.info(
        "[DepthWizard] Downsampled raster: %d×%d → %d×%d",
        w, h, new_w, new_h,
    )
    return downsampled.astype(np.float32)


def raster_to_base64(raster: np.ndarray) -> str:
    """
    Encode a float32 2D numpy array as base64 string (raw little-endian bytes).
    The frontend decodes this back into a Float32Array.
    """
    raw = raster.astype(np.float32).tobytes()
    return base64.b64encode(raw).decode("ascii")


def _get_extension(filename: str) -> str:
    """Get lowercase file extension including the dot."""
    import os
    return os.path.splitext(filename)[1].lower()
