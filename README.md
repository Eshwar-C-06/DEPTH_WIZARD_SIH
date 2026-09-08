# DEPTHWIZARD — Single-View Height Estimation

> **AI-Powered Building Height Estimation & 3D Terrain Reconstruction from Single Aerial Imagery**

DepthWizard is a Neo-Brutalist geospatial AI application interface designed for building height estimation and relative digital surface representation from single-view aerial/satellite photos.

---

## 🌟 Key Features

- **Monocular Depth & Height Estimation**: Powered by Depth Anything V2 architecture.
- **Neo-Brutalist GIS Interface**: Technical, high-contrast, multi-level scroll workspace built for remote-sensing workflows.
- **Multi-View Visualizer**:
  - **Aerial Imagery**: High-res pan, zoom, rotate canvas.
  - **Estimated Depth**: Scientific color-mapped height heatmaps with interactive legends.
  - **Side-by-Side Comparison**: Synchronized swipe-slider comparison.
  - **3D Terrain Explorer**: Interactive Three.js 3D textured mesh with elevation extrusion and wireframe view.
- **Dual Inference Engine**:
  - **Demo Mode**: Instant browser-side simulation for demo & zero-backend deployment (Vercel-ready).
  - **Live Mode**: FastAPI + ONNX / PyTorch backend integration.
- **Data Export**: Depth maps, 3D (.OBJ) models, and comprehensive inspection reports.

---

## 🚀 Quick Start (Local Setup)

### 1. Frontend Only (Demo / UI)
Open `index.html` in any modern web browser or serve statically:
```bash
python -m http.server 3000
```
Visit `http://localhost:3000`.

### 2. Live ML Backend (FastAPI + Depth Anything V2)
```bash
# Create and activate virtual environment
python -m venv venv
venv\Scripts\activate  # Windows (or source venv/bin/activate on Linux/macOS)

# Install dependencies
pip install -r backend/requirements.txt

# Start backend server
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

---

## 🛠️ Tech Stack

- **Frontend**: Vanilla HTML5, Vanilla CSS3 (Custom Neo-Brutalist Design Tokens), JavaScript (ES Modules), Three.js.
- **Backend**: FastAPI, Uvicorn, PyTorch / ONNX Runtime, NumPy, Pillow.
- **Deployment**: Vercel (Frontend), Self-hosted / Cloud Run / Hugging Face Spaces (ML Backend).

---

## 📄 License
MIT License
