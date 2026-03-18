const CONFIG = {
  NEWS_API_KEY:        "f67241df6a0641b1a6bbd59a86500e9f",
  OPENSKY_USER:        "",
  OPENSKY_PASS:        "",
  ANTHROPIC_API_KEY:   "",
  GROQ_API_KEY:        "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",
  AIRCRAFT_REFRESH_MS: 60000,
  NEWS_REFRESH_MS:     300000,
  GDELT_REFRESH_MS:    120000,
  BRIEF_AUTO_HOURS:    8,
  AIRCRAFT_BBOX:       null,
  NEWS_QUERY:          "military OR conflict OR war OR nuclear OR missile OR NATO OR China OR Russia OR Iran OR DPRK",
  NEWS_LANGUAGE:       "en",
  NEWS_PAGE_SIZE:      30,
  GDELT_QUERY:         "conflict OR military OR war OR attack OR missile",
  GDELT_MAX_RECORDS:   50,
};

const STATE = {
  aircraftData: [],
  newsData:     [],
  gdeltData:    [],
  briefCount:   0,
  startTime:    Date.now(),
  anthropicKey: CONFIG.GROQ_API_KEY,
  sources: {
    opensky: { name: "OpenSky Network", status: "connecting", lastSync: null },
    newsapi: { name: "NewsAPI",         status: "connecting", lastSync: null },
    gdelt:   { name: "GDELT Project",   status: "connecting", lastSync: null },
    claude:  { name: "Groq AI (Llama)", status: "ready",      lastSync: null },
  },
};
// ============================================================
//  SENTINEL // API MODULE
//  Handles all real data fetching from live APIs
// ============================================================

// ── OPENSKY NETWORK ──────────────────────────────────────────
// Returns real-time aircraft positions (ADS-B transponders)
async function fetchAircraft() {
  try {
    let url = 'https://opensky-network.org/api/states/all';

    if (CONFIG.AIRCRAFT_BBOX) {
      const [lamin, lomin, lamax, lomax] = CONFIG.AIRCRAFT_BBOX;
      url += `?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;
    }

    // Add auth header if credentials provided
    const headers = {};
    if (CONFIG.OPENSKY_USER && CONFIG.OPENSKY_PASS) {
      headers['Authorization'] = 'Basic ' + btoa(`${CONFIG.OPENSKY_USER}:${CONFIG.OPENSKY_PASS}`);
    }

    const resp = await fetch(url, { headers });

    if (!resp.ok) throw new Error(`OpenSky HTTP ${resp.status}`);

    const data = await resp.json();
    STATE.sources.opensky.status = 'live';
    STATE.sources.opensky.lastSync = new Date();

    if (!data.states) return [];

    // OpenSky state vector fields:
    // [0]icao24 [1]callsign [2]origin_country [3]time_position [4]last_contact
    // [5]longitude [6]latitude [7]baro_altitude [8]on_ground [9]velocity
    // [10]true_track [11]vertical_rate [12]sensors [13]geo_altitude
    // [14]squawk [15]spi [16]position_source

    return data.states
      .filter(s => s[1] && s[5] !== null && s[6] !== null) // must have callsign + position
      .map(s => ({
        icao:       s[0],
        callsign:   (s[1] || '').trim(),
        country:    s[2] || 'Unknown',
        lon:        s[5],
        lat:        s[6],
        altitude:   s[7] ? Math.round(s[7]) : null,
        on_ground:  s[8],
        speed:      s[9] ? Math.round(s[9]) : null,
        heading:    s[10] ? Math.round(s[10]) : null,
        squawk:     s[14] || null,
      }));

  } catch (err) {
    console.error('OpenSky error:', err);
    STATE.sources.opensky.status = 'error';
    return null; // null = failed, [] = empty result
  }
}

// ── GDELT PROJECT ────────────────────────────────────────────
// Real-time global event database — conflict, protests, military
// 100% free, no API key needed
async function fetchGDELT() {
  try {
    const query = encodeURIComponent(CONFIG.GDELT_QUERY);
    const maxrecs = CONFIG.GDELT_MAX_RECORDS;

    // GDELT 2.0 Article Search API
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=artlist&maxrecords=${maxrecs}&sort=DateDesc&format=json`;

    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`GDELT HTTP ${resp.status}`);

    const data = await resp.json();
    STATE.sources.gdelt.status = 'live';
    STATE.sources.gdelt.lastSync = new Date();

    if (!data.articles) return [];

    return data.articles.map(a => ({
      title:   a.title || 'Untitled',
      url:     a.url || '#',
      source:  a.domain || 'Unknown',
      date:    a.seendate ? formatGDELTDate(a.seendate) : 'Unknown',
      lang:    a.language || 'en',
      country: a.sourcecountry || '',
      // Derive rough geo from title keywords for map plotting
      geo:     inferGeo(a.title || ''),
    }));

  } catch (err) {
    console.error('GDELT error:', err);
    STATE.sources.gdelt.status = 'error';
    return null;
  }
}

// ── NEWSAPI ───────────────────────────────────────────────────
// Live news headlines — requires free API key from newsapi.org
async function fetchNews(filterKeyword = '') {
  try {
    if (!CONFIG.NEWS_API_KEY || CONFIG.NEWS_API_KEY === 'YOUR_NEWSAPI_KEY_HERE') {
      STATE.sources.newsapi.status = 'no-key';
      return getMockNews(); // graceful fallback
    }

    const q = filterKeyword || CONFIG.NEWS_QUERY;
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&language=${CONFIG.NEWS_LANGUAGE}&pageSize=${CONFIG.NEWS_PAGE_SIZE}&sortBy=publishedAt&apiKey=${CONFIG.NEWS_API_KEY}`;

    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`NewsAPI HTTP ${resp.status}`);

    const data = await resp.json();

    if (data.status !== 'ok') {
      throw new Error(data.message || 'NewsAPI error');
    }

    STATE.sources.newsapi.status = 'live';
    STATE.sources.newsapi.lastSync = new Date();

    return data.articles.map(a => ({
      title:       a.title || 'Untitled',
      description: a.description || '',
      url:         a.url || '#',
      source:      (a.source && a.source.name) || 'Unknown',
      publishedAt: a.publishedAt ? new Date(a.publishedAt) : new Date(),
      category:    inferCategory(a.title + ' ' + (a.description || '')),
    }));

  } catch (err) {
    console.error('NewsAPI error:', err);
    STATE.sources.newsapi.status = 'error';
    return getMockNews();
  }
}

// ── GROQ AI (Free Claude replacement) ────────────────────────
// Uses Llama 3.3 70B via Groq — 100% free, no credit card
async function fetchAIBrief(context) {
  const key = CONFIG.GROQ_API_KEY || STATE.anthropicKey;
  if (!key) throw new Error('No Groq API key — get one free at console.groq.com');

  const systemPrompt = `You are a senior intelligence analyst at a global OSINT monitoring center.
Write concise, classified-style intelligence briefs using analyst tradecraft.
Format each priority exactly like this:
[PRIORITY N — THEATER]: Analysis sentence. Recommendation sentence.
Use labels: [PRIORITY 1 — HIGH THREAT], [PRIORITY 2 — ...], [WATCH — ...], [ASSESSMENT]
Keep each item under 50 words. Be specific, clinical, actionable.
End with: CONFIDENCE: X% | SOURCES ANALYZED: Y | NEXT BRIEF: T+8HRS`;

  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + key,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 1000,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: context },
      ],
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err.error && err.error.message) || `Groq HTTP ${resp.status}`);
  }

  const data = await resp.json();
  STATE.sources.claude.status = 'live';
  STATE.sources.claude.lastSync = new Date();

  return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || 'No response from Groq';
}

// ── HELPER UTILITIES ──────────────────────────────────────────

function formatGDELTDate(d) {
  // GDELT date format: YYYYMMDDHHMMSS
  if (!d || d.length < 8) return d;
  return `${d.substr(0,4)}-${d.substr(4,2)}-${d.substr(6,2)} ${d.substr(8,2)}:${d.substr(10,2)}Z`;
}

function inferCategory(text) {
  const t = text.toLowerCase();
  if (/nuclear|nuke|warhead|icbm/.test(t)) return { label: 'NUCLEAR', color: '#ff3b3b' };
  if (/missile|rocket|launch|ballistic/.test(t)) return { label: 'MISSILE', color: '#ff3b3b' };
  if (/china|pla|taiwan|beijing/.test(t)) return { label: 'CHINA', color: '#ffb300' };
  if (/russia|ukraine|kremlin|nato|suwalki/.test(t)) return { label: 'EUROPE', color: '#ff3b3b' };
  if (/iran|irgc|hormuz|persian/.test(t)) return { label: 'IRAN', color: '#ffb300' };
  if (/north korea|dprk|pyongyang|kim/.test(t)) return { label: 'DPRK', color: '#ff3b3b' };
  if (/cyber|hack|breach|malware|ransomware/.test(t)) return { label: 'CYBER', color: '#00c8ff' };
  if (/military|troops|army|navy|air force/.test(t)) return { label: 'MILITARY', color: '#b06bff' };
  if (/attack|bomb|explosion|strike/.test(t)) return { label: 'ATTACK', color: '#ff3b3b' };
  if (/africa|sahel|sudan|mali|niger/.test(t)) return { label: 'AFRICA', color: '#ffb300' };
  return { label: 'INTEL', color: '#00c8ff' };
}

// Rough geo inference from article title for map plotting
function inferGeo(title) {
  const t = title.toLowerCase();
  const geoMap = [
    { rx: /ukraine|kyiv|donetsk|kharkiv|zaporizhzhia/, lat: 49.0, lon: 32.0 },
    { rx: /russia|moscow|kremlin|siberia/, lat: 55.7, lon: 37.6 },
    { rx: /china|beijing|taiwan|pla|shanghai/, lat: 35.0, lon: 105.0 },
    { rx: /taiwan/, lat: 23.5, lon: 121.0 },
    { rx: /north korea|dprk|pyongyang/, lat: 39.0, lon: 125.7 },
    { rx: /iran|tehran|irgc|hormuz/, lat: 32.0, lon: 53.0 },
    { rx: /israel|gaza|west bank|hamas/, lat: 31.5, lon: 34.8 },
    { rx: /syria|damascus|aleppo/, lat: 35.0, lon: 38.0 },
    { rx: /iraq|baghdad/, lat: 33.3, lon: 44.4 },
    { rx: /nato|poland|baltic|estonia|latvia|lithuania/, lat: 54.0, lon: 24.0 },
    { rx: /afghanistan|kabul/, lat: 34.5, lon: 69.2 },
    { rx: /pakistan|islamabad/, lat: 33.7, lon: 73.0 },
    { rx: /india|delhi|mumbai/, lat: 22.0, lon: 78.0 },
    { rx: /sudan|mali|niger|sahel|africa corps/, lat: 12.0, lon: 25.0 },
    { rx: /yemen|houthi|sanaa/, lat: 15.5, lon: 48.5 },
    { rx: /red sea|bab-el-mandeb/, lat: 15.0, lon: 42.0 },
    { rx: /south china sea/, lat: 12.0, lon: 114.0 },
  ];
  for (const { rx, lat, lon } of geoMap) {
    if (rx.test(t)) return { lat, lon };
  }
  return null;
}

// ── MOCK FALLBACKS (when APIs not configured) ─────────────────

function getMockNews() {
  STATE.sources.newsapi.status = 'demo';
  return [
    { title: 'NATO activates rapid reaction force amid Baltic exercises', description: 'Alliance officials confirm elevated readiness posture following unusual armored movements.', url: '#', source: 'Demo Mode', publishedAt: new Date(), category: { label: 'EUROPE', color: '#ff3b3b' } },
    { title: 'DPRK conducts ballistic missile test over Sea of Japan', description: 'South Korea and Japan issue alerts. Projectile analyzed as medium-range type.', url: '#', source: 'Demo Mode', publishedAt: new Date(Date.now() - 600000), category: { label: 'DPRK', color: '#ff3b3b' } },
    { title: 'US carrier USS Nimitz enters Persian Gulf', description: 'Second carrier deployment in 60 days amid rising Iran tensions in Strait of Hormuz.', url: '#', source: 'Demo Mode', publishedAt: new Date(Date.now() - 1200000), category: { label: 'IRAN', color: '#ffb300' } },
    { title: 'PLA air incursion near Taiwan exceeds monthly record', description: '42 aircraft detected in 24-hour period including Y-20 tankers indicating extended operations.', url: '#', source: 'Demo Mode', publishedAt: new Date(Date.now() - 2400000), category: { label: 'CHINA', color: '#ffb300' } },
    { title: 'Coordinated cyberattacks target Eastern European energy grid', description: 'CERT reports intrusion attempts on SCADA systems in four countries. APT28 signature consistent.', url: '#', source: 'Demo Mode', publishedAt: new Date(Date.now() - 3600000), category: { label: 'CYBER', color: '#00c8ff' } },
    { title: 'Wagner/Africa Corps convoy movements confirmed in Sahel', description: 'Satellite imagery shows redeployment in Mali and Niger under new Africa Corps command structure.', url: '#', source: 'Demo Mode', publishedAt: new Date(Date.now() - 5400000), category: { label: 'AFRICA', color: '#ffb300' } },
  ];
}

function getMockAircraft() {
  return [
    { icao: 'ae1234', callsign: 'RCH102', country: 'United States', lat: 36.2, lon: 30.5, altitude: 10360, speed: 247, heading: 95, on_ground: false },
    { icao: 'ae5678', callsign: 'NATO17', country: 'Netherlands', lat: 57.1, lon: 20.4, altitude: 8992, speed: 211, heading: 45, on_ground: false },
    { icao: 'ae9012', callsign: 'MAGMA89', country: 'United Kingdom', lat: 43.2, lon: 34.6, altitude: 10972, speed: 254, heading: 180, on_ground: false },
    { icao: '780000', callsign: 'SHF001', country: 'United States', lat: 12.5, lon: 112.3, altitude: 6400, speed: 190, heading: 270, on_ground: false },
    { icao: 'ra1111', callsign: 'INDEF5', country: 'Russia', lat: 72.1, lon: 55.0, altitude: 12800, speed: 298, heading: 180, on_ground: false },
    { icao: 'fe0001', callsign: 'FR4012', country: 'France', lat: 26.5, lon: 56.8, altitude: 5486, speed: 267, heading: 120, on_ground: false },
    { icao: 'ae3333', callsign: 'COBRA31', country: 'United States', lat: 30.1, lon: 33.5, altitude: 7620, speed: 118, heading: 200, on_ground: false },
    { icao: 'ja0099', callsign: 'JAL991', country: 'Japan', lat: 35.8, lon: 131.2, altitude: 9449, speed: 221, heading: 90, on_ground: false },
  ];
}
// ============================================================
//  SENTINEL // MAP MODULE
//  World map + animated aircraft/event overlay
// ============================================================

let mapAnimId = null;

// Convert lat/lon → canvas x/y (simple equirectangular)
function latLonToXY(lat, lon, W, H) {
  const x = ((lon + 180) / 360) * W;
  const y = ((90 - lat) / 180) * H;
  return { x, y };
}

// Minimal world landmass outline as normalized [lon, lat] pairs
const LAND_DOTS = [
  // North America
  [-125,49],[-123,46],[-120,40],[-118,35],[-117,32],[-112,29],[-105,23],[-95,18],
  [-90,15],[-85,10],[-80,8],[-77,7],[-75,10],[-72,18],[-70,22],[-75,28],
  [-80,32],[-81,38],[-75,42],[-70,44],[-67,47],[-66,50],[-60,47],[-57,48],
  [-55,50],[-65,55],[-75,60],[-85,65],[-90,70],[-100,75],[-110,72],[-120,68],
  [-130,60],[-135,58],[-140,55],[-148,62],[-155,65],[-160,60],[-165,55],
  // Central / South America
  [-90,15],[-88,12],[-85,8],[-80,5],[-75,0],[-70,-5],[-65,-10],[-60,-15],
  [-55,-20],[-50,-25],[-48,-28],[-43,-23],[-40,-20],[-38,-13],[-35,-8],
  [-37,-5],[-44,-3],[-50,0],[-55,2],[-60,5],[-63,10],[-68,12],
  // Europe
  [-10,36],[0,38],[5,40],[10,42],[12,44],[14,40],[16,38],[18,40],[20,42],
  [22,40],[26,38],[28,40],[30,45],[28,50],[26,54],[24,58],[22,60],[20,64],
  [18,68],[15,70],[10,63],[5,58],[0,52],[-2,48],[-5,44],[-8,38],[-10,36],
  // Africa
  [-17,14],[-15,10],[-12,5],[-8,4],[-4,5],[0,5],[5,5],[10,4],[15,5],
  [20,8],[25,12],[30,15],[35,18],[38,20],[42,12],[44,8],[40,2],[36,-2],
  [32,-5],[28,-10],[24,-14],[20,-18],[16,-22],[12,-26],[18,-30],[26,-34],
  [30,-30],[33,-25],[36,-20],[40,-10],[42,-1],[44,4],[48,8],[50,12],
  [44,12],[42,14],[38,14],[34,10],[30,4],[26,2],[22,4],[18,8],[14,12],
  [10,14],[6,14],[2,14],[-2,13],[-6,13],[-10,13],[-14,13],[-17,14],
  // Middle East
  [35,30],[38,34],[40,38],[42,36],[44,34],[46,30],[48,26],[50,24],
  [52,26],[56,24],[60,22],[55,18],[50,14],[45,12],[42,12],[40,14],
  [38,16],[36,20],[34,26],[35,30],
  // Asia
  [40,38],[45,42],[50,45],[55,50],[60,55],[65,60],[70,65],[75,68],
  [80,72],[90,72],[100,68],[110,65],[120,62],[130,58],[135,55],[140,50],
  [145,45],[140,40],[135,34],[130,30],[125,26],[120,22],[115,20],[110,18],
  [105,14],[100,10],[98,8],[95,5],[100,2],[104,0],[108,-4],[110,-8],
  [116,-8],[120,-4],[124,0],[128,4],[132,8],[130,14],[126,20],[122,26],
  [118,30],[116,35],[114,40],[112,44],[108,48],[104,52],[100,55],[95,52],
  [90,46],[85,40],[80,34],[76,28],[72,22],[68,20],[64,22],[60,25],
  [56,26],[52,30],[48,30],[44,30],[40,36],[38,36],
  // SE Asia / Oceania
  [100,18],[102,16],[104,12],[106,10],[108,14],[110,18],[112,22],
  [120,26],[125,20],[130,14],[135,8],[138,4],[135,0],[130,-5],[125,-10],
  [130,-15],[135,-20],[140,-18],[145,-14],[148,-18],[152,-22],[155,-28],
  [152,-32],[148,-36],[144,-38],[140,-36],[138,-32],[134,-26],[130,-20],
  [125,-18],[122,-22],[118,-20],[115,-24],[112,-26],[116,-30],[120,-34],
  [116,-32],[114,-28],[112,-24],[110,-20],[105,-8],[102,-4],[100,2],
  // Japan
  [130,32],[132,34],[134,36],[136,38],[138,40],[140,42],[142,44],[144,42],
  [142,40],[140,38],[138,36],[136,34],[134,32],[132,30],[130,32],
];

function drawWorldMap(ctx, W, H, t) {
  // Landmass dots
  LAND_DOTS.forEach(([lon, lat]) => {
    const { x, y } = latLonToXY(lat, lon, W, H);
    if (x < 0 || x > W || y < 0 || y > H) return;
    ctx.beginPath();
    ctx.arc(x, y, 1.2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,200,255,0.14)';
    ctx.fill();
  });

  // Grid
  ctx.strokeStyle = 'rgba(0,200,255,0.03)';
  ctx.lineWidth = 0.5;
  for (let i = 1; i < 8; i++) {
    ctx.beginPath(); ctx.moveTo(0, i * H / 8); ctx.lineTo(W, i * H / 8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(i * W / 8, 0); ctx.lineTo(i * W / 8, H); ctx.stroke();
  }

  // Equator
  ctx.strokeStyle = 'rgba(0,200,255,0.08)';
  ctx.lineWidth = 0.8;
  ctx.setLineDash([6, 6]);
  const eq = latLonToXY(0, 0, W, H);
  ctx.beginPath(); ctx.moveTo(0, eq.y); ctx.lineTo(W, eq.y); ctx.stroke();
  ctx.setLineDash([]);
}

function drawAircraft(ctx, W, H, t) {
  const aircraft = STATE.aircraftData.length > 0 ? STATE.aircraftData : getMockAircraft();

  aircraft.forEach(a => {
    if (a.lat === null || a.lon === null) return;
    const { x, y } = latLonToXY(a.lat, a.lon, W, H);
    if (x < 0 || x > W || y < 0 || y > H) return;

    if (a.on_ground) {
      // On ground: dim gray square
      ctx.fillStyle = 'rgba(100,150,180,0.4)';
      ctx.fillRect(x - 2, y - 2, 4, 4);
    } else {
      // In flight: amber dot with pulse
      const pulse = (Math.sin(t / 800 + a.lat) + 1) / 2;
      ctx.beginPath();
      ctx.arc(x, y, 3 + pulse * 2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,179,0,${0.08 + pulse * 0.06})`;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fillStyle = '#ffb300';
      ctx.fill();
    }
  });
}

function drawGDELTEvents(ctx, W, H, t) {
  STATE.gdeltData.forEach((ev, i) => {
    if (!ev.geo) return;
    const { x, y } = latLonToXY(ev.geo.lat, ev.geo.lon, W, H);
    if (x < 0 || x > W || y < 0 || y > H) return;

    const phase = ((t + i * 400) % 2200) / 2200;
    const r = 6 + phase * 18;
    const alpha = (1 - phase) * 0.5;

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,59,59,${alpha})`;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#ff3b3b';
    ctx.fill();
  });
}

function startMapAnimation() {
  const cv = document.getElementById('map-canvas');
  if (!cv) return;

  function resize() {
    cv.width = cv.offsetWidth;
    cv.height = cv.offsetHeight;
  }
  resize();
  window.addEventListener('resize', () => { resize(); });

  function frame() {
    const W = cv.width, H = cv.height;
    if (!W || !H) { mapAnimId = requestAnimationFrame(frame); return; }
    const ctx = cv.getContext('2d');
    const t = Date.now();

    ctx.clearRect(0, 0, W, H);
    drawWorldMap(ctx, W, H, t);
    drawGDELTEvents(ctx, W, H, t);
    drawAircraft(ctx, W, H, t);

    mapAnimId = requestAnimationFrame(frame);
  }
  frame();
}

function stopMapAnimation() {
  if (mapAnimId) cancelAnimationFrame(mapAnimId);
}

// ── HEATMAP ───────────────────────────────────────────────────

function renderHeatmap() {
  const cv = document.getElementById('heatmap-canvas');
  const container = cv.parentElement;
  cv.width = container.offsetWidth;
  cv.height = container.offsetHeight;
  const W = cv.width, H = cv.height;
  const ctx = cv.getContext('2d');

  ctx.fillStyle = '#06090d';
  ctx.fillRect(0, 0, W, H);

  // Draw landmass base
  LAND_DOTS.forEach(([lon, lat]) => {
    const { x, y } = latLonToXY(lat, lon, W, H);
    ctx.beginPath();
    ctx.arc(x, y, 1, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,200,255,0.08)';
    ctx.fill();
  });

  // GDELT-based hotspots + static well-known zones
  const zones = buildConflictZones();

  zones.forEach(z => {
    const { x, y } = latLonToXY(z.lat, z.lon, W, H);
    const r = Math.max(25, z.intensity * 0.55);
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);

    const alpha = z.intensity / 100;
    if (z.intensity >= 70) {
      grad.addColorStop(0,   `rgba(255,59,59,${alpha})`);
      grad.addColorStop(0.5, `rgba(255,59,59,${alpha * 0.4})`);
      grad.addColorStop(1,   'rgba(255,59,59,0)');
    } else if (z.intensity >= 40) {
      grad.addColorStop(0,   `rgba(255,179,0,${alpha})`);
      grad.addColorStop(0.5, `rgba(255,179,0,${alpha * 0.4})`);
      grad.addColorStop(1,   'rgba(255,179,0,0)');
    } else {
      grad.addColorStop(0,   `rgba(0,200,255,${alpha * 0.8})`);
      grad.addColorStop(0.5, `rgba(0,200,255,${alpha * 0.3})`);
      grad.addColorStop(1,   'rgba(0,200,255,0)');
    }

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    // Label
    const col = z.intensity >= 70 ? '#ff3b3b' : z.intensity >= 40 ? '#ffb300' : '#00c8ff';
    ctx.fillStyle = col;
    ctx.font = 'bold 9px "Share Tech Mono",monospace';
    ctx.textAlign = 'center';
    ctx.fillText(z.name.toUpperCase(), x, y - r * 0.35 - 2);
  });

  // Legend
  const legend = document.getElementById('heatmap-legend');
  legend.innerHTML = `
    <div class="legend-item"><div class="legend-dot" style="background:#ff3b3b"></div>CRITICAL (≥70)</div>
    <div class="legend-item"><div class="legend-dot" style="background:#ffb300"></div>ELEVATED (40–70)</div>
    <div class="legend-item"><div class="legend-dot" style="background:#00c8ff"></div>WATCH (≤40)</div>
    <div class="legend-item" style="margin-left:auto;font-family:'Share Tech Mono',monospace;font-size:9px;color:#6a8fa8">GDELT + STATIC BASELINE • ${zones.length} ZONES</div>
  `;
}

function buildConflictZones() {
  const base = [
    { name: 'Ukraine',       lat: 49.0, lon:  32.0, intensity: 92 },
    { name: 'Suwalki Gap',   lat: 54.3, lon:  23.2, intensity: 68 },
    { name: 'DPRK',          lat: 39.5, lon: 127.0, intensity: 78 },
    { name: 'Taiwan Strait', lat: 24.0, lon: 120.5, intensity: 74 },
    { name: 'S. China Sea',  lat: 12.0, lon: 114.0, intensity: 55 },
    { name: 'Red Sea',       lat: 15.5, lon:  42.0, intensity: 60 },
    { name: 'Persian Gulf',  lat: 26.5, lon:  53.0, intensity: 52 },
    { name: 'Sahel',         lat: 14.0, lon:   2.0, intensity: 44 },
    { name: 'Gaza / Sinai',  lat: 31.5, lon:  34.5, intensity: 70 },
    { name: 'Arctic',        lat: 75.0, lon:  30.0, intensity: 22 },
    { name: 'Baltic',        lat: 57.0, lon:  22.0, intensity: 32 },
    { name: 'Afghanistan',   lat: 33.0, lon:  65.0, intensity: 38 },
  ];

  // Boost intensity for zones mentioned in live GDELT data
  if (STATE.gdeltData.length > 0) {
    const titles = STATE.gdeltData.map(e => e.title.toLowerCase()).join(' ');
    base.forEach(z => {
      const name = z.name.toLowerCase().split(' ')[0];
      const mentions = (titles.match(new RegExp(name, 'g')) || []).length;
      z.intensity = Math.min(99, z.intensity + mentions * 3);
    });
  }

  return base;
}
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
