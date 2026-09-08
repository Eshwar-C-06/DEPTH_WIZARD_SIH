/* ============================================
   DEPTHWIZARD — DSM Renderer
   Renders elevation raster to canvas using
   scientific color ramp.
   
   Consumes InferenceResult.dsm — does NOT
   generate its own DSM data.
   ============================================ */

export class DSMRenderer {
  constructor(container) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.container.appendChild(this.canvas);

    this._dsmData = null;
    this._transform = { x: 0, y: 0, scale: 1, rotation: 0 };
    this._isDragging = false;
    this._lastMouse = { x: 0, y: 0 };
    this._rafId = null;
    this._dsmCanvas = null; // Pre-rendered DSM image

    this._bindEvents();
  }

  /**
   * Load DSM data from InferenceResult.dsm
   */
  loadDSM(dsmData) {
    this._dsmData = dsmData;
    this._renderDSMToOffscreen();
    this.fitToScreen();
  }

  getRenderedCanvas() {
    return this._dsmCanvas;
  }

  clear() {
    this._dsmData = null;
    this._dsmCanvas = null;
    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  fitToScreen() {
    if (!this._dsmCanvas) return;
    this._resize();

    const scaleX = this._logicalWidth / this._dsmCanvas.width;
    const scaleY = this._logicalHeight / this._dsmCanvas.height;
    const scale = Math.min(scaleX, scaleY) * 0.9;

    this._transform = {
      x: (this._logicalWidth - this._dsmCanvas.width * scale) / 2,
      y: (this._logicalHeight - this._dsmCanvas.height * scale) / 2,
      scale,
      rotation: 0,
    };
    this._render();
  }

  zoomIn() { this._zoomBy(1.25); }
  zoomOut() { this._zoomBy(0.8); }
  resetView() { this.fitToScreen(); }
  rotate(deg = 90) { this._transform.rotation = (this._transform.rotation + deg) % 360; this._render(); }

  getTransform() { return { ...this._transform }; }
  setTransform(t) { this._transform = { ...t }; this._render(); }

  getMinElevation() { return this._dsmData ? this._dsmData.minElevation : 0; }
  getMaxElevation() { return this._dsmData ? this._dsmData.maxElevation : 100; }

  destroy() {
    this._unbindEvents();
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
  }

  // ───── Private ─────

  _renderDSMToOffscreen() {
    if (!this._dsmData || !this._dsmData.raster) return;

    const { raster, width, height, minElevation, maxElevation } = this._dsmData;
    this._dsmCanvas = document.createElement('canvas');
    this._dsmCanvas.width = width;
    this._dsmCanvas.height = height;
    const ctx = this._dsmCanvas.getContext('2d');
    const imageData = ctx.createImageData(width, height);

    const range = maxElevation - minElevation || 1;

    for (let i = 0; i < raster.length; i++) {
      const val = raster[i];
      if (val === this._dsmData.noDataValue) {
        imageData.data[i * 4 + 3] = 0; // Transparent for nodata
        continue;
      }
      const norm = Math.max(0, Math.min(1, (val - minElevation) / range));
      const [r, g, b] = DSMRenderer.elevationToColor(norm);
      imageData.data[i * 4] = r;
      imageData.data[i * 4 + 1] = g;
      imageData.data[i * 4 + 2] = b;
      imageData.data[i * 4 + 3] = 255;
    }

    ctx.putImageData(imageData, 0, 0);
  }

  _resize() {
    const rect = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._logicalWidth = rect.width;
    this._logicalHeight = rect.height;
  }

  _render() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = requestAnimationFrame(() => this._draw());
  }

  _draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this._logicalWidth, this._logicalHeight);
    ctx.fillStyle = '#0A0F1A';
    ctx.fillRect(0, 0, this._logicalWidth, this._logicalHeight);

    if (!this._dsmCanvas) return;

    const { x, y, scale, rotation } = this._transform;
    ctx.save();

    if (rotation) {
      const cx = x + (this._dsmCanvas.width * scale) / 2;
      const cy = y + (this._dsmCanvas.height * scale) / 2;
      ctx.translate(cx, cy);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.translate(-cx, -cy);
    }

    // Use nearest-neighbor for scientific accuracy
    ctx.imageSmoothingEnabled = scale > 2 ? false : true;
    ctx.drawImage(this._dsmCanvas, x, y, this._dsmCanvas.width * scale, this._dsmCanvas.height * scale);
    ctx.restore();
  }

  _zoomBy(factor) {
    const cx = this._logicalWidth / 2;
    const cy = this._logicalHeight / 2;
    const newScale = Math.max(0.1, Math.min(20, this._transform.scale * factor));
    const ratio = newScale / this._transform.scale;
    this._transform.x = cx - ratio * (cx - this._transform.x);
    this._transform.y = cy - ratio * (cy - this._transform.y);
    this._transform.scale = newScale;
    this._render();
  }

  _bindEvents() {
    this._onMouseDown = (e) => {
      if (e.button !== 0) return;
      this._isDragging = true;
      this._lastMouse = { x: e.clientX, y: e.clientY };
      this.container.style.cursor = 'grabbing';
    };
    this._onMouseMove = (e) => {
      if (!this._isDragging) return;
      this._transform.x += e.clientX - this._lastMouse.x;
      this._transform.y += e.clientY - this._lastMouse.y;
      this._lastMouse = { x: e.clientX, y: e.clientY };
      this._render();
    };
    this._onMouseUp = () => {
      this._isDragging = false;
      this.container.style.cursor = 'grab';
    };
    this._onWheel = (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const rect = this.container.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const newScale = Math.max(0.1, Math.min(20, this._transform.scale * factor));
      const ratio = newScale / this._transform.scale;
      this._transform.x = mx - ratio * (mx - this._transform.x);
      this._transform.y = my - ratio * (my - this._transform.y);
      this._transform.scale = newScale;
      this._render();
    };
    this._onResize = () => { this._resize(); this._render(); };

    this.container.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mouseup', this._onMouseUp);
    this.container.addEventListener('wheel', this._onWheel, { passive: false });
    window.addEventListener('resize', this._onResize);
  }

  _unbindEvents() {
    this.container.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mouseup', this._onMouseUp);
    this.container.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('resize', this._onResize);
  }

  /**
   * Scientific color ramp: Blue → Cyan → Green → Yellow → Orange → Red
   * @param {number} t - Normalized value 0-1
   * @returns {number[]} [r, g, b]
   */
  static elevationToColor(t) {
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
}
