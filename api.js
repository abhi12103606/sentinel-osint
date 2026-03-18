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
