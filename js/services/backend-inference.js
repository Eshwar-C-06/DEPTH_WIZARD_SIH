/* ============================================
   DEPTHWIZARD — Backend Inference Service
   
   Connects to the real FastAPI backend running
   Depth Anything V2 Small on CPU.
   
   Implements the same InferenceServiceInterface
   as MockInferenceService so app.js can switch
   seamlessly via the factory.
   ============================================ */

import { createEmptyResult, createProcessingStages } from '../models/result-schema.js';
import { CONFIG } from '../config.js';

export class BackendInferenceService {
  constructor(config = {}) {
    this._config = config;
    this._backendUrl = config.backendUrl || CONFIG.BACKEND_URL;
    this._images = new Map();
    this._jobs = new Map();
    this._nextId = 1;
  }

  getMode() {
    return 'live';
  }

  // ═══════════════════════════════════════════
  // Upload — client-side (file stays in browser)
  // ═══════════════════════════════════════════

  async uploadImage(file) {
    const imageId = `img_${this._nextId++}`;
    const url = URL.createObjectURL(file);
    const dims = await this._getImageDimensions(url);

    const imageData = {
      id: imageId,
      file,
      url,
      width: dims.width,
      height: dims.height,
      filename: file.name,
      format: file.type || this._guessFormat(file.name),
      fileSize: file.size,
    };

    this._images.set(imageId, imageData);

    return {
      imageId,
      metadata: {
        filename: file.name,
        width: dims.width,
        height: dims.height,
        format: imageData.format,
        fileSize: file.size,
      },
    };
  }

  // ═══════════════════════════════════════════
  // Validation — client-side checks
  // ═══════════════════════════════════════════

  async validateImage(imageId) {
    const img = this._images.get(imageId);
    if (!img) {
      return { valid: false, issues: ['Image not found'], imageInfo: null };
    }

    const issues = [];
    if (img.fileSize > 50 * 1024 * 1024) {
      issues.push('File exceeds 50 MB limit');
    }

    const validFormats = ['image/jpeg', 'image/png', 'image/tiff'];
    if (!validFormats.includes(img.format)) {
      issues.push(`Unsupported format: ${img.format}`);
    }

    return {
      valid: issues.length === 0,
      issues,
      imageInfo: {
        width: img.width,
        height: img.height,
        format: img.format,
        fileSize: img.fileSize,
      },
    };
  }

  // ═══════════════════════════════════════════
  // Metadata — no fabrication
  // ═══════════════════════════════════════════

  async getMetadata(imageId) {
    const img = this._images.get(imageId);
    if (!img) return null;

    // We don't fabricate geo metadata client-side.
    // Real GeoTIFF metadata comes from the backend response.
    return {
      filename: img.filename,
      width: img.width,
      height: img.height,
      format: img.format,
      fileSize: img.fileSize,
      resolution: null,
      crs: null,
      georeferenced: false,
      extent: null,
    };
  }

  // ═══════════════════════════════════════════
  // Inference — real backend call
  // ═══════════════════════════════════════════

  async runInference(imageId, config = {}) {
    const img = this._images.get(imageId);
    if (!img) throw new Error('Image not found');

    const jobId = `job_${this._nextId++}`;
    const stages = createProcessingStages();

    const job = {
      id: jobId,
      imageId,
      config: {
        model: config.model || 'Depth Anything V2',
        output: config.output || 'Relative Depth',
      },
      stages,
      currentStageIndex: -1,
      status: 'running',
      startTime: Date.now(),
      result: null,
    };

    this._jobs.set(jobId, job);

    // Run actual inference in background
    this._runBackendInference(jobId);

    return { jobId };
  }

  async _runBackendInference(jobId) {
    const job = this._jobs.get(jobId);
    if (!job) return;

    const img = this._images.get(job.imageId);
    const stages = job.stages;

    try {
      // Stage 0: Image Validation
      this._advanceStage(job, 0);
      await this._delay(300);
      this._completeStage(job, 0);

      // Stage 1: Preprocessing
      this._advanceStage(job, 1);
      await this._delay(200);
      this._completeStage(job, 1);

      // Stage 2: Depth Estimation (real backend call)
      this._advanceStage(job, 2);

      const formData = new FormData();
      formData.append('file', img.file);

      let response;
      try {
        response = await fetch(`${this._backendUrl}/predict`, {
          method: 'POST',
          body: formData,
        });
      } catch (networkErr) {
        throw new Error(
          'DepthWizard backend is not running. ' +
          'Start the Python inference server:\n\n' +
          '  cd E:\\SIH_2026\\UI_FINAL\n' +
          '  venv\\Scripts\\activate\n' +
          '  uvicorn backend.app:app --host 127.0.0.1 --port 8000'
        );
      }

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error || `Backend error (HTTP ${response.status})`);
      }

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Backend returned unsuccessful response');
      }

      this._completeStage(job, 2);

      // Stage 3: Depth Normalization
      this._advanceStage(job, 3);
      await this._delay(100);

      // Decode base64 Float32Array
      const rasterBytes = Uint8Array.from(atob(data.depth.raster_b64), c => c.charCodeAt(0));
      const depthRaster = new Float32Array(rasterBytes.buffer);
      const rasterW = data.depth.raster_width;
      const rasterH = data.depth.raster_height;

      this._completeStage(job, 3);

      // Stage 4: Result Preparation
      this._advanceStage(job, 4);
      await this._delay(100);

      // Build the InferenceResult
      const result = this._buildResult(job, img, data, depthRaster, rasterW, rasterH);
      job.result = result;

      this._completeStage(job, 4);

      // Stage 5: 3D Visualization
      this._advanceStage(job, 5);
      await this._delay(200);
      this._completeStage(job, 5);

      // Complete
      job.status = 'complete';
      job.endTime = Date.now();

      document.dispatchEvent(new CustomEvent('dw:inference-complete', {
        detail: { jobId, result: job.result },
      }));

    } catch (err) {
      console.error('[DepthWizard] Backend inference failed:', err);
      job.status = 'error';

      // Mark current stage as error
      const activeStage = stages.find(s => s.status === 'active');
      if (activeStage) activeStage.status = 'error';

      document.dispatchEvent(new CustomEvent('dw:inference-error', {
        detail: { jobId, error: err.message },
      }));
    }
  }

  _buildResult(job, img, backendData, depthRaster, rasterW, rasterH) {
    const result = createEmptyResult();

    // ── Image ──
    result.image = {
      id: img.id,
      filename: img.filename,
      width: img.width,
      height: img.height,
      format: img.format,
      url: img.url,
      fileSize: img.fileSize,
    };

    // ── Metadata — from backend (real GeoTIFF only) ──
    const bImg = backendData.image;
    result.metadata = {
      resolution: bImg.resolution || null,
      crs: bImg.crs || null,
      georeferenced: bImg.georeferenced || false,
      extent: bImg.extent || null,
      dimensions: { width: img.width, height: img.height },
    };

    // ── Depth (relative, 0-1 normalized) ──
    result.depth = {
      raster: depthRaster,
      width: rasterW,
      height: rasterH,
      min: 0,
      max: 1,
      normalization: 'relative',
    };

    // ── DSM — NOT populated in Phase 1 ──
    // We keep dsm as a separate concept. For Phase 1, the
    // visualization pipeline reads from depth via a compatibility
    // shim (dsm fields populated from depth for rendering only).
    result.dsm = {
      raster: depthRaster,     // same data — relative depth, NOT metric elevation
      width: rasterW,
      height: rasterH,
      minElevation: 0,         // relative depth min
      maxElevation: 1,         // relative depth max
      resolution: null,
      crs: null,
      geotransform: null,
      unit: 'relative',        // explicitly NOT 'm'
      noDataValue: -9999,
    };

    // ── Calibration — none in Phase 1 ──
    result.calibration = {
      scale: 1.0,
      offset: 0.0,
      method: 'none',
      confidence: 0.0,
    };

    // ── Metrics — only what we can actually compute ──
    // No fake building count, no fake area, no fake metric heights
    const depthStats = this._computeDepthStats(depthRaster);
    result.metrics = {
      maxHeight: null,           // not available without calibration
      meanHeight: null,          // not available without calibration
      medianHeight: null,
      buildingCount: null,       // not available without segmentation
      areaCovered: null,         // not available without GSD
      mae: null,
      rmse: null,
      correlation: null,
      // Phase 1 extras (relative depth stats)
      maxDepth: depthStats.max,
      meanDepth: depthStats.mean,
      depthRange: depthStats.range,
    };

    // ── Processing ──
    result.processing = {
      model: { name: 'Depth Anything V2 Small', version: 'vits' },
      duration: Date.now() - job.startTime,
      status: 'complete',
      progress: 100,
      mode: 'live',
      stages: job.stages.map(s => ({ ...s })),
      error: null,
    };

    return result;
  }

  _computeDepthStats(raster) {
    let min = Infinity, max = -Infinity, sum = 0, count = 0;
    for (let i = 0; i < raster.length; i++) {
      const v = raster[i];
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
      count++;
    }
    return {
      min: count > 0 ? min : 0,
      max: count > 0 ? max : 1,
      mean: count > 0 ? sum / count : 0,
      range: count > 0 ? max - min : 0,
    };
  }

  // ═══════════════════════════════════════════
  // Status polling
  // ═══════════════════════════════════════════

  async getInferenceStatus(jobId) {
    const job = this._jobs.get(jobId);
    if (!job) return null;

    const completedCount = job.stages.filter(s => s.status === 'complete').length;
    const progress = Math.round((completedCount / job.stages.length) * 100);

    return {
      status: job.status,
      stage: job.currentStageIndex >= 0 ? job.stages[job.currentStageIndex].id : null,
      progress,
      stages: job.stages.map(s => ({ ...s })),
    };
  }

  // ═══════════════════════════════════════════
  // Result accessors
  // ═══════════════════════════════════════════

  async getDepthResult(jobId) {
    const job = this._jobs.get(jobId);
    if (!job || !job.result) return null;
    return job.result.depth;
  }

  async getDSMResult(jobId) {
    const job = this._jobs.get(jobId);
    if (!job || !job.result) return null;
    return job.result.dsm;
  }

  async getMetrics(jobId) {
    const job = this._jobs.get(jobId);
    if (!job || !job.result) return null;
    return job.result.metrics;
  }

  async getFullResult(jobId) {
    const job = this._jobs.get(jobId);
    if (!job || !job.result) return null;
    return job.result;
  }

  // ═══════════════════════════════════════════
  // Exports — client-side from real raster
  // ═══════════════════════════════════════════

  async exportDSM(jobId, format = 'png') {
    const job = this._jobs.get(jobId);
    if (!job || !job.result) throw new Error('No results available');

    const { raster, width, height } = job.result.depth;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(width, height);

    for (let i = 0; i < raster.length; i++) {
      const norm = Math.max(0, Math.min(1, raster[i]));
      const [r, g, b] = this._depthToColor(norm);
      imageData.data[i * 4] = r;
      imageData.data[i * 4 + 1] = g;
      imageData.data[i * 4 + 2] = b;
      imageData.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);

    return new Promise(resolve => {
      canvas.toBlob(blob => resolve(blob), 'image/png');
    });
  }

  async exportMesh(jobId, format = 'obj') {
    const job = this._jobs.get(jobId);
    if (!job || !job.result) throw new Error('No results available');

    const { raster, width, height } = job.result.depth;
    const step = Math.max(1, Math.floor(Math.max(width, height) / 128));
    let obj = '# DepthWizard — Depth Anything V2 Real Inference\n';
    obj += '# Relative depth surface (not metric elevation)\n\n';

    const cols = Math.ceil(width / step);
    const rows = Math.ceil(height / step);

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const sx = x * step;
        const sy = y * step;
        const idx = Math.min(sy, height - 1) * width + Math.min(sx, width - 1);
        const elev = raster[idx] || 0;
        obj += `v ${(x / cols).toFixed(4)} ${elev.toFixed(4)} ${(y / rows).toFixed(4)}\n`;
      }
    }

    for (let y = 0; y < rows - 1; y++) {
      for (let x = 0; x < cols - 1; x++) {
        const i = y * cols + x + 1;
        obj += `f ${i} ${i + 1} ${i + cols + 1} ${i + cols}\n`;
      }
    }

    return new Blob([obj], { type: 'text/plain' });
  }

  async exportReport(jobId) {
    const job = this._jobs.get(jobId);
    if (!job || !job.result) throw new Error('No results available');

    const r = job.result;
    const m = r.metrics;
    const text = [
      '═══════════════════════════════════════════',
      '  DEPTHWIZARD — Depth Analysis Report',
      '  Phase 1: Relative Depth Estimation',
      '═══════════════════════════════════════════',
      '',
      `  Image: ${r.image.filename}`,
      `  Dimensions: ${r.image.width} × ${r.image.height}`,
      `  Model: ${r.processing.model.name}`,
      `  Encoder: vits`,
      `  Device: CPU`,
      `  Processing Time: ${(r.processing.duration / 1000).toFixed(1)}s`,
      '',
      '  ─── Depth Statistics (Relative) ───',
      `  Max Depth:    ${m.maxDepth != null ? m.maxDepth.toFixed(4) : 'N/A'}`,
      `  Mean Depth:   ${m.meanDepth != null ? m.meanDepth.toFixed(4) : 'N/A'}`,
      `  Depth Range:  ${m.depthRange != null ? m.depthRange.toFixed(4) : 'N/A'}`,
      '',
      '  ─── Metric Elevation ───',
      '  Not available in Phase 1.',
      '  Metric calibration requires elevation references',
      '  (DEM, GCP, LiDAR) and will be implemented in Phase 2.',
      '',
      '  ─── Building Detection ───',
      '  Not available in Phase 1.',
      '  Building segmentation requires a dedicated model.',
      '',
      '═══════════════════════════════════════════',
    ].join('\n');

    return new Blob([text], { type: 'text/plain' });
  }

  dispose() {
    for (const img of this._images.values()) {
      if (img.url) URL.revokeObjectURL(img.url);
    }
    this._images.clear();
    this._jobs.clear();
  }

  // ═══════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════

  _advanceStage(job, index) {
    job.currentStageIndex = index;
    job.stages[index].status = 'active';
    document.dispatchEvent(new CustomEvent('dw:inference-progress', {
      detail: { jobId: job.id, stageIndex: index, stage: job.stages[index].id },
    }));
  }

  _completeStage(job, index) {
    job.stages[index].status = 'complete';
    job.stages[index].duration = 0; // actual timing not tracked per-stage
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  _depthToColor(t) {
    t = Math.max(0, Math.min(1, t));
    const stops = [
      [0.00, 0, 102, 255],
      [0.20, 0, 204, 204],
      [0.40, 102, 204, 0],
      [0.60, 255, 204, 0],
      [0.80, 255, 102, 0],
      [1.00, 255, 0, 0],
    ];
    for (let i = 0; i < stops.length - 1; i++) {
      if (t >= stops[i][0] && t <= stops[i + 1][0]) {
        const f = (t - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
        return [
          Math.round(stops[i][1] + f * (stops[i + 1][1] - stops[i][1])),
          Math.round(stops[i][2] + f * (stops[i + 1][2] - stops[i][2])),
          Math.round(stops[i][3] + f * (stops[i + 1][3] - stops[i][3])),
        ];
      }
    }
    return [255, 0, 0];
  }

  _guessFormat(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const map = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', tif: 'image/tiff', tiff: 'image/tiff' };
    return map[ext] || 'application/octet-stream';
  }

  _getImageDimensions(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve({ width: 512, height: 512 });
      img.src = url;
    });
  }
}
