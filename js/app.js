/* ============================================
   DEPTHWIZARD — Application Controller
   
   Main orchestrator. Manages state, creates
   service, wires all modules together.
   ============================================ */

import { createInferenceService } from './services/inference-service.js';
import { CONFIG } from './config.js';
import { ImageViewer } from './viewer.js';
import { DSMRenderer } from './dsm-renderer.js';
import { SideBySideView } from './side-by-side.js';
import { ThreeViewer } from './three-viewer.js';
import { WorkflowManager } from './workflow.js';
import { UploadManager } from './upload.js';
import { ExportManager } from './export.js';

class DepthWizardApp {
  constructor() {
    // ── Service Layer ──
    this.service = createInferenceService(CONFIG.MODE);

    // ── Single Authoritative Image & App State ──
    this.state = {
      phase: 'idle',        // idle | image_loaded | processing | results_ready | error
      activeTab: 'aerial',  // aerial | dsm | sbs | 3d
      imageId: null,
      jobId: null,
      result: null,
      processingInterval: null,
    };

    this.currentFile = null;
    this._currentImageUrl = null;
    this._currentAerialImage = null;

    // ── UI Modules ──
    this.workflow = null;
    this.uploadManager = null;
    this.exportManager = null;
    this.aerialViewer = null;
    this.dsmRenderer = null;
    this.sbsView = null;
    this.threeViewer = null;
  }

  async init() {
    // ── Initialize Modules ──
    this.workflow = new WorkflowManager();
    this.workflow.setActiveStep(0);

    // Upload Manager
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('file-input');
    this.uploadManager = new UploadManager(dropzone, fileInput);
    this.uploadManager.onFileSelected = (file) => this._handleUpload(file, false);

    // Export Manager
    this.exportManager = new ExportManager(this.service);

    // Viewers
    const aerialContainer = document.getElementById('view-aerial-canvas');
    this.aerialViewer = new ImageViewer(aerialContainer);

    const dsmContainer = document.getElementById('view-dsm-canvas');
    this.dsmRenderer = new DSMRenderer(dsmContainer);

    const sbsContainer = document.getElementById('view-sbs-canvas');
    this.sbsView = new SideBySideView(sbsContainer);

    const threeContainer = document.getElementById('view-3d-canvas');
    this.threeViewer = new ThreeViewer(threeContainer);
    await this.threeViewer.init();

    // ── Bind UI Events ──
    this._bindTabEvents();
    this._bindToolbarEvents();
    this._bindControlPanelEvents();
    this._bindExportEvents();
    this._bindExampleEvents();
    this._bindServiceEvents();
    this._bindMiscEvents();

    // ── Set initial state ──
    this._updateUI();
    this._updateModeBadge();

    // ── Health check for live mode ──
    if (this.service.getMode() === 'live') {
      this._checkBackendHealth();
    }

    console.log(`[DepthWizard] Initialized in ${this.service.getMode().toUpperCase()} mode`);
  }

  // ═══════════════════════════════════════════
  // Unified Image Ingestion Flow
  // ═══════════════════════════════════════════

  async _handleUpload(file, isExample = false) {
    if (!file) return;

    try {
      // 1. Clean previous state & visualizations
      this._clearPreviousResults();
      this.currentFile = file;

      // Update example selection styling
      if (!isExample) {
        document.querySelectorAll('.example-item').forEach(item => item.classList.remove('selected'));
      }

      // 2. Ingest through inference service
      const { imageId, metadata } = await this.service.uploadImage(file);
      this.state.imageId = imageId;

      // 3. Validate image
      const validation = await this.service.validateImage(imageId);
      if (!validation.valid) {
        this._showError(validation.issues.join('. '));
        return;
      }

      // 4. Retrieve full metadata & update inspector panel
      const fullMeta = await this.service.getMetadata(imageId);
      UploadManager.updateMetadataDisplay(
        document.getElementById('metadata-display'),
        fullMeta
      );

      // 5. Create object URL & render into Aerial viewer
      if (this._currentImageUrl && this._currentImageUrl.startsWith('blob:')) {
        URL.revokeObjectURL(this._currentImageUrl);
      }
      const imgUrl = URL.createObjectURL(file);
      await this.aerialViewer.loadImage(imgUrl);

      this._currentImageUrl = imgUrl;
      this._currentAerialImage = this.aerialViewer.image;

      // 6. Set state to image_loaded and ready for inference
      this.state.activeTab = 'aerial';
      this._setPhase('image_loaded');
      this.workflow.setActiveStep(0);

    } catch (err) {
      console.error('[DepthWizard] Upload failed:', err);
      this._showError('Failed to load image. Please try again.');
    }
  }

  _clearPreviousResults() {
    if (this.state.processingInterval) {
      clearInterval(this.state.processingInterval);
      this.state.processingInterval = null;
    }

    this.state.jobId = null;
    this.state.result = null;

    if (this.dsmRenderer) this.dsmRenderer.clear();
    if (this.threeViewer) this.threeViewer.clearTerrain();
    if (this.sbsView) this.sbsView.clear();

    // Reset metric indicators
    this._resetMetricsDisplay();

    // Reset tab selections to aerial
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === 'aerial');
    });
  }

  _resetMetricsDisplay() {
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    set('metric-max-height', '—');
    set('metric-mean-height', '—');
    set('metric-buildings', '—');
    set('metric-area', '—');
  }

  // ═══════════════════════════════════════════
  // Inference Flow
  // ═══════════════════════════════════════════

  async _runInference() {
    // Prevent double submission or execution without valid image
    if (this.state.phase === 'processing' || !this.state.imageId) return;

    const enhanceToggle = document.getElementById('toggle-enhance');
    const vegToggle = document.getElementById('toggle-vegetation');

    const config = {
      model: document.getElementById('model-select').value,
      output: document.getElementById('output-select').value,
      enhanceBuildings: enhanceToggle ? enhanceToggle.classList.contains('active') : false,
      removeVegetation: vegToggle ? vegToggle.classList.contains('active') : false,
    };

    try {
      this._setPhase('processing');
      this.workflow.setActiveStep(1);
      this.workflow.showProcessing();

      const { jobId } = await this.service.runInference(this.state.imageId, config);
      this.state.jobId = jobId;
      this.exportManager.setJobId(jobId);

      // Poll for progress stages
      this.state.processingInterval = setInterval(async () => {
        const status = await this.service.getInferenceStatus(jobId);
        if (status && status.stages) {
          this.workflow.updateProcessingStages(status.stages);
        }
      }, 150);

    } catch (err) {
      console.error('[DepthWizard] Inference failed:', err);
      this._showError('Processing failed. Please try again.');
    }
  }

  async _onInferenceComplete(result) {
    if (this.state.processingInterval) {
      clearInterval(this.state.processingInterval);
      this.state.processingInterval = null;
    }
    this.state.result = result;

    // Load DSM heatmap
    if (result.dsm) {
      this.dsmRenderer.loadDSM(result.dsm);
    }

    // Load Side-by-Side view
    if (this._currentAerialImage && this.dsmRenderer.getRenderedCanvas()) {
      this.sbsView.load(this._currentAerialImage, this.dsmRenderer.getRenderedCanvas());
    }

    // Load 3D Terrain view
    if (this._currentImageUrl && result.dsm) {
      await this.threeViewer.loadTerrain(this._currentImageUrl, result.dsm);
    }

    // Update metrics and legend
    this._updateMetrics(result.metrics);
    this._updateDSMLegend(result.dsm.minElevation, result.dsm.maxElevation);

    // Switch tab to Estimated Depth for immediate gratification
    this.state.activeTab = 'dsm';
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === 'dsm');
    });

    this._setPhase('results_ready');
    this.workflow.hideProcessing();
    this.workflow.setActiveStep(2);
  }

  // ═══════════════════════════════════════════
  // UI State & View Synchronization
  // ═══════════════════════════════════════════

  _setPhase(phase) {
    this.state.phase = phase;
    this._updateUI();
  }

  _updateUI() {
    const { phase, activeTab } = this.state;
    const emptyState = document.getElementById('empty-state');
    const errorState = document.getElementById('error-state');
    const runBtn = document.getElementById('btn-run-inference');
    const runText = document.getElementById('btn-run-text');
    const exportBtns = document.querySelectorAll('.btn-export');
    const tabBtns = document.querySelectorAll('.tab-btn');
    const resultsMetrics = document.querySelector('.results-metrics');

    // Empty state visibility
    if (emptyState) {
      emptyState.classList.toggle('hidden', phase !== 'idle');
    }

    // Error state visibility
    if (errorState) {
      errorState.classList.toggle('visible', phase === 'error');
    }

    // Run inference button states
    if (runBtn) {
      const isProcessing = phase === 'processing';
      const isReady = phase === 'image_loaded' || phase === 'results_ready';

      runBtn.disabled = !isReady || isProcessing;
      if (runText) {
        runText.textContent = isProcessing ? 'Processing Depth...' : 'Run Inference';
      }
    }

    // Export buttons
    exportBtns.forEach(btn => {
      btn.disabled = phase !== 'results_ready';
    });

    // Tabs availability
    tabBtns.forEach(btn => {
      const tab = btn.dataset.tab;
      if (tab !== 'aerial') {
        btn.disabled = phase !== 'results_ready';
      } else {
        btn.disabled = false;
      }
      btn.classList.toggle('active', tab === activeTab);
    });

    // Metrics panel opacity
    if (resultsMetrics) {
      resultsMetrics.style.opacity = phase === 'results_ready' ? '1' : '0.35';
    }

    // Show/hide view containers
    document.querySelectorAll('.view-aerial, .view-dsm, .view-sbs, .view-3d').forEach(v => {
      v.classList.remove('active');
    });
    const activeView = document.querySelector(`.view-${activeTab}`);
    if (activeView) activeView.classList.add('active');

    // DSM legend visibility
    const legend = document.getElementById('dsm-legend');
    if (legend) {
      legend.style.display = (activeTab === 'dsm' || activeTab === 'sbs') && phase === 'results_ready' ? 'flex' : 'none';
    }

    // Scale bar visibility
    const scaleBar = document.getElementById('scale-bar');
    if (scaleBar) {
      scaleBar.style.display = (activeTab === 'aerial' || activeTab === 'sbs') && phase !== 'idle' ? 'flex' : 'none';
    }
  }

  // ═══════════════════════════════════════════
  // Event Bindings
  // ═══════════════════════════════════════════

  _bindTabEvents() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.state.activeTab = btn.dataset.tab;
        this._updateUI();

        // Resize viewer after tab switch
        setTimeout(() => {
          if (this.state.activeTab === 'aerial' && this.aerialViewer) this.aerialViewer.fitToScreen();
          if (this.state.activeTab === 'dsm' && this.dsmRenderer) this.dsmRenderer.fitToScreen();
          if (this.state.activeTab === '3d' && this.threeViewer) this.threeViewer.resize();
        }, 50);
      });
    });
  }

  _bindToolbarEvents() {
    const bind = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', fn);
    };

    bind('tool-zoom-in', () => this._activeViewerAction('zoomIn'));
    bind('tool-zoom-out', () => this._activeViewerAction('zoomOut'));
    bind('tool-rotate', () => this._activeViewerAction('rotate'));
    bind('tool-reset', () => this._activeViewerAction('resetView'));
    bind('tool-fit', () => this._activeViewerAction('fitToScreen'));

    bind('tool-fullscreen', () => {
      const container = document.querySelector('.viz-container');
      if (container) container.classList.toggle('fullscreen');
      setTimeout(() => {
        this._activeViewerAction('fitToScreen');
        if (this.threeViewer) this.threeViewer.resize();
      }, 100);
    });
  }

  _activeViewerAction(action) {
    const tab = this.state.activeTab;
    if (tab === 'aerial' && this.aerialViewer && this.aerialViewer[action]) this.aerialViewer[action]();
    if (tab === 'dsm' && this.dsmRenderer && this.dsmRenderer[action]) this.dsmRenderer[action]();
    if (tab === '3d' && this.threeViewer) {
      if (action === 'resetView' || action === 'fitToScreen') this.threeViewer.resetCamera();
    }
  }

  _bindControlPanelEvents() {
    // Collapsible accordion headers (full row clickable & keyboard accessible)
    document.querySelectorAll('.panel-section-header').forEach(header => {
      const toggleSection = (e) => {
        e.preventDefault();
        const section = header.closest('.panel-section');
        if (!section) return;
        const isOpen = section.classList.toggle('open');
        header.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      };

      header.addEventListener('click', toggleSection);
      header.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          toggleSection(e);
        }
      });
    });

    // Toggle switch interaction (row and track clicks)
    const bindToggle = (rowId, trackId) => {
      const row = document.getElementById(rowId);
      const track = document.getElementById(trackId);
      if (!track) return;

      const toggleAction = (e) => {
        // Prevent double toggle when clicking button inside row
        if (e.target.closest('.toggle-help')) return;
        const isActive = track.classList.toggle('active');
        track.setAttribute('aria-checked', isActive ? 'true' : 'false');
      };

      if (row) row.addEventListener('click', toggleAction);
      else track.addEventListener('click', toggleAction);
    };

    bindToggle('toggle-enhance-row', 'toggle-enhance');
    bindToggle('toggle-vegetation-row', 'toggle-vegetation');

    // Run Inference button
    const runBtn = document.getElementById('btn-run-inference');
    if (runBtn) {
      runBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this._runInference();
      });
    }

    // Upload Image button
    const uploadBtn = document.getElementById('btn-upload-image');
    if (uploadBtn) {
      uploadBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const fileInput = document.getElementById('file-input');
        if (fileInput) fileInput.click();
      });
    }
  }

  _bindExportEvents() {
    const bind = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', fn);
    };

    bind('export-dsm', () => this.exportManager.downloadDSM());
    bind('export-3d', () => this.exportManager.downloadMesh());
    bind('export-report', () => this.exportManager.downloadReport());
  }

  _bindExampleEvents() {
    document.querySelectorAll('.example-item').forEach(item => {
      item.addEventListener('click', async (e) => {
        e.preventDefault();
        const src = item.dataset.src;
        if (!src) return;

        // Highlight selected example card
        document.querySelectorAll('.example-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');

        try {
          const response = await fetch(src);
          if (!response.ok) throw new Error(`HTTP ${response.status} loading ${src}`);
          const blob = await response.blob();
          const filename = src.split('/').pop() || 'example.jpg';
          const file = new File([blob], filename, { type: blob.type || 'image/jpeg' });
          await this._handleUpload(file, true);
        } catch (err) {
          console.error('[DepthWizard] Failed to load example:', err);
          this._showError(`Failed to load example (${src}).`);
        }
      });
    });

    // Empty state example links
    document.querySelectorAll('.empty-example-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const src = link.dataset.src;
        if (src) {
          const item = document.querySelector(`.example-item[data-src="${src}"]`);
          if (item) item.click();
        }
      });
    });
  }

  _bindServiceEvents() {
    document.addEventListener('dw:inference-complete', (e) => {
      const { result } = e.detail;
      this._onInferenceComplete(result);
    });

    document.addEventListener('dw:inference-error', (e) => {
      if (this.state.processingInterval) {
        clearInterval(this.state.processingInterval);
        this.state.processingInterval = null;
      }
      this.workflow.hideProcessing();
      this._showError(e.detail.error || 'Inference failed.');
    });

    document.addEventListener('dw:upload-error', (e) => {
      this._showError(e.detail.message || 'Invalid file format.');
    });
  }

  _bindMiscEvents() {
    // New Project button
    const newProjectBtn = document.getElementById('btn-new-project');
    if (newProjectBtn) {
      newProjectBtn.addEventListener('click', () => {
        this._resetApplication();
      });
    }

    // Error retry button
    const retryBtn = document.getElementById('btn-retry');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        if (this.state.imageId) {
          this._setPhase('image_loaded');
        } else {
          this._setPhase('idle');
        }
      });
    }

    // Nav rail
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        item.classList.add('active');
      });
    });

    // 3D camera controls
    const bind3D = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', fn);
    };
    bind3D('three-top-view', () => this.threeViewer && this.threeViewer.setTopView());
    bind3D('three-perspective', () => this.threeViewer && this.threeViewer.setPerspectiveView());
    bind3D('three-wireframe', () => {
      if (!this.threeViewer) return;
      const isWire = this.threeViewer.toggleWireframe();
      const btn = document.getElementById('three-wireframe');
      if (btn) btn.classList.toggle('active', isWire);
    });
    bind3D('three-reset', () => this.threeViewer && this.threeViewer.resetCamera());
  }

  // ═══════════════════════════════════════════
  // Metrics & Visual Feedback Helpers
  // ═══════════════════════════════════════════

  _updateMetrics(metrics) {
    if (!metrics) return;

    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };

    const isLive = this.service.getMode() === 'live';

    if (isLive) {
      // Phase 1: Show relative depth stats
      set('metric-max-height', metrics.maxDepth != null ? metrics.maxDepth.toFixed(3) : '—');
      set('metric-mean-height', metrics.meanDepth != null ? metrics.meanDepth.toFixed(3) : '—');
      set('metric-buildings', metrics.depthRange != null ? metrics.depthRange.toFixed(3) : '—');
      set('metric-area', `${metrics.depthRange != null ? '0 – 1' : '—'}`);
    } else {
      // Demo mode: mock metric DSM display
      set('metric-max-height', metrics.maxHeight != null ? metrics.maxHeight.toFixed(1) + ' m' : '—');
      set('metric-mean-height', metrics.meanHeight != null ? metrics.meanHeight.toFixed(1) + ' m' : '—');
      set('metric-buildings', metrics.buildingCount != null ? metrics.buildingCount.toLocaleString() : '—');
      set('metric-area', metrics.areaCovered != null ? metrics.areaCovered.toFixed(1) + ' km²' : '—');
    }
  }

  _updateDSMLegend(minElev, maxElev) {
    const labels = document.querySelectorAll('.dsm-legend-label');
    if (labels.length >= 5) {
      const isLive = this.service.getMode() === 'live';
      if (isLive) {
        labels[0].textContent = '1.0';
        labels[1].textContent = '0.75';
        labels[2].textContent = '0.50';
        labels[3].textContent = '0.25';
        labels[4].textContent = '0.0';
      } else {
        const range = maxElev - minElev;
        labels[0].textContent = Math.round(maxElev);
        labels[1].textContent = Math.round(minElev + range * 0.75);
        labels[2].textContent = Math.round(minElev + range * 0.5);
        labels[3].textContent = Math.round(minElev + range * 0.25);
        labels[4].textContent = Math.round(minElev);
      }
    }
  }

  _showError(message) {
    const errorDesc = document.querySelector('.error-desc');
    if (errorDesc) errorDesc.textContent = message;
    this._setPhase('error');
  }

  _updateModeBadge() {
    const badge = document.getElementById('mode-badge');
    if (!badge) return;
    const isLive = this.service.getMode() === 'live';
    badge.textContent = isLive ? 'Live — Depth Anything V2' : 'Demo Mode';
    badge.classList.toggle('live', isLive);
  }

  async _checkBackendHealth() {
    try {
      const resp = await fetch(`${CONFIG.BACKEND_URL}/health`);
      const data = await resp.json();
      if (data.status === 'ok' && data.model_loaded) {
        console.log('[DepthWizard] Backend connected:', data.model, '/', data.device);
      } else {
        console.warn('[DepthWizard] Backend health check returned:', data);
      }
    } catch (err) {
      console.warn('[DepthWizard] Backend not reachable — inference will fallback if necessary.');
    }
  }

  _resetApplication() {
    this._clearPreviousResults();
    this.currentFile = null;
    this.state.phase = 'idle';
    this.state.imageId = null;

    if (this._currentImageUrl && this._currentImageUrl.startsWith('blob:')) {
      URL.revokeObjectURL(this._currentImageUrl);
    }
    this._currentImageUrl = null;
    this._currentAerialImage = null;

    if (this.aerialViewer) this.aerialViewer.clear();

    // Reset example cards selection
    document.querySelectorAll('.example-item').forEach(i => i.classList.remove('selected'));

    // Reset metadata display
    const meta = document.getElementById('metadata-display');
    if (meta) {
      meta.classList.remove('visible');
      meta.innerHTML = '';
    }

    this.workflow.setActiveStep(0);
    this._updateUI();
  }
}

// ── Initialize on DOM ready ──
document.addEventListener('DOMContentLoaded', () => {
  const app = new DepthWizardApp();
  app.init();
  window.__depthWizard = app; // For debugging
});
