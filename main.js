// ============================================================
//  SENTINEL // MAIN — Boot & Orchestration
// ============================================================

// ── UTC CLOCK ─────────────────────────────────────────────────
function tickClock() {
  const n = new Date();
  const s = n.getUTCHours().toString().padStart(2,'0') + ':' +
            n.getUTCMinutes().toString().padStart(2,'0') + ':' +
            n.getUTCSeconds().toString().padStart(2,'0') + 'Z';
  document.getElementById('utc-clock').textContent = s;
}
setInterval(tickClock, 1000);
tickClock();

// ── OPENSKY FETCH ─────────────────────────────────────────────
async function loadAircraft() {
  const data = await fetchAircraft();
  if (data === null) {
    // fetch failed — use mock data
    STATE.aircraftData = getMockAircraft();
    renderAircraftList(STATE.aircraftData);
    updateTicker();
    return;
  }
  STATE.aircraftData = data.length > 0 ? data : getMockAircraft();
  renderAircraftList(STATE.aircraftData);
  updateTicker();
  document.getElementById('hud-sync').textContent = new Date().toISOString().substr(11,5)+'Z';
  renderSources();
}

// ── GDELT FETCH ───────────────────────────────────────────────
async function loadGDELT() {
  const data = await fetchGDELT();
  if (data === null) {
    // failed — inject minimal mock intel
    STATE.gdeltData = [
      { title: 'Military exercises reported near Baltic states', url: '#', source: 'GDELT (fallback)', date: new Date().toISOString(), country: 'EU', geo: { lat: 57, lon: 22 } },
      { title: 'Missile test detected in East Asia region', url: '#', source: 'GDELT (fallback)', date: new Date().toISOString(), country: 'DPRK', geo: { lat: 39, lon: 127 } },
      { title: 'Naval activity surge reported in Strait of Hormuz', url: '#', source: 'GDELT (fallback)', date: new Date().toISOString(), country: 'IR', geo: { lat: 26, lon: 56 } },
    ];
  } else {
    STATE.gdeltData = data;
  }
  renderIntelFeed(STATE.gdeltData);
  renderConflictZones();
  renderSources();
  updateTicker();
  formatAlertCount(STATE.gdeltData, STATE.newsData);
  if (activeView === 'heatmap') renderHeatmap();
}

// ── NEWSAPI FETCH ─────────────────────────────────────────────
async function loadNews(filter) {
  const data = await fetchNews(filter || '');
  STATE.newsData = data || getMockNews();
  renderNews(STATE.newsData);
  renderSources();
  updateTicker();
  formatAlertCount(STATE.gdeltData, STATE.newsData);
}

// ── PERIODIC REFRESHES ────────────────────────────────────────
function startRefreshCycles() {
  setInterval(loadAircraft, CONFIG.AIRCRAFT_REFRESH_MS);
  setInterval(loadGDELT,    CONFIG.GDELT_REFRESH_MS);
  setInterval(loadNews,     CONFIG.NEWS_REFRESH_MS);
  setInterval(renderSources, 15000);
  setInterval(updateUptime,  10000);
  setInterval(updateTicker,  30000);

  // Auto-brief every N hours
  if (CONFIG.BRIEF_AUTO_HOURS > 0) {
    setInterval(() => {
      if (STATE.anthropicKey) generateBrief();
    }, CONFIG.BRIEF_AUTO_HOURS * 3600 * 1000);
  }
}

// ── INIT ──────────────────────────────────────────────────────
async function init() {
  // Start map animation immediately
  startMapAnimation();

  // If key already saved in session, hide banner
  if (STATE.anthropicKey) hideBanner();

  // Render source status
  renderSources();

  // Load all data in parallel
  await Promise.all([
    loadAircraft(),
    loadGDELT(),
    loadNews(),
  ]);

  // Start periodic refresh
  startRefreshCycles();

  // Initial ticker
  updateTicker();

  console.log('[SENTINEL] All feeds initialized.');
}

// Boot
window.addEventListener('DOMContentLoaded', init);
