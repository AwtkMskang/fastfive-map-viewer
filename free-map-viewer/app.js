/* global L, Papa, Supercluster */
(() => {
  const DEFAULT_CENTER = [36.5, 127.8]; // Korea-ish
  const DEFAULT_ZOOM = 7;

  // === DOM ===
  const csvUrlEl = document.getElementById('csvUrl');
  const loadBtn = document.getElementById('loadBtn');
  const loadingEl = document.getElementById('loading');
  const loadingTextEl = document.getElementById('loadingText');
  const statsEl = document.getElementById('stats');
  const idSearchEl = document.getElementById('idSearch');
  const goBtn = document.getElementById('goBtn');
  const statusFilterEl = document.getElementById('statusFilter');

  // Allow config via query param: ?csv=...
  const urlParams = new URLSearchParams(location.search);
  const csvParam = urlParams.get('csv');
  if (csvParam) csvUrlEl.value = csvParam;

  // === Map ===
  const map = L.map('map', { preferCanvas: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  const layer = L.layerGroup().addTo(map);

  // === Data ===
  let clusterIndex = null;
  let pointsById = new Map(); // recordId -> {lat,lng, props}
  let allPointsCount = 0;

  // CSV column names (Korean + fallback)
  const COL_ID = ['레코드Id', 'recordId', 'id'];
  const COL_LAT = ['위도', 'lat', 'latitude'];
  const COL_LNG = ['경도', 'lng', 'lon', 'longitude'];
  const COL_ADDR = ['대지위치', 'address', 'addr'];
  const COL_STATUS = ['status', 'Status'];
  const COL_SFURL = ['Salesforce URL', 'salesforce_url', 'sf_url', 'SalesforceURL'];

  function pick(row, keys) {
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(row, k)) return row[k];
    }
    return undefined;
  }

  function setLoading(on, text) {
    if (on) loadingEl.classList.remove('hidden');
    else loadingEl.classList.add('hidden');
    if (text) loadingTextEl.textContent = text;
  }

  function formatCount(n) {
    return new Intl.NumberFormat('ko-KR').format(n);
  }

  function makeClusterIcon(count) {
    let cls = 'cluster-icon';
    if (count >= 10000) cls += ' xl';
    else if (count >= 1000) cls += ' lg';
    return L.divIcon({
      className: '',
      html: `<div class="${cls}">${formatCount(count)}</div>`,
      iconSize: [1, 1]
    });
  }

  function render() {
    if (!clusterIndex) return;

    layer.clearLayers();

    const bounds = map.getBounds();
    const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
    const zoom = map.getZoom();

    const statusFilter = statusFilterEl.value;

    const clusters = clusterIndex.getClusters(bbox, zoom);

    // Note: status filter is applied at point-level only.
    // For clusters, we keep them as-is (still useful). If you need status-aware clustering,
    // build two indices (status=1, status=0) and switch by filter.
    let renderedPoints = 0;
    let renderedClusters = 0;

    for (const c of clusters) {
      const [lng, lat] = c.geometry.coordinates;
      const p = c.properties;

      if (p.cluster) {
        renderedClusters++;
        const count = p.point_count;
        const marker = L.marker([lat, lng], { icon: makeClusterIcon(count) });
        marker.on('click', () => {
          // Zoom into cluster
          const expansionZoom = Math.min(clusterIndex.getClusterExpansionZoom(p.cluster_id), 19);
          map.setView([lat, lng], expansionZoom);
        });
        marker.addTo(layer);
      } else {
        // individual point
        const row = p.row || {};
        if (statusFilter !== 'all') {
          const s = String(row.status ?? '');
          if (s !== statusFilter) continue;
        }
        renderedPoints++;

        const circle = L.circleMarker([lat, lng], {
          radius: 5,
          weight: 1,
          fillOpacity: 0.9
        });

        const recordId = row.recordId ?? '';
        const addr = row.address ?? '';
        const sfUrl = row.sfUrl ?? '';
        const status = row.status ?? '';

        const safe = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({
          '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
        }[ch]));

        const popupHtml = `
          <div style="min-width:240px">
            <div style="font-weight:800;margin-bottom:6px">${safe(recordId)}</div>
            ${addr ? `<div style="font-size:12px;color:#333;margin-bottom:6px">${safe(addr)}</div>` : ''}
            <div style="font-size:12px;color:#555;margin-bottom:10px">위도/경도: ${lat.toFixed(6)}, ${lng.toFixed(6)}${status!==''?` · status=${safe(status)}`:''}</div>
            ${sfUrl ? `<a href="${safe(sfUrl)}" target="_blank" rel="noopener noreferrer" style="font-size:12px">Salesforce에서 열기</a>` : `<div style="font-size:12px;color:#888">Salesforce URL 없음</div>`}
          </div>
        `;
        circle.bindPopup(popupHtml);
        circle.addTo(layer);
      }
    }

    statsEl.textContent = `화면: 클러스터 ${formatCount(renderedClusters)} · 포인트 ${formatCount(renderedPoints)} · 전체 ${formatCount(allPointsCount)}`;
  }

  function buildIndex(points) {
    // Supercluster expects GeoJSON points with coordinates [lng,lat]
    clusterIndex = new Supercluster({
      radius: 60,
      maxZoom: 19
    });
    clusterIndex.load(points);
  }

  function normalizeRow(row) {
    const recordId = String(pick(row, COL_ID) ?? '').trim();
    const latRaw = pick(row, COL_LAT);
    const lngRaw = pick(row, COL_LNG);
    const address = String(pick(row, COL_ADDR) ?? '').trim();
    const status = pick(row, COL_STATUS);
    const sfUrl = String(pick(row, COL_SFURL) ?? '').trim();

    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    return { recordId, lat, lng, address, status, sfUrl };
  }

  async function loadFromCsvUrl(csvUrl) {
    setLoading(true, 'CSV 다운로드 및 파싱 중…');
    loadBtn.disabled = true;

    pointsById = new Map();

    return new Promise((resolve, reject) => {
      let rowCount = 0;
      const points = [];

      Papa.parse(csvUrl, {
        download: true,
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        worker: true,
        step: (results) => {
          rowCount++;
          if (rowCount % 5000 === 0) {
            loadingTextEl.textContent = `파싱 중… ${formatCount(rowCount)}행`;
          }

          const normalized = normalizeRow(results.data);
          if (!normalized) return;

          const { recordId, lat, lng, address, status, sfUrl } = normalized;

          const row = { recordId, address, status, sfUrl };

          if (recordId) pointsById.set(recordId, { lat, lng, row });

          points.push({
            type: 'Feature',
            properties: { row }, // keep lightweight
            geometry: { type: 'Point', coordinates: [lng, lat] }
          });
        },
        complete: () => {
          allPointsCount = points.length;
          resolve(points);
        },
        error: (err) => reject(err)
      });
    }).finally(() => {
      loadBtn.disabled = false;
      setLoading(false);
    });
  }

  async function startLoad() {
    const csvUrl = csvUrlEl.value.trim();
    if (!csvUrl) {
      alert('CSV URL을 입력해 주세요. (Google Sheets → 웹에 게시한 CSV URL)');
      return;
    }

    setLoading(true, '클러스터 인덱스 생성 중…');
    loadBtn.disabled = true;

    try {
      const points = await loadFromCsvUrl(csvUrl);

      // Build cluster index (can take a moment)
      setLoading(true, `클러스터 인덱스 생성 중… (${formatCount(points.length)} 포인트)`);
      buildIndex(points);

      // Fit to data bounds (rough sampling for speed)
      const sample = points.length > 50000 ? points.filter((_, i) => i % 20 === 0) : points;
      let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
      for (const f of sample) {
        const [lng, lat] = f.geometry.coordinates;
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
      }
      if (minLat <= maxLat && minLng <= maxLng) {
        map.fitBounds([[minLat, minLng], [maxLat, maxLng]], { padding: [20, 20] });
      }

      render();
    } catch (e) {
      console.error(e);
      alert('불러오기에 실패했습니다. CSV URL이 공개되어 있고, 헤더가 포함되어 있는지 확인해 주세요.');
    } finally {
      loadBtn.disabled = false;
      setLoading(false);
    }
  }

  function goToId() {
    const id = idSearchEl.value.trim();
    if (!id) return;

    const hit = pointsById.get(id);
    if (!hit) {
      alert('해당 레코드Id를 찾지 못했습니다.');
      return;
    }

    map.setView([hit.lat, hit.lng], Math.max(map.getZoom(), 16));
    // Ensure rendered, then open popup if exists
    render();
    // Find nearest marker to open popup: easiest is to add a temporary marker
    const temp = L.circleMarker([hit.lat, hit.lng], { radius: 9, weight: 2, fillOpacity: 0.15 });
    temp.addTo(layer);
    setTimeout(() => layer.removeLayer(temp), 2500);
  }

  // === Events ===
  loadBtn.addEventListener('click', startLoad);
  goBtn.addEventListener('click', goToId);
  idSearchEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') goToId(); });
  map.on('moveend zoomend', () => {
    // debounce-ish
    if (!clusterIndex) return;
    render();
  });

  statusFilterEl.addEventListener('change', () => {
    render();
  });

  // Auto-load if csv param is present
  if (csvParam) {
    // small delay to allow map layout
    setTimeout(() => startLoad(), 50);
  }
})();
