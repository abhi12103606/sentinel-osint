// ============================================================
//  SENTINEL // UI MODULE
//  All DOM rendering functions
// ============================================================

let allAircraftRaw = [];
let allNewsRaw = [];
let activeView = 'dashboard';

// ── VIEW SWITCHING ────────────────────────────────────────────
function switchView(v) {
  activeView = v;
  document.querySelectorAll('.nav-btn').forEach((b, i) => b.classList.remove('active'));
  const btns = document.querySelectorAll('.nav-btn');
  const idx = { dashboard: 0, aircraft: 1, news: 2, heatmap: 3, briefs: 4 };
  if (btns[idx[v]]) btns[idx[v]].classList.add('active');

  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  const el = document.getElementById('view-' + v);
  if (el) el.classList.add('active');

  if (v === 'heatmap') setTimeout(renderHeatmap, 60);
}

// ── AIRCRAFT LIST (sidebar) ───────────────────────────────────
function renderAircraftList(data) {
  allAircraftRaw = data;
  filterAircraft('');
  document.getElementById('ac-badge').textContent = data.length + ' ACTIVE';
  document.getElementById('ac-full-badge').textContent = data.length + ' LIVE';
  document.getElementById('sn-aircraft').textContent = data.length;
  document.getElementById('hud-ac').textContent = data.length;
}

function filterAircraft(q) {
  const list = document.getElementById('aircraft-list');
  const filtered = q
    ? allAircraftRaw.filter(a =>
        a.callsign.toLowerCase().includes(q.toLowerCase()) ||
        a.country.toLowerCase().includes(q.toLowerCase()))
    : allAircraftRaw;

  if (filtered.length === 0) {
    list.innerHTML = '<div class="loading-msg">No aircraft match search</div>';
    return;
  }

  // Show first 30 in sidebar
  list.innerHTML = filtered.slice(0, 30).map(a => `
    <div class="asset-row">
      <div style="flex:1;min-width:0">
        <div class="asset-id">${a.callsign || a.icao}</div>
        <div class="asset-sub">${a.country}${a.altitude ? ' · ' + a.altitude + 'm' : ''}</div>
      </div>
      <div class="asset-right" style="color:${a.on_ground ? '#6a8fa8' : '#ffb300'}">
        ${a.on_ground ? 'GND' : (a.speed ? a.speed + 'm/s' : 'AIR')}
        ${a.heading !== null ? '<br>' + a.heading + '°' : ''}
      </div>
    </div>
  `).join('');

  // Full table
  const tbody = document.getElementById('aircraft-table-body');
  if (tbody) {
    tbody.innerHTML = filtered.map(a => `
      <tr>
        <td style="color:${a.callsign ? 'var(--bright)' : 'var(--text)'}">${a.callsign || a.icao}</td>
        <td>${a.country}</td>
        <td style="color:var(--b)">${a.altitude !== null ? a.altitude : '—'}</td>
        <td style="color:var(--a)">${a.speed !== null ? a.speed : '—'}</td>
        <td>${a.heading !== null ? a.heading + '°' : '—'}</td>
        <td style="font-size:10px;color:var(--text)">${a.lat !== null ? a.lat.toFixed(2) : '—'}</td>
        <td style="font-size:10px;color:var(--text)">${a.lon !== null ? a.lon.toFixed(2) : '—'}</td>
        <td style="color:${a.on_ground ? 'var(--g)' : 'var(--text)'}">${a.on_ground ? 'YES' : 'NO'}</td>
      </tr>
    `).join('');
  }
}

// ── INTEL FEED (sidebar) ──────────────────────────────────────
function renderIntelFeed(gdeltData) {
  const feed = document.getElementById('intel-feed');
  if (!gdeltData || gdeltData.length === 0) {
    feed.innerHTML = '<div class="loading-msg">No GDELT data yet...</div>';
    return;
  }

  const items = gdeltData.slice(0, 20);
  feed.innerHTML = items.map(ev => {
    const lvl = getLvl(ev.title);
    return `
      <div class="intel-item ${lvl}" onclick="window.open('${ev.url}','_blank')">
        <div class="intel-time">${formatRelTime(ev.date)} · ${ev.source}</div>
        <div class="intel-text">${truncate(ev.title, 90)}</div>
        ${ev.country ? `<div class="intel-src">SRC: ${ev.country} · GDELT</div>` : '<div class="intel-src">SRC: GDELT</div>'}
      </div>
    `;
  }).join('');

  document.getElementById('sn-events').textContent = gdeltData.length;
  document.getElementById('hud-ev').textContent = gdeltData.length;

  // Update threat index based on GDELT volume
  const threatPct = Math.min(99, 40 + gdeltData.length * 0.8);
  document.getElementById('threat-fill').style.width = Math.round(threatPct) + '%';
  const label = threatPct > 75 ? 'CRITICAL' : threatPct > 55 ? 'ELEVATED' : 'MODERATE';
  document.getElementById('threat-pct').textContent = `${label} — ${Math.round(threatPct)}%`;
  document.getElementById('sn-threats').textContent = gdeltData.filter(e => getLvl(e.title) === 'h').length;
}

// ── NEWS FEED ─────────────────────────────────────────────────
function renderNews(data) {
  allNewsRaw = data;
  filterNews('');
  document.getElementById('news-badge').textContent = data.length + ' ARTICLES';
  document.getElementById('sn-news').textContent = data.length;
  document.getElementById('hud-news').textContent = data.length;
}

function filterNews(keyword) {
  const feed = document.getElementById('news-feed');
  const filtered = keyword
    ? allNewsRaw.filter(n => n.title.toLowerCase().includes(keyword.toLowerCase()) || (n.description || '').toLowerCase().includes(keyword.toLowerCase()))
    : allNewsRaw;

  if (filtered.length === 0) {
    feed.innerHTML = '<div class="loading-msg">No articles match filter</div>';
    return;
  }

  feed.innerHTML = filtered.map(n => `
    <a class="news-item" href="${n.url}" target="_blank">
      <div class="news-cat" style="color:${n.category.color};border-color:${n.category.color}33;background:${n.category.color}11">
        ${n.category.label}
      </div>
      <div class="news-body">
        <div class="news-title">${n.title}</div>
        ${n.description ? `<div class="news-snippet">${n.description}</div>` : ''}
        <div class="news-meta">${formatRelTime(n.publishedAt)} · ${n.source}</div>
      </div>
    </a>
  `).join('');
}

// ── CONFLICT ZONES (right panel) ──────────────────────────────
function renderConflictZones() {
  const zones = buildConflictZones();
  const el = document.getElementById('conflict-zones');

  el.innerHTML = zones.sort((a, b) => b.intensity - a.intensity).slice(0, 8).map(z => {
    const col = z.intensity >= 70 ? 'var(--r)' : z.intensity >= 40 ? 'var(--a)' : 'var(--b)';
    return `
      <div class="conflict-zone-item">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span class="zone-name">${z.name}</span>
          <span style="font-family:'Share Tech Mono',monospace;font-size:9px;color:${col}">${z.intensity}</span>
        </div>
        <div class="zone-bar"><div class="zone-fill" style="width:${z.intensity}%;background:${col}"></div></div>
        <div class="zone-meta">${z.intensity >= 70 ? 'CRITICAL' : z.intensity >= 40 ? 'ELEVATED' : 'WATCH'} · GDELT+BASELINE</div>
      </div>
    `;
  }).join('');
}

// ── SOURCE STATUS (right panel) ───────────────────────────────
function renderSources() {
  const el = document.getElementById('source-list');
  el.innerHTML = Object.values(STATE.sources).map(s => {
    const col = s.status === 'live' ? 'var(--g)' : s.status === 'error' ? 'var(--r)' : s.status === 'demo' ? 'var(--a)' : 'var(--text)';
    const label = s.status === 'live' ? 'LIVE' : s.status === 'error' ? 'ERROR' : s.status === 'no-key' ? 'NO KEY' : s.status === 'demo' ? 'DEMO' : 'WAIT';
    return `
      <div class="source-item">
        <span class="source-name">${s.name.toUpperCase()}</span>
        <span class="source-status" style="color:${col}">${label}${s.lastSync ? ' · ' + formatRelTime(s.lastSync) : ''}</span>
      </div>
    `;
  }).join('');

  // Feed status pill
  const allLive = Object.values(STATE.sources).filter(s => s.name !== 'Claude AI').every(s => s.status === 'live' || s.status === 'demo');
  const pill = document.getElementById('feed-status');
  if (allLive) {
    pill.innerHTML = '<span class="dot g"></span>FEEDS LIVE';
    pill.className = 'pill live';
  } else {
    pill.innerHTML = '<span class="dot a"></span>PARTIAL';
    pill.className = 'pill warn';
  }
}

// ── TICKER ────────────────────────────────────────────────────
function updateTicker() {
  const parts = [];

  if (STATE.aircraftData.length) {
    parts.push(`OPENSKY: ${STATE.aircraftData.length} aircraft tracked`);
    const inFlight = STATE.aircraftData.filter(a => !a.on_ground).length;
    parts.push(`${inFlight} airborne`);
  }

  if (STATE.gdeltData.length) {
    parts.push(`GDELT: ${STATE.gdeltData.length} conflict events indexed`);
    STATE.gdeltData.slice(0, 3).forEach(e => parts.push(truncate(e.title, 60)));
  }

  if (STATE.newsData.length) {
    parts.push(`NEWSAPI: ${STATE.newsData.length} headlines`);
    STATE.newsData.slice(0, 3).forEach(n => parts.push(truncate(n.title, 60)));
  }

  parts.push('SENTINEL OSINT — REAL-TIME GLOBAL INTELLIGENCE');
  parts.push(`UPTIME: ${formatUptime(Date.now() - STATE.startTime)}`);

  const text = parts.map(p => ` // ${p} `).join('') + ' ';
  const el = document.getElementById('ticker-text');
  el.textContent = text.repeat(2);
}

// ── AI BRIEF ──────────────────────────────────────────────────
async function generateBrief() {
  const btn1 = document.getElementById('gen-brief-btn');
  const btn2 = document.querySelector('.right-panel .ai-btn');
  const setLoading = (v) => {
    [btn1, btn2].forEach(b => { if (b) { b.disabled = v; b.textContent = v ? '⚡ AI ANALYST THINKING...' : '⚡ GENERATE LIVE AI INTELLIGENCE BRIEF'; } });
    if (btn2 && !v) btn2.textContent = '⚡ AI BRIEF NOW';
  };

  setLoading(true);
  switchView('briefs');

  const gdeltSummary = STATE.gdeltData.slice(0, 8).map((e, i) => `${i+1}. ${e.title} (${e.source})`).join('\n');
  const newsSummary  = STATE.newsData.slice(0, 6).map((n, i) => `${i+1}. ${n.title} (${n.source})`).join('\n');
  const acCount      = STATE.aircraftData.filter(a => !a.on_ground).length;

  const context = `You are analyzing live OSINT data from multiple real-time feeds.

LIVE GDELT CONFLICT EVENTS (last 2hrs):
${gdeltSummary || 'No GDELT data loaded'}

LIVE NEWS HEADLINES:
${newsSummary || 'No news data loaded'}

LIVE AIRCRAFT: ${acCount} tracked airborne

Generate an intelligence brief with 3-4 priorities using ONLY this data. Be specific about what's in the data above.`;

  try {
    const text = await fetchAIBrief(context);
    addBriefCard(text, true);
    STATE.briefCount++;
    document.getElementById('sn-briefs').textContent = STATE.briefCount;
    STATE.sources.claude.status = 'live';
    STATE.sources.claude.lastSync = new Date();
    renderSources();
    hideBanner();
  } catch (err) {
    addBriefCard(getFallbackBrief(), false, 'FALLBACK: ' + err.message);
    STATE.briefCount++;
    document.getElementById('sn-briefs').textContent = STATE.briefCount;
  }

  setLoading(false);
}

function addBriefCard(text, isAI, note) {
  const now = new Date();
  const timeStr = now.getUTCHours().toString().padStart(2, '0') + ':' + now.getUTCMinutes().toString().padStart(2, '0') + 'Z';

  const formatted = text
    .replace(/\[PRIORITY\s+(\d+)\s*[—-]\s*([^\]]+)\]/gi, '<span class="hi">[$1 — $2]</span>')
    .replace(/\[WATCH[^\]]*\]/gi, s => `<span class="wa">${s}</span>`)
    .replace(/\[ASSESSMENT[^\]]*\]/gi, s => `<span class="ok">${s}</span>`)
    .replace(/(CONFIDENCE:[^\n|]+)/gi, s => `<span class="ok">${s}</span>`)
    .replace(/\n/g, '<br>');

  const card = document.createElement('div');
  card.className = `brief-card ${isAI ? 'ai' : ''}`;
  card.innerHTML = `
    <div class="brief-head ${isAI ? 'ai' : ''}">
      ${isAI ? '⚡' : '⚠'} INTELLIGENCE BRIEF — ${timeStr} — ${isAI ? 'CLAUDE AI LIVE' : 'DEMO'}
    </div>
    <div class="brief-body">${formatted}</div>
    <div class="brief-meta">
      ${isAI ? 'GENERATED BY CLAUDE SONNET · LIVE OSINT CONTEXT · ' : 'DEMO MODE · '}
      SOURCES: GDELT(${STATE.gdeltData.length}) NEWS(${STATE.newsData.length}) AIRCRAFT(${STATE.aircraftData.length})
      ${note ? ' · ' + note : ''}
    </div>
  `;

  const list = document.getElementById('briefs-list');
  list.insertBefore(card, list.firstChild);
}

function getFallbackBrief() {
  const gdeltCount = STATE.gdeltData.length;
  const newsCount = STATE.newsData.length;
  const topNews = (STATE.newsData[0] && STATE.newsData[0].title) || 'No live news loaded';

  return `[PRIORITY 1 — LIVE DATA]: ${gdeltCount} GDELT events and ${newsCount} news articles analyzed. Top headline: "${topNews.substring(0, 80)}..."

[PRIORITY 2 — AIRCRAFT]: ${STATE.aircraftData.filter(a => !a.on_ground).length} aircraft currently tracked airborne via OpenSky Network.

[WATCH — STATUS]: Add your Anthropic API key in the AI Briefs panel to enable live AI analysis of this data.

CONFIDENCE: N/A | SOURCES ANALYZED: ${gdeltCount + newsCount} | NEXT BRIEF: T+8HRS`;
}

// ── API KEY HANDLING ──────────────────────────────────────────
function saveApiKey() {
  const val = document.getElementById('anthropic-key').value.trim();
  if (!val.startsWith('sk-ant')) {
    alert('Invalid key format. Should start with sk-ant-...');
    return;
  }
  STATE.anthropicKey = val;
  sessionStorage.setItem('anthropic_key', val);
  STATE.sources.claude.status = 'ready';
  hideBanner();
  renderSources();
  generateBrief();
}

function hideBanner() {
  if (STATE.anthropicKey) {
    const banner = document.getElementById('api-key-banner');
    if (banner) banner.style.display = 'none';
  }
}

// ── UPTIME COUNTER ────────────────────────────────────────────
function updateUptime() {
  const ms = Date.now() - STATE.startTime;
  document.getElementById('sn-uptime').textContent = formatUptime(ms);
}

// ── HELPERS ───────────────────────────────────────────────────
function getLvl(title) {
  const t = (title || '').toLowerCase();
  if (/nuclear|missile launch|attack|explosion|bomb|war|invasion|dprk|strike/.test(t)) return 'h';
  if (/military|conflict|troops|exercise|threat|tension|warning/.test(t)) return 'm';
  return 'l';
}

function truncate(str, n) {
  return str && str.length > n ? str.slice(0, n) + '...' : str;
}

function formatRelTime(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt)) return String(d).substring(0, 16);
  const diff = Math.floor((Date.now() - dt) / 1000);
  if (diff < 60) return diff + 's ago';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'hr ago';
  return Math.floor(diff / 86400) + 'd ago';
}

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return h + 'h ' + (m % 60) + 'm';
  return m + 'm ' + (s % 60) + 's';
}

function formatAlertCount(gdelt, news) {
  const high = (gdelt || []).filter(e => getLvl(e.title) === 'h').length
             + (news || []).filter(n => getLvl(n.title) === 'h').length;
  document.getElementById('alert-count').textContent = high + ' ALERTS';
  if (high > 0) {
    document.getElementById('conflict-pill').style.display = 'flex';
  }
}
