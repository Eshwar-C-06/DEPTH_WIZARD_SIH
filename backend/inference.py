"""
DEPTHWIZARD — Depth Inference Engine
Wraps the official Depth Anything V2 model.

Loads the model ONCE at startup and keeps it in memory.
All inference runs on CPU with torch.no_grad().
"""

import logging
import os
import sys
import time
from typing import Tuple

import cv2
import numpy as np
import torch

logger = logging.getLogger("depthwizard")

# Path to the cloned Depth-Anything-V2 repository (relative to project root)
_DA_V2_ROOT = os.path.join(os.path.dirname(__file__), "..", "Depth-Anything-V2")
_CHECKPOINT_PATH = os.path.join(_DA_V2_ROOT, "checkpoints", "depth_anything_v2_vits.pth")

# Model configuration for V2 Small (ViT-S)
_MODEL_CONFIG = {
    "encoder": "vits",
    "features": 64,
    "out_channels": [48, 96, 192, 384],
}


class DepthInferenceEngine:
    """
    Depth Anything V2 Small inference engine.

    Usage:
        engine = DepthInferenceEngine()
        engine.load_model()
        depth_full, depth_normalized = engine.infer(bgr_image)
    """

    def __init__(self):
        self.model = None
        self.device = "cpu"
        self.encoder = _MODEL_CONFIG["encoder"]
        self.model_name = "Depth Anything V2 Small"
        self.checkpoint_path = os.path.abspath(_CHECKPOINT_PATH)
        self._is_loaded = False

    @property
    def is_loaded(self) -> bool:
        return self._is_loaded

    def load_model(self) -> None:
        """
        Load Depth Anything V2 Small from checkpoint.
        Must be called once at application startup.
        """
        logger.info("[DepthWizard] Loading %s...", self.model_name)
        logger.info("[DepthWizard] Device: %s", self.device.upper())
        logger.info("[DepthWizard] Checkpoint: %s", self.checkpoint_path)

        if not os.path.isfile(self.checkpoint_path):
            raise FileNotFoundError(
                f"Checkpoint not found: {self.checkpoint_path}"
            )

        # Add the DA-V2 repo to sys.path so we can import their modules
        da_v2_root = os.path.abspath(_DA_V2_ROOT)
        if da_v2_root not in sys.path:
            sys.path.insert(0, da_v2_root)

        from depth_anything_v2.dpt import DepthAnythingV2

        self.model = DepthAnythingV2(**_MODEL_CONFIG)
        state_dict = torch.load(self.checkpoint_path, map_location="cpu")
        self.model.load_state_dict(state_dict)
        self.model = self.model.to(self.device).eval()
        self._is_loaded = True

        logger.info("[DepthWizard] Model loaded successfully")

    def infer(self, raw_image: np.ndarray, input_size: int = 518) -> Tuple[np.ndarray, np.ndarray]:
        """
        Run depth inference on a BGR numpy image.

        Args:
            raw_image: H×W×3 BGR uint8 numpy array (from OpenCV)
            input_size: Model input resolution (default 518)

        Returns:
            (depth_raw, depth_normalized):
                depth_raw — H×W float32 array of raw relative depth values
                           at original image resolution
                depth_normalized — H×W float32 array normalized to [0, 1]
        """
        if not self._is_loaded:
            raise RuntimeError("Model not loaded. Call load_model() first.")

        h, w = raw_image.shape[:2]
        logger.info(
            "[DepthWizard] Running %s (ViT-S) on %d×%d image...",
            self.model_name, w, h,
        )

        t0 = time.time()

        with torch.no_grad():
            depth_raw = self.model.infer_image(raw_image, input_size)

        elapsed = time.time() - t0
        logger.info(
            "[DepthWizard] Inference completed in %.2f seconds", elapsed,
        )
        logger.info(
            "[DepthWizard] Depth output shape: %d × %d  "
            "Range: [%.4f, %.4f]",
            depth_raw.shape[1], depth_raw.shape[0],
            float(depth_raw.min()), float(depth_raw.max()),
        )

        # Normalize to [0, 1]
        d_min = float(depth_raw.min())
        d_max = float(depth_raw.max())
        d_range = d_max - d_min if d_max > d_min else 1.0
        depth_normalized = ((depth_raw - d_min) / d_range).astype(np.float32)

        return depth_raw.astype(np.float32), depth_normalized
