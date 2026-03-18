// ============================================================
//  SENTINEL // OSINT — API CONFIGURATION
//  Fill in your API keys below before running
// ============================================================

const CONFIG = {

  // ── NewsAPI ──────────────────────────────────────────────
  // Free key at: https://newsapi.org/register
  // Allows 100 requests/day on free tier
  NEWS_API_KEY: 'YOUR_NEWSAPI_KEY_HERE',

  // ── OpenSky Network ──────────────────────────────────────
  // No key required for anonymous (rate limited: 10 req/min)
  // For higher limits, register at: https://opensky-network.org
  // Leave empty for anonymous access
  OPENSKY_USER: '',
  OPENSKY_PASS: '',

  // ── GDELT Project ────────────────────────────────────────
  // 100% free, no key required — uses public GDELT 2.0 API
  // Docs: https://blog.gdeltproject.org/gdelt-2-0-our-global-database-of-society/

  // ── Anthropic — not used, replaced by Groq ───────────────
  ANTHROPIC_API_KEY: '',

  // ── Groq (FREE replacement for Claude) ───────────────────
  // Free key from: https://console.groq.com
  GROQ_API_KEY: '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',

  // ── Refresh intervals (ms) ───────────────────────────────
  AIRCRAFT_REFRESH_MS:  60000,   // 60s (OpenSky rate limit)
  NEWS_REFRESH_MS:      300000,  // 5 min
  GDELT_REFRESH_MS:     120000,  // 2 min
  BRIEF_AUTO_HOURS:     8,       // Auto-generate brief every N hours

  // ── Map settings ─────────────────────────────────────────
  // Bounding box for OpenSky aircraft query [lamin, lomin, lamax, lomax]
  // Set to null to fetch all aircraft globally (slower)
  AIRCRAFT_BBOX: null,

  // ── NewsAPI query ─────────────────────────────────────────
  // Keywords for geopolitical news
  NEWS_QUERY: 'military OR conflict OR war OR nuclear OR missile OR NATO OR China OR Russia OR Iran OR DPRK',
  NEWS_LANGUAGE: 'en',
  NEWS_PAGE_SIZE: 30,

  // ── GDELT query ───────────────────────────────────────────
  GDELT_QUERY: 'conflict OR military OR war OR attack OR missile',
  GDELT_MAX_RECORDS: 50,

};

// Runtime state — do not modify
const STATE = {
  aircraftData: [],
  newsData: [],
  gdeltData: [],
  briefCount: 0,
  startTime: Date.now(),
  anthropicKey: sessionStorage.getItem('anthropic_key') || CONFIG.ANTHROPIC_API_KEY,
  sources: {
    opensky: { name: 'OpenSky Network', status: 'connecting', lastSync: null },
    newsapi: { name: 'NewsAPI', status: 'connecting', lastSync: null },
    gdelt:   { name: 'GDELT Project', status: 'connecting', lastSync: null },
    claude:  { name: 'Claude AI', status: CONFIG.ANTHROPIC_API_KEY ? 'ready' : 'no-key', lastSync: null },
  }
};
