/* ============================================
   DEPTHWIZARD — Workflow Manager
   Drives the workflow bar and processing overlay
   from service status
   ============================================ */

export class WorkflowManager {
  constructor() {
    this._steps = document.querySelectorAll('.workflow-step');
    this._connectors = document.querySelectorAll('.workflow-connector');
    this._pipelineStages = document.querySelectorAll('.pipeline-stage');
    this._overlay = document.getElementById('processing-overlay');
  }

  /**
   * Set the top-level workflow step.
   * Steps: 'upload' (0), 'process' (1), 'visualize' (2), 'export' (3)
   */
  setActiveStep(stepIndex) {
    this._steps.forEach((step, i) => {
      step.classList.remove('active', 'complete', 'pending');
      if (i < stepIndex) {
        step.classList.add('complete');
      } else if (i === stepIndex) {
        step.classList.add('active');
      } else {
        step.classList.add('pending');
      }
    });

    this._connectors.forEach((conn, i) => {
      conn.classList.remove('active', 'complete');
      if (i < stepIndex) {
        conn.classList.add('complete');
      } else if (i === stepIndex) {
        conn.classList.add('active');
      }
    });
  }

  /**
   * Show the processing overlay.
   */
  showProcessing() {
    if (this._overlay) {
      this._overlay.classList.add('visible');
      // Reset all stages
      this._pipelineStages.forEach(stage => {
        stage.classList.remove('active', 'complete');
        stage.classList.add('pending');
      });
    }
  }

  /**
   * Hide the processing overlay.
   */
  hideProcessing() {
    if (this._overlay) {
      this._overlay.classList.remove('visible');
    }
  }

  /**
   * Update processing stages from service status.
   * @param {Array} stages - From getInferenceStatus().stages
   */
  updateProcessingStages(stages) {
    if (!stages) return;

    stages.forEach((stage, i) => {
      const el = this._pipelineStages[i];
      if (!el) return;

      el.classList.remove('pending', 'active', 'complete');
      el.classList.add(stage.status);

      const indicator = el.querySelector('.pipeline-stage-indicator');
      if (indicator) {
        if (stage.status === 'complete') {
          indicator.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        } else if (stage.status === 'active') {
          indicator.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>';
        } else {
          indicator.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/></svg>';
        }
      }
    });
  }
}
