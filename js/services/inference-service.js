/* ============================================
   DEPTHWIZARD — Inference Service
   
   Service interface + factory.
   The UI ONLY interacts with this abstraction.
   
   To switch from demo → live:
   Change CONFIG.MODE to 'live' in js/config.js
   ============================================ */

import { MockInferenceService } from './mock-inference.js';
import { BackendInferenceService } from './backend-inference.js';
import { CONFIG } from '../config.js';

/**
 * Factory function — creates the appropriate service implementation.
 * @param {'demo'|'live'} mode
 * @param {Object} config - Optional configuration (e.g., API base URL)
 * @returns {InferenceServiceInterface}
 */
export function createInferenceService(mode = CONFIG.MODE, config = {}) {
  switch (mode) {
    case 'demo':
      return new MockInferenceService(config);

    case 'live':
      return new BackendInferenceService(config);

    default:
      console.warn(`[DepthWizard] Unknown service mode: "${mode}". Falling back to demo.`);
      return new MockInferenceService(config);
  }
}

/**
 * @typedef {Object} InferenceServiceInterface
 * 
 * Every service implementation must provide these methods:
 * 
 * @property {function(File): Promise<{imageId: string, metadata: Object}>} uploadImage
 *   Upload an image file. Returns an image ID and extracted metadata.
 * 
 * @property {function(string): Promise<{valid: boolean, issues: string[], imageInfo: Object}>} validateImage
 *   Validate an uploaded image by its ID.
 * 
 * @property {function(string): Promise<Object>} getMetadata
 *   Get detailed metadata for an uploaded image.
 * 
 * @property {function(string, Object): Promise<{jobId: string}>} runInference
 *   Start inference on an image with the given config.
 * 
 * @property {function(string): Promise<{stage: string, progress: number, stages: Array}>} getInferenceStatus
 *   Poll the status of an inference job.
 * 
 * @property {function(string): Promise<Object>} getDepthResult
 *   Get the depth estimation result for a completed job.
 * 
 * @property {function(string): Promise<Object>} getDSMResult
 *   Get the DSM result for a completed job.
 * 
 * @property {function(string): Promise<Object>} getMetrics
 *   Get computed metrics for a completed job.
 * 
 * @property {function(string, string): Promise<Blob>} exportDSM
 *   Export DSM in the specified format. Returns a downloadable Blob.
 * 
 * @property {function(string, string): Promise<Blob>} exportMesh
 *   Export 3D mesh in the specified format. Returns a downloadable Blob.
 * 
 * @property {function(string): Promise<Blob>} exportReport
 *   Export analysis report. Returns a downloadable Blob.
 * 
 * @property {function(): string} getMode
 *   Returns 'demo' or 'live'.
 * 
 * @property {function(): void} dispose
 *   Clean up resources.
 */
