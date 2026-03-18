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
