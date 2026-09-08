/* ============================================
   DEPTHWIZARD — Mock Inference Service
   
   Demo Mode implementation. Generates simulated
   results so the UI can be fully demonstrated.
   
   THIS IS A TEMPORARY PLACEHOLDER.
   Replace with BackendInferenceService when
   the real ML pipeline is ready.
   ============================================ */

import { createEmptyResult, createProcessingStages } from '../models/result-schema.js';

export class MockInferenceService {
  constructor(config = {}) {
    this._config = config;
    this._images = new Map();
    this._jobs = new Map();
    this._nextId = 1;
  }

  getMode() {
    return 'demo';
  }

  /**
   * Simulate uploading an image.
   */
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

  /**
   * Simulate image validation.
   */
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

  /**
   * Get metadata for an uploaded image.
   * In demo mode, CRS and georeferencing are simulated.
   */
  async getMetadata(imageId) {
    const img = this._images.get(imageId);
    if (!img) return null;

    const isGeoTiff = img.filename.toLowerCase().endsWith('.tif') ||
                      img.filename.toLowerCase().endsWith('.tiff');

    return {
      filename: img.filename,
      width: img.width,
      height: img.height,
      format: img.format,
      fileSize: img.fileSize,
      resolution: isGeoTiff ? 0.5 : null,
      crs: isGeoTiff ? 'EPSG:4326' : null,
      georeferenced: isGeoTiff,
      extent: isGeoTiff ? { minX: 77.58, minY: 12.93, maxX: 77.62, maxY: 12.97 } : null,
    };
  }

  /**
   * Start simulated inference.
   * Returns a jobId that can be polled for status.
   */
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
        output: config.output || 'DSM',
        enhanceBuildings: config.enhanceBuildings !== false,
        removeVegetation: config.removeVegetation || false,
      },
      stages,
      currentStageIndex: -1,
      status: 'running',
      startTime: Date.now(),
      result: null,
    };

    this._jobs.set(jobId, job);

    // Start the simulated processing pipeline
    this._simulateProcessing(jobId);

    return { jobId };
  }

  /**
   * Get the current status of an inference job.
   */
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

  /**
   * Get depth result. Only available after processing completes.
   */
  async getDepthResult(jobId) {
    const job = this._jobs.get(jobId);
    if (!job || !job.result) return null;
    return job.result.depth;
  }

  /**
   * Get DSM result. Only available after processing completes.
   */
  async getDSMResult(jobId) {
    const job = this._jobs.get(jobId);
    if (!job || !job.result) return null;
    return job.result.dsm;
  }

  /**
   * Get computed metrics.
   */
  async getMetrics(jobId) {
    const job = this._jobs.get(jobId);
    if (!job || !job.result) return null;
    return job.result.metrics;
  }

  /**
   * Get the full InferenceResult.
   */
  async getFullResult(jobId) {
    const job = this._jobs.get(jobId);
    if (!job || !job.result) return null;
    return job.result;
  }

  /**
   * Export DSM — in demo mode, generates a PNG from the DSM canvas.
   */
  async exportDSM(jobId, format = 'png') {
    const job = this._jobs.get(jobId);
    if (!job || !job.result) throw new Error('No results available');

    // Create a canvas from the DSM raster and export
    const { raster, width, height, minElevation, maxElevation } = job.result.dsm;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(width, height);

    const range = maxElevation - minElevation || 1;
    for (let i = 0; i < raster.length; i++) {
      const norm = (raster[i] - minElevation) / range;
      const rgb = this._elevationToColor(norm);
      imageData.data[i * 4] = rgb[0];
      imageData.data[i * 4 + 1] = rgb[1];
      imageData.data[i * 4 + 2] = rgb[2];
      imageData.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);

    return new Promise(resolve => {
      canvas.toBlob(blob => resolve(blob), 'image/png');
    });
  }

  /**
   * Export 3D mesh — in demo mode, generates a simple OBJ.
   */
  async exportMesh(jobId, format = 'obj') {
    const job = this._jobs.get(jobId);
    if (!job || !job.result) throw new Error('No results available');

    const { raster, width, height, maxElevation } = job.result.dsm;
    const step = Math.max(1, Math.floor(Math.max(width, height) / 128));
    let obj = '# DepthWizard Demo Export\n# This is simulated data\n\n';

    const cols = Math.ceil(width / step);
    const rows = Math.ceil(height / step);

    // Vertices
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const sx = x * step;
        const sy = y * step;
        const idx = Math.min(sy, height - 1) * width + Math.min(sx, width - 1);
        const elev = raster[idx] / (maxElevation || 1);
        obj += `v ${(x / cols).toFixed(4)} ${elev.toFixed(4)} ${(y / rows).toFixed(4)}\n`;
      }
    }

    // Faces
    for (let y = 0; y < rows - 1; y++) {
      for (let x = 0; x < cols - 1; x++) {
        const i = y * cols + x + 1;
        obj += `f ${i} ${i + 1} ${i + cols + 1} ${i + cols}\n`;
      }
    }

    return new Blob([obj], { type: 'text/plain' });
  }

  /**
   * Export report — demo placeholder.
   */
  async exportReport(jobId) {
    const job = this._jobs.get(jobId);
    if (!job || !job.result) throw new Error('No results available');

    const m = job.result.metrics;
    const text = [
      '═══════════════════════════════════════════',
      '  DEPTHWIZARD — Analysis Report',
      '  DEMO MODE — Simulated Results',
      '═══════════════════════════════════════════',
      '',
      `  Image: ${job.result.image.filename}`,
      `  Model: ${job.result.processing.model.name}`,
      `  Processing Time: ${(job.result.processing.duration / 1000).toFixed(1)}s`,
      '',
      '  ─── Metrics ───',
      `  Max Height:        ${m.maxHeight != null ? m.maxHeight.toFixed(1) + ' m' : 'N/A'}`,
      `  Mean Height:       ${m.meanHeight != null ? m.meanHeight.toFixed(1) + ' m' : 'N/A'}`,
      `  Buildings:         ${m.buildingCount != null ? m.buildingCount.toLocaleString() : 'N/A'}`,
      `  Area Covered:      ${m.areaCovered != null ? m.areaCovered.toFixed(1) + ' km²' : 'N/A'}`,
      '',
      '  ⚠ Note: These values are simulated demo data.',
      '  Real metrics require backend ML pipeline integration.',
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

  // ───── Private Methods ─────

  /**
   * Simulate the processing pipeline with timed delays.
   */
  _simulateProcessing(jobId) {
    const job = this._jobs.get(jobId);
    if (!job) return;

    const delays = [600, 800, 2000, 1200, 1500, 1000]; // ms per stage
    let elapsed = 0;

    job.stages.forEach((stage, i) => {
      // Set stage to active
      setTimeout(() => {
        if (job.status !== 'running') return;
        job.currentStageIndex = i;
        stage.status = 'active';
        document.dispatchEvent(new CustomEvent('dw:inference-progress', {
          detail: { jobId, stageIndex: i, stage: stage.id }
        }));
      }, elapsed);

      elapsed += delays[i];

      // Set stage to complete
      setTimeout(() => {
        if (job.status !== 'running') return;
        stage.status = 'complete';
        stage.duration = delays[i];

        // If last stage, generate results
        if (i === job.stages.length - 1) {
          this._generateDemoResult(jobId).then(() => {
            job.status = 'complete';
            job.endTime = Date.now();
            document.dispatchEvent(new CustomEvent('dw:inference-complete', {
              detail: { jobId, result: job.result }
            }));
          });
        }
      }, elapsed);
    });
  }

  /**
   * Generate demo results from the uploaded image.
   * Creates a simulated DSM from image luminance.
   */
  async _generateDemoResult(jobId) {
    const job = this._jobs.get(jobId);
    const img = this._images.get(job.imageId);

    const result = createEmptyResult();

    // Image info
    result.image = {
      id: img.id,
      filename: img.filename,
      width: img.width,
      height: img.height,
      format: img.format,
      url: img.url,
      fileSize: img.fileSize,
    };

    // Metadata
    const meta = await this.getMetadata(job.imageId);
    result.metadata = {
      resolution: meta.resolution,
      crs: meta.crs,
      georeferenced: meta.georeferenced,
      extent: meta.extent,
      dimensions: { width: img.width, height: img.height },
    };

    // Generate DSM from image luminance
    const dsmSize = 256; // Process at reduced resolution for performance
    const { raster, width, height } = await this._generateDSMFromImage(img.url, dsmSize);

    // Simulate elevation range
    const maxElev = 60 + Math.random() * 60; // 60-120m
    const minElev = 0;

    // Scale raster to elevation range
    const scaledRaster = new Float32Array(raster.length);
    for (let i = 0; i < raster.length; i++) {
      scaledRaster[i] = raster[i] * maxElev;
    }

    result.depth = {
      raster: new Float32Array(raster), // 0-1 normalized
      width,
      height,
      min: 0,
      max: 1,
      normalization: 'relative',
    };

    result.dsm = {
      raster: scaledRaster,
      width,
      height,
      minElevation: minElev,
      maxElevation: maxElev,
      resolution: meta.resolution || 0.5,
      crs: meta.crs || null,
      geotransform: null,
      unit: 'm',
      noDataValue: -9999,
    };

    result.calibration = {
      scale: maxElev,
      offset: 0,
      method: 'demo',
      confidence: 0.0,
    };

    // Simulated metrics
    const meanH = maxElev * 0.15 + Math.random() * maxElev * 0.1;
    result.metrics = {
      maxHeight: parseFloat(maxElev.toFixed(1)),
      meanHeight: parseFloat(meanH.toFixed(1)),
      medianHeight: parseFloat((meanH * 0.8).toFixed(1)),
      buildingCount: Math.floor(200 + Math.random() * 2000),
      areaCovered: parseFloat((0.5 + Math.random() * 4).toFixed(1)),
      mae: null,
      rmse: null,
      correlation: null,
    };

    result.processing = {
      model: { name: job.config.model, version: '1.0-demo' },
      duration: Date.now() - job.startTime,
      status: 'complete',
      progress: 100,
      mode: 'demo',
      stages: job.stages.map(s => ({ ...s })),
      error: null,
    };

    job.result = result;
  }

  /**
   * Generate a simulated DSM raster from image luminance.
   * This is NOT real depth estimation — it's a visualization placeholder.
   */
  async _generateDSMFromImage(imageUrl, targetSize) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const aspect = img.width / img.height;
        const w = aspect >= 1 ? targetSize : Math.round(targetSize * aspect);
        const h = aspect >= 1 ? Math.round(targetSize / aspect) : targetSize;

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        const pixels = ctx.getImageData(0, 0, w, h).data;
        const raster = new Float32Array(w * h);

        // Convert to luminance
        for (let i = 0; i < w * h; i++) {
          const r = pixels[i * 4];
          const g = pixels[i * 4 + 1];
          const b = pixels[i * 4 + 2];
          raster[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        }

        // Apply simple box blur to smooth the "depth"
        const blurred = this._boxBlur(raster, w, h, 3);

        // Apply contrast enhancement
        let min = Infinity, max = -Infinity;
        for (let i = 0; i < blurred.length; i++) {
          if (blurred[i] < min) min = blurred[i];
          if (blurred[i] > max) max = blurred[i];
        }
        const range = max - min || 1;
        for (let i = 0; i < blurred.length; i++) {
          blurred[i] = (blurred[i] - min) / range;
          // Apply slight S-curve for more dramatic DSM look
          blurred[i] = blurred[i] * blurred[i] * (3 - 2 * blurred[i]);
        }

        resolve({ raster: blurred, width: w, height: h });
      };
      img.onerror = () => {
        // Fallback: generate procedural terrain
        const w = targetSize;
        const h = targetSize;
        const raster = new Float32Array(w * h);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            // Simple procedural terrain
            const nx = x / w * 4;
            const ny = y / h * 4;
            raster[y * w + x] = 0.5 + 0.3 * Math.sin(nx * 3.14) * Math.cos(ny * 3.14)
              + 0.2 * Math.sin(nx * 6.28 + 1) * Math.sin(ny * 6.28 + 2);
          }
        }
        resolve({ raster, width: w, height: h });
      };
      img.src = imageUrl;
    });
  }

  /**
   * Simple box blur.
   */
  _boxBlur(data, w, h, radius) {
    const result = new Float32Array(data.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0, count = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
              sum += data[ny * w + nx];
              count++;
            }
          }
        }
        result[y * w + x] = sum / count;
      }
    }
    return result;
  }

  /**
   * Map normalized elevation (0-1) to scientific color ramp.
   * Blue → Cyan → Green → Yellow → Orange → Red
   */
  _elevationToColor(t) {
    t = Math.max(0, Math.min(1, t));
    const stops = [
      [0.0, 0, 102, 255],   // Blue
      [0.2, 0, 204, 204],   // Cyan
      [0.4, 102, 204, 0],   // Green
      [0.6, 255, 204, 0],   // Yellow
      [0.8, 255, 102, 0],   // Orange
      [1.0, 255, 0, 0],     // Red
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
