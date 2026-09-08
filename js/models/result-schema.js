/* ============================================
   DEPTHWIZARD — InferenceResult Schema
   
   Standardized result structure consumed by
   ALL UI components. The UI never accesses
   raw backend data directly — it only reads
   this standardized object.
   
   When the real backend is integrated, it must
   return data conforming to this schema.
   ============================================ */

/**
 * Creates an empty InferenceResult with all fields initialized.
 * Used as the default state before any processing.
 */
export function createEmptyResult() {
  return {
    image: {
      id: null,
      filename: '',
      width: 0,
      height: 0,
      format: '',
      url: null,            // Object URL or data URL of the source image
      fileSize: 0,
    },
    metadata: {
      resolution: null,     // meters per pixel (null if unknown)
      crs: null,            // e.g. "EPSG:4326" (null if non-georeferenced)
      georeferenced: false,
      extent: null,         // { minX, minY, maxX, maxY } in CRS units
      dimensions: { width: 0, height: 0 },
    },
    depth: {
      raster: null,         // Float32Array — relative depth values
      width: 0,
      height: 0,
      min: 0,
      max: 0,
      normalization: 'relative', // 'relative' | 'metric'
    },
    dsm: {
      raster: null,         // Float32Array — elevation values
      width: 0,
      height: 0,
      minElevation: 0,
      maxElevation: 0,
      resolution: null,     // meters per pixel
      crs: null,
      geotransform: null,   // [originX, pixelW, 0, originY, 0, pixelH]
      unit: 'm',
      noDataValue: -9999,
    },
    calibration: {
      scale: 1.0,
      offset: 0.0,
      method: 'none',       // 'none' | 'gsd' | 'reference' | 'manual'
      confidence: 0.0,
    },
    metrics: {
      maxHeight: null,
      meanHeight: null,
      medianHeight: null,
      buildingCount: null,
      areaCovered: null,    // in km²
      mae: null,
      rmse: null,
      correlation: null,
    },
    processing: {
      model: { name: '', version: '' },
      duration: 0,          // ms
      status: 'idle',       // 'idle' | 'uploading' | 'processing' | 'complete' | 'error'
      progress: 0,          // 0-100
      mode: 'demo',         // 'demo' | 'live'
      stages: [],           // Array of { name, status, duration, description }
      error: null,          // Error message if status === 'error'
    },
  };
}

/**
 * Creates the default processing stages representing the real pipeline.
 * Stage statuses: 'pending' | 'active' | 'complete' | 'error'
 */
export function createProcessingStages() {
  return [
    {
      id: 'validation',
      name: 'Image Validation',
      description: 'Checking format, resolution, and metadata',
      status: 'pending',
      duration: 0,
    },
    {
      id: 'preprocessing',
      name: 'Preprocessing',
      description: 'Normalizing and preparing input',
      status: 'pending',
      duration: 0,
    },
    {
      id: 'depth',
      name: 'Depth Estimation',
      description: 'Running Depth Anything V2 inference',
      status: 'pending',
      duration: 0,
    },
    {
      id: 'normalization',
      name: 'Depth Normalization',
      description: 'Normalizing relative depth output',
      status: 'pending',
      duration: 0,
    },
    {
      id: 'preparation',
      name: 'Result Preparation',
      description: 'Preparing raster for visualization',
      status: 'pending',
      duration: 0,
    },
    {
      id: 'visualization',
      name: '3D Visualization',
      description: 'Generating 3D depth surface',
      status: 'pending',
      duration: 0,
    },
  ];
}

/**
 * Validates that a result object conforms to the expected schema.
 * Returns { valid: boolean, issues: string[] }
 */
export function validateResult(result) {
  const issues = [];

  if (!result) {
    return { valid: false, issues: ['Result is null or undefined'] };
  }

  if (!result.image) issues.push('Missing image data');
  if (!result.depth) issues.push('Missing depth data');
  if (!result.dsm) issues.push('Missing DSM data');
  if (!result.metrics) issues.push('Missing metrics');
  if (!result.processing) issues.push('Missing processing info');

  if (result.dsm && result.dsm.raster) {
    if (!(result.dsm.raster instanceof Float32Array)) {
      issues.push('DSM raster must be Float32Array');
    }
  }

  return { valid: issues.length === 0, issues };
}
