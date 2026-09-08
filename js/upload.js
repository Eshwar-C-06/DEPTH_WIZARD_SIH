/* ============================================
   DEPTHWIZARD — Upload Manager
   Drag & drop, file validation, metadata
   ============================================ */

export class UploadManager {
  constructor(dropzone, fileInput) {
    this.dropzone = dropzone;
    this.fileInput = fileInput;
    this.onFileSelected = null; // Callback: (file) => {}
    this._bindEvents();
  }

  _bindEvents() {
    // Click / Enter to browse
    if (this.dropzone && this.fileInput) {
      this.dropzone.addEventListener('click', () => this.fileInput.click());
      this.dropzone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.fileInput.click();
        }
      });
    }

    if (this.fileInput) {
      this.fileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) this._handleFile(file);
        this.fileInput.value = '';
      });
    }

    // Drag & drop with full event lifecycle
    if (this.dropzone) {
      ['dragenter', 'dragover'].forEach(eventName => {
        this.dropzone.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.dropzone.classList.add('drag-over');
        });
      });

      ['dragleave', 'dragend'].forEach(eventName => {
        this.dropzone.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.dropzone.classList.remove('drag-over');
        });
      });

      this.dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.dropzone.classList.remove('drag-over');
        const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) this._handleFile(file);
      });
    }
  }

  _handleFile(file) {
    if (!file) return;

    // Client-side validation
    const validTypes = ['image/jpeg', 'image/png', 'image/tiff', 'image/x-tiff'];
    const ext = file.name.split('.').pop().toLowerCase();
    const validExts = ['jpg', 'jpeg', 'png', 'tif', 'tiff'];

    if (!validExts.includes(ext) && !validTypes.includes(file.type)) {
      this._showError('Unsupported format. Please select a JPG, PNG, or TIFF image.');
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      this._showError('File exceeds 50 MB limit.');
      return;
    }

    if (this.onFileSelected) {
      this.onFileSelected(file);
    }
  }

  _showError(message) {
    document.dispatchEvent(new CustomEvent('dw:upload-error', { detail: { message } }));
  }

  /**
   * Update the metadata display panel.
   */
  static updateMetadataDisplay(container, metadata) {
    if (!container || !metadata) return;

    container.classList.add('visible');
    container.innerHTML = `
      <div class="metadata-row">
        <span class="metadata-key">File</span>
        <span class="metadata-value">${metadata.filename || 'Unknown'}</span>
      </div>
      <div class="metadata-row">
        <span class="metadata-key">Dimensions</span>
        <span class="metadata-value">${metadata.width} × ${metadata.height} px</span>
      </div>
      <div class="metadata-row">
        <span class="metadata-key">Format</span>
        <span class="metadata-value">${(metadata.format || '').split('/').pop().toUpperCase()}</span>
      </div>
      <div class="metadata-row">
        <span class="metadata-key">Size</span>
        <span class="metadata-value">${(metadata.fileSize / (1024 * 1024)).toFixed(2)} MB</span>
      </div>
      ${metadata.resolution ? `
      <div class="metadata-row">
        <span class="metadata-key">Resolution</span>
        <span class="metadata-value">${metadata.resolution} m/px</span>
      </div>` : ''}
      ${metadata.crs ? `
      <div class="metadata-row">
        <span class="metadata-key">CRS</span>
        <span class="metadata-value">${metadata.crs}</span>
      </div>` : ''}
      <div class="metadata-row">
        <span class="metadata-key">Georeferenced</span>
        <span class="metadata-value ${metadata.georeferenced ? 'georef-yes' : 'georef-no'}">${metadata.georeferenced ? 'YES' : 'NO'}</span>
      </div>
    `;
  }
}
