/* ============================================
   DEPTHWIZARD — Configuration
   
   Single configuration point for backend URL
   and application mode.
   ============================================ */

export const CONFIG = {
  /** Backend API base URL (no trailing slash) */
  BACKEND_URL: 'http://127.0.0.1:8000',

  /**
   * Application mode:
   *   'live' — real Depth Anything V2 inference via backend
   *   'demo' — mock/simulated inference (development fallback)
   */
  MODE: 'live',
};
