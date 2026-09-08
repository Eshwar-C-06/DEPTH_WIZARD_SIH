/* ============================================
   DEPTHWIZARD — Export Manager
   Delegates to service for downloads
   ============================================ */

export class ExportManager {
  constructor(service) {
    this._service = service;
    this._jobId = null;
  }

  setJobId(jobId) {
    this._jobId = jobId;
  }

  async downloadDSM() {
    if (!this._jobId) return;
    try {
      const blob = await this._service.exportDSM(this._jobId, 'png');
      this._downloadBlob(blob, 'depthwizard_dsm.png');
    } catch (err) {
      console.error('[DepthWizard] DSM export failed:', err);
    }
  }

  async downloadMesh() {
    if (!this._jobId) return;
    try {
      const blob = await this._service.exportMesh(this._jobId, 'obj');
      this._downloadBlob(blob, 'depthwizard_3d.obj');
    } catch (err) {
      console.error('[DepthWizard] Mesh export failed:', err);
    }
  }

  async downloadReport() {
    if (!this._jobId) return;
    try {
      const blob = await this._service.exportReport(this._jobId);
      this._downloadBlob(blob, 'depthwizard_report.txt');
    } catch (err) {
      console.error('[DepthWizard] Report export failed:', err);
    }
  }

  _downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
