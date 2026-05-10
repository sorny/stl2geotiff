let parsedSTL      = null;
let heightGrid     = null;   // raw rasterized grid (never mutated)
let displayGrid    = null;   // rotated/current grid
let displayWidth   = 0;
let displayHeight  = 0;
let tiffBlob       = null;
let converting     = false;
let currentNodata  = -9999;
let exportFilename = 'heightmap.tif';

const dropZone      = document.getElementById('drop-zone');
const fileInput     = document.getElementById('file-input');
const resolutionSel = document.getElementById('resolution');
const nodataInput   = document.getElementById('nodata');
const convertBtn    = document.getElementById('convert-btn');
const downloadBtn   = document.getElementById('download-btn');
const progressWrap  = document.getElementById('progress-wrap');
const progressBar   = document.getElementById('progress-bar');
const progressLabel = document.getElementById('progress-label');
const statusEl      = document.getElementById('status');
const infoEl        = document.getElementById('info');
const previewWrap   = document.getElementById('preview-wrap');
const previewCanvas = document.getElementById('preview');
const rotateBtns    = document.querySelectorAll('.rotate-btn');

// ── File loading ────────────────────────────────────────────────────────────

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f) loadFile(f);
});
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', e => { if (e.target.files[0]) loadFile(e.target.files[0]); });

async function loadFile(file) {
  setStatus('Parsing STL…');
  convertBtn.disabled = true;
  downloadBtn.style.display = 'none';
  previewWrap.style.display = 'none';
  infoEl.innerHTML = '';
  tiffBlob = null; heightGrid = null; displayGrid = null;

  try {
    const buf = await file.arrayBuffer();
    parsedSTL = parseSTL(buf);
  } catch (err) {
    setStatus('Error parsing file: ' + err.message);
    return;
  }

  const { triangles, bounds } = parsedSTL;
  const { minX, maxX, minY, maxY, minZ, maxZ } = bounds;
  infoEl.innerHTML =
    `<strong>${escapeHtml(file.name)}</strong><br>` +
    `Triangles: ${triangles.length.toLocaleString()}<br>` +
    `X: ${fmt(minX)} → ${fmt(maxX)}<br>` +
    `Y: ${fmt(minY)} → ${fmt(maxY)}<br>` +
    `Z: ${fmt(minZ)} → ${fmt(maxZ)}`;

  exportFilename = file.name.replace(/\.[^.]+$/, '') + '.tif';
  convertBtn.disabled = false;
  setStatus('File loaded. Click Convert to generate the GeoTIFF.');
}

// ── Conversion ──────────────────────────────────────────────────────────────

convertBtn.addEventListener('click', async () => {
  if (!parsedSTL || converting) return;
  converting = true;
  convertBtn.disabled = true;
  downloadBtn.style.display = 'none';
  previewWrap.style.display = 'none';
  tiffBlob = null; heightGrid = null; displayGrid = null;

  const size   = parseInt(resolutionSel.value, 10);
  const nodata = parseFloat(nodataInput.value);
  if (isNaN(nodata)) {
    setStatus('Invalid nodata value.');
    converting = false; convertBtn.disabled = false; return;
  }
  currentNodata = nodata;

  progressWrap.style.display = 'block';
  setProgress(0);
  setStatus('Rasterizing…');

  try {
    heightGrid = await rasterize(
      parsedSTL.triangles, parsedSTL.bounds,
      size, size, nodata,
      p => setProgress(p * 0.9)
    );
  } catch (err) {
    setStatus('Rasterization error: ' + err.message);
    converting = false; convertBtn.disabled = false; return;
  }

  displayGrid   = heightGrid;
  displayWidth  = size;
  displayHeight = size;

  finalize();
  converting = false;
  convertBtn.disabled = false;
});

// ── Rotation ────────────────────────────────────────────────────────────────

rotateBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    if (!heightGrid) return;
    const deg = parseInt(btn.dataset.deg, 10);
    const result = rotateGrid(heightGrid, parseInt(resolutionSel.value, 10), deg);
    displayGrid   = result.grid;
    displayWidth  = result.width;
    displayHeight = result.height;
    finalize();
  });
});

// ── Finalize (encode + preview) ─────────────────────────────────────────────

async function finalize() {
  setStatus('Encoding GeoTIFF…');
  setProgress(0.95);
  await tick();

  try {
    tiffBlob = encodeGeoTIFF(displayWidth, displayHeight, displayGrid, currentNodata);
  } catch (err) {
    setStatus('Encoding error: ' + err.message);
    return;
  }

  setProgress(1);
  renderPreview(displayGrid, displayWidth, displayHeight, currentNodata);
  previewWrap.style.display = 'block';
  downloadBtn.style.display = 'inline-block';
  setStatus(`Done — ${displayWidth}×${displayHeight} px, ${fmtBytes(tiffBlob.size)}`);
}

// ── Download ────────────────────────────────────────────────────────────────

downloadBtn.addEventListener('click', () => {
  if (!tiffBlob) return;
  const url = URL.createObjectURL(tiffBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = exportFilename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// ── Preview ─────────────────────────────────────────────────────────────────

function renderPreview(grid, width, height, nodata) {
  previewCanvas.width  = width;
  previewCanvas.height = height;
  const ctx = previewCanvas.getContext('2d');
  const img = ctx.createImageData(width, height);

  // Find Z range, ignoring nodata
  // Use float32-exact nodata comparison
  const f32nd = new Float32Array(1);
  f32nd[0] = nodata;
  const nodataF32 = f32nd[0];

  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i];
    if (v !== nodataF32 && !isNaN(v)) {
      if (v < minZ) minZ = v;
      if (v > maxZ) maxZ = v;
    }
  }
  const range = maxZ - minZ || 1;

  for (let i = 0; i < grid.length; i++) {
    const p = i * 4;
    const v = grid[i];
    if (v === nodataF32 || isNaN(v)) {
      img.data[p] = 255; img.data[p+1] = 0; img.data[p+2] = 204; img.data[p+3] = 255;
    } else {
      const g = Math.round(((v - minZ) / range) * 255);
      img.data[p] = g; img.data[p+1] = g; img.data[p+2] = g; img.data[p+3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  document.getElementById('legend-min').textContent = fmt(minZ);
  document.getElementById('legend-max').textContent = fmt(maxZ);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function setStatus(msg) { statusEl.textContent = msg; }
function setProgress(p) {
  const pct = Math.round(p * 100);
  progressBar.style.width = pct + '%';
  progressLabel.textContent = pct + '%';
}
function tick() { return new Promise(r => setTimeout(r, 0)); }
function fmt(n) { return (typeof n === 'number' && isFinite(n)) ? n.toFixed(4) : '—'; }
function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
