/* ============================================
   DEPTHWIZARD — Three.js 3D Terrain Viewer
   
   Consumes RGB texture + DSM elevation raster.
   Does NOT generate its own DSM data.
   ============================================ */

export class ThreeViewer {
  constructor(container) {
    this.container = container;
    this._scene = null;
    this._camera = null;
    this._renderer = null;
    this._mesh = null;
    this._animId = null;
    this._isWireframe = false;

    // Simple orbit state
    this._orbit = {
      phi: Math.PI / 4,     // vertical angle
      theta: Math.PI / 4,   // horizontal angle
      distance: 2.5,
      target: { x: 0.5, y: 0, z: 0.5 },
      isDragging: false,
      isPanning: false,
      lastMouse: { x: 0, y: 0 },
    };
  }

  async init() {
    // Wait for THREE to be available
    if (typeof THREE === 'undefined') {
      console.warn('[DepthWizard] Three.js not loaded. 3D view unavailable.');
      this.container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#7A8BA5;font-size:14px;">3D view requires Three.js</div>';
      return false;
    }

    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(0x0A0F1A);

    const rect = this.container.getBoundingClientRect();
    this._camera = new THREE.PerspectiveCamera(50, rect.width / rect.height, 0.01, 100);
    this._updateCameraPosition();

    this._renderer = new THREE.WebGLRenderer({ antialias: true });
    this._renderer.setSize(rect.width, rect.height);
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(this._renderer.domElement);

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this._scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(1, 2, 1);
    this._scene.add(dirLight);

    const dirLight2 = new THREE.DirectionalLight(0x9BBFF4, 0.3);
    dirLight2.position.set(-1, 1, -1);
    this._scene.add(dirLight2);

    // Grid helper
    const grid = new THREE.GridHelper(2, 20, 0x1a2540, 0x1a2540);
    grid.position.set(0.5, -0.01, 0.5);
    this._scene.add(grid);

    this._bindEvents();
    this._animate();
    return true;
  }

  clearTerrain() {
    if (this._mesh && this._scene) {
      this._scene.remove(this._mesh);
      if (this._mesh.geometry) this._mesh.geometry.dispose();
      if (this._mesh.material) {
        if (this._mesh.material.map) this._mesh.material.map.dispose();
        this._mesh.material.dispose();
      }
      this._mesh = null;
    }
  }

  /**
   * Load terrain from image URL and DSM raster
   */
  async loadTerrain(imageUrl, dsmData) {
    if (!this._scene) return;

    // Remove existing mesh
    this.clearTerrain();

    const { raster, width, height, maxElevation } = dsmData;

    // Create geometry
    const segW = Math.min(width, 128);
    const segH = Math.min(height, 128);
    const geometry = new THREE.PlaneGeometry(1, 1, segW - 1, segH - 1);

    // Apply displacement from DSM raster
    const vertices = geometry.attributes.position.array;
    const maxElev = maxElevation || 1;
    const heightScale = 0.4; // Visual scale factor

    for (let iy = 0; iy < segH; iy++) {
      for (let ix = 0; ix < segW; ix++) {
        const vi = (iy * segW + ix) * 3;

        // Sample DSM raster
        const sx = Math.floor((ix / (segW - 1)) * (width - 1));
        const sy = Math.floor((iy / (segH - 1)) * (height - 1));
        const rasterIdx = sy * width + sx;
        const elev = raster[rasterIdx] || 0;

        // Y is up in three.js
        vertices[vi + 2] = -(elev / maxElev) * heightScale;
      }
    }

    geometry.computeVertexNormals();

    // Load texture
    let material;
    try {
      const texture = await this._loadTexture(imageUrl);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      material = new THREE.MeshLambertMaterial({
        map: texture,
        wireframe: this._isWireframe,
      });
    } catch {
      material = new THREE.MeshLambertMaterial({
        color: 0x4A80F5,
        wireframe: this._isWireframe,
      });
    }

    this._mesh = new THREE.Mesh(geometry, material);
    this._mesh.rotation.x = -Math.PI / 2;
    this._mesh.position.set(0.5, 0, 0.5);
    this._scene.add(this._mesh);
  }

  toggleWireframe() {
    this._isWireframe = !this._isWireframe;
    if (this._mesh) {
      this._mesh.material.wireframe = this._isWireframe;
    }
    return this._isWireframe;
  }

  setTopView() {
    this._orbit.phi = 0.01;
    this._orbit.theta = 0;
    this._orbit.distance = 2;
    this._updateCameraPosition();
  }

  setPerspectiveView() {
    this._orbit.phi = Math.PI / 4;
    this._orbit.theta = Math.PI / 4;
    this._orbit.distance = 2.5;
    this._updateCameraPosition();
  }

  resetCamera() {
    this.setPerspectiveView();
  }

  resize() {
    if (!this._renderer || !this._camera) return;
    const rect = this.container.getBoundingClientRect();
    this._camera.aspect = rect.width / rect.height;
    this._camera.updateProjectionMatrix();
    this._renderer.setSize(rect.width, rect.height);
  }

  destroy() {
    if (this._animId) cancelAnimationFrame(this._animId);
    this._unbindEvents();
    if (this._renderer) {
      this._renderer.dispose();
      if (this._renderer.domElement.parentNode) {
        this._renderer.domElement.parentNode.removeChild(this._renderer.domElement);
      }
    }
  }

  // ───── Private ─────

  _animate() {
    this._animId = requestAnimationFrame(() => this._animate());
    if (this._renderer && this._scene && this._camera) {
      this._renderer.render(this._scene, this._camera);
    }
  }

  _updateCameraPosition() {
    if (!this._camera) return;
    const { phi, theta, distance, target } = this._orbit;
    this._camera.position.set(
      target.x + distance * Math.sin(phi) * Math.cos(theta),
      target.y + distance * Math.cos(phi),
      target.z + distance * Math.sin(phi) * Math.sin(theta)
    );
    this._camera.lookAt(target.x, target.y, target.z);
  }

  _loadTexture(url) {
    return new Promise((resolve, reject) => {
      const loader = new THREE.TextureLoader();
      loader.crossOrigin = 'anonymous';
      loader.load(url, resolve, undefined, reject);
    });
  }

  _bindEvents() {
    const el = this.container;

    this._onMouseDown = (e) => {
      if (e.button === 0) {
        this._orbit.isDragging = true;
      } else if (e.button === 2) {
        this._orbit.isPanning = true;
      }
      this._orbit.lastMouse = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    };

    this._onMouseMove = (e) => {
      const dx = e.clientX - this._orbit.lastMouse.x;
      const dy = e.clientY - this._orbit.lastMouse.y;
      this._orbit.lastMouse = { x: e.clientX, y: e.clientY };

      if (this._orbit.isDragging) {
        this._orbit.theta -= dx * 0.005;
        this._orbit.phi = Math.max(0.01, Math.min(Math.PI / 2 - 0.01, this._orbit.phi - dy * 0.005));
        this._updateCameraPosition();
      }

      if (this._orbit.isPanning) {
        this._orbit.target.x -= dx * 0.002;
        this._orbit.target.z += dy * 0.002;
        this._updateCameraPosition();
      }
    };

    this._onMouseUp = () => {
      this._orbit.isDragging = false;
      this._orbit.isPanning = false;
    };

    this._onWheel = (e) => {
      e.preventDefault();
      this._orbit.distance *= e.deltaY > 0 ? 1.1 : 0.9;
      this._orbit.distance = Math.max(0.5, Math.min(10, this._orbit.distance));
      this._updateCameraPosition();
    };

    this._onContextMenu = (e) => e.preventDefault();

    this._onResize = () => this.resize();

    el.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mouseup', this._onMouseUp);
    el.addEventListener('wheel', this._onWheel, { passive: false });
    el.addEventListener('contextmenu', this._onContextMenu);
    window.addEventListener('resize', this._onResize);
  }

  _unbindEvents() {
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('resize', this._onResize);
  }
}
