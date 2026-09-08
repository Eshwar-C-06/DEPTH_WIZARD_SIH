/* ============================================
   DEPTHWIZARD — Image Viewer
   Pan, Zoom, Rotate canvas viewer
   ============================================ */

export class ImageViewer {
  constructor(container) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.container.appendChild(this.canvas);

    this.image = null;
    this.transform = { x: 0, y: 0, scale: 1, rotation: 0 };
    this._isDragging = false;
    this._lastMouse = { x: 0, y: 0 };
    this._rafId = null;

    this._bindEvents();
  }

  /**
   * Load an image from a URL or data URL.
   */
  async loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        this.image = img;
        this.fitToScreen();
        resolve();
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  /**
   * Load from a canvas/imageData for DSM rendering.
   */
  loadFromCanvas(sourceCanvas) {
    this.image = sourceCanvas;
    this.fitToScreen();
  }

  fitToScreen() {
    if (!this.image) return;
    this._resize();

    const scaleX = this.canvas.width / this.image.width;
    const scaleY = this.canvas.height / this.image.height;
    const scale = Math.min(scaleX, scaleY) * 0.9;

    this.transform = {
      x: (this.canvas.width - this.image.width * scale) / 2,
      y: (this.canvas.height - this.image.height * scale) / 2,
      scale,
      rotation: 0,
    };
    this._render();
  }

  zoomIn() {
    this._zoomBy(1.25);
  }

  zoomOut() {
    this._zoomBy(0.8);
  }

  resetView() {
    this.fitToScreen();
  }

  rotate(deg = 90) {
    this.transform.rotation = (this.transform.rotation + deg) % 360;
    this._render();
  }

  getTransform() {
    return { ...this.transform };
  }

  clear() {
    this.image = null;
    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  destroy() {
    this._unbindEvents();
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
  }

  // ───── Private ─────

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
    const { x, y, scale, rotation } = this.transform;

    ctx.clearRect(0, 0, this._logicalWidth, this._logicalHeight);

    // Background
    ctx.fillStyle = '#EAF2FC';
    ctx.fillRect(0, 0, this._logicalWidth, this._logicalHeight);

    if (!this.image) return;

    ctx.save();

    if (rotation) {
      const cx = x + (this.image.width * scale) / 2;
      const cy = y + (this.image.height * scale) / 2;
      ctx.translate(cx, cy);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.translate(-cx, -cy);
    }

    ctx.drawImage(this.image, x, y, this.image.width * scale, this.image.height * scale);
    ctx.restore();
  }

  _zoomBy(factor) {
    const cx = this._logicalWidth / 2;
    const cy = this._logicalHeight / 2;

    const newScale = Math.max(0.1, Math.min(20, this.transform.scale * factor));
    const ratio = newScale / this.transform.scale;

    this.transform.x = cx - ratio * (cx - this.transform.x);
    this.transform.y = cy - ratio * (cy - this.transform.y);
    this.transform.scale = newScale;

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
      const dx = e.clientX - this._lastMouse.x;
      const dy = e.clientY - this._lastMouse.y;
      this._lastMouse = { x: e.clientX, y: e.clientY };
      this.transform.x += dx;
      this.transform.y += dy;
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

      const newScale = Math.max(0.1, Math.min(20, this.transform.scale * factor));
      const ratio = newScale / this.transform.scale;

      this.transform.x = mx - ratio * (mx - this.transform.x);
      this.transform.y = my - ratio * (my - this.transform.y);
      this.transform.scale = newScale;

      this._render();
    };

    this._onResize = () => {
      this._resize();
      this._render();
    };

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
}
