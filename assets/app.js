/**
 * app.js — 電芯篩選查詢工具
 * 台塑尖端能源股份有限公司 ∙ 彰濱廠
 * G450 批號，2026-05-26
 *
 * 依賴：
 *   - assets/data.js  → CELL_SET (全域)
 *   - ZXing Browser   → https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/umd/index.min.js
 */

/* ── LocalStorage helpers ───────────────────────────────────── */
const LS_KEY = 'cellscan_log_g450';

function loadLog()    { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; } }
function saveLog(l)   { localStorage.setItem(LS_KEY, JSON.stringify(l)); }
function todayKey()   {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/* ── State ──────────────────────────────────────────────────── */
let log = loadLog();
let debugMode = false;

/* ── Counter helpers ────────────────────────────────────────── */
function refreshCounters() {
  const today = todayKey();
  const entries = log[today] || [];
  const hit  = entries.filter(e => e.found).length;
  document.getElementById('cnt-total').textContent = entries.length;
  document.getElementById('cnt-hit').textContent   = hit;
  document.getElementById('cnt-miss').textContent  = entries.length - hit;
}

function renderTodayHistory() {
  const list = document.getElementById('history-list');
  list.innerHTML = '';
  const entries = [...(log[todayKey()] || [])].reverse();
  entries.forEach(e => {
    const li = document.createElement('li');
    li.className = 'h-item ' + (e.found ? 'hit' : 'miss');
    li.innerHTML = `
      <span class="h-icon">${e.found ? '✅' : '❌'}</span>
      <span class="h-code">${esc(e.code)}</span>
      <span class="h-time">${e.time}</span>
      <span class="h-src">${e.src || 'gun'}</span>`;
    list.appendChild(li);
  });
}

/* ── Image preprocessing for low-contrast laser engraving ─── */
/**
 * enhanceForBarcode(srcCanvas) → returns a new canvas with:
 *   1. Grayscale conversion
 *   2. Contrast stretching (normalize histogram)
 *   3. Unsharp mask (sharpen edges)
 *   4. Adaptive threshold (binarize)
 * Designed for laser-etched QR codes on metallic surfaces.
 */
function enhanceForBarcode(src) {
  const w = src.width, h = src.height;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0);

  const img = ctx.getImageData(0, 0, w, h);
  const d   = img.data;

  // ── Step 1: Grayscale ──────────────────────────────────────
  const gray = new Uint8ClampedArray(w * h);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    gray[p] = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
  }

  // ── Step 2: Contrast stretch (1%–99% percentile) ──────────
  const hist = new Int32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  const lo_cut = total * 0.01, hi_cut = total * 0.99;
  let lo = 0, hi = 255, cum = 0;
  for (let v = 0; v < 256; v++) { cum += hist[v]; if (cum < lo_cut) lo = v; }
  cum = 0;
  for (let v = 255; v >= 0; v--) { cum += hist[v]; if (cum < total - hi_cut) hi = v; }
  if (hi <= lo) { lo = 0; hi = 255; }
  const range = hi - lo || 1;
  for (let i = 0; i < gray.length; i++) {
    gray[i] = Math.max(0, Math.min(255, ((gray[i] - lo) / range) * 255));
  }

  // ── Step 3: Unsharp mask (3×3 Gaussian blur subtracted) ───
  const blurred = new Uint8ClampedArray(gray.length);
  const kernel  = [1,2,1, 2,4,2, 1,2,1]; // sum=16
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const ny = Math.min(h-1, Math.max(0, y+ky));
          const nx = Math.min(w-1, Math.max(0, x+kx));
          sum += gray[ny*w+nx] * kernel[(ky+1)*3+(kx+1)];
        }
      }
      blurred[y*w+x] = sum / 16;
    }
  }
  const amount = 1.8; // sharpening strength
  for (let i = 0; i < gray.length; i++) {
    gray[i] = Math.max(0, Math.min(255, gray[i] + amount * (gray[i] - blurred[i])));
  }

  // ── Step 4: Write back as RGB ──────────────────────────────
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    d[i] = d[i+1] = d[i+2] = gray[p];
    d[i+3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

/* ── Core: process one scanned code ────────────────────────── */
let lastCode = '', lastTs = 0;  // debounce for camera

function processCode(code, src) {
  // camera debounce: same code within 2.5 s → skip
  const now = Date.now();
  if (src === 'cam' && code === lastCode && now - lastTs < 2500) return;
  lastCode = code; lastTs = now;

  const found    = CELL_SET.has(code);
  const timeStr  = new Date().toTimeString().slice(0, 8);
  const today    = todayKey();

  // persist
  if (!log[today]) log[today] = [];
  log[today].push({ code, found, time: timeStr, src: src || 'gun' });
  saveLog(log);

  // counters
  refreshCounters();

  // result panel
  const panel   = document.getElementById('result-panel');
  const content = document.getElementById('result-content');
  panel.className = 'result-panel ' + (found ? 'hit' : 'miss');
  content.innerHTML = `
    <div class="result-icon">${found ? '✅' : '❌'}</div>
    <div class="result-code">${esc(code)}</div>
    <div class="result-status ${found ? 'ok' : 'ng'}">${found ? '在名單內' : '不在名單內'}</div>`;

  // camera flash feedback
  if (src === 'cam') {
    const cc = document.getElementById('cam-container');
    cc.classList.remove('flash-ok', 'flash-ng');
    void cc.offsetWidth;                        // force reflow
    cc.classList.add(found ? 'flash-ok' : 'flash-ng');
  }

  // debug: show raw scanned value
  const dbg = document.getElementById('debug-bar');
  if (dbg) dbg.textContent = '📡 RAW: ' + code;

  // prepend to today history
  const li = document.createElement('li');
  li.className = 'h-item ' + (found ? 'hit' : 'miss');
  li.innerHTML = `
    <span class="h-icon">${found ? '✅' : '❌'}</span>
    <span class="h-code">${esc(code)}</span>
    <span class="h-time">${timeStr}</span>
    <span class="h-src">${src || 'gun'}</span>`;
  const list = document.getElementById('history-list');
  list.insertBefore(li, list.firstChild);
}

/* ── Keyboard / scanner gun input ───────────────────────────── */
const scanInput = document.getElementById('scan-input');

scanInput.addEventListener('keydown', function (e) {
  if (e.key === 'Enter') {
    const code = scanInput.value.trim();
    scanInput.value = '';
    if (code) processCode(code, 'gun');
  }
});

document.addEventListener('click', () => {
  if (document.getElementById('tab-scan').classList.contains('active') && !cameraOn)
    setTimeout(() => scanInput.focus(), 80);
});

/* ── Camera / Photo capture ─────────────────────────────────── */
let cameraOn     = false;
let codeReader   = null;
let scanControls = null;
let _photoInput  = null;   // reused <input> element for photo capture

// Entry point — decides between live stream (BarcodeDetector) or photo capture (iOS 18)
function toggleCamera() {
  const hasBD    = ('BarcodeDetector' in window);
  const isSecure = (location.protocol === 'https:' || location.hostname === 'localhost');
  if (hasBD && isSecure) {
    cameraOn ? stopCamera() : startCamera();
  } else {
    triggerPhotoCapture();   // iOS 18 path
  }
}

// ── iOS 18 path: photo capture via system camera ─────────────
function triggerPhotoCapture() {
  const dbg      = document.getElementById('debug-bar');
  const btnLabel = document.getElementById('cam-btn-label');
  const btnIcon  = document.getElementById('cam-btn-icon');

  if (!_photoInput) {
    _photoInput         = document.createElement('input');
    _photoInput.type    = 'file';
    _photoInput.accept  = 'image/*';
    _photoInput.capture = 'environment';
    _photoInput.style.display = 'none';
    document.body.appendChild(_photoInput);

    _photoInput.addEventListener('change', async () => {
      const file = _photoInput.files && _photoInput.files[0];
      _photoInput.value = '';
      if (!file) return;

      btnIcon.textContent  = '⏳';
      btnLabel.textContent = '解碼中…';
      if (dbg) dbg.textContent = '📷 收到照片，解碼中（共三輪嘗試）…';

      try {
        if (dbg) dbg.textContent = '📷 圖片載入中… 大小=' + Math.round(file.size/1024) + 'KB';
        const raw = await decodeImageFile(file, dbg);
        if (raw) {
          if (dbg) dbg.textContent = '📡 RAW: [' + raw + '] len=' + raw.length;
          processCode(raw.trim(), 'cam');
        } else {
          if (dbg) dbg.textContent = '❌ 三輪解碼均失敗，請截圖此訊息回報';
        }
      } catch(e) {
        if (dbg) dbg.textContent = '❌ 解碼例外：' + e.name + ': ' + e.message;
        console.error(e);
      } finally {
        btnIcon.textContent  = '📷';
        btnLabel.textContent = '拍照掃碼（點擊開啟相機）';
      }
    });
  }
  _photoInput.click();
}

// ── decodeImageFile: 3-round decode with image enhancement ───
async function decodeImageFile(file, dbg) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = async () => {
      const origW = img.width, origH = img.height;
      if (dbg) dbg.textContent = '🖼 圖片尺寸: ' + origW + '×' + origH;

      // Try multiple scales: 1200, 800, 1800 (sometimes larger helps ZXing)
      const scales = [1200, 800, 1800];

      for (let si = 0; si < scales.length; si++) {
        const MAX   = scales[si];
        const scale = Math.min(1, MAX / Math.max(origW, origH));
        const w = Math.round(origW * scale);
        const h = Math.round(origH * scale);

        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);

        const reader = new ZXingBrowser.BrowserMultiFormatReader();

        // Round A: raw
        if (dbg) dbg.textContent = '🔍 嘗試 scale=' + MAX + ' 原圖…';
        try {
          const r = await reader.decodeFromCanvas(canvas);
          if (r) { resolve(r.getText()); return; }
        } catch(e) {
          if (dbg) dbg.textContent = '🔍 scale=' + MAX + ' 原圖: ' + e.name;
        }

        // Round B: enhanced
        if (dbg) dbg.textContent = '🔍 嘗試 scale=' + MAX + ' 增強…';
        try {
          const enh = enhanceForBarcode(canvas);
          const r   = await reader.decodeFromCanvas(enh);
          if (r) { resolve(r.getText()); return; }
        } catch(e) {
          if (dbg) dbg.textContent = '🔍 scale=' + MAX + ' 增強: ' + e.name;
        }

        // Round C: centre crop enhanced
        if (dbg) dbg.textContent = '🔍 嘗試 scale=' + MAX + ' 裁切…';
        try {
          const crop = document.createElement('canvas');
          crop.width = w; crop.height = h;
          const cw = Math.round(w * 0.6), ch = Math.round(h * 0.6);
          crop.getContext('2d').drawImage(canvas,
            Math.round(w*0.2), Math.round(h*0.2), cw, ch, 0, 0, w, h);
          const enh2 = enhanceForBarcode(crop);
          const r    = await reader.decodeFromCanvas(enh2);
          if (r) { resolve(r.getText()); return; }
        } catch(e) {
          if (dbg) dbg.textContent = '🔍 scale=' + MAX + ' 裁切: ' + e.name;
        }
      }

      if (dbg) dbg.textContent = '❌ 全部 9 輪解碼失敗 — 條碼對比度不足';
      resolve(null);
    };
    img.onerror = (e) => {
      if (dbg) dbg.textContent = '❌ 圖片載入失敗: ' + e;
      resolve(null);
    };
    img.src = URL.createObjectURL(file);
  });
}

// ── BarcodeDetector live stream path (iOS 19+ / Android Chrome) ──
async function startCamera() {
  const btnLabel = document.getElementById('cam-btn-label');
  const btnIcon  = document.getElementById('cam-btn-icon');
  const dbg      = document.getElementById('debug-bar');
  btnLabel.textContent = '相機啟動中…';
  try {
    const video  = document.getElementById('cam-video');
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    video.srcObject = stream;
    const [track] = stream.getVideoTracks();
    if (track?.applyConstraints) {
      try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch(_) {}
    }
    await video.play();

    document.getElementById('cam-wrap').classList.add('open');
    cameraOn = true;
    document.getElementById('cam-toggle-btn').classList.add('active');
    btnIcon.textContent  = '⏹';
    btnLabel.textContent = '關閉相機';
    if (dbg) dbg.textContent = '📡 BarcodeDetector (原生) — 等待掃描…';

    const detector  = new BarcodeDetector({
      formats: ['qr_code','code_128','code_39','data_matrix','pdf417','aztec','ean_13','ean_8']
    });
    const offscreen = document.createElement('canvas');
    const ctx       = offscreen.getContext('2d', { willReadFrequently: true });
    scanControls    = { _rafId: null, stop() { cancelAnimationFrame(this._rafId); } };

    let _fc = 0;
    const tick = async () => {
      if (!cameraOn) return;
      if (++_fc % 3 === 0 && video.readyState >= video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
        offscreen.width  = video.videoWidth;
        offscreen.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        try {
          let codes = await detector.detect(offscreen);
          if (codes.length === 0) {
            const enh = enhanceForBarcode(offscreen);
            codes = await detector.detect(enh);
          }
          if (codes.length > 0) {
            const raw = codes[0].rawValue.trim();
            if (dbg) dbg.textContent = '📡 RAW: [' + raw + '] len=' + raw.length;
            processCode(raw, 'cam');
          }
        } catch(_) {}
      }
      scanControls._rafId = requestAnimationFrame(tick);
    };
    tick();
  } catch(err) {
    btnLabel.textContent = '拍照掃碼（點擊開啟相機）';
    btnIcon.textContent  = '📷';
    document.getElementById('cam-wrap').classList.remove('open');
    cameraOn = false;
    document.getElementById('cam-toggle-btn').classList.remove('active');
    if (dbg) dbg.textContent = '';
    alert('無法存取相機：' + err.message);
  }
}

function stopCamera() {
  if (scanControls) { try { scanControls.stop(); } catch(_) {} scanControls = null; }
  if (codeReader)   { try { codeReader.reset();  } catch(_) {} codeReader   = null; }
  const video = document.getElementById('cam-video');
  if (video.srcObject) {
    video.srcObject.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  }
  document.getElementById('cam-wrap').classList.remove('open');
  document.getElementById('cam-toggle-btn').classList.remove('active');
  document.getElementById('cam-btn-icon').textContent  = '📷';
  document.getElementById('cam-btn-label').textContent = '拍照掃碼（點擊開啟相機）';
  cameraOn = false;
  setTimeout(() => scanInput.focus(), 100);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && cameraOn) stopCamera();
});

/* ── Clear today ────────────────────────────────────────────── */
function clearToday() {
  if (!confirm('確定清除今日紀錄？')) return;
  delete log[todayKey()];
  saveLog(log);
  refreshCounters();
  renderTodayHistory();
  document.getElementById('result-panel').className = 'result-panel';
  document.getElementById('result-content').innerHTML = '<div class="result-idle">AWAITING SCAN</div>';
}

/* ── Log tab ────────────────────────────────────────────────── */
function renderLogTab() {
  const c     = document.getElementById('daily-cards');
  const dates = Object.keys(log).sort().reverse();

  if (!dates.length) {
    c.innerHTML = '<div class="empty-msg">尚無任何掃描紀錄</div>';
    return;
  }

  c.innerHTML = '';
  dates.forEach(date => {
    const entries = log[date] || [];
    const hit     = entries.filter(e => e.found).length;
    const miss    = entries.length - hit;

    const card = document.createElement('div');
    card.className = 'day-card';

    const head = document.createElement('div');
    head.className = 'day-card-head';
    head.innerHTML = `
      <span class="day-date">${date}</span>
      <div class="day-chips">
        <span class="chip chip-total">總計 ${entries.length}</span>
        <span class="chip chip-hit">✓ ${hit}</span>
        <span class="chip chip-miss">✗ ${miss}</span>
      </div>
      <span class="day-toggle">▼</span>`;

    const detail = document.createElement('div');
    detail.className = 'day-detail';
    entries.forEach(e => {
      const row = document.createElement('div');
      row.className = 'detail-row ' + (e.found ? 'hit' : 'miss');
      row.innerHTML = `
        <span class="dr-icon">${e.found ? '✅' : '❌'}</span>
        <span class="dr-code">${esc(e.code)}</span>
        <span class="dr-time">${e.time}</span>
        <span class="dr-src">${e.src || 'gun'}</span>`;
      detail.appendChild(row);
    });

    head.addEventListener('click', () => {
      detail.classList.toggle('open');
      head.querySelector('.day-toggle').textContent =
        detail.classList.contains('open') ? '▲' : '▼';
    });

    card.appendChild(head);
    card.appendChild(detail);
    c.appendChild(card);
  });
}

/* ── CSV export ─────────────────────────────────────────────── */
function exportCSV() {
  const dates = Object.keys(log).sort();
  if (!dates.length) { alert('尚無紀錄可匯出'); return; }

  let csv = '\uFEFF日期,時間,電芯碼,結果,輸入方式\n';
  dates.forEach(date => {
    (log[date] || []).forEach(e => {
      const src = e.src === 'cam' ? '相機' : '掃碼槍';
      csv += `${date},${e.time},${e.code},${e.found ? '在名單內' : '不在名單內'},${src}\n`;
    });
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `電芯掃描紀錄_G450_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function clearAllLog() {
  if (!confirm('確定清除所有歷史紀錄？此操作無法復原。')) return;
  log = {};
  saveLog(log);
  refreshCounters();
  renderTodayHistory();
  document.getElementById('result-panel').className = 'result-panel';
  document.getElementById('result-content').innerHTML = '<div class="result-idle">AWAITING SCAN</div>';
  renderLogTab();
}

/* ── Debug mode ─────────────────────────────────────────────── */
function toggleDebug() {
  debugMode = !debugMode;
  const bar = document.getElementById('debug-bar');
  const btn = document.getElementById('debug-btn');
  if (bar) bar.style.display = debugMode ? 'block' : 'none';
  if (btn) btn.textContent   = debugMode ? 'DEBUG ON' : 'DEBUG';
}

/* ── Tab switching ──────────────────────────────────────────── */
function switchTab(name, el) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b  => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  el.classList.add('active');
  if (name === 'log') renderLogTab();
  if (name === 'scan' && !cameraOn) setTimeout(() => scanInput.focus(), 80);
  if (name !== 'scan' && cameraOn) stopCamera();
}

/* ── Utility ────────────────────────────────────────────────── */
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ── Boot ───────────────────────────────────────────────────── */
refreshCounters();
renderTodayHistory();
setTimeout(() => scanInput.focus(), 200);
