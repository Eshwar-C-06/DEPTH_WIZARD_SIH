"""
DEPTHWIZARD — Response Schema
Pydantic models for FastAPI responses.
"""

from pydantic import BaseModel
from typing import Optional


class HealthResponse(BaseModel):
    status: str
    model: str
    encoder: str
    device: str
    model_loaded: bool


class DepthData(BaseModel):
    min: float
    max: float
    raster_b64: str          # base64-encoded Float32Array (reduced resolution for frontend)
    raster_width: int        # width of the transferred raster
    raster_height: int       # height of the transferred raster
    full_width: int          # original / full-resolution depth width
    full_height: int         # original / full-resolution depth height


class ProcessingInfo(BaseModel):
    model: str
    variant: str
    encoder: str
    device: str
    mode: str                # 'real'
    duration_ms: float
    input_size: int          # model input_size used


class ImageMetadata(BaseModel):
    filename: str
    format: str
    file_size: int
    width: int
    height: int
    georeferenced: bool
    crs: Optional[str] = None
    resolution: Optional[float] = None
    extent: Optional[dict] = None


class PredictResponse(BaseModel):
    success: bool
    image: ImageMetadata
    depth: DepthData
    processing: ProcessingInfo


class ErrorResponse(BaseModel):
    success: bool = False
    error: str
