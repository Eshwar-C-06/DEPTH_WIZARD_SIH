/* ============================================
   DEPTHWIZARD — Side-by-Side View
   Split view with draggable divider and
   synchronized pan/zoom
   ============================================ */

export class SideBySideView {
  constructor(container) {
    this.container = container;
    this._splitRatio = 0.5;
    this._isDragging = false;
    this._transform = { x: 0, y: 0, scale: 1 };
    this._isPanning = false;
    this._lastMouse = { x: 0, y: 0 };

    this._aerialImage = null;
    this._dsmCanvas = null;

    this._build();
    this._bindEvents();
  }

  load(aerialImage, dsmCanvas) {
    this._aerialImage = aerialImage;
    this._dsmCanvas = dsmCanvas;
    this._fitToScreen();
  }

  clear() {
    this._aerialImage = null;
    this._dsmCanvas = null;
    if (this._leftCtx && this._leftCanvas) {
      this._leftCtx.clearRect(0, 0, this._leftCanvas.width, this._leftCanvas.height);
    }
    if (this._rightCtx && this._rightCanvas) {
      this._rightCtx.clearRect(0, 0, this._rightCanvas.width, this._rightCanvas.height);
    }
  }

  destroy() {
    this._unbindEvents();
    this.container.innerHTML = '';
  }

  // ───── Build DOM ─────
  _build() {
    this.container.innerHTML = `
      <div class="sbs-left">
        <canvas></canvas>
        <div class="sbs-label">Aerial Image</div>
      </div>
      <div class="sbs-right">
        <canvas></canvas>
        <div class="sbs-label">Estimated Depth</div>
      </div>
      <div class="sbs-divider">
        <div class="sbs-divider-handle">&lt;&gt;</div>
      </div>
    `;

    this._leftPanel = this.container.querySelector('.sbs-left');
    this._rightPanel = this.container.querySelector('.sbs-right');
    this._leftCanvas = this._leftPanel.querySelector('canvas');
    this._rightCanvas = this._rightPanel.querySelector('canvas');
    this._divider = this.container.querySelector('.sbs-divider');
    this._leftCtx = this._leftCanvas.getContext('2d');
    this._rightCtx = this._rightCanvas.getContext('2d');
  }

  _fitToScreen() {
    if (!this._aerialImage || !this._dsmCanvas) return;

    const rect = this.container.getBoundingClientRect();
    const panelW = rect.width * this._splitRatio;
    const panelH = rect.height;

    const scaleX = panelW / this._aerialImage.width;
    const scaleY = panelH / this._aerialImage.height;
    const scale = Math.min(scaleX, scaleY) * 0.85;

    this._transform = {
      x: (panelW - this._aerialImage.width * scale) / 2,
      y: (panelH - this._aerialImage.height * scale) / 2,
      scale,
    };

    this._render();
  }

  _render() {
    requestAnimationFrame(() => this._draw());
  }

  _draw() {
    const rect = this.container.getBoundingClientRect();
    const splitX = rect.width * this._splitRatio;

    // Update layout
    this._leftPanel.style.width = splitX + 'px';
    this._divider.style.left = splitX + 'px';

    // Size canvases
    const dpr = window.devicePixelRatio || 1;
    const leftW = splitX;
    const rightW = rect.width - splitX;
    const h = rect.height;

    this._leftCanvas.width = leftW * dpr;
    this._leftCanvas.height = h * dpr;
    this._leftCanvas.style.width = leftW + 'px';
    this._leftCanvas.style.height = h + 'px';

    this._rightCanvas.width = rightW * dpr;
    this._rightCanvas.height = h * dpr;
    this._rightCanvas.style.width = rightW + 'px';
    this._rightCanvas.style.height = h + 'px';

    this._leftCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._rightCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Clear
    this._leftCtx.fillStyle = '#EAF2FC';
    this._leftCtx.fillRect(0, 0, leftW, h);
    this._rightCtx.fillStyle = '#0A0F1A';
    this._rightCtx.fillRect(0, 0, rightW, h);

    const { x, y, scale } = this._transform;

    // Draw aerial
    if (this._aerialImage) {
      this._leftCtx.drawImage(
        this._aerialImage,
        x, y,
        this._aerialImage.width * scale,
        this._aerialImage.height * scale
      );
    }

    // Draw DSM — offset by the same transform relative to right panel
    if (this._dsmCanvas) {
      // Scale DSM to match aerial dimensions
      const dsmScaleX = (this._aerialImage ? this._aerialImage.width : this._dsmCanvas.width) / this._dsmCanvas.width;
      const dsmScaleY = (this._aerialImage ? this._aerialImage.height : this._dsmCanvas.height) / this._dsmCanvas.height;

      this._rightCtx.drawImage(
        this._dsmCanvas,
        x, y,
        this._dsmCanvas.width * dsmScaleX * scale,
        this._dsmCanvas.height * dsmScaleY * scale
      );
    }
  }

  // ───── Events ─────
  _bindEvents() {
    // Divider drag
    this._onDividerDown = (e) => {
      e.preventDefault();
      this._isDragging = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    };

    this._onDividerMove = (e) => {
      if (!this._isDragging) return;
      const rect = this.container.getBoundingClientRect();
      this._splitRatio = Math.max(0.2, Math.min(0.8, (e.clientX - rect.left) / rect.width));
      this._render();
    };

    this._onDividerUp = () => {
      if (!this._isDragging) return;
      this._isDragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    // Pan
    this._onPanDown = (e) => {
      if (this._isDragging) return;
      if (e.target.closest('.sbs-divider')) return;
      this._isPanning = true;
      this._lastMouse = { x: e.clientX, y: e.clientY };
      this.container.style.cursor = 'grabbing';
    };

    this._onPanMove = (e) => {
      if (!this._isPanning) return;
      this._transform.x += e.clientX - this._lastMouse.x;
      this._transform.y += e.clientY - this._lastMouse.y;
      this._lastMouse = { x: e.clientX, y: e.clientY };
      this._render();
    };

    this._onPanUp = () => {
      this._isPanning = false;
      this.container.style.cursor = 'grab';
    };

    // Zoom (synced)
    this._onWheel = (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const rect = this.container.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      // Zoom relative to left panel for consistency
      const localMx = mx < rect.width * this._splitRatio ? mx : mx - rect.width * (1 - this._splitRatio);

      const newScale = Math.max(0.1, Math.min(20, this._transform.scale * factor));
      const ratio = newScale / this._transform.scale;
      this._transform.x = mx - ratio * (mx - this._transform.x);
      this._transform.y = my - ratio * (my - this._transform.y);
      this._transform.scale = newScale;
      this._render();
    };

    this._onResize = () => this._render();

    this._divider.addEventListener('mousedown', this._onDividerDown);
    this.container.addEventListener('mousedown', this._onPanDown);
    window.addEventListener('mousemove', (e) => { this._onDividerMove(e); this._onPanMove(e); });
    window.addEventListener('mouseup', () => { this._onDividerUp(); this._onPanUp(); });
    this.container.addEventListener('wheel', this._onWheel, { passive: false });
    window.addEventListener('resize', this._onResize);
  }

  _unbindEvents() {
    window.removeEventListener('resize', this._onResize);
  }
}
