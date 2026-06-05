// ── STATE ─────────────────────────────────────────────────────
let map, pins = [], routes = [], currentPin = null, selectedColor = '#00f5ff';
let markers = {}, routeLayers = [];
let buildingRoute = false, routePinIds = [], routeColor = '#00f5ff';
let searchTimer = null;

// ── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  loadPins();
  loadRoutes();
  bindUI();
});

function initMap() {
  map = L.map('map', { zoomControl: false }).setView([48.5, 31.3], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
  }).addTo(map);
  map.on('click', onMapClick);
}

// ── MAP CLICK ─────────────────────────────────────────────────
async function onMapClick(e) {
  if (buildingRoute) return;
  const { lat, lng } = e.latlng;
  const res = await fetch('/api/pins', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ lat, lng, title: 'Нова точка', note: '', color: selectedColor })
  });
  const data = await res.json();
  await loadPins();
  openPin(data.id);
  showTooltip();
}

// ── LOAD PINS ─────────────────────────────────────────────────
async function loadPins() {
  const res = await fetch('/api/pins');
  pins = await res.json();
  Object.values(markers).forEach(m => map.removeLayer(m));
  markers = {};
  pins.forEach(pin => addMarker(pin));
  updateStats();
  renderDrawer();
}

function addMarker(pin) {
  const icon = L.divIcon({
    className: '',
    html: `<div class="custom-marker" style="background:${pin.color};color:${pin.color}"><div class="custom-marker-inner"></div></div>`,
    iconSize: [32, 32], iconAnchor: [16, 32], popupAnchor: [0, -36]
  });
  const note_preview = pin.note ? pin.note.slice(0, 80) + (pin.note.length > 80 ? '…' : '') : '';
  const marker = L.marker([pin.lat, pin.lng], { icon }).addTo(map)
    .bindPopup(`
      <div class="popup-title" style="color:${pin.color}">${pin.title}</div>
      ${note_preview ? `<div class="popup-note">${note_preview}</div>` : ''}
      <div style="display:flex;gap:6px;margin-top:8px">
        <div class="popup-edit" onclick="openPin('${pin.id}')">Редагувати →</div>
        ${buildingRoute ? `<div class="popup-edit" onclick="addPinToRoute('${pin.id}')" style="border-color:rgba(184,255,87,.3);color:#b8ff57">+ Маршрут</div>` : ''}
      </div>`);
  marker.on('click', () => marker.openPopup());
  markers[pin.id] = marker;
}

// ── OPEN PIN ──────────────────────────────────────────────────
function openPin(id) {
  const pin = pins.find(p => p.id === id);
  if (!pin) return;
  currentPin = pin;
  document.getElementById('pinTitle').value = pin.title;
  document.getElementById('pinNote').value = pin.note || '';
  document.getElementById('pinMeta').textContent = `📍 ${pin.lat.toFixed(4)}, ${pin.lng.toFixed(4)}   •   ${pin.created}`;
  selectedColor = pin.color;
  const dot = document.getElementById('pinColorDot');
  dot.style.background = pin.color;
  dot.style.boxShadow = `0 0 12px ${pin.color}`;
  document.querySelectorAll('#colorSwatches .swatch').forEach(s => s.classList.toggle('active', s.dataset.color === pin.color));
  renderPhotos(pin.photos || []);
  document.getElementById('sidebar').classList.add('open');
  map.panTo([pin.lat, pin.lng], { animate: true, duration: 0.5 });
  loadWeather(pin.lat, pin.lng);
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  currentPin = null;
}

// ── WEATHER ───────────────────────────────────────────────────
async function loadWeather(lat, lng) {
  const card = document.getElementById('weatherCard');
  const inner = document.getElementById('weatherInner');
  card.style.display = 'block';
  inner.innerHTML = '<div class="weather-loading">⟳ Завантаження погоди...</div>';
  try {
    const res = await fetch(`/api/weather?lat=${lat}&lng=${lng}`);
    const w = await res.json();
    if (w.error && !w.mock) { card.style.display = 'none'; return; }
    const icons = {'01d':'☀️','01n':'🌙','02d':'⛅','02n':'🌙','03d':'☁️','03n':'☁️','04d':'☁️','04n':'☁️','09d':'🌧️','09n':'🌧️','10d':'🌦️','10n':'🌧️','11d':'⛈️','11n':'⛈️','13d':'❄️','13n':'❄️','50d':'🌫️','50n':'🌫️'};
    const emoji = icons[w.icon] || '🌡️';
    inner.innerHTML = `
      <div class="weather-main">
        <div class="weather-icon">${emoji}</div>
        <div class="weather-temp">${w.temp}°</div>
        <div class="weather-info">
          <div class="weather-desc">${w.desc}</div>
          <div class="weather-extra">Відчувається ${w.feels}° · Вологість ${w.humidity}% · Вітер ${w.wind} м/с${w.mock ? ' · (демо)' : ''}</div>
        </div>
      </div>`;
  } catch { card.style.display = 'none'; }
}

// ── PHOTOS ────────────────────────────────────────────────────
function renderPhotos(photos) {
  const grid = document.getElementById('photosGrid');
  grid.innerHTML = photos.map(ph => `
    <div class="photo-thumb" data-fid="${ph.id}">
      <img src="/uploads/${ph.filename}" alt="${ph.caption||''}">
      <button class="photo-del" onclick="deletePhoto('${ph.id}',event)">✕</button>
    </div>`).join('');
  grid.querySelectorAll('.photo-thumb').forEach(thumb => {
    thumb.addEventListener('click', (e) => {
      if (e.target.classList.contains('photo-del')) return;
      openLightbox(thumb.querySelector('img').src, thumb.querySelector('img').alt);
    });
  });
}

async function deletePhoto(fid, e) {
  e.stopPropagation();
  await fetch(`/api/photos/${fid}`, { method: 'DELETE' });
  await loadPins();
  if (currentPin) openPin(currentPin.id);
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('photoUpload').addEventListener('change', async (e) => {
    if (!currentPin) return;
    for (const file of Array.from(e.target.files)) {
      const fd = new FormData();
      fd.append('photo', file);
      await fetch(`/api/pins/${currentPin.id}/photos`, { method: 'POST', body: fd });
    }
    e.target.value = '';
    await loadPins();
    openPin(currentPin.id);
  });
});

// ── SAVE / DELETE PIN ─────────────────────────────────────────
async function savePin() {
  if (!currentPin) return;
  await fetch(`/api/pins/${currentPin.id}`, {
    method: 'PUT', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ title: document.getElementById('pinTitle').value.trim()||'Без назви', note: document.getElementById('pinNote').value.trim(), color: selectedColor })
  });
  await loadPins();
  openPin(currentPin.id);
  flashSave();
}

function flashSave() {
  const btn = document.getElementById('btnSave');
  btn.textContent = '✓ Збережено';
  btn.style.color = '#b8ff57';
  btn.style.borderColor = 'rgba(184,255,87,.4)';
  setTimeout(() => { btn.textContent = 'Зберегти'; btn.style.color=''; btn.style.borderColor=''; }, 1500);
}

async function deletePin() {
  if (!currentPin || !confirm(`Видалити "${currentPin.title}"?`)) return;
  await fetch(`/api/pins/${currentPin.id}`, { method: 'DELETE' });
  closeSidebar();
  await loadPins();
  await loadRoutes();
}

// ── SEARCH ────────────────────────────────────────────────────
function initSearch() {
  const input = document.getElementById('searchInput');
  const results = document.getElementById('searchResults');
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (q.length < 2) { results.classList.remove('open'); return; }
    searchTimer = setTimeout(async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!data.length) { results.classList.remove('open'); return; }
      results.innerHTML = data.map(d => `<div class="search-result-item" data-lat="${d.lat}" data-lng="${d.lng}">${d.name}</div>`).join('');
      results.classList.add('open');
      results.querySelectorAll('.search-result-item').forEach(item => {
        item.addEventListener('click', () => {
          map.setView([+item.dataset.lat, +item.dataset.lng], 14, { animate: true });
          results.classList.remove('open');
          input.value = '';
        });
      });
    }, 400);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrap')) results.classList.remove('open');
  });
}

// ── ROUTES ────────────────────────────────────────────────────
async function loadRoutes() {
  const res = await fetch('/api/routes');
  routes = await res.json();
  renderRouteLines();
  renderRoutesList();
}

function renderRouteLines() {
  routeLayers.forEach(l => map.removeLayer(l));
  routeLayers = [];
  routes.forEach(route => {
    if (route.pins.length < 2) return;
    const coords = route.pins.map(p => [p.lat, p.lng]);
    const line = L.polyline(coords, { color: route.color, weight: 3, opacity: .7, dashArray: '8,6' }).addTo(map);
    line.bindTooltip(route.name, { permanent: false, className: 'route-tooltip' });
    routeLayers.push(line);
  });
}

function renderRoutesList() {
  const list = document.getElementById('routesList');
  if (!routes.length) {
    list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text2);font-family:var(--font-mono);font-size:12px">Маршрутів ще немає.<br>Натисніть «Маршрут+» щоб створити!</div>';
    return;
  }
  list.innerHTML = routes.map(r => `
    <div class="route-item" onclick="focusRoute('${r.id}')">
      <div class="route-line" style="background:${r.color}"></div>
      <div class="route-info">
        <div class="route-name">${r.name}</div>
        <div class="route-stops">${r.pins.length} точок · ${r.created}</div>
      </div>
      <button class="route-del" onclick="deleteRoute('${r.id}',event)">✕</button>
    </div>`).join('');
}

function focusRoute(id) {
  const route = routes.find(r => r.id === id);
  if (!route || !route.pins.length) return;
  const bounds = L.latLngBounds(route.pins.map(p => [p.lat, p.lng]));
  map.fitBounds(bounds, { padding: [60, 60], animate: true });
}

async function deleteRoute(id, e) {
  e.stopPropagation();
  await fetch(`/api/routes/${id}`, { method: 'DELETE' });
  await loadRoutes();
}

// ── BUILD ROUTE ───────────────────────────────────────────────
function startBuildRoute() {
  buildingRoute = true;
  routePinIds = [];
  document.getElementById('routeBuilder').style.display = 'block';
  document.getElementById('rbPins').innerHTML = '';
  document.getElementById('rbName').value = '';
  renderRbChips();
  // Refresh markers to show route buttons in popups
  Object.values(markers).forEach(m => map.removeLayer(m));
  markers = {};
  pins.forEach(p => addMarker(p));
}

function addPinToRoute(pid) {
  if (routePinIds.includes(pid)) return;
  routePinIds.push(pid);
  renderRbChips();
}

function renderRbChips() {
  const container = document.getElementById('rbPins');
  container.innerHTML = routePinIds.map(pid => {
    const pin = pins.find(p => p.id === pid);
    return pin ? `<div class="rb-pin-chip" style="border-color:rgba(0,245,255,.3)">
      <span style="color:${pin.color}">●</span> ${pin.title}
      <button onclick="removePinFromRoute('${pid}')">✕</button>
    </div>` : '';
  }).join('');
  if (!routePinIds.length) container.innerHTML = '<div style="font-family:var(--font-mono);font-size:10px;color:var(--text2);font-style:italic">Ще не додано точок...</div>';
}

function removePinFromRoute(pid) {
  routePinIds = routePinIds.filter(id => id !== pid);
  renderRbChips();
}

async function saveRoute() {
  if (routePinIds.length < 2) { alert('Додайте хоча б 2 точки!'); return; }
  const name = document.getElementById('rbName').value.trim() || 'Маршрут';
  await fetch('/api/routes', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ name, color: routeColor, pin_ids: routePinIds })
  });
  cancelBuildRoute();
  await loadRoutes();
}

function cancelBuildRoute() {
  buildingRoute = false;
  routePinIds = [];
  document.getElementById('routeBuilder').style.display = 'none';
  Object.values(markers).forEach(m => map.removeLayer(m));
  markers = {};
  pins.forEach(p => addMarker(p));
}

// ── STATS ─────────────────────────────────────────────────────
function updateStats() {
  document.getElementById('pinCount').textContent = pins.length;
  document.getElementById('photoCount').textContent = pins.reduce((s,p)=>s+(p.photos?p.photos.length:0),0);
}

// ── DRAWER ────────────────────────────────────────────────────
function renderDrawer() {
  const list = document.getElementById('drawerList');
  if (!pins.length) {
    list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text2);font-family:var(--font-mono);font-size:12px">Точок ще немає.<br>Клікніть на карту щоб додати!</div>';
    return;
  }
  list.innerHTML = pins.map(p => `
    <div class="drawer-item" onclick="openPin('${p.id}');closeDrawers()">
      <div class="drawer-dot" style="background:${p.color};color:${p.color}"></div>
      <div class="drawer-info">
        <div class="drawer-name">${p.title}</div>
        <div class="drawer-date">${p.created}</div>
      </div>
      ${p.photos&&p.photos.length?`<span style="font-family:var(--font-mono);font-size:10px;color:var(--text2)">${p.photos.length}📷</span>`:''}
    </div>`).join('');
}

function closeDrawers() {
  document.getElementById('pinsDrawer').classList.remove('open');
  document.getElementById('routesDrawer').classList.remove('open');
}

// ── LIGHTBOX ──────────────────────────────────────────────────
function openLightbox(src, cap) {
  document.getElementById('lightboxImg').src = src;
  document.getElementById('lightboxCaption').textContent = cap;
  document.getElementById('lightbox').classList.add('open');
}
function closeLightbox() { document.getElementById('lightbox').classList.remove('open'); }

// ── TOOLTIP ───────────────────────────────────────────────────
function showTooltip() {
  const t = document.getElementById('newPinTooltip');
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// ── BIND UI ───────────────────────────────────────────────────
function bindUI() {
  document.getElementById('sidebarClose').onclick = closeSidebar;
  document.getElementById('btnSave').onclick = savePin;
  document.getElementById('btnDelete').onclick = deletePin;
  document.getElementById('lightboxClose').onclick = closeLightbox;
  document.getElementById('lightbox').onclick = e => { if(e.target===e.currentTarget) closeLightbox(); };
  document.getElementById('listToggle').onclick = () => { document.getElementById('pinsDrawer').classList.toggle('open'); document.getElementById('routesDrawer').classList.remove('open'); };
  document.getElementById('drawerClose').onclick = closeDrawers;
  document.getElementById('routeToggle').onclick = () => { document.getElementById('routesDrawer').classList.toggle('open'); document.getElementById('pinsDrawer').classList.remove('open'); };
  document.getElementById('routesDrawerClose').onclick = closeDrawers;
  document.getElementById('buildRouteBtn').onclick = startBuildRoute;
  document.getElementById('rbSave').onclick = saveRoute;
  document.getElementById('rbCancel').onclick = cancelBuildRoute;
  document.getElementById('rbClose').onclick = cancelBuildRoute;

  document.getElementById('rbColors').addEventListener('click', e => {
    const sw = e.target.closest('.swatch');
    if (!sw) return;
    routeColor = sw.dataset.color;
    document.querySelectorAll('#rbColors .swatch').forEach(s => s.classList.remove('active'));
    sw.classList.add('active');
  });

  document.getElementById('colorSwatches').addEventListener('click', e => {
    const sw = e.target.closest('.swatch');
    if (!sw) return;
    selectedColor = sw.dataset.color;
    document.querySelectorAll('#colorSwatches .swatch').forEach(s => s.classList.remove('active'));
    sw.classList.add('active');
    const dot = document.getElementById('pinColorDot');
    dot.style.background = selectedColor;
    dot.style.boxShadow = `0 0 12px ${selectedColor}`;
  });

  document.getElementById('pinTitle').addEventListener('keydown', e => { if(e.key==='Enter'){e.preventDefault();savePin();} });
  document.addEventListener('keydown', e => { if(e.key==='Escape'){closeSidebar();closeLightbox();closeDrawers();cancelBuildRoute();} });

  initSearch();
}