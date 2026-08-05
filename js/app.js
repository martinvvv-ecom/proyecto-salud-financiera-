/* ============================================================
   UTILIDADES GENERALES
   ============================================================ */
const $   = id => document.getElementById(id);
const fmt = v  => '$' + Math.round(v).toLocaleString('es-CL');
const pct = (v, t) => t > 0 ? Math.round(v / t * 100) : 0;

let donutChart = null, trendChart = null;

// ============================================================
// REQ 2 & 3: ESTADO GLOBAL DE MONEDA DEL SIMULADOR
// indUF e indUSD se populan cuando fetchIndicadores() responde.
// simMoneda controla qué prefijo y límites se usan en todo el simulador.
// ============================================================
let simMoneda = 'CLP';   // 'CLP' | 'UF' | 'USD'
let indUF     = 38000;   // valor por defecto hasta que responda la API
let indUSD    = 1000;    // valor por defecto hasta que responda la API
// PART 1 (Chile 2026): UTM se usa como base legal para el tope del bono APV Régimen A (6 UTM)
let indUTM    = 66832;   // valor por defecto 2026 (~$66.832 por UTM)

// Retorna colores adaptativos para Chart.js según el modo actual
function chartTheme() {
  const dark = document.body.classList.contains('dark');
  return {
    grid: dark ? '#1c3530' : '#e2ece9',
    tick: dark ? '#4d7a72' : '#7a9490',
    font: "'Plus Jakarta Sans', sans-serif"
  };
}

/* ============================================================
   FEATURE 2: PERSISTENCIA CON localStorage
   Claves: sf_budget | sf_income | sf_debt | sf_sim | sf_mes | sf_dark
   ============================================================ */
// EDIT 4: GAMIFICACIÓN — puntos extra del Score por badges ganados
// Se suma al score base calculado en dashUpdate()
let badgeScore = 0;

const LS = {
  budget : 'sf_budget_rows',
  income : 'sf_income',
  debt   : 'sf_debt',
  sim    : 'sf_simulator',
  mes    : 'sf_mes',
  dark   : 'sf_dark_mode',
  venc   : 'sf_vencimientos',  // FEAT E: calendario de vencimientos
  badges : 'sf_badges',         // EDIT 4: gamificación — badges ganados
  debts  : 'sf_debts',          // Simulador de deudas
  ofertas: 'sf_ofertas'         // Comparador de ofertas
};

// EDIT 4: badges ganados (se carga de localStorage)
let earnedBadges = [];

/** Guarda el estado completo del presupuesto en localStorage */
function saveAll() {
  try {
    localStorage.setItem(LS.budget, JSON.stringify(budgetRows));
    localStorage.setItem(LS.income, $('b-ingreso').value);
    localStorage.setItem(LS.debt,   $('b-deuda').value);
    localStorage.setItem(LS.mes,    $('b-mes').value);
    localStorage.setItem(LS.venc,   JSON.stringify(vencRows));
    localStorage.setItem(LS.badges, JSON.stringify(earnedBadges)); // EDIT 4
  } catch(e) { console.warn('localStorage no disponible:', e); }
}

/** Guarda los parámetros del simulador en localStorage */
function saveSim() {
  try {
    const d = {
      monto  : $('s-monto').value,
      plazo  : $('s-plazo').value,
      tasa   : $('s-tasa').value,
      tipo   : $('s-tipo').value,
      ingreso: $('s-ingreso').value,
      otras  : $('s-otras').value,
      moneda : simMoneda   // REQ 2: persistir moneda seleccionada
    };
    localStorage.setItem(LS.sim, JSON.stringify(d));
  } catch(e) {}
}

/** Carga todos los datos guardados al iniciar la app */
function loadFromStorage() {
  try {
    // Presupuesto
    const savedBudget = localStorage.getItem(LS.budget);
    if (savedBudget) budgetRows = JSON.parse(savedBudget);

    const savedIncome = localStorage.getItem(LS.income);
    if (savedIncome) $('b-ingreso').value = savedIncome;

    const savedDebt = localStorage.getItem(LS.debt);
    if (savedDebt) $('b-deuda').value = savedDebt;

    const savedMes = localStorage.getItem(LS.mes);
    if (savedMes) $('b-mes').value = savedMes;

    // Simulador
    const savedSim = localStorage.getItem(LS.sim);
    if (savedSim) {
      const d = JSON.parse(savedSim);
      $('s-monto').value   = d.monto;
      $('s-plazo').value   = d.plazo;
      $('s-tasa').value    = d.tasa;
      $('s-tipo').value    = d.tipo;
      $('s-ingreso').value = d.ingreso;
      $('s-otras').value   = d.otras;
      // REQ 2: restaurar moneda y reconfigurar slider sin llamar a la API todavía
      if (d.moneda && ['CLP','UF','USD'].includes(d.moneda)) {
        simMoneda = d.moneda;
        ['CLP','UF','USD'].forEach(m => $('cur-' + m).classList.toggle('active', m === d.moneda));
        const cfg = getSliderConfig(d.moneda);
        $('s-monto').min   = cfg.min;
        $('s-monto').max   = cfg.max;
        $('s-monto').step  = cfg.step;
        $('s-monto-min').textContent = cfg.minLbl;
        $('s-monto-max').textContent = cfg.maxLbl;
        if (cfg.chip) { $('s-rate-chip').textContent = cfg.chip; $('s-rate-chip').classList.remove('hidden'); }
      }
    }
  } catch(e) { console.warn('Error al cargar datos:', e); }

  // FEAT E: cargar vencimientos
  try {
    const savedVenc = localStorage.getItem(LS.venc);
    if (savedVenc) vencRows = JSON.parse(savedVenc);
  } catch(e) {}
}

/* ============================================================
   FEATURE 3: MODO OSCURO
   Añade/quita la clase 'dark' en <body> y guarda la preferencia
   ============================================================ */
function toggleDarkMode() {
  const isDark = document.body.classList.toggle('dark');
  $('dark-icon').textContent = isDark ? '☀️' : '🌙';
  try { localStorage.setItem(LS.dark, isDark ? '1' : '0'); } catch(e) {}
  // Refrescar gráficos para adaptar colores
  dashUpdate();
}

/** Aplica el modo guardado al cargar la página */
function applyDarkMode() {
  try {
    const saved = localStorage.getItem(LS.dark);
    if (saved === '1') {
      document.body.classList.add('dark');
      $('dark-icon').textContent = '☀️';
    }
  } catch(e) {}
}

/* ============================================================
   FEATURE 5: INDICADORES ECONÓMICOS EN VIVO
   Hace fetch a https://mindicador.cl/api y muestra UF y Dólar
   ============================================================ */
async function fetchIndicadores() {
  try {
    const res  = await fetch('https://mindicador.cl/api');
    const data = await res.json();

    const uf    = data.uf?.valor;
    const dolar = data.dolar?.valor;
    // PART 1 (Chile 2026): capturar UTM para cálculo legal del tope APV (6 UTM)
    const utm   = data.utm?.valor;
    const fecha = new Date(data.uf?.fecha).toLocaleDateString('es-CL', { day:'2-digit', month:'short' });

    const fmtInd = v => v ? '$' + v.toLocaleString('es-CL', { maximumFractionDigits: 2 }) : 'N/D';

    // Topbar desktop
    $('ind-uf').innerHTML  = fmtInd(uf);
    $('ind-usd').innerHTML = fmtInd(dolar);

    // Drawer móvil
    $('m-ind-uf').textContent  = fmtInd(uf);
    $('m-ind-usd').textContent = fmtInd(dolar);

    $('indicators-widget').title = `Valores al ${fecha} · UTM: ${fmtInd(utm)}`;

    // REQ 3: Guardar tasas en variables globales para el simulador y APV.
    if (uf    && uf    > 0) indUF  = uf;
    if (dolar && dolar > 0) indUSD = dolar;
    // PART 1: sobrescribir UTM con valor real de la API
    if (utm   && utm   > 0) indUTM = utm;

    // Refrescar los límites del slider si el usuario ya cambió la moneda
    if (simMoneda !== 'CLP') onCurrencyChange(simMoneda);

  } catch(err) {
    ['ind-uf','ind-usd','m-ind-uf','m-ind-usd'].forEach(id => {
      const el = $(id);
      if (el) el.textContent = 'N/D';
    });
    console.warn('mindicador.cl no disponible:', err);
  }
}

/* ============================================================
   NAVEGACIÓN
   ============================================================ */
function navigate(page, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-pill').forEach(b => b.classList.remove('active'));
  $('page-' + page).classList.add('active');
  document.querySelectorAll('.nav-pill').forEach(b => {
    if (b.getAttribute('onclick')?.includes("'" + page + "'")) b.classList.add('active');
  });
  if (page === 'dashboard')      dashUpdate();
  if (page === 'simulador')      { simUpdate(); debtUpdate(); ofertaUpdate(); }
  if (page === 'presupuesto')    { renderBudgetTable(); budgetCalc(); renderVenc(); }
  if (page === 'inversiones')    invUpdate();
  if (page === 'autos')          autosUpdate();
  if (page === 'emprendedores')  { siiCalc(); ivaCalc(); }
  if (page === 'about')          { runAboutCountUp(); }
  updateNavIndicator();
  updateMobileTitle();
}

function updateNavIndicator() {
  const active = document.querySelector('.topbar-nav .nav-pill.active');
  const nav    = document.querySelector('.topbar-nav');
  const ind    = document.getElementById('nav-indicator');
  if (!active || !ind || !nav) return;
  const ar = active.getBoundingClientRect();
  const nr = nav.getBoundingClientRect();
  ind.style.left  = (ar.left - nr.left) + 'px';
  ind.style.width = ar.width + 'px';
}

function updateMobileTitle() {
  const active  = document.querySelector('.topbar-nav .nav-pill.active');
  const titleEl = document.getElementById('mobile-section-title');
  if (!active || !titleEl) return;
  const clone = active.cloneNode(true);
  const icon  = clone.querySelector('span');
  if (icon) icon.remove();
  titleEl.textContent = clone.textContent.trim();
}

function toggleMobileMenu() {
  const open = $('mobile-drawer').classList.toggle('open');
  $('drawer-overlay').classList.toggle('open', open);
}
function closeMobileMenu() {
  $('mobile-drawer').classList.remove('open');
  $('drawer-overlay').classList.remove('open');
}

/* ============================================================
   FEATURE 1: DASHBOARD — SINGLE SOURCE OF TRUTH
   Lee de budgetRows (gastos reales), b-ingreso y b-deuda.
   No tiene inputs propios.
   ============================================================ */
function dashUpdate() {
  // ► Fuente única: leer del módulo Presupuesto
  const ing = parseFloat($('b-ingreso').value) || 0;
  const gas = budgetRows.reduce((s, r) => s + (r.real || 0), 0);
  const deu = parseFloat($('b-deuda').value) || 0;
  const aho = Math.max(ing - gas, 0);

  // Actualizar tarjetas del dashboard (solo lectura)
  $('d-ingreso').textContent = fmt(ing);
  $('d-gasto').textContent   = fmt(gas);
  $('d-deuda').textContent   = fmt(deu);
  $('d-ahorro').textContent  = fmt(aho);

  // ============================================================
  // FEAT A: SCORE FINANCIERO 0–1000 + VELOCÍMETRO
  // Reglas de puntuación:
  //   Ahorro > 20% ingresos → +350 pts (máximo)
  //   Ahorro 10–20%         → +175 pts
  //   Gastos > 80% ingresos → −300 pts
  //   Gastos 65–80%         → −150 pts
  //   Deuda > 30% ingresos  → −250 pts
  //   Deuda 15–30%          → −100 pts
  //   Base                  → 600 pts
  // ============================================================
  const ahoroPct = ing > 0 ? (aho / ing) * 100 : 0;
  const gastoPct = ing > 0 ? (gas / ing) * 100 : 100;
  const deudaPct = ing > 0 ? ((deu / 12) / ing) * 100 : 0;

  let score = 600;
  // Ahorro
  let ptAhorro = 0;
  if (ahoroPct >= 20)     { score += 350; ptAhorro = +350; }
  else if (ahoroPct >= 10){ score += 175; ptAhorro = +175; }
  // Gastos
  let ptGasto = 0;
  if (gastoPct > 80)      { score -= 300; ptGasto = -300; }
  else if (gastoPct > 65) { score -= 150; ptGasto = -150; }
  // Deuda mensual
  let ptDeuda = 0;
  if (deudaPct > 30)      { score -= 250; ptDeuda = -250; }
  else if (deudaPct > 15) { score -= 100; ptDeuda = -100; }

  score = Math.max(0, Math.min(1000, score));

  // EDIT 4: sumar puntos permanentes de badges ganados (50 pts por badge)
  score = Math.min(1000, score + badgeScore);

  // Clasificación
  let scoreLabel, scoreCls, scoreColor;
  if      (score >= 800) { scoreLabel='Perfil Excelente';     scoreCls='excellent'; scoreColor='#1da077'; }
  else if (score >= 650) { scoreLabel='Buen Perfil';          scoreCls='good';      scoreColor='#3b82f6'; }
  else if (score >= 450) { scoreLabel='Perfil Moderado';      scoreCls='moderate';  scoreColor='#f59e0b'; }
  else                    { scoreLabel='Requiere Atención';   scoreCls='critical';  scoreColor='#ef4444'; }

  // Actualizar score factors
  $('sf-ahorro').textContent = ahoroPct.toFixed(1) + '%';
  $('sf-gasto').textContent  = gastoPct.toFixed(1) + '%';
  $('sf-deuda').textContent  = deudaPct.toFixed(1) + '%';
  $('sf-puntos-ahorro').textContent = (ptAhorro >= 0 ? '+' : '') + ptAhorro;
  $('sf-puntos-ahorro').style.color = ptAhorro > 0 ? 'var(--green-600)' : 'var(--muted)';
  $('sf-puntos-gasto').textContent  = ptGasto;
  $('sf-puntos-gasto').style.color  = ptGasto < 0 ? 'var(--red-500)' : 'var(--muted)';
  $('sf-puntos-deuda').textContent  = ptDeuda;
  $('sf-puntos-deuda').style.color  = ptDeuda < 0 ? 'var(--red-500)' : 'var(--muted)';

  // Dibujar velocímetro SVG (animado — Mejora 5)
  $('gauge-score').style.color = '#fff';
  animateGaugeScore(score, scoreColor);
  $('gauge-label').textContent = scoreLabel;
  $('gauge-label').className   = 'gauge-label';
  $('gauge-label').style.cssText = 'background:rgba(255,255,255,.15);color:#fff;';

  // UX1: RESUMEN EJECUTIVO ANUALIZADO — texto dinámico basado en score y ahorro
  const ahorroAnual  = aho * 12;
  const deudaRatio   = ing > 0 ? (deu / ing) : 0;
  let execText = '';
  if (ahorroAnual <= 0) {
    execText = `⚠️ Este mes no estás generando ahorro. Si mantienes el presupuesto actual, terminarás el año con un <strong>déficit acumulado</strong>. Prioridad: reducir gastos o aumentar ingresos.`;
  } else {
    const inversion = score >= 800
      ? `Como tu perfil es excelente y tus deudas están controladas, te sugerimos evaluar el <strong>S&P 500</strong> o un <strong>APV Régimen A</strong> para hacer crecer ese capital.`
      : score >= 650
      ? `Con ese monto, considera un <strong>Fondo Mutuo</strong> o un <strong>Depósito a Plazo</strong> como primer paso inversor.`
      : deudaRatio > 3
      ? `Sin embargo, tus deudas aún son altas. Destina al menos el 50% de ese ahorro a <strong>pagar deuda</strong> y el resto a un fondo de emergencias.`
      : `Como paso inicial, completa tu <strong>Fondo de Emergencias</strong> (3–6 meses de gastos) antes de invertir.`;
    execText = `Si mantienes este presupuesto, ahorrarás <strong style="color:var(--green-600)">${fmt(ahorroAnual)}</strong> al año. ${inversion}`;
  }
  const execEl = $('exec-summary-text');
  if (execEl) execEl.innerHTML = execText;

  // PART 3 — INSIGHT 1: Alerta contextual bajo el velocímetro según score
  const insightScore = $('score-insight');
  insightScore.style.display = 'flex';
  if (score < 450) {
    insightScore.className = 'alert danger';
    insightScore.innerHTML = `<span class="alert-icon">🚨</span><div><strong>Acción urgente:</strong> Tu perfil financiero requiere atención inmediata. Comienza por revisar el <strong>Método Bola de Nieve</strong> en la sección <a href="#" onclick="navigate('educativa',document.querySelector('.nav-pill'))" style="color:inherit;text-decoration:underline">Aprende y Crece</a> para empezar a salir de deudas hoy.</div>`;
  } else if (score < 650) {
    insightScore.className = 'alert warning';
    insightScore.innerHTML = `<span class="alert-icon">💡</span><div><strong>Sigue mejorando:</strong> Estás en el camino correcto pero aún hay margen. Revisa los módulos de <strong>Ahorro y Presupuesto</strong> para subir tu score. Intenta llevar el ahorro mensual al 20% de tus ingresos.</div>`;
  } else {
    insightScore.className = 'alert success';
    insightScore.innerHTML = `<span class="alert-icon">🏆</span><div><strong>¡Felicidades!</strong> Tu perfil financiero es <strong>${scoreLabel}</strong>. Es el momento ideal para hacer crecer tu patrimonio. Visita la sección <a href="#" onclick="navigate('inversiones',document.querySelector('.nav-pill'))" style="color:inherit;text-decoration:underline">Inversiones & APV</a> y descubre el poder del interés compuesto.</div>`;
  }

  const th = chartTheme();

  // Gráfico de dona
  const donutData = [gas, aho, deu / 12];
  const donutCols = ['#ef4444','#1da077','#f59e0b'];
  const donutLbls = ['Gastos', 'Ahorro disponible', 'Cuota deuda est.'];
  const ctx = $('donut-chart').getContext('2d');
  if (donutChart) donutChart.destroy();
  donutChart = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: donutLbls, datasets: [{ data: donutData, backgroundColor: donutCols, borderWidth: 3, borderColor: document.body.classList.contains('dark') ? '#111e1b' : '#fff', hoverBorderWidth: 3 }] },
    options: { responsive: false, cutout: '65%', animation: { animateScale: true },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: i => ' ' + fmt(i.raw) } } } }
  });
  $('donut-legend').innerHTML = donutLbls.map((l, i) =>
    `<div style="display:flex;align-items:center;justify-content:space-between;font-size:12.5px;padding:3px 0">
       <div style="display:flex;align-items:center;gap:8px">
         <span style="width:10px;height:10px;border-radius:50%;background:${donutCols[i]};display:inline-block;flex-shrink:0"></span>
         <span style="color:var(--muted)">${l}</span>
       </div>
       <span style="font-weight:600;color:var(--ink)">${fmt(donutData[i])}</span>
     </div>`).join('');

  // Barras por categoría real
  const catMap = {};
  budgetRows.forEach(r => {
    catMap[r.cat] = (catMap[r.cat] || 0) + r.real;
  });
  const catPalette = ['#0f5240','#126b53','#d97706','#1d4ed8','#dc2626','#7c3aed','#0891b2','#db2777','#6b7280'];
  let barsHtml = '';
  Object.keys(catMap).forEach(ci => {
    const lbl = catConfig[ci]?.label || 'Otro';
    const val = catMap[ci] || 0;
    const p   = ing > 0 ? pct(val, ing) : 0;
    barsHtml += `<div class="bar-row">
      <span class="bar-cat" style="width:110px;font-size:12px">${lbl}</span>
      <div class="bar-track2"><div class="bar-fill2" style="width:${p}%;background:${catPalette[ci] || '#6b7280'}"></div></div>
      <span class="bar-amount" style="width:75px;font-size:11.5px">${fmt(val)}</span>
    </div>`;
  });
  $('dash-bars').innerHTML = barsHtml || '<div style="font-size:13px;color:var(--muted)">Agrega gastos en la pestaña Presupuesto.</div>';

  const rulePct = pct(gas, ing);
  $('dash-rule').innerHTML = `<div style="margin-bottom:4px"><strong>Regla 50/30/20:</strong></div>
    <div>Destinas el <strong>${rulePct}%</strong> de tus ingresos a gastos. ${rulePct <= 50 ? '✅ Dentro del rango ideal.' : rulePct <= 70 ? '⚠️ Un poco elevado.' : '🔴 Por encima del límite recomendado.'}</div>`;

  // Línea de tendencia (últimos 6 meses simulados desde ahorro actual)
  const months   = ['Oct', 'Nov', 'Dic', 'Ene', 'Feb', 'Mar'];
  const saveData = [.70, .80, .60, .85, .90, 1.00].map(f => Math.max(aho * f, 0));
  const tCtx     = $('trend-chart').getContext('2d');
  if (trendChart) trendChart.destroy();
  trendChart = new Chart(tCtx, {
    type: 'line',
    data: { labels: months, datasets: [{ label: 'Ahorro disponible', data: saveData, borderColor: '#1da077', backgroundColor: 'rgba(29,160,119,.08)', fill: true, tension: 0.4, pointBackgroundColor: '#1da077', pointRadius: 4, borderWidth: 2.5 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: i => ' ' + fmt(i.raw) } } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { family: th.font }, color: th.tick } },
        y: { grid: { color: th.grid }, ticks: { callback: v => '$' + (v/1000) + 'k', color: th.tick, font: { family: th.font } } }
      }
    }
  });

  // Alertas automáticas
  const alertsEl = $('dash-alerts');
  let html = '';
  if (aho <= 0)              html += `<div class="alert danger mb1"><span class="alert-icon">🚨</span><div><strong>Déficit detectado:</strong> Tus gastos superan tus ingresos. Revisa tus gastos fijos urgentemente.</div></div>`;
  else if (aho < ing * 0.10) html += `<div class="alert warning mb1"><span class="alert-icon">⚠️</span><div><strong>Ahorro bajo:</strong> Solo el ${pct(aho,ing)}% de tus ingresos queda libre. El mínimo recomendado es 10–20%.</div></div>`;
  if (deu > ing * 4)         html += `<div class="alert warning mb1"><span class="alert-icon">⚠️</span><div><strong>Deuda elevada:</strong> Tu deuda supera 4 veces tu ingreso mensual. Considera renegociar las condiciones.</div></div>`;
  if (aho >= ing * 0.20)     html += `<div class="alert success mb1"><span class="alert-icon">✅</span><div><strong>¡Excelente!</strong> Ahorras el ${pct(aho,ing)}% de tus ingresos. Considera invertir parte en un APV o fondo mutuo.</div></div>`;
  alertsEl.innerHTML = html || `<div class="alert info mb1"><span class="alert-icon">ℹ️</span><div>Registra tus gastos en la pestaña <strong>Presupuesto</strong> para ver alertas personalizadas aquí.</div></div>`;
}

/* ============================================================
   SIMULADOR — FUNCIONES DE MONEDA (REQ 2, 3, 4)
   ============================================================ */

/**
 * REQ 4: Formatea un valor numérico según la moneda activa del simulador.
 * CLP  → $1.234.567
 * UF   → UF 123,45
 * USD  → USD 1.234,56
 */
function fmtSim(v) {
  if (simMoneda === 'UF')  return 'UF '  + v.toLocaleString('es-CL', { minimumFractionDigits:2, maximumFractionDigits:2 });
  if (simMoneda === 'USD') return 'USD ' + v.toLocaleString('es-CL', { minimumFractionDigits:2, maximumFractionDigits:2 });
  return '$' + Math.round(v).toLocaleString('es-CL');   // CLP sin decimales
}

/**
 * REQ 1 & 3: Devuelve la configuración del slider según la moneda.
 * Los máximos están calculados para equivaler ~200 millones de CLP.
 */
function getSliderConfig(moneda) {
  if (moneda === 'UF') {
    const maxUF  = Math.round(200_000_000 / indUF / 100) * 100;  // ~5.000 UF
    const stepUF = maxUF >= 2000 ? 50 : 10;
    return { min:10, max:maxUF, step:stepUF, def:Math.min(200, maxUF),
             minLbl:`UF 10`, maxLbl:`UF ${maxUF.toLocaleString('es-CL')}`,
             chip:`⟳ 1 UF = ${fmt(indUF)}` };
  }
  if (moneda === 'USD') {
    const maxUSD  = Math.round(200_000_000 / indUSD / 1000) * 1000;  // ~200.000 USD
    const stepUSD = 1000;
    return { min:500, max:maxUSD, step:stepUSD, def:Math.min(5000, maxUSD),
             minLbl:`USD 500`, maxLbl:`USD ${maxUSD.toLocaleString('es-CL')}`,
             chip:`⟳ 1 USD = ${fmt(indUSD)}` };
  }
  // CLP — REQ 1: máximo 200.000.000, step 500.000
  return { min:500_000, max:200_000_000, step:500_000, def:5_000_000,
           minLbl:'$500.000', maxLbl:'$200.000.000', chip:'' };
}

/**
 * REQ 2 & 3: Cambia la moneda activa, reconfigura el slider y los labels,
 * muestra/oculta el chip de tasa de conversión y re-corre la simulación.
 */
function onCurrencyChange(moneda) {
  simMoneda = moneda;

  // Activar botón seleccionado
  ['CLP','UF','USD'].forEach(m => {
    $('cur-' + m).classList.toggle('active', m === moneda);
  });

  const cfg = getSliderConfig(moneda);
  const slider = $('s-monto');

  // Actualizar atributos del slider
  slider.min   = cfg.min;
  slider.max   = cfg.max;
  slider.step  = cfg.step;
  // Ajustar valor actual al nuevo rango si queda fuera de límites
  slider.value = Math.min(Math.max(parseFloat(slider.value) || cfg.def, cfg.min), cfg.max);

  // Actualizar etiquetas de rango
  $('s-monto-min').textContent = cfg.minLbl;
  $('s-monto-max').textContent = cfg.maxLbl;

  // Actualizar labels de inputs de ingresos y otras cuotas
  const sym = moneda === 'CLP' ? '$' : moneda;
  $('s-ingreso-lbl').textContent = `Ingreso mensual neto (${sym})`;
  $('s-otras-lbl').textContent   = `Otras cuotas mensuales (${sym})`;

  // Mostrar u ocultar chip de tasa
  const chip = $('s-rate-chip');
  if (cfg.chip) { chip.textContent = cfg.chip; chip.classList.remove('hidden'); }
  else           { chip.classList.add('hidden'); }

  simUpdate();
  saveSim();
}

/* ============================================================
   SIMULADOR DE CRÉDITOS — simUpdate() con soporte multi-moneda
   ============================================================ */
function simUpdate() {
  const ingInp  = $('s-ingreso');
  const otrasInp = $('s-otras');
  if (ingInp  && parseFloat(ingInp.value)   < 0) ingInp.value   = 0;
  if (otrasInp && parseFloat(otrasInp.value) < 0) otrasInp.value = 0;

  const monto = parseFloat($('s-monto').value)   || 0;
  const plazo = parseInt($('s-plazo').value)      || 1;
  const tasa  = parseFloat($('s-tasa').value)     / 100;
  const ing   = parseFloat(ingInp?.value)         || 1;
  const otras = parseFloat(otrasInp?.value)       || 0;

  if (ingInp?.value.trim() === '' || parseFloat(ingInp?.value) <= 0) {
    _calcHint('s-ingreso', '💡 Ingresa tu ingreso mensual neto para calcular el ratio de endeudamiento.');
  } else {
    _calcHint('s-ingreso', null);
  }

  // REQ 4: mostrar el valor del slider con el prefijo de la moneda activa
  $('s-monto-lbl').textContent = fmtSim(monto);
  $('s-plazo-lbl').textContent = plazo + ' meses';
  $('s-tasa-lbl').textContent  = (tasa * 100).toFixed(1) + '%';

  // Fórmula de amortización francesa (opera en la unidad seleccionada)
  const cuota      = monto * (tasa * Math.pow(1+tasa, plazo)) / (Math.pow(1+tasa, plazo) - 1);
  const total      = cuota * plazo;
  const inter      = total - monto;
  const cuotaTotal = cuota + otras;
  const ratioPct   = pct(cuotaTotal, ing);

  // REQ 4: todos los resultados monetarios usan fmtSim()
  $('r-cuota').textContent = fmtSim(cuota);
  $('r-total').textContent = fmtSim(total);
  $('r-inter').textContent = fmtSim(inter);
  $('r-pct').textContent   = ratioPct + '%';

  const bar = $('r-bar');
  bar.style.width      = Math.min(ratioPct, 100) + '%';
  bar.style.background = ratioPct > 40 ? '#ef4444' : ratioPct > 30 ? '#f59e0b' : '#1da077';
  $('r-pct').style.color = ratioPct > 40 ? 'var(--red-500)' : ratioPct > 30 ? 'var(--amber-500)' : 'var(--green-600)';

  const res = $('sim-result');
  if (ratioPct > 40) {
    res.innerHTML = `<div class="calc-result-card danger"><div class="calc-result-title">🚨 Crédito muy riesgoso</div><div style="font-size:13px;color:#991b1b;line-height:1.6">La cuota representa el <strong>${ratioPct}%</strong> de tus ingresos. El límite recomendado es 35%. Considera un monto menor o un plazo mayor.</div></div>`;
  } else if (ratioPct > 30) {
    res.innerHTML = `<div class="calc-result-card warn"><div class="calc-result-title">⚠️ En el límite aceptable</div><div style="font-size:13px;color:#92400e;line-height:1.6">El <strong>${ratioPct}%</strong> de tus ingresos irá a esta cuota. Es viable pero asegúrate de tener fondo de emergencias.</div></div>`;
  } else {
    res.innerHTML = `<div class="calc-result-card ok"><div class="calc-result-title">✅ Crédito financieramente viable</div><div style="font-size:13px;color:var(--green-800);line-height:1.6">La cuota es el <strong>${ratioPct}%</strong> de tus ingresos, dentro del rango saludable. Compara tasas antes de firmar.</div></div>`;
  }

  // REQ 4: tabla comparativa con fmtSim() en columnas Cuota e Intereses
  const insts = [
    { nombre:'Banco del Estado', tasa:0.009 },
    { nombre:'Cooperativa',      tasa:0.013 },
    { nombre:'Banco privado A',  tasa:0.018 },
    { nombre:'Banco privado B',  tasa:0.022 },
    { nombre:'Casa comercial',   tasa:0.035 },
    { nombre:'⭐ Tu selección',  tasa:tasa   },
  ];
  const calcIntr = t => {
    const c = monto * (t * Math.pow(1+t, plazo)) / (Math.pow(1+t, plazo) - 1);
    return c * plazo - monto;
  };
  const minIntr = Math.min(...insts.map(i => calcIntr(i.tasa)));
  let tbl = '<tr><th>Institución</th><th>Tasa mensual</th><th>Cuota</th><th>Intereses</th></tr>';
  insts.forEach(inst => {
    const c    = monto * (inst.tasa * Math.pow(1+inst.tasa, plazo)) / (Math.pow(1+inst.tasa, plazo) - 1);
    const intr = c * plazo - monto;
    const isSel  = Math.abs(inst.tasa - tasa) < 0.0001;
    const isBest = Math.abs(intr - minIntr) < 1;
    tbl += `<tr${isSel ? ' class="selected-row"' : ''}>
      <td>${inst.nombre}</td>
      <td>${(inst.tasa*100).toFixed(1)}%</td>
      <td>${fmtSim(c)}</td>
      <td class="${isBest ? 'best-val' : ''}">${fmtSim(intr)}${isBest ? ' 🏆' : ''}</td>
    </tr>`;
  });
  $('compare-tbl').innerHTML = tbl;

  // REQ 4: barra capital vs intereses (porcentajes, moneda solo en el mensaje)
  const interPct = pct(inter, total);
  $('intereses-viz').innerHTML = `
    <div style="display:flex;height:28px;border-radius:var(--r-sm);overflow:hidden;margin-bottom:8px">
      <div style="width:${100-interPct}%;background:var(--green-500);display:flex;align-items:center;justify-content:center;font-size:11px;color:#fff;font-weight:600;transition:width .5s">${100-interPct}% capital</div>
      <div style="width:${interPct}%;background:var(--red-400);display:flex;align-items:center;justify-content:center;font-size:11px;color:#fff;font-weight:600;transition:width .5s">${interPct}% intereses</div>
    </div>`;
  $('amort-msg').innerHTML = `De los <strong>${fmtSim(total)}</strong> que pagarás en total, <strong style="color:var(--green-600)">${fmtSim(monto)}</strong> es el capital real y <strong style="color:var(--red-500)">${fmtSim(inter)}</strong> (${interPct}%) son intereses que se queda el banco. A menor tasa y menor plazo, menos intereses pagas.`;

  // PART 3 — INSIGHT 2: Costo de Oportunidad
  // "¿Qué pasaría si en lugar de pagar esta cuota invirtieras el mismo monto al 6% anual?"
  const tasaOp   = 0.06;
  const tasaMensualOp = Math.pow(1 + tasaOp, 1/12) - 1;
  const valorFuturoOp = cuota > 0
    ? cuota * ((Math.pow(1 + tasaMensualOp, plazo) - 1) / tasaMensualOp)
    : 0;
  const opInsight = $('oportunidad-insight');
  if (cuota > 0) {
    opInsight.style.display = 'flex';
    opInsight.className = 'alert info';
    opInsight.innerHTML = `<span class="alert-icon">🤔</span>
      <div><strong>Costo de Oportunidad:</strong> Si en lugar de pagar esta cuota de <strong>${fmtSim(cuota)}/mes</strong> la invirtieras al <strong>6% anual</strong> durante <strong>${plazo} meses</strong>, acumularías <strong style="color:var(--green-600)">${fmtSim(valorFuturoOp)}</strong> a tu favor. Ese es el verdadero costo de endeudarse.</div>`;
  } else {
    opInsight.style.display = 'none';
  }

  // EDIT 5: CÁLCULO CAE (Carga Anual Equivalente)
  // CAE = ((1 + tasa_efectiva_mensual)^12 - 1) donde tasa_efectiva incluye gastos operacionales
  const gastosOp = parseFloat($('s-gastos-op')?.value) || 0;
  const caeEl    = $('cae-result');
  if (gastosOp > 0 && monto > 0) {
    // Tasa mensual efectiva: resolver TIR de flujos reales (cuota + gastos_op)
    // Aproximación: buscar r tal que PV(flujos con gastos) = monto
    // Usamos Newton-Raphson sobre la fórmula de VA
    const cuotaReal = cuota + gastosOp;
    let rEfec = tasa; // semilla
    for (let iter = 0; iter < 50; iter++) {
      const f   = cuotaReal * ((1 - Math.pow(1+rEfec, -plazo)) / rEfec) - monto;
      const df  = cuotaReal * (
        (Math.pow(1+rEfec, -plazo) * plazo) / rEfec -
        (1 - Math.pow(1+rEfec, -plazo)) / (rEfec * rEfec)
      );
      const rNew = rEfec - f / df;
      if (Math.abs(rNew - rEfec) < 1e-10) break;
      rEfec = rNew;
    }
    const caeAnual = (Math.pow(1 + rEfec, 12) - 1) * 100;
    const tasaBaseAnual = (Math.pow(1 + tasa, 12) - 1) * 100;
    const caeDiff = caeAnual - tasaBaseAnual;

    if (caeEl) {
      caeEl.style.display = 'block';
      $('cae-cuota-real').textContent = fmtSim(cuotaReal);
      $('cae-tasa-base').textContent  = tasaBaseAnual.toFixed(2) + '%';
      $('cae-anual').textContent      = caeAnual.toFixed(2) + '%';
      // Alerta si CAE es más de 2 pp mayor que tasa base
      const caeWarn = $('cae-warn');
      if (caeWarn) {
        if (caeDiff > 2) {
          caeWarn.style.display = 'flex';
          caeWarn.className = 'alert warning';
          caeWarn.innerHTML = `<span class="alert-icon">⚠️</span><div><strong>¡Atención!</strong> La CAE real (<strong>${caeAnual.toFixed(2)}%</strong>) es <strong>${caeDiff.toFixed(2)} puntos porcentuales</strong> más alta que la tasa base ofrecida (${tasaBaseAnual.toFixed(2)}%). Los gastos operacionales encarecen significativamente el crédito.</div>`;
        } else {
          caeWarn.style.display = 'none';
        }
      }
    }
  } else if (caeEl) {
    caeEl.style.display = 'none';
  }
}

/* ============================================================
   MÓDULO EDUCATIVO — Acordeones y paneles de contenido
   ============================================================ */
const modData = {
  emergencias: { emoji:'💰', title:'Fondo de emergencias', badge:'Básico', badgeCls:'green', body: `
    <div class="alert success"><span class="alert-icon">🎯</span><div><strong>Objetivo:</strong> 3–6 meses de gastos esenciales en una cuenta de fácil acceso.</div></div>
    <div class="video-responsive"><iframe src="https://www.youtube.com/embed/mm6S2Bs4KZ4" title="Cómo crear un Fondo de Emergencia — Guía Completa" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>
    ${acc('¿Por qué es la prioridad número uno?','Sin fondo de emergencias, cualquier imprevisto (desempleo, enfermedad) te obliga a usar tarjetas con tasas altísimas. Es la diferencia entre un tropiezo temporal y una espiral de deudas.')}
    ${acc('¿Cuánto debo acumular?','Multiplica tus gastos esenciales mensuales por 3 si tienes trabajo estable, o por 6 si eres independiente. Incluye: arriendo, alimentación, transporte, servicios básicos.')}
    ${acc('¿Dónde guardar el dinero?','Cuenta de ahorro remunerada o cuenta vista con rendimiento. Debe ser LÍQUIDO (accesible en 24–48h) y SEPARADO de tu cuenta corriente para evitar gastarlo.')}
    ${acc('Plan práctico: el sistema del 10%','El día que recibes tu sueldo, transfiere automáticamente el 10% a tu cuenta de ahorro. No lo pienses, automatízalo. En 2 años tendrás más de 2 meses ahorrados.')}
    <div class="alert info"><span class="alert-icon">📊</span><div>El 68% de las personas que caen en sobreendeudamiento no tenían fondo de emergencias.</div></div>
  `},
  deudas: { emoji:'🏔️', title:'Cómo salir de deudas', badge:'Intermedio', badgeCls:'amber', body: `
    <div class="alert warning"><span class="alert-icon">⚠️</span><div>Si tus cuotas superan el <strong>40% de tus ingresos</strong>, considera una reprogramación de deuda con tu banco.</div></div>
    <div class="video-responsive"><iframe src="https://www.youtube.com/embed/6WelJf1y6Ls" title="Cómo salir de deudas: Método Bola de Nieve y Avalancha" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>
    ${acc('Método Avalancha — matemáticamente óptimo','Prioriza pagar la deuda con mayor tasa de interés. Paga el mínimo en las demás. Cuando la eliminas, vuelcas ese monto a la siguiente. Ahorras más dinero en intereses.')}
    ${acc('Método Bola de Nieve — psicológicamente poderoso','Paga primero la deuda con menor saldo, sin importar la tasa. Cada deuda eliminada es una victoria que te mantiene motivado. Estudios muestran más éxito con este método.')}
    ${acc('¿Cuál elegir?','Si eres disciplinado: Avalancha. Si necesitas victorias tempranas: Bola de Nieve. Lo más importante es empezar y ser consistente.')}
    ${acc('5 señales de sobreendeudamiento','1. Pagas solo el mínimo regularmente. 2. Usas un crédito para pagar otro. 3. Total de cuotas > 40% de tu sueldo. 4. No sabes cuánto debes en total. 5. Evitas revisar tus estados de cuenta.')}
  `},
  inversion: { emoji:'📈', title:'Empieza a invertir', badge:'Intermedio', badgeCls:'blue', body: `
    <div class="alert info"><span class="alert-icon">ℹ️</span><div><strong>Orden correcto:</strong> Primero fondo de emergencias → luego pagar deudas caras → luego invertir.</div></div>
    <div class="video-responsive"><iframe src="https://www.youtube.com/embed/amsKzl4SSTE" title="Cómo invertir en el S&P 500 desde Chile usando ETFs" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>
    ${acc('Instrumentos de bajo riesgo para principiantes','Depósito a plazo, cuenta de ahorro remunerada, fondos mutuos de renta fija, APV (Ahorro Previsional Voluntario). Todos son regulados y seguros.')}
    ${acc('APV: beneficio tributario del Estado','El APV permite ahorrar para la jubilación con beneficios. Régimen A: bonificación estatal del 15% (máx 6 UTM/año). Régimen B: descuento de base imponible. Disponible en AFP, bancos y seguros.')}
    ${acc('El poder del interés compuesto','$50.000/mes durante 30 años al 6% anual = ~$47 millones. En efectivo = $18 millones. La diferencia es el interés compuesto. Einstein lo llamó "la octava maravilla del mundo".')}
    ${acc('Reglas del inversionista principiante','1. Diversifica. 2. Piensa en el largo plazo. 3. Elige fondos con comisiones bajas. 4. Aporta regularmente. 5. Entiende en qué estás invirtiendo antes de hacerlo.')}
  `},
  tarjetas: { emoji:'💳', title:'Tarjetas sin trampa', badge:'Básico', badgeCls:'green', body: `
    <div class="alert danger"><span class="alert-icon">🚨</span><div>Una tarjeta puede cobrar más del <strong>3% mensual</strong> (36%+ anual). Usarla mal es extremadamente caro.</div></div>
    <div class="video-responsive"><iframe src="https://www.youtube.com/embed/yALBya7Oano" title="Tarjeta de crédito: aliada del consumo o trampa de deuda" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>
    ${acc('Cómo funciona realmente una tarjeta','El banco te presta SIN intereses si pagas el TOTAL antes del vencimiento. Si pagas solo el mínimo, el saldo acumula intereses desde el día de cada compra. Ese es el negocio.')}
    ${acc('La regla de oro: paga el total cada mes','Si no puedes pagar el total, significa que compraste algo que no podías costear. Las cuotas "sin interés" solo son convenientes si el monto cabe en tu presupuesto.')}
    ${acc('¿Ya tienes deuda en la tarjeta? Plan de acción','1. Deja de usarla para compras nuevas. 2. Calcula exactamente cuánto debes. 3. Paga siempre más del doble del mínimo. 4. Considera un crédito de consumo a tasa fija para consolidarla.')}
    ${acc('3 trucos para usarla a tu favor','1. Úsala como método de pago, no como crédito. 2. Aprovecha beneficios (cashback, descuentos). 3. Configura el pago total automático desde tu cuenta corriente.')}
  `},
  presupuesto_tip: { emoji:'📊', title:'El arte del presupuesto', badge:'Básico', badgeCls:'green', body: `
    <div class="alert success"><span class="alert-icon">💡</span><div>Un presupuesto no es una restricción. Es un permiso para gastar sin culpa dentro de los límites que TÚ defines.</div></div>
    <div class="video-responsive"><iframe src="https://www.youtube.com/embed/FDWuSVhdwJc" title="Regla 50-30-20: cómo organizar tu dinero" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>
    ${acc('El método 50/30/20 explicado','50% necesidades (arriendo, comida, transporte). 30% deseos (entretención, restaurantes). 20% ahorro e inversión. Ajusta los porcentajes a tu realidad, pero mantén la lógica.')}
    ${acc('Crear tu primer presupuesto en 5 pasos','1. Anota todos tus ingresos netos. 2. Revisa 2 meses de gastos en tu app bancaria. 3. Clasifica en necesidades/deseos/ahorro. 4. Compara con el 50/30/20. 5. Ajusta y actúa.')}
    ${acc('Por qué fallan los presupuestos','Son muy rígidos (sin margen para imprevistos), muy imprecisos ("gastar menos" no es un plan), o se revisan muy poco. Solución: incluye un 5–10% de "varios" y revísalo cada semana.')}
    ${acc('Con ingresos variables','Presupuesta con tu ingreso mínimo de los últimos 6 meses. Los meses buenos, guarda el extra. Paga un "sueldo" fijo mensual desde una cuenta separada.')}
  `},
  habitos: { emoji:'🧠', title:'Hábitos que te hacen rico', badge:'Avanzado', badgeCls:'amber', body: `
    <div class="alert info"><span class="alert-icon">🧠</span><div>Las finanzas personales son 80% comportamiento y 20% conocimiento. El problema rara vez es saber qué hacer; es hacerlo.</div></div>
    <div class="video-responsive"><iframe src="https://www.youtube.com/embed/EM5vv6_MQLY" title="5 hábitos financieros que te harán ahorrador en 3 meses" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>
    ${acc('La psicología del gasto impulsivo','El comercio está diseñado para generar compras impulsivas. Contramedida: regla de las 48 horas — espera 2 días antes de comprar cualquier cosa no planificada.')}
    ${acc('El sesgo del presente','Nuestro cerebro sobrevalora el placer inmediato. Por eso es difícil ahorrar. Solución: automatizar. Si el dinero nunca llega a tu cuenta corriente, no puedes gastarlo.')}
    ${acc('Los 5 hábitos del millonario promedio','1. Viven bajo sus posibilidades. 2. Invierten consistentemente. 3. Evitan deudas de consumo. 4. Tienen y revisan un presupuesto. 5. Invierten en educación financiera continua.')}
    ${acc('Cómo construir el hábito de ahorrar','Hazlo fácil (automatiza), visible (metas concretas), satisfactorio (celebra cada meta) y social (cuéntale a alguien para crear compromiso). Los hábitos financieros tardan ~66 días en consolidarse.')}
  `}
};

/* ============================================================
   GLOSARIO FINANCIERO — datos y buscador en tiempo real
   ============================================================ */
const glosario = [
  { term:'UF (Unidad de Fomento)',
    def:'Unidad de cuenta reajustable diariamente según la inflación del mes anterior. Se usa en créditos hipotecarios, arriendos y contratos de largo plazo. Su valor lo puedes ver en el widget de la barra superior.' },
  { term:'UTM (Unidad Tributaria Mensual)',
    def:'Valor en pesos fijado mensualmente por el SII. Se usa como referencia para calcular multas, tramos del impuesto a la renta, límites del APV y otros beneficios tributarios.' },
  { term:'CAE (Carga Anual Equivalente)',
    def:'El costo REAL de un crédito expresado como porcentaje anual. Incluye la tasa de interés + todos los gastos (seguros, comisiones, notaría). Siempre compara CAE, nunca solo la tasa base.' },
  { term:'CTC (Costo Total del Crédito)',
    def:'La suma en pesos que pagarás de más sobre el capital prestado: intereses + seguros + comisiones. Es el número más honesto para comparar préstamos.' },
  { term:'TIN (Tasa de Interés Nominal)',
    def:'La tasa "de vitrina" que anuncia el banco, sin incluir costos adicionales. Siempre es más baja que la CAE. No uses solo esta tasa para comparar créditos.' },
  { term:'APV (Ahorro Previsional Voluntario)',
    def:'Instrumento de ahorro para la jubilación con beneficio tributario. En Régimen A, el Estado te bonifica el 15% de lo ahorrado (tope 6 UTM/año). En Régimen B, reduces tu base imponible.' },
  { term:'AFP (Administradora de Fondos de Pensiones)',
    def:'Entidad que administra tu ahorro previsional obligatorio (10% de tu sueldo imponible). Hay fondos A al E con distintos niveles de riesgo y rentabilidad.' },
  { term:'Fondo Mutuo',
    def:'Instrumento de inversión colectiva administrado por una institución financiera. Tu dinero se une al de otros inversores para comprar activos diversificados. Hay fondos conservadores y de mayor riesgo.' },
  { term:'Interés Compuesto',
    def:'El interés que se calcula sobre el capital MÁS los intereses ya acumulados. Es el principio que hace crecer exponencialmente tus ahorros (o tus deudas). Einstein lo llamó "la octava maravilla del mundo".' },
  { term:'Interés Simple',
    def:'El interés que se calcula SOLO sobre el capital original. Produce menor crecimiento que el compuesto. Se usa en depósitos a plazo cortos.' },
  { term:'Inflación',
    def:'El aumento general sostenido de los precios. Si la inflación es 5% y tu ahorro crece 3%, en términos reales estás perdiendo poder adquisitivo. Por eso importa invertir por encima de la inflación.' },
  { term:'IPC (Índice de Precios al Consumidor)',
    def:'Medición mensual del Banco Central que refleja la variación de precios de una canasta de productos. Es el indicador oficial de inflación en Chile.' },
  { term:'Liquidez',
    def:'Qué tan rápido puedes convertir un activo en dinero sin perder valor. Una cuenta de ahorro es muy líquida; un departamento es poco líquido.' },
  { term:'Diversificación',
    def:'Distribuir tus inversiones en distintos instrumentos para reducir el riesgo. Si un activo baja, los otros pueden compensar. "No pongas todos los huevos en la misma canasta."' },
  { term:'Depósito a Plazo (DAP)',
    def:'Instrumento bancario donde depositas dinero por un período fijo a cambio de una tasa acordada. Es seguro, líquido al vencer y con rentabilidad garantizada.' },
  { term:'Sobreendeudamiento',
    def:'Situación en la que el total de tus cuotas mensuales supera el 40% de tus ingresos. Es la zona de riesgo donde una emergencia puede convertirse en una crisis irreversible.' },
  { term:'Repactación',
    def:'Renegociación de las condiciones de una deuda: extender el plazo, reducir la tasa o consolidar múltiples deudas. Puede reducir la carga mensual pero aumentar el costo total.' },
  { term:'DICOM (Boletín Comercial)',
    def:'Registro de morosidad gestionado por Equifax en Chile. Aparecer en DICOM dificulta acceder a créditos, arriendos o empleos. Se puede salir pagando la deuda o esperando 5 años.' },
];

function buscarGlosario() {
  const query   = $('glosario-input').value.trim().toLowerCase();
  const results = $('glosario-resultados');
  if (!query) { results.innerHTML = ''; return; }
  const matches = glosario.filter(item =>
    item.term.toLowerCase().includes(query) ||
    item.def.toLowerCase().includes(query)
  );
  if (matches.length === 0) {
    results.innerHTML = `<div class="glosario-empty">Sin resultados para "<strong>${query}</strong>". Prueba con otro término.</div>`;
    return;
  }
  results.innerHTML = matches.map(item => `
    <div class="glosario-card">
      <div class="glosario-term">${item.term}</div>
      <div class="glosario-def">${item.def}</div>
    </div>`).join('');
}

function acc(q, a) {
  const id = 'a' + Math.random().toString(36).substr(2, 8);
  return `<div class="acc">
    <div class="acc-head" onclick="toggleAcc('${id}')"><span>${q}</span><span class="acc-arrow" id="arr-${id}">▼</span></div>
    <div class="acc-body" id="${id}">${a}</div>
  </div>`;
}
function toggleAcc(id) {
  const body = $(id), arr = $('arr-' + id);
  arr.classList.toggle('open', body.classList.toggle('open'));
}
function openModule(key) {
  const m = modData[key];
  $('mod-emoji').textContent = m.emoji;
  $('mod-title').textContent = m.title;
  $('mod-badge').textContent = m.badge;
  $('mod-badge').className   = 'badge ' + m.badgeCls;
  $('mod-body').innerHTML    = m.body;
  const panel = $('module-panel');
  panel.classList.add('open');
  setTimeout(() => panel.scrollIntoView({ behavior:'smooth', block:'start' }), 80);
  // Quiz: mostrar botón si hay preguntas para este módulo
  quizState.module = key;
  const btn = $('quiz-start-btn');
  if (btn && quizData[key]) btn.style.display = 'inline-flex';
  const qc = $('quiz-container');
  if (qc) { qc.innerHTML = ''; qc.style.display = 'none'; }
}
function closeModule() {
  $('module-panel').classList.remove('open');
  const btn = $('quiz-start-btn');
  if (btn) btn.style.display = 'none';
  const qc = $('quiz-container');
  if (qc) { qc.innerHTML = ''; qc.style.display = 'none'; }
}

/* ============================================================
   PRESUPUESTO — configuración de categorías
   ============================================================ */
const catConfig = [
  { label:'🏠 Vivienda',      color:'#0f5240' },
  { label:'🍽️ Alimentación', color:'#126b53' },
  { label:'🚌 Transporte',   color:'#d97706' },
  { label:'💡 Servicios',    color:'#1d4ed8' },
  { label:'🎬 Entretención', color:'#dc2626' },
  { label:'💊 Salud',        color:'#7c3aed' },
  { label:'📚 Educación',    color:'#0891b2' },
  { label:'👕 Vestuario',    color:'#db2777' },
  { label:'📦 Otros',        color:'#6b7280' },
];

// ► Estado inicial de budgetRows (se sobrescribe con localStorage si existe)
let budgetRows = [
  { cat:0, desc:'Arriendo / dividendo',          presup:250000, real:250000 },
  { cat:1, desc:'Supermercado + delivery',        presup:120000, real:138000 },
  { cat:2, desc:'Transporte público / bencina',   presup:55000,  real:52000  },
  { cat:3, desc:'Luz, agua, internet, gas',       presup:48000,  real:44000  },
  { cat:4, desc:'Streaming + salidas',            presup:35000,  real:42000  },
  { cat:5, desc:'Medicamentos / consultas',       presup:20000,  real:15000  },
];

/** Renderiza la tabla de presupuesto en el DOM */
function renderBudgetTable() {
  const tbody = $('budget-tbody');
  tbody.innerHTML = '';
  budgetRows.forEach((row, i) => {
    const diff      = row.real - row.presup;
    const diffClass = diff > 0 ? 'diff-positive' : diff < 0 ? 'diff-negative' : 'diff-zero';
    const diffStr   = (diff > 0 ? '+' : '') + fmt(diff);
    tbody.innerHTML += `<tr>
      <td>
        <select onchange="budgetRows[${i}].cat=+this.value;renderBudgetTable();budgetCalc();saveAll()"
                style="background:transparent;border:1px solid var(--line);border-radius:6px;padding:4px 6px;font-size:12px;color:var(--ink);cursor:pointer;max-width:150px">
          ${catConfig.map((c, ci) => `<option value="${ci}"${ci === row.cat ? ' selected' : ''}>${c.label}</option>`).join('')}
        </select>
      </td>
      <td><input class="b-input" value="${row.desc}" onchange="budgetRows[${i}].desc=this.value;saveAll()"></td>
      <td style="text-align:right"><input class="b-num" type="number" value="${row.presup}" onchange="budgetRows[${i}].presup=+this.value;budgetCalc();saveAll()"></td>
      <td style="text-align:right"><input class="b-num" type="number" value="${row.real}"   onchange="budgetRows[${i}].real=+this.value;budgetCalc();dashUpdate();saveAll()"></td>
      <td style="text-align:right" class="${diffClass}">${diffStr}</td>
      <td><button onclick="deleteBudgetRow(${i})" class="btn btn-danger btn-sm" style="padding:4px 8px;font-size:12px">✕</button></td>
    </tr>`;
  });
  budgetCalc();
}

function addBudgetRow() {
  budgetRows.push({ cat:8, desc:'Nuevo gasto', presup:0, real:0 });
  renderBudgetTable();
  saveAll();
}
function deleteBudgetRow(i) {
  budgetRows.splice(i, 1);
  renderBudgetTable();
  dashUpdate();
  saveAll();
}

/** Recalcula todos los totales y actualiza la UI del presupuesto */
function budgetCalc() {
  const ingreso   = parseFloat($('b-ingreso').value) || 0;
  const totPresup = budgetRows.reduce((s, r) => s + r.presup, 0);
  const totReal   = budgetRows.reduce((s, r) => s + r.real,   0);
  const diff      = totPresup - totReal;
  const ahorro    = Math.max(ingreso - totReal, 0);

  $('b-tot-presup').textContent  = fmt(totPresup);
  $('b-tot-real').textContent    = fmt(totReal);
  $('b-diferencia').textContent  = (diff >= 0 ? '+' : '') + fmt(diff);
  $('b-diferencia').style.color  = diff >= 0 ? 'var(--green-600)' : 'var(--red-500)';
  $('b-ahorro-card').textContent = fmt(ahorro);
  $('b-ahorro').textContent      = fmt(ahorro);
  $('b-ahorro-pct').textContent  = ingreso > 0 ? `${pct(ahorro, ingreso)}% de tus ingresos` : '';

  // Barra de tasa de gasto
  const rate   = pct(totReal, ingreso);
  const rateEl = $('b-rate-bar');
  rateEl.style.width      = Math.min(rate, 100) + '%';
  rateEl.style.background = rate > 85 ? '#ef4444' : rate > 65 ? '#f59e0b' : '#1da077';
  $('b-rate-text').textContent = `Usas el ${rate}% de tus ingresos en gastos. ${rate > 85 ? '⚠️ Nivel crítico.' : rate > 65 ? 'Poco margen de ahorro.' : '✅ Rango saludable.'}`;

  // Barras de ejecución por categoría
  const catMap = {};
  budgetRows.forEach(r => {
    if (!catMap[r.cat]) catMap[r.cat] = { presup:0, real:0 };
    catMap[r.cat].presup += r.presup;
    catMap[r.cat].real   += r.real;
  });
  let barsHtml = '';
  Object.keys(catMap).forEach(ci => {
    const d   = catMap[ci];
    const p   = d.presup > 0 ? Math.min(pct(d.real, d.presup), 150) : 0;
    const col = p > 100 ? '#ef4444' : p > 80 ? '#f59e0b' : '#1da077';
    barsHtml += `<div class="bar-row">
      <span class="bar-cat" style="width:120px;font-size:12px">${catConfig[ci]?.label || 'Otro'}</span>
      <div class="bar-track2"><div class="bar-fill2" style="width:${Math.min(p,100)}%;background:${col}"></div></div>
      <span class="bar-amount" style="width:46px;font-size:11.5px;text-align:right">${p}%</span>
    </div>`;
  });
  $('b-bars').innerHTML = barsHtml || '<div style="font-size:13px;color:var(--muted)">Agrega gastos para ver el desglose.</div>';

  // Consejo contextual existente
  const c = $('b-consejo');
  if (rate > 85) {
    c.style.display = 'flex'; c.className = 'alert danger';
    c.innerHTML = `<span class="alert-icon">🚨</span><div>Tus gastos superan el 85% de tus ingresos. Revisa las categorías en rojo y busca dónde reducir.</div>`;
  } else if (ahorro >= ingreso * 0.20) {
    c.style.display = 'flex'; c.className = 'alert success';
    c.innerHTML = `<span class="alert-icon">🏆</span><div>¡Ahorras el ${pct(ahorro,ingreso)}% de tus ingresos! Considera invertir al menos la mitad en un APV o fondo mutuo.</div>`;
  } else if (ahorro > 0) {
    c.style.display = 'flex'; c.className = 'alert info';
    c.innerHTML = `<span class="alert-icon">💡</span><div>Tienes ${fmt(ahorro)} disponibles. Destina al menos el 50% a tu fondo de emergencias.</div>`;
  } else {
    c.style.display = 'none';
  }

  // PART 3 — INSIGHT 4: Alerta de "Gasto Hormiga"
  // Si la suma de Entretención (cat 4) + Otros (cat 8) > 15% del ingreso
  const gastoHormiga = budgetRows
    .filter(r => r.cat === 4 || r.cat === 8)
    .reduce((s, r) => s + r.real, 0);
  const hormigas = $('b-hormiga-insight');
  if (hormigas) {
    const horPct = ingreso > 0 ? (gastoHormiga / ingreso) * 100 : 0;
    if (horPct > 15 && ingreso > 0) {
      hormigas.style.display = 'flex';
      hormigas.className = 'alert warning';
      hormigas.innerHTML = `<span class="alert-icon">☕</span>
        <div><strong>Alerta de Gasto Hormiga:</strong> Estás destinando el <strong>${horPct.toFixed(1)}%</strong> de tus ingresos (<strong>${fmt(gastoHormiga)}/mes</strong>) a Entretención y Otros — gastos no esenciales. Reducir aquí en ${fmt(gastoHormiga - ingreso * 0.15)} aumentaría tu ahorro directamente.</div>`;
    } else {
      hormigas.style.display = 'none';
    }
  }
}


/* ============================================================
   FEAT A: VELOCÍMETRO — drawGauge(score, color)
   Dibuja un arco SVG semicircular que va de 0 a 1000 puntos
   ============================================================ */
function drawGauge(score, color) {
  const svg = $('gauge-svg');
  const cx = 90, cy = 92, r = 72;
  // El arco va de 180° a 0° (semicírculo superior)
  const toRad = d => d * Math.PI / 180;
  const startAngle = 180, endAngle = 0;
  const totalArc = Math.PI; // semicircle
  const circumference = r * totalArc;
  const pct = score / 1000;

  // Puntos del arco de fondo
  const x1 = cx + r * Math.cos(toRad(startAngle));
  const y1 = cy + r * Math.sin(toRad(startAngle));
  const x2 = cx + r * Math.cos(toRad(endAngle));
  const y2 = cy + r * Math.sin(toRad(endAngle));

  // Aguja: ángulo desde 180° (izq) hasta 0° (der) según score
  const needleAngle = 180 - pct * 180;
  const needleLen = 54;
  const nx = cx + needleLen * Math.cos(toRad(needleAngle));
  const ny = cy + needleLen * Math.sin(toRad(needleAngle));

  // Color de fondo del arco adaptado al modo
  const dark   = document.body.classList.contains('dark');
  const trackC = dark ? '#1c3530' : '#e2ece9';

  svg.innerHTML = `
    <!-- track -->
    <path d="M ${cx-r} ${cy} A ${r} ${r} 0 0 1 ${cx+r} ${cy}"
          fill="none" stroke="${trackC}" stroke-width="16" stroke-linecap="round"/>
    <!-- fill animado -->
    <path id="gauge-path" d="M ${cx-r} ${cy} A ${r} ${r} 0 0 1 ${cx+r} ${cy}"
          fill="none" stroke="${color}" stroke-width="16" stroke-linecap="round"
          stroke-dasharray="${circumference}" stroke-dashoffset="${circumference * (1 - pct)}"
          style="transition:stroke-dashoffset .9s cubic-bezier(.4,0,.2,1);"/>
    <!-- ticks -->
    ${[0,250,500,750,1000].map(v => {
      const a = toRad(180 - (v/1000)*180);
      const ix = cx + (r+4)*Math.cos(a), iy = cy + (r+4)*Math.sin(a);
      const ox = cx + (r+14)*Math.cos(a), oy = cy + (r+14)*Math.sin(a);
      return `<line x1="${ix}" y1="${iy}" x2="${ox}" y2="${oy}" stroke="${trackC}" stroke-width="2"/>
              <text x="${cx+(r+24)*Math.cos(a)}" y="${cy+(r+24)*Math.sin(a)}"
                    text-anchor="middle" dominant-baseline="middle"
                    font-size="9" fill="${dark?'#4d7a72':'#9ca3af'}">${v}</text>`;
    }).join('')}
    <!-- aguja -->
    <line x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}"
          stroke="${color}" stroke-width="3" stroke-linecap="round"
          style="transform-origin:${cx}px ${cy}px;transition:all .9s cubic-bezier(.4,0,.2,1)"/>
    <circle cx="${cx}" cy="${cy}" r="6" fill="${color}"/>
    <circle cx="${cx}" cy="${cy}" r="3" fill="${dark?'#111e1b':'#fff'}"/>
  `;
}
/* ============================================================
   INVERSIONES — switchInvTab, invLibreUpdate, invJubUpdate
   ============================================================ */
/* ============================================================
   switchInvTab(tabName) — alterna entre los dos paneles
   ============================================================ */
function switchInvTab(tab) {
  // Paneles
  $('inv-panel-libre').style.display       = tab === 'libre'      ? 'block' : 'none';
  $('inv-panel-jubilacion').style.display  = tab === 'jubilacion' ? 'block' : 'none';
  // Botones
  $('tab-btn-libre').classList.toggle('active',      tab === 'libre');
  $('tab-btn-jubilacion').classList.toggle('active', tab === 'jubilacion');
  // Renderizar el tab activado
  if (tab === 'libre')      invLibreUpdate();
  if (tab === 'jubilacion') invJubUpdate();
}

/* ============================================================
   setInvTasa(val, btn) — botones rápidos de tasa
   ============================================================ */
function setInvTasa(val, btn) {
  $('inv-tasa').value = val;
  document.querySelectorAll('.quick-rate-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  invLibreUpdate();
}

/* ============================================================
   TAB 1: invLibreUpdate()
   Calcula colchón vs inversión vs APV y renderiza inv-chart-libre
   ============================================================ */
let invChartLibre = null;

function invLibreUpdate() {
  const mensual = parseFloat($('inv-mensual').value) || 0;
  const tasaA   = parseFloat($('inv-tasa').value)    / 100 || 0;
  const anos    = parseInt($('inv-anos').value)       || 1;
  const esAPV   = $('inv-apv').checked;

  $('inv-anos-lbl').textContent = anos + ' año' + (anos !== 1 ? 's' : '');

  // Tope APV Régimen A (6 UTM / año)
  const bonoMaxAnual = Math.min(mensual * 12 * 0.15, indUTM * 6);
  $('apv-bono-max').textContent = fmt(Math.round(bonoMaxAnual));
  $('apv-info').style.display   = esAPV ? 'block' : 'none';

  const tasaM = Math.pow(1 + tasaA, 1/12) - 1;
  const meses = anos * 12;

  const labels = [], colchon = [], trad = [], apvArr = [];
  for (let m = 1; m <= meses; m++) {
    labels.push(m % 12 === 0 ? 'Año ' + Math.round(m / 12) : '');
    colchon.push(Math.round(mensual * m));
    const c = tasaM > 0
      ? mensual * ((Math.pow(1 + tasaM, m) - 1) / tasaM)
      : mensual * m;
    trad.push(Math.round(c));
    let apvTotal = c;
    if (esAPV) {
      const ac = Math.floor(m / 12);
      let bono = 0;
      for (let y = 1; y <= ac; y++)
        bono += Math.min(mensual * 12 * 0.15, bonoMaxAnual) *
                Math.pow(1 + tasaA, ac - y + (m % 12) / 12);
      apvTotal = Math.round(c + bono);
    }
    apvArr.push(apvTotal);
  }

  const tot    = trad[meses - 1]   || 0;
  const totAPV = apvArr[meses - 1] || 0;
  const aporte = mensual * meses;

  $('inv-r-colchon').textContent     = fmt(mensual * meses);
  $('inv-r-tradicional').textContent = fmt(tot);
  $('inv-r-apv').textContent         = fmt(totAPV);
  $('inv-r-aporte').textContent      = fmt(aporte);
  $('inv-r-ganancia').textContent    = fmt(tot - aporte);
  $('inv-r-bonoTotal').textContent   = fmt(esAPV ? Math.min(mensual*12*0.15, bonoMaxAnual)*anos : 0);

  // Gráfico
  const th   = chartTheme();
  const step = Math.max(1, Math.floor(meses / 24));
  const filter = (arr) => arr.filter((_,i) => i % step === 0 || i === meses - 1);
  const lClean = filter(labels).map((l,i,a) => l || (i === a.length-1 ? 'Hoy' : ''));

  const datasets = [
    { label:'Bajo el colchón',   data:filter(colchon), borderColor:'#9ca3af', backgroundColor:'transparent', borderDash:[5,5], tension:.4, pointRadius:0, borderWidth:2 },
    { label:'Invertido',         data:filter(trad),    borderColor:'#3b82f6', backgroundColor:'rgba(59,130,246,.08)', fill:true, tension:.4, pointRadius:0, borderWidth:2.5 },
  ];
  if (esAPV) datasets.push(
    { label:'Con APV (Régimen A)', data:filter(apvArr), borderColor:'#1da077', backgroundColor:'rgba(29,160,119,.10)', fill:true, tension:.4, pointRadius:0, borderWidth:2.5 }
  );

  const ctx = $('inv-chart-libre').getContext('2d');
  if (invChartLibre) invChartLibre.destroy();
  invChartLibre = new Chart(ctx, {
    type: 'line',
    data: { labels: lClean, datasets },
    options: {
      responsive:true, maintainAspectRatio:false,
      interaction:{ mode:'index', intersect:false },
      plugins:{
        legend:{ position:'top', labels:{ font:{ family:th.font }, color:th.tick, boxWidth:14 } },
        tooltip:{ callbacks:{ label: i => ' ' + fmt(i.raw) } }
      },
      scales:{
        x:{ grid:{ display:false }, ticks:{ font:{ family:th.font }, color:th.tick, maxTicksLimit:12 } },
        y:{ grid:{ color:th.grid }, ticks:{ callback: v => '$'+(v/1e6).toFixed(1)+'M', color:th.tick, font:{ family:th.font } } }
      }
    }
  });
}

/* ============================================================
   TAB 2: invJubUpdate()
   Proyecta AFP obligatorio + APV voluntario hasta la jubilación
   ============================================================ */
let invChartJub = null;

function invJubUpdate() {
  const edadActual = parseInt($('jub-edad').value)    || 30;
  const edadRet    = parseInt($('jub-edad-ret').value) || 65;
  const sueldo     = parseFloat($('jub-sueldo').value) || 0;
  const saldoHoy   = parseFloat($('jub-saldo').value)  || 0;
  const apvMensual = parseFloat($('jub-apv').value)    || 0;
  const tasaA      = parseFloat($('jub-tasa').value)   / 100 || 0.05;

  const anosRest = Math.max(0, edadRet - edadActual);
  const restEl   = $('jub-anos-rest');
  if (restEl) restEl.textContent = anosRest;

  if (anosRest === 0 || sueldo <= 0) {
    ['jub-r-afp','jub-r-apv','jub-r-total','jub-r-bono','jub-r-pension']
      .forEach(id => { const el=$(id); if(el) el.textContent='—'; });
    return;
  }

  const tasaM  = Math.pow(1 + tasaA, 1/12) - 1;
  const meses  = anosRest * 12;
  const aporteMensAFP = sueldo * 0.10;

  // Tope bono APV (6 UTM/año)
  const bonoMaxAnual = Math.min(apvMensual * 12 * 0.15, indUTM * 6);

  // Arrays para el gráfico (puntos anuales)
  const labelsArr = [], afpArr = [], apvArr = [];

  for (let m = 1; m <= meses; m++) {
    // Fondo AFP: saldo inicial crece + aportes mensuales
    const fondoAFP = saldoHoy * Math.pow(1 + tasaM, m) +
      (tasaM > 0
        ? aporteMensAFP * ((Math.pow(1+tasaM,m)-1) / tasaM)
        : aporteMensAFP * m);

    // Fondo APV: aportes voluntarios + bono del Estado acumulado
    let fondoAPV = tasaM > 0
      ? apvMensual * ((Math.pow(1+tasaM,m)-1) / tasaM)
      : apvMensual * m;
    // Bono anual acumulado (se reinvierte)
    const ac = Math.floor(m / 12);
    let bonoAcum = 0;
    for (let y = 1; y <= ac; y++)
      bonoAcum += Math.min(apvMensual*12*0.15, bonoMaxAnual) *
                  Math.pow(1+tasaA, ac - y + (m%12)/12);
    fondoAPV = Math.round(fondoAPV + bonoAcum);

    if (m % 12 === 0 || m === meses) {
      labelsArr.push('Año ' + Math.round(m/12));
      afpArr.push(Math.round(fondoAFP));
      apvArr.push(fondoAPV);
    }
  }

  const fondoAFPFinal  = afpArr[afpArr.length-1]   || 0;
  const fondoAPVFinal  = apvArr[apvArr.length-1]   || 0;
  const fondoTotal     = fondoAFPFinal + fondoAPVFinal;
  const bonoTotal      = Math.min(apvMensual*12*0.15, bonoMaxAnual) * anosRest;
  const pension        = Math.round(fondoTotal / 240);

  $('jub-r-afp').textContent    = fmt(fondoAFPFinal);
  $('jub-r-apv').textContent    = fmt(fondoAPVFinal);
  $('jub-r-total').textContent  = fmt(fondoTotal);
  $('jub-r-bono').textContent   = fmt(bonoTotal);
  $('jub-r-pension').textContent= fmt(pension) + '/mes';

  // Gráfico apilado AFP + APV
  const th = chartTheme();
  const ctx = $('inv-chart-jubilacion').getContext('2d');
  if (invChartJub) invChartJub.destroy();
  invChartJub = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labelsArr,
      datasets: [
        { label:'Fondo AFP (obligatorio)',  data:afpArr, backgroundColor:'rgba(245,158,11,.75)', borderRadius:3, stack:'fondo' },
        { label:'Fondo APV (voluntario)',   data:apvArr, backgroundColor:'rgba(29,160,119,.80)', borderRadius:3, stack:'fondo' },
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      interaction:{ mode:'index', intersect:false },
      plugins:{
        legend:{ position:'top', labels:{ font:{ family:th.font }, color:th.tick, boxWidth:14 } },
        tooltip:{ callbacks:{
          label: i => ' ' + fmt(i.raw),
          footer: items => ' Total: ' + fmt(items.reduce((s,i)=>s+i.raw,0))
        }}
      },
      scales:{
        x:{ stacked:true, grid:{ display:false }, ticks:{ font:{ family:th.font }, color:th.tick } },
        y:{ stacked:true, grid:{ color:th.grid },  ticks:{ callback: v => '$'+(v/1e6).toFixed(1)+'M', color:th.tick, font:{ family:th.font } } }
      }
    }
  });
}

/* ============================================================
   invUpdate() — alias de invLibreUpdate() para compatibilidad
   con el botón de inicialización y el navigate()
   ============================================================ */
function invUpdate() { invLibreUpdate(); }

/* ============================================================
   FEAT C: COMPARADOR AUTOMOTRIZ
   Crédito tradicional vs Compra Inteligente (balloon payment)
   ============================================================ */
let autChart = null;

function autosUpdate() {
  const valor  = parseFloat($('aut-valor').value)   || 0;
  const piePct = parseFloat($('aut-pie-pct').value) / 100 || 0;
  const pie    = valor * piePct;
  const financ = valor - pie;

  $('aut-pie-lbl').textContent = Math.round(piePct * 100) + '%';
  $('aut-pie-val').textContent = fmt(pie);
  $('aut-fin-val').textContent = fmt(financ);

  // — CRÉDITO TRADICIONAL (amortización francesa) —
  const tPlazo = parseInt($('aut-t-plazo').value) || 1;
  const tTasa  = parseFloat($('aut-t-tasa').value) / 100 || 0;
  const tCuota = tTasa > 0
    ? financ * (tTasa * Math.pow(1+tTasa, tPlazo)) / (Math.pow(1+tTasa, tPlazo) - 1)
    : financ / tPlazo;
  const tTotal = tCuota * tPlazo + pie;
  const tInter = tCuota * tPlazo - financ;

  $('aut-t-cuota').textContent = fmt(tCuota);
  $('aut-t-total').textContent = fmt(tTotal);
  $('aut-t-inter').textContent = fmt(tInter);

  // — COMPRA INTELIGENTE (balloon / cuotón final) —
  const sPlazo  = parseInt($('aut-s-plazo').value)    || 1;
  const sTasa   = parseFloat($('aut-s-tasa').value)   / 100 || 0;
  const sCuoton = parseFloat($('aut-s-cuoton').value) || 0;
  const sPow        = Math.pow(1 + sTasa, sPlazo);
  const sFinancNeto = financ - sCuoton / sPow;
  const sCuota = sTasa > 0
    ? sFinancNeto * (sTasa * sPow) / (sPow - 1)
    : (financ - sCuoton) / sPlazo;
  const sTotal = sCuota * sPlazo + sCuoton + pie;
  const sInter = sCuota * sPlazo + sCuoton - financ;

  $('aut-s-cuota').textContent = fmt(sCuota);
  $('aut-s-total').textContent = fmt(sTotal);
  $('aut-s-inter').textContent = fmt(sInter);

  // — VEREDICTO —
  const winner = $('aut-winner');
  const diff   = Math.abs(tInter - sInter);
  if (tInter <= sInter) {
    winner.className = 'auto-winner better';
    winner.innerHTML = `<div class="auto-winner-icon">✅</div>
      <div><div class="auto-winner-title">Crédito Tradicional paga ${fmt(diff)} menos en intereses</div>
      <div style="font-size:13px;color:var(--muted)">El crédito estándar es más económico a largo plazo. La cuota inicial es mayor pero el costo total es menor.</div></div>`;
  } else {
    winner.className = 'auto-winner better';
    winner.innerHTML = `<div class="auto-winner-icon">✅</div>
      <div><div class="auto-winner-title">Compra Inteligente paga ${fmt(diff)} menos en intereses</div>
      <div style="font-size:13px;color:var(--muted)">Las cuotas mensuales son más bajas. Recuerda planificar para pagar o refinanciar el cuotón final (${fmt(sCuoton)}).</div></div>`;
  }

  // — GRÁFICO DE BARRAS comparativo —
  const th = chartTheme();
  const ctx = $('aut-chart').getContext('2d');
  if (autChart) autChart.destroy();
  autChart = new Chart(ctx, {
    type:'bar',
    data:{
      labels:['Capital financiado','Intereses totales','Costo total (sin pie)'],
      datasets:[
        { label:'Crédito Tradicional',  data:[financ, tInter, tCuota*tPlazo], backgroundColor:'rgba(239,68,68,.75)',  borderRadius:6 },
        { label:'Compra Inteligente',   data:[financ, sInter, sCuota*sPlazo+sCuoton], backgroundColor:'rgba(29,160,119,.75)', borderRadius:6 }
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ labels:{ font:{ family:th.font }, color:th.tick, boxWidth:14 } },
                tooltip:{ callbacks:{ label: i => ' ' + fmt(i.raw) } } },
      scales:{
        x:{ grid:{ display:false }, ticks:{ font:{ family:th.font }, color:th.tick } },
        y:{ grid:{ color:th.grid }, ticks:{ callback: v => '$'+(v/1e6).toFixed(1)+'M', color:th.tick, font:{ family:th.font } } }
      }
    }
  });
}

/* ============================================================
   FEAT D: EMPRENDEDORES — Calculadora SII Boletas
   PART 1 (Chile 2026): Tasa de retención correcta = 14.5%
   Bruto = Líquido / (1 − 0.145)
   ============================================================ */
function siiCalc() {
  const inp = $('sii-liquido');
  if (parseFloat(inp.value) < 0) inp.value = 0;
  const raw     = inp.value;
  const liquido = parseFloat(raw) || 0;
  if (!raw.trim() || liquido <= 0) {
    _calcHint('sii-liquido', '💡 Ingresa el monto líquido que quieres recibir en tu cuenta bancaria.');
    ['sii-bruto','sii-retencion','sii-liquido-out','sii-diff'].forEach(id => { const e=$(id); if(e) e.textContent='—'; });
    return;
  }
  _calcHint('sii-liquido', null);
  const tasa  = 0.145;
  const bruto = liquido / (1 - tasa);
  const reten = bruto * tasa;
  $('sii-bruto').textContent       = fmt(bruto);
  $('sii-retencion').textContent   = fmt(reten);
  $('sii-liquido-out').textContent = fmt(liquido);
  $('sii-diff').textContent        = '+' + fmt(bruto - liquido) + ' (retención SII)';
}

/* ============================================================
   FEAT D: EMPRENDEDORES — Calculadora IVA E-commerce + Dropshipping
   PART 2: incluye tarifa de pasarela de pago (Shopify/Stripe/Transbank)
   PART 3 / INSIGHT 5: alerta "El IVA no es tuyo"
   ============================================================ */
function ivaCalc() {
  const netoInp = $('iva-neto');
  if (parseFloat(netoInp.value) < 0) netoInp.value = 0;
  const costo        = parseFloat(netoInp.value)             || 0;
  const margen       = parseFloat($('iva-margen').value)     / 100 || 0;
  const pasarelaPct  = parseFloat($('iva-pasarela').value)   / 100 || 0;

  $('iva-margen-lbl').textContent    = Math.round(margen * 100) + '%';
  $('iva-pasarela-lbl').textContent  = (pasarelaPct * 100).toFixed(1) + '%';

  if (!netoInp.value.trim() || costo <= 0) {
    _calcHint('iva-neto', '💡 Ingresa el costo del producto (lo que tú pagas al proveedor, sin IVA).');
    ['iva-con-margen','iva-monto','iva-total','iva-pasarela-costo','iva-ganancia'].forEach(id => { const e=$(id); if(e) e.textContent='—'; });
    $('iva-margen-real').textContent = '—';
    $('iva-insight').style.display = 'none';
    return;
  }
  _calcHint('iva-neto', null);

  // 1. Precio neto con margen (sin IVA)
  const conMargen = costo * (1 + margen);
  // 2. IVA sobre precio con margen
  const ivaMonto  = conMargen * 0.19;
  // 3. Precio total que paga el cliente
  const total     = conMargen + ivaMonto;
  // 4. Costo pasarela de pago (se cobra sobre el total con IVA)
  const costoPasarela = total * pasarelaPct;
  // 5. Ganancia neta real = ingreso recibido − costo del producto − pasarela
  //    (el IVA se devuelve al SII, no es ganancia)
  const ganancia  = conMargen - costo - costoPasarela;
  // 6. Margen real sobre precio de venta neto (sin IVA)
  const margenReal = conMargen > 0 ? (ganancia / conMargen) * 100 : 0;

  $('iva-con-margen').textContent    = fmt(conMargen);
  $('iva-monto').textContent         = fmt(ivaMonto);
  $('iva-total').textContent         = fmt(total);
  $('iva-pasarela-costo').textContent= fmt(costoPasarela);
  $('iva-ganancia').textContent      = fmt(ganancia);
  $('iva-margen-real').textContent   = margenReal.toFixed(1) + '%';

  // PART 3 — INSIGHT 5: "El IVA no es tuyo"
  const insightEl = $('iva-insight');
  if (ivaMonto > 0) {
    insightEl.style.display = 'flex';
    insightEl.className     = 'alert warning';
    insightEl.innerHTML     = `<span class="alert-icon">🚀</span>
      <div><strong>Regla de oro del IVA:</strong> El IVA de <strong style="color:var(--amber-500)">${fmt(ivaMonto)}</strong> no es tuyo.
      Apenas te paguen, transfiere ese monto a una cuenta separada para no desfinanciarte a fin de mes cuando debas declararlo al SII.</div>`;
  } else {
    insightEl.style.display = 'none';
  }
}

/* ============================================================
   FEAT E: VENCIMIENTOS — CRUD + render + localStorage
   ============================================================ */
let vencRows = [
  { id:1, nombre:'Cuenta de Luz',    monto:35000,  dia:10, paid:false },
  { id:2, nombre:'Agua / Sanitario', monto:18000,  dia:15, paid:false },
  { id:3, nombre:'Internet',         monto:28000,  dia:5,  paid:true  },
];
let vencNextId = 10;

function renderVenc() {
  const list  = $('venc-list');
  const today = new Date().getDate();
  list.innerHTML = '';

  if (vencRows.length === 0) {
    list.innerHTML = '<div style="font-size:13px;color:var(--muted);padding:.75rem 1rem">No hay vencimientos registrados. Agrega uno arriba.</div>';
    $('venc-totals').style.display = 'none';
    return;
  }

  // Ordenar por día del mes
  const sorted = [...vencRows].sort((a, b) => a.dia - b.dia);

  sorted.forEach(row => {
    const daysLeft = row.dia - today;
    let diaCls = '';
    if (!row.paid) {
      if (daysLeft < 0)        diaCls = 'urgent';
      else if (daysLeft <= 5)  diaCls = 'soon';
    }
    const item = document.createElement('div');
    item.className = 'venc-item' + (row.paid ? ' paid' : '');
    item.innerHTML = `
      <div class="venc-check ${row.paid ? 'paid' : ''}" onclick="toggleVenc(${row.id})" title="Marcar como ${row.paid ? 'pendiente' : 'pagada'}">
        ${row.paid ? '✓' : ''}
      </div>
      <span class="venc-nombre">${row.nombre}</span>
      <span class="venc-monto">${fmt(row.monto)}</span>
      <span class="venc-dia ${diaCls}">Día ${row.dia}${daysLeft === 0 && !row.paid ? ' ⚡' : daysLeft < 0 && !row.paid ? ' ❗' : ''}</span>
      <button class="venc-del" onclick="deleteVenc(${row.id})" title="Eliminar">✕</button>
    `;
    list.appendChild(item);
  });

  // Totales
  const totalPendiente = vencRows.filter(r => !r.paid).reduce((s, r) => s + r.monto, 0);
  const totalPagado    = vencRows.filter(r =>  r.paid).reduce((s, r) => s + r.monto, 0);
  const totalAll       = vencRows.reduce((s, r) => s + r.monto, 0);
  $('venc-totals').style.display = 'flex';
  $('venc-summary-text').innerHTML = `${vencRows.filter(r => r.paid).length}/${vencRows.length} pagadas · Pendiente: <strong style="color:var(--red-500)">${fmt(totalPendiente)}</strong>`;
  $('venc-total-val').textContent = 'Total: ' + fmt(totalAll);
}

function addVenc() {
  const nombre = $('venc-nombre-in').value.trim();
  const monto  = parseFloat($('venc-monto-in').value) || 0;
  const dia    = parseInt($('venc-dia-in').value) || 1;
  if (!nombre) { $('venc-nombre-in').focus(); return; }
  vencRows.push({ id: ++vencNextId, nombre, monto, dia, paid: false });
  $('venc-nombre-in').value = '';
  $('venc-monto-in').value  = '';
  $('venc-dia-in').value    = '';
  renderVenc();
  saveAll();
}

function toggleVenc(id) {
  const row = vencRows.find(r => r.id === id);
  if (row) { row.paid = !row.paid; renderVenc(); saveAll(); }
}

function deleteVenc(id) {
  vencRows = vencRows.filter(r => r.id !== id);
  renderVenc();
  saveAll();
}

/* ============================================================
   INICIALIZACIÓN — orden de carga al abrir la página
   ============================================================ */

// FEATURE 2: Cargar datos persistidos ANTES de renderizar
loadFromStorage();

// FEATURE 3: Aplicar modo oscuro guardado
applyDarkMode();

// FEATURE 5: Obtener indicadores económicos en vivo (async)
fetchIndicadores();

function closeModule() {
  $('module-panel').classList.remove('open');
  $('quiz-start-btn').style.display = 'none';
  $('quiz-container').innerHTML = '';
}

/* ============================================================
   UX3 / EDIT 3: BOTONES RÁPIDOS DE TASA DE INVERSIÓN
   setInvTasa(val, btn) — rellena el input y anima el gráfico
   ============================================================ */
function setInvTasa(val, btn) {
  $('inv-tasa').value = val;
  document.querySelectorAll('.quick-rate-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  invUpdate();
}

/* ============================================================
   EDIT 4: GAMIFICACIÓN — Quiz y Badges
   quizData: definición de preguntas por módulo
   startQuiz(): muestra el quiz del módulo activo
   submitQuiz(): evalúa respuestas y otorga badge
   earnBadge(): guarda badge en localStorage y suma al score
   ============================================================ */
const quizData = {
  emergencias: {
    badge: '🏅 Experto en Ahorro',
    key:   'badge_emergencias',
    preguntas: [
      {
        q: '¿Cuántos meses de gastos esenciales se recomienda tener en un fondo de emergencias?',
        opts: ['1 mes', '3–6 meses', '12 meses', '2 semanas'],
        correct: 1,
        feedback: 'Lo correcto es 3–6 meses. 3 si tienes trabajo estable, 6 si eres independiente o con ingresos variables.'
      },
      {
        q: '¿Dónde debe estar guardado el fondo de emergencias?',
        opts: ['Invertido en acciones', 'Bajo el colchón', 'Cuenta de ahorro de fácil acceso', 'Criptomonedas'],
        correct: 2,
        feedback: 'Debe ser líquido y accesible en 24–48h. Las acciones o crypto pueden bajar justo cuando más las necesitas.'
      },
      {
        q: '¿Qué porcentaje del sueldo se recomienda destinar al fondo de emergencias cada mes?',
        opts: ['1%', '5%', '10%', '25%'],
        correct: 2,
        feedback: 'Un 10% automático el día de cobro es el estándar recomendado. Así en ~2 años tienes más de 2 meses ahorrados sin esfuerzo.'
      },
      {
        q: 'Si tus gastos esenciales mensuales son $400.000, ¿cuánto necesitas en tu fondo de emergencias (3 meses)?',
        opts: ['$400.000', '$800.000', '$1.200.000', '$2.400.000'],
        correct: 2,
        feedback: '$400.000 × 3 = $1.200.000. Ese es el mínimo para tener 3 meses de colchón ante cualquier imprevisto.'
      },
      {
        q: '¿Por qué NO se recomienda invertir el fondo de emergencias en acciones?',
        opts: ['Porque las acciones no dan intereses', 'Porque pueden bajar de valor justo cuando más los necesitas', 'Porque el SII lo grava con impuestos', 'Porque los bancos no lo permiten'],
        correct: 1,
        feedback: 'El fondo de emergencias debe estar siempre disponible a su valor completo. Una caída bursátil podría reducirlo a la mitad en el peor momento.'
      },
      {
        q: '¿Qué significa que el fondo de emergencias sea "líquido"?',
        opts: ['Que está en billetes físicos', 'Que puede retirarse rápidamente sin penalización ni pérdida de valor', 'Que está invertido en fondos mutuos', 'Que se actualiza según la UF'],
        correct: 1,
        feedback: 'Liquidez significa acceso inmediato al dinero sin penalización. Una cuenta de ahorro remunerada o cuenta vista lo cumplen perfectamente.'
      },
      {
        q: 'Una persona independiente en Chile debería tener un fondo de emergencias de al menos:',
        opts: ['1 mes de gastos', '3 meses de gastos', '6 meses de gastos', '1 año de gastos'],
        correct: 2,
        feedback: 'Los trabajadores independientes tienen ingresos variables y pueden quedar sin trabajo por periodos más largos. 6 meses es el estándar recomendado.'
      },
      {
        q: '¿Cuál de estos gastos NO debe incluirse en el cálculo del fondo de emergencias?',
        opts: ['Arriendo', 'Alimentación básica', 'Transporte al trabajo', 'Vacaciones en el extranjero'],
        correct: 3,
        feedback: 'El fondo cubre gastos ESENCIALES para sobrevivir. Las vacaciones son un deseo, no una necesidad básica.'
      },
      {
        q: '¿Cuál es la mayor ventaja de automatizar el ahorro para el fondo de emergencias?',
        opts: ['Genera más intereses', 'El dinero no llega a la cuenta corriente, así no se gasta', 'Evita pagar impuestos', 'Mejora el score crediticio automáticamente'],
        correct: 1,
        feedback: 'Si el dinero nunca llega a tu cuenta corriente, no puedes gastarlo. La automatización elimina la decisión y el tentación de gastar.'
      },
      {
        q: '¿Cuál de estas opciones es la MÁS adecuada para guardar el fondo de emergencias en Chile?',
        opts: ['Depósito a plazo fijo de 1 año', 'Cuenta de ahorro remunerada o cuenta vista con rendimiento', 'Fondo mutuo de renta variable', 'Compra de dólares en efectivo'],
        correct: 1,
        feedback: 'La cuenta de ahorro remunerada ofrece liquidez inmediata y un pequeño rendimiento. El depósito a plazo no permite retiro anticipado sin penalización.'
      }
    ]
  },
  deudas: {
    badge: '🏔️ Maestro de Deudas',
    key:   'badge_deudas',
    preguntas: [
      {
        q: '¿Cuál estrategia paga MENOS intereses totales a largo plazo?',
        opts: ['Bola de Nieve', 'Avalancha', 'Pagar el mínimo', 'Ignorar las deudas'],
        correct: 1,
        feedback: 'El Método Avalancha (atacar la deuda con mayor tasa primero) es matemáticamente el que más ahorra en intereses.'
      },
      {
        q: '¿Cuándo se considera que hay "sobreendeudamiento"?',
        opts: ['Cuando tienes una tarjeta de crédito', 'Cuando debes más de tu sueldo anual', 'Cuando las cuotas superan el 40% de tus ingresos', 'Nunca, la deuda es normal'],
        correct: 2,
        feedback: 'Si el total de cuotas mensuales supera el 40% de tus ingresos, estás en zona de riesgo financiero.'
      },
      {
        q: '¿Qué es el CAE (Carga Anual Equivalente) en Chile?',
        opts: ['El capital inicial de un crédito', 'El costo real total del crédito expresado como porcentaje anual, incluyendo todos los gastos', 'El número de cuotas de un préstamo', 'La tasa de interés base sin comisiones'],
        correct: 1,
        feedback: 'El CAE incluye tasa de interés + comisiones + seguros + gastos notariales. Es la única cifra que permite comparar créditos correctamente.'
      },
      {
        q: 'Si tienes 3 deudas con tasas de 15%, 28% y 8%, ¿cuál priorizar con el Método Avalancha?',
        opts: ['La de 8% (menor tasa)', 'La de 15%', 'La de 28% (mayor tasa)', 'La de mayor saldo'],
        correct: 2,
        feedback: 'El Método Avalancha prioriza la deuda con mayor tasa (28%), ya que es la que más dinero te está costando cada mes.'
      },
      {
        q: '¿Qué es el Método Bola de Nieve?',
        opts: ['Pagar primero la deuda con mayor tasa', 'Pagar primero la deuda con menor saldo para ganar victorias tempranas', 'Refinanciar todas las deudas en una sola', 'Ignorar las deudas pequeñas'],
        correct: 1,
        feedback: 'La Bola de Nieve es psicológicamente poderosa: cada deuda eliminada motiva a seguir. Estudios muestran mayor éxito con este método por adherencia.'
      },
      {
        q: '¿Qué es el DICOM en Chile?',
        opts: ['Un tipo de crédito estudiantil', 'El registro de deudas impagas que consultan los bancos al evaluar créditos', 'Una entidad del SII', 'Un tipo de seguro de desgravamen'],
        correct: 1,
        feedback: 'DICOM (hoy parte de Equifax) es el registro de morosidad. Aparecer ahí dificulta enormemente acceder a créditos, arriendo o trabajo.'
      },
      {
        q: 'Una tarjeta de crédito cobra 3% mensual. ¿Cuánto es eso aproximadamente al año?',
        opts: ['3% anual', '18% anual', 'Más del 36% anual', '9% anual'],
        correct: 2,
        feedback: '3% mensual compuesto equivale a más del 42% anual. Es una de las tasas más altas del mercado y destruye el patrimonio si no se controla.'
      },
      {
        q: '¿Qué es un "avance en efectivo" con tarjeta de crédito?',
        opts: ['Una cuota sin interés en comercios', 'Un descuento especial del banco', 'Un préstamo a altísima tasa que se obtiene retirando dinero con la tarjeta', 'Un beneficio exclusivo para clientes premium'],
        correct: 2,
        feedback: 'El avance acumula intereses desde el primer día (sin periodo de gracia) y suele tener la tasa más alta de todos los productos bancarios.'
      },
      {
        q: '¿Qué ocurre si pagas solo el "mínimo" de tu tarjeta mes a mes?',
        opts: ['La deuda desaparece en 1 año', 'La deuda puede tardar décadas en pagarse y triplicar su monto original', 'El banco te premia con menor tasa', 'No afecta tu historial crediticio'],
        correct: 1,
        feedback: 'Los intereses se acumulan sobre el saldo restante. Una deuda de $500.000 pagando solo el mínimo puede tardar más de 10 años en liquidarse.'
      },
      {
        q: '¿Qué es "renegociar una deuda" en Chile?',
        opts: ['Ignorar las cuotas atrasadas', 'Acordar nuevas condiciones con el banco: plazo, tasa o cuota más baja', 'Declararse en quiebra', 'Transferir la deuda a otra persona'],
        correct: 1,
        feedback: 'Renegociar puede reducir la cuota mensual extendiendo el plazo, aunque el costo total puede aumentar. Es mejor que caer en mora.'
      }
    ]
  },
  inversion: {
    badge: '📈 Inversor Principiante',
    key:   'badge_inversion',
    preguntas: [
      {
        q: '¿Qué es el APV Régimen A en Chile?',
        opts: ['Un tipo de tarjeta de crédito', 'Un ahorro previsional con bonificación del 15% del Estado', 'Un seguro médico estatal', 'Una cuenta corriente sin costo'],
        correct: 1,
        feedback: 'El APV Régimen A permite que el Estado done el 15% de lo ahorrado (con tope de 6 UTM/año). Es uno de los mejores beneficios tributarios disponibles.'
      },
      {
        q: '¿Qué es el interés compuesto?',
        opts: ['Interés que solo se calcula al final', 'Interés que se aplica solo a deudas', 'Interés que se genera sobre el capital + los intereses acumulados', 'Un tipo de descuento bancario'],
        correct: 2,
        feedback: 'El interés compuesto se aplica sobre el capital más los intereses ya generados, creando efecto "bola de nieve". Einstein lo llamó "la octava maravilla".'
      },
      {
        q: '¿Cuál es el orden correcto para empezar a invertir?',
        opts: ['Invertir primero, luego ahorrar', 'Fondo de emergencias → pagar deudas caras → invertir', 'Pagar deudas primero, nunca invertir', 'Invertir y pagar deudas al mismo tiempo siempre'],
        correct: 1,
        feedback: 'Sin fondo de emergencias te verás obligado a liquidar inversiones en el peor momento. Y las deudas caras (tarjetas al 36%) rinden más pagándolas que invirtiendo.'
      },
      {
        q: '¿Qué diferencia hay entre el APV Régimen A y el Régimen B en Chile?',
        opts: ['Son idénticos', 'El A da bonificación estatal del 15%; el B descuenta el monto de la base imponible del impuesto', 'El B es solo para independientes', 'El A es para mayores de 40 años'],
        correct: 1,
        feedback: 'El Régimen A conviene si pagas pocos impuestos (bonificación directa del Estado). El B conviene si tienes tramo alto de renta, ya que reduce el impuesto a pagar.'
      },
      {
        q: '¿Qué es un ETF (Exchange Traded Fund)?',
        opts: ['Una cuenta de ahorro del Banco Central', 'Un fondo que replica un índice bursátil y se transa en bolsa como una acción', 'Un tipo de seguro de vida con ahorro', 'Una moneda digital regulada por la CMF'],
        correct: 1,
        feedback: 'Los ETFs como el SPY (S&P 500) permiten invertir en cientos de empresas con una sola transacción y comisiones muy bajas.'
      },
      {
        q: '¿Qué es el S&P 500?',
        opts: ['Un banco de inversiones de Chile', 'Un índice que agrupa las 500 empresas más grandes de Estados Unidos', 'Una tasa de interés de la Reserva Federal', 'Un fondo de pensiones americano'],
        correct: 1,
        feedback: 'El S&P 500 incluye empresas como Apple, Microsoft, Amazon y Google. Históricamente ha rentado ~10% anual promedio en los últimos 50 años.'
      },
      {
        q: 'Si inviertes $50.000 mensuales durante 30 años al 7% anual, ¿cuánto tendrías aproximadamente?',
        opts: ['$18.000.000', '$30.000.000', 'Más de $56.000.000', '$5.000.000'],
        correct: 2,
        feedback: 'En efectivo habrías aportado $18 millones. El interés compuesto genera más de $38 millones adicionales. Esa es la magia de invertir con tiempo.'
      },
      {
        q: '¿Qué es "diversificar" una inversión?',
        opts: ['Poner todo el dinero en el mejor activo', 'Distribuir el dinero en distintos instrumentos para reducir el riesgo', 'Invertir solo en acciones chilenas', 'Cambiar de inversión cada mes'],
        correct: 1,
        feedback: '"No pongas todos los huevos en la misma canasta." Si un activo cae, los otros pueden compensar la pérdida.'
      },
      {
        q: '¿Qué es un fondo mutuo de renta fija?',
        opts: ['Un fondo que garantiza ganancias fijas mensuales', 'Un instrumento de bajo riesgo que invierte en bonos y depósitos a plazo', 'Una cuenta corriente remunerada', 'Un fondo solo para empresas'],
        correct: 1,
        feedback: 'Los fondos de renta fija invierten en instrumentos de deuda (bonos, depósitos). Son más seguros que los de renta variable, aunque con menor retorno esperado.'
      },
      {
        q: '¿Cuál es la principal ventaja tributaria del APV en Chile para un trabajador dependiente?',
        opts: ['No paga AFP', 'Recibe bonificación estatal (Régimen A) o reduce base imponible (Régimen B)', 'El empleador paga el doble', 'Está exento de IVA en retiros'],
        correct: 1,
        feedback: 'El APV es uno de los pocos instrumentos que ofrece un beneficio tributario directo del Estado chileno. Es especialmente poderoso para la jubilación.'
      }
    ]
  },
  tarjetas: {
    badge: '💳 Experto en Crédito',
    key:   'badge_tarjetas',
    preguntas: [
      {
        q: '¿Cuándo se cobran intereses en una tarjeta de crédito?',
        opts: ['Siempre al hacer una compra', 'Solo si no pagas el total al vencimiento', 'Solo en cuotas de más de 3 meses', 'Nunca si es cuotas sin interés del comercio'],
        correct: 1,
        feedback: 'Si pagas el 100% del estado de cuenta antes del vencimiento, NO se cobran intereses. El problema surge al pagar solo el mínimo.'
      },
      {
        q: '¿Cuál es la mejor estrategia para usar tarjetas de crédito?',
        opts: ['Usarla para todo y pagar el mínimo', 'No tener tarjetas nunca', 'Usarla como medio de pago y pagar el total cada mes', 'Sacar avances frecuentes'],
        correct: 2,
        feedback: 'La tarjeta es una herramienta poderosa si se usa para pagar (no endeudarse) y se liquida el total mensualmente.'
      },
      {
        q: '¿Cuál es la tasa de interés típica de una tarjeta de crédito en Chile?',
        opts: ['0,5% mensual (6% anual)', '1% mensual (12% anual)', 'Entre 2% y 3,5% mensual (24%–42% anual)', '5% mensual (60% anual)'],
        correct: 2,
        feedback: 'Las tasas de tarjetas en Chile están entre las más altas del sistema financiero: 2%–3,5% mensual, lo que equivale a 24%–42% anual.'
      },
      {
        q: '¿Qué significa "cuotas sin interés del comercio"?',
        opts: ['El banco no cobra nada a nadie', 'El comercio paga los intereses al banco; el precio del producto puede estar inflado', 'La tarjeta regala el interés ese mes', 'Solo aplica para montos menores a $50.000'],
        correct: 1,
        feedback: 'En las cuotas sin interés, el comercio subsidia los intereses. Muchos negocios suben el precio para recuperar ese costo, por lo que conviene preguntar el precio al contado.'
      },
      {
        q: 'Si tienes deuda pendiente en la tarjeta, ¿cuál es el primer paso?',
        opts: ['Sacar otro crédito para pagarla', 'Cancelar la tarjeta inmediatamente', 'Dejar de usarla para nuevas compras y calcular cuánto debes exactamente', 'Pagar el mínimo y esperar'],
        correct: 2,
        feedback: 'Usar la tarjeta con deuda pendiente es agravar el problema. El primer paso es conocer el saldo exacto y dejar de aumentarlo.'
      },
      {
        q: '¿Qué es el "pago mínimo" de una tarjeta?',
        opts: ['El monto ideal para liquidar la deuda en 1 año', 'El mínimo que exige el banco para no reportarte como moroso, pero que acumula intereses sobre el saldo restante', 'Un pago sin intereses', 'El 50% del saldo total'],
        correct: 1,
        feedback: 'El mínimo te mantiene al día en el sistema, pero los intereses siguen corriendo sobre el saldo. Es una trampa diseñada para maximizar los ingresos del banco.'
      },
      {
        q: '¿Qué es un "avance en efectivo" con tarjeta?',
        opts: ['Un descuento especial en comercios', 'Un retiro de dinero con la tarjeta a altísima tasa, sin periodo de gracia', 'Una transferencia sin costo entre cuentas', 'Un beneficio para clientes VIP'],
        correct: 1,
        feedback: 'El avance cobra intereses desde el día 1 y tiene la tasa más alta del banco. Es una de las operaciones más costosas del sistema financiero chileno.'
      },
      {
        q: '¿Para qué sirve configurar el "pago total automático" de tu tarjeta?',
        opts: ['Para pagar menos intereses que el mínimo', 'Para asegurar que nunca pagues intereses, ya que el banco descuenta el total desde tu cuenta', 'Para bloquear compras en el extranjero', 'Para evitar el cobro de la mantención anual'],
        correct: 1,
        feedback: 'El pago total automático es la mejor protección contra los intereses de tarjeta. Si tienes el dinero, el banco lo descuenta solo y nunca pagas de más.'
      },
      {
        q: '¿Qué es el CTC (Costo Total del Crédito)?',
        opts: ['Solo la tasa de interés mensual', 'El monto total que pagarás incluyendo intereses, comisiones y seguros', 'El número de cuotas pendientes', 'La tasa anual sin impuestos'],
        correct: 1,
        feedback: 'El CTC muestra el costo real de un crédito. La CMF obliga a las instituciones financieras a informarlo para que puedas comparar correctamente.'
      },
      {
        q: '¿Cuál de estas opciones es la MÁS cara al usar una tarjeta de crédito?',
        opts: ['Pagar en cuotas sin interés en el comercio', 'Pagar el total al vencimiento', 'Sacar un avance en efectivo', 'Comprar en 3 cuotas con interés del banco'],
        correct: 2,
        feedback: 'El avance en efectivo no tiene periodo de gracia y aplica la tasa máxima desde el primer día. Es la operación más costosa de cualquier tarjeta.'
      }
    ]
  },
  presupuesto_tip: {
    badge: '📊 Maestro del Presupuesto',
    key:   'badge_presupuesto',
    preguntas: [
      {
        q: '¿En qué consiste la regla 50/30/20?',
        opts: ['50% inversión, 30% gastos, 20% deudas', '50% necesidades, 30% deseos, 20% ahorro', '50% ahorro, 30% alimentación, 20% ocio', '50% deudas, 30% ropa, 20% comida'],
        correct: 1,
        feedback: 'La regla 50/30/20 divide el ingreso neto en: 50% necesidades básicas, 30% deseos y 20% ahorro e inversión.'
      },
      {
        q: '¿Por qué suelen fracasar los presupuestos?',
        opts: ['Porque el dinero nunca alcanza', 'Por ser muy rígidos y no tener margen para imprevistos', 'Porque los bancos no los apoyan', 'Porque son muy complejos de entender'],
        correct: 1,
        feedback: 'Los presupuestos rígidos sin colchón se rompen al primer gasto inesperado. Siempre incluye un 5–10% de "varios" como válvula de escape.'
      },
      {
        q: 'Si ganas $900.000 líquidos al mes, ¿cuánto deberías destinar al ahorro según la regla 50/30/20?',
        opts: ['$90.000', '$150.000', '$180.000', '$270.000'],
        correct: 2,
        feedback: '$900.000 × 20% = $180.000 al mes para ahorro e inversión. En un año habrías acumulado $2.160.000.'
      },
      {
        q: '¿Cuál de estos es un ejemplo de "necesidad" dentro del 50%?',
        opts: ['Netflix y Spotify', 'Arriendo, alimentación y transporte al trabajo', 'Salidas a restaurantes', 'Ropa de temporada'],
        correct: 1,
        feedback: 'Necesidades son gastos esenciales que no puedes eliminar sin afectar tu calidad de vida básica: vivienda, comida, transporte laboral, servicios básicos.'
      },
      {
        q: '¿Qué son los "gastos hormiga"?',
        opts: ['Gastos del supermercado', 'Pequeños gastos frecuentes (café, delivery, apps) que suman montos grandes al mes', 'Los impuestos que descuenta el empleador', 'Cuotas de crédito muy pequeñas'],
        correct: 1,
        feedback: 'Un café diario de $2.000 parece insignificante, pero son $60.000 al mes y $720.000 al año. Los gastos hormiga destruyen el presupuesto silenciosamente.'
      },
      {
        q: 'Una persona con ingresos variables debería presupuestar basándose en:',
        opts: ['Su ingreso más alto del último año', 'Su ingreso promedio teórico', 'Su ingreso mínimo de los últimos 6 meses', 'El sueldo mínimo legal'],
        correct: 2,
        feedback: 'Presupuestar con el mínimo garantiza que en meses malos cubres todo. En meses buenos, el excedente va directo al ahorro o fondo de emergencias.'
      },
      {
        q: '¿Cuál es la mayor ventaja de automatizar los ahorros el día que llega el sueldo?',
        opts: ['Genera más intereses que si se ahorra después', 'El dinero nunca llega a la cuenta corriente, por lo que no hay tentación de gastarlo', 'El banco ofrece mejores tasas', 'Reduce el impuesto a la renta'],
        correct: 1,
        feedback: '"Págate primero a ti mismo." Si el dinero pasa por tu cuenta corriente, las probabilidades de gastarlo se multiplican. La automatización elimina la decisión.'
      },
      {
        q: '¿Cuál de estos es un "deseo" según la regla 50/30/20?',
        opts: ['Arriendo del departamento', 'Cuenta de luz y agua', 'Suscripción a streaming y salidas a restaurantes', 'Seguro de salud obligatorio'],
        correct: 2,
        feedback: 'Los deseos son gastos que mejoran tu calidad de vida pero no son imprescindibles: entretención, restaurantes, viajes, ropa de moda, suscripciones.'
      },
      {
        q: 'La CMF de Chile recomienda que las deudas mensuales no superen:',
        opts: ['El 10% del ingreso', 'El 25% del ingreso', 'El 40% del ingreso', 'El 60% del ingreso'],
        correct: 2,
        feedback: 'Superar el 40% de endeudamiento sobre el ingreso es la zona de riesgo según la CMF. Por encima de eso se considera sobreendeudamiento.'
      },
      {
        q: '¿Cada cuánto tiempo se recomienda revisar el presupuesto mensual?',
        opts: ['Una vez al año', 'Solo cuando hay problemas de dinero', 'Al menos una vez por semana', 'Solo en enero'],
        correct: 2,
        feedback: 'Revisar semanalmente toma 10–15 minutos y permite detectar gastos descontrolados antes de que sea tarde. El 31 del mes es demasiado tarde para corregir.'
      }
    ]
  },
  habitos: {
    badge: '🧠 Psicólogo Financiero',
    key:   'badge_habitos',
    preguntas: [
      {
        q: '¿Qué es el "sesgo del presente" en finanzas personales?',
        opts: ['Preferir gastar hoy sobre ahorrar para el futuro', 'Comprar solo artículos en oferta actuales', 'Revisar la cuenta bancaria todos los días', 'Comparar precios antes de comprar'],
        correct: 0,
        feedback: 'El sesgo del presente hace que sobreestimemos el placer inmediato sobre el beneficio futuro. Es la razón principal por la que cuesta ahorrar.'
      },
      {
        q: '¿Cuántos días tarda en formarse un hábito financiero según estudios conductuales?',
        opts: ['7 días', '21 días', '~66 días', '1 año'],
        correct: 2,
        feedback: 'Estudios conductuales indican que los hábitos complejos (como el ahorro) tardan en promedio 66 días en consolidarse, no 21 como se cree popularmente.'
      },
      {
        q: '¿En qué consiste la "regla de las 48 horas" para evitar gastos impulsivos?',
        opts: ['Esperar 48 horas antes de ir al banco', 'Esperar 2 días antes de comprar cualquier cosa no planificada', 'Revisar el presupuesto cada 2 días', 'Ahorrar las primeras 48 horas del sueldo'],
        correct: 1,
        feedback: 'Si después de 48 horas todavía quieres el producto, probablemente sea una compra razonada. La mayoría de los impulsos desaparecen en ese tiempo.'
      },
      {
        q: '¿Qué significa "vivir bajo tus posibilidades"?',
        opts: ['Ganar más de lo que necesitas', 'Gastar menos de lo que ganas de manera consistente', 'No usar tarjetas de crédito nunca', 'Vivir sin deudas en absoluto'],
        correct: 1,
        feedback: 'Vivir bajo tus posibilidades es el principio fundamental de la salud financiera. No importa cuánto ganes si gastas todo (o más).'
      },
      {
        q: '¿Cuál de estos es un ejemplo de "automatización financiera"?',
        opts: ['Usar una app para registrar gastos', 'Programar una transferencia automática al ahorro el día que llega el sueldo', 'Revisar el estado de cuenta mensualmente', 'Pagar con tarjeta en vez de efectivo'],
        correct: 1,
        feedback: 'La automatización elimina la necesidad de fuerza de voluntad diaria. Si el ahorro es automático, ya no depende de una decisión que puede fallar.'
      },
      {
        q: '¿Cuál es el mayor enemigo del ahorro según la psicología conductual?',
        opts: ['Los impuestos', 'El gasto impulsivo motivado por la satisfacción inmediata', 'Las tasas de interés', 'Los empleadores que pagan poco'],
        correct: 1,
        feedback: 'El cerebro está diseñado para preferir el placer inmediato. El comercio aprovecha esto con ofertas, descuentos urgentes y filas de caja llenas de tentaciones.'
      },
      {
        q: '¿Qué es una "meta SMART" aplicada a las finanzas personales?',
        opts: ['Una meta que solo aplica para personas con alto ingreso', 'Una meta Específica, Medible, Alcanzable, Relevante y con Tiempo definido', 'Una meta establecida por un asesor financiero certificado', 'Una meta de al menos 5 años plazo'],
        correct: 1,
        feedback: 'Ejemplo de meta SMART: "Ahorrar $200.000 en 4 meses reduciendo gastos de entretención." Es concreta, medible y tiene fecha. "Ahorrar más" no es una meta.'
      },
      {
        q: '¿Cuál de los 5 hábitos del millonario promedio es el más importante según estudios?',
        opts: ['Ganar más de $5.000.000 al mes', 'Invertir consistentemente aunque sea un monto pequeño', 'Nunca endeudarse bajo ninguna circunstancia', 'Tener múltiples trabajos simultáneos'],
        correct: 1,
        feedback: 'La constancia supera al monto. Invertir $30.000 al mes durante 30 años al 7% genera más de $33 millones. El tiempo es el activo más poderoso.'
      },
      {
        q: 'Activar notificaciones de gasto del banco reduce el gasto impulsivo en aproximadamente:',
        opts: ['2%', '10%', '20%', '50%'],
        correct: 2,
        feedback: 'Según estudios de comportamiento financiero, las alertas de gasto generan conciencia inmediata y reducen compras impulsivas en torno al 20%.'
      },
      {
        q: '¿Cuál es la diferencia entre un "activo" y un "pasivo" en finanzas personales?',
        opts: ['Los activos son propiedades físicas; los pasivos son deudas digitales', 'Los activos generan dinero; los pasivos consumen dinero', 'Los activos son del banco; los pasivos son tuyos', 'No hay diferencia práctica entre ambos'],
        correct: 1,
        feedback: 'Un auto (que se deprecia y gastas en bencina) es un pasivo. Una inversión que genera dividendos es un activo. La salud financiera mejora acumulando activos.'
      }
    ]
  }
};

let quizState = { module: null, step: 0, correct: 0 };

function startQuiz() {
  const key    = quizState.module;
  const data   = quizData[key];
  if (!data) return;
  quizState.step    = 0;
  quizState.correct = 0;
  renderQuizQuestion(data, 0);
  $('quiz-container').style.display = 'block';
  $('quiz-start-btn').style.display = 'none';
}

function renderQuizQuestion(data, step) {
  const q   = data.preguntas[step];
  const con = $('quiz-container');
  con.innerHTML = `
    <div class="quiz-wrap">
      <div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:.5rem">
        Pregunta ${step + 1} de ${data.preguntas.length}
      </div>
      <div class="quiz-question">${q.q}</div>
      <div class="quiz-options">
        ${q.opts.map((opt, i) => `
          <button class="quiz-opt" onclick="answerQuiz(${i},${step})">${opt}</button>
        `).join('')}
      </div>
      <div class="quiz-feedback" id="quiz-fb-${step}" style="display:none"></div>
      <div id="quiz-next-${step}" style="display:none;margin-top:.75rem">
        <button class="btn btn-primary btn-sm" onclick="nextQuestion(${step})">
          ${step + 1 < data.preguntas.length ? 'Siguiente pregunta →' : '🏁 Ver resultado'}
        </button>
      </div>
    </div>`;
}

function answerQuiz(chosen, step) {
  const key  = quizState.module;
  const data = quizData[key];
  const q    = data.preguntas[step];
  const opts = $('quiz-container').querySelectorAll('.quiz-opt');
  opts.forEach((btn, i) => {
    btn.disabled = true;
    if (i === q.correct)  btn.classList.add('correct');
    if (i === chosen && i !== q.correct) btn.classList.add('wrong');
  });
  if (chosen === q.correct) quizState.correct++;
  const fb = $(`quiz-fb-${step}`);
  fb.style.display = 'block';
  fb.innerHTML = `${chosen === q.correct ? '✅' : '❌'} ${q.feedback}`;
  $(`quiz-next-${step}`).style.display = 'block';
}

function nextQuestion(step) {
  const key  = quizState.module;
  const data = quizData[key];
  if (step + 1 < data.preguntas.length) {
    renderQuizQuestion(data, step + 1);
  } else {
    // Show final result
    const total    = data.preguntas.length;
    const correct  = quizState.correct;
    const passed   = correct >= 7;
    const con      = $('quiz-container');
    if (passed && !earnedBadges.includes(data.key)) {
      earnBadge(data.key, data.badge);
      con.innerHTML = `
        <div class="badge-earned">
          <div class="badge-earned-icon">${data.badge.split(' ')[0]}</div>
          <div>
            <div style="font-family:var(--ff-head);font-size:16px;font-weight:700;margin-bottom:3px">¡${data.badge} desbloqueado!</div>
            <div style="font-size:13px;color:var(--muted)">Respondiste ${correct}/${total} correctamente. Se sumaron +50 puntos a tu Score Financiero.</div>
          </div>
        </div>`;
    } else if (passed) {
      con.innerHTML = `<div class="quiz-wrap"><div style="color:var(--green-600);font-weight:600">✅ ${correct}/${total} correctas — Ya habías ganado este badge anteriormente.</div></div>`;
    } else {
      con.innerHTML = `<div class="quiz-wrap">
        <div style="font-size:14px;margin-bottom:.75rem">❌ ${correct}/${total} correctas. Necesitas 7/10 para ganar el badge. ¡Sigue leyendo el módulo y vuelve a intentarlo!</div>
        <button class="btn btn-outline btn-sm" onclick="startQuiz()">🔁 Reintentar</button>
      </div>`;
    }
  }
}

function earnBadge(key, label) {
  earnedBadges.push(key);
  badgeScore = earnedBadges.length * 50;
  try { localStorage.setItem(LS.badges, JSON.stringify(earnedBadges)); } catch(e) {}
  dashUpdate(); // Refrescar score con los nuevos puntos
}

// Sobrescribir openModule para exponer el quiz al final de cada módulo
// EDIT 4: badges y quiz integrados directamente en openModule() arriba

/* ============================================================
   EDIT 6: AFP — integrado en invUpdate()
   Se añade dataset "AFP + APV" al gráfico de líneas
   ============================================================ */
// Sobrescribir invUpdate para incluir AFP fund projection
/* ============================================================
   EDIT 7: CALCULADORA DE IMPORTACIONES
   Usa indUSD de la API. Calcula: FOB → CIF → Arancel → IVA → Costo real
   ============================================================ */
function importCalc() {
  const fob    = parseFloat($('imp-valor-usd')?.value)  || 0;
  const flete  = parseFloat($('imp-flete-usd')?.value)  || 0;
  const tc     = indUSD; // tipo de cambio de la API (global)

  // Actualizar tipo de cambio visible
  const tcEl = $('imp-tc-val');
  if (tcEl) tcEl.textContent = Math.round(tc).toLocaleString('es-CL');

  const fobInp = $('imp-valor-usd');
  if (fobInp && parseFloat(fobInp.value) < 0) fobInp.value = 0;
  if (!fobInp?.value?.trim() || fob <= 0) {
    const el = $('imp-steps');
    if (el) el.innerHTML = '<div class="calc-empty-hint">💡 Ingresa el valor del producto en USD para ver el desglose de costos de importación a Chile.</div>';
    const insEl = $('imp-insight');
    if (insEl) insEl.style.display = 'none';
    return;
  }

  // Cálculo paso a paso (fórmula Aduana Chile)
  const cifUSD   = fob + flete;                        // Costo + Seguro + Flete
  const cifCLP   = cifUSD * tc;
  const arancel  = cifCLP * 0.06;                      // 6% arancel general
  const baseIVA  = cifCLP + arancel;                   // base imponible del IVA
  const iva      = baseIVA * 0.19;                     // 19% IVA
  const total    = cifCLP + arancel + iva;             // Costo real en puerta

  const steps = [
    { label:'Valor FOB del producto',       val: fob * tc,  note:'USD ' + fob + ' × $' + Math.round(tc).toLocaleString('es-CL') },
    { label:'+ Flete internacional',         val: flete * tc, note:'USD ' + flete + ' × tipo de cambio' },
    { label:'= Valor CIF (base aduanera)',   val: cifCLP,    note:'Costo + Seguro + Flete', highlight:true },
    { label:'+ Arancel (6% del CIF)',        val: arancel,   note:'Impuesto de importación general' },
    { label:'= Base imponible IVA',          val: baseIVA,   note:'CIF + Arancel' },
    { label:'+ IVA (19% sobre base)',        val: iva,       note:'Impuesto al Valor Agregado' },
    { label:'= Costo real en puerta',        val: total,     note:'Lo que realmente pagas para tener el producto', total:true },
  ];

  const stepsEl = $('imp-steps');
  if (stepsEl) {
    stepsEl.innerHTML = steps.map(s => `
      <div style="display:flex;justify-content:space-between;align-items:baseline;
        padding:${s.total ? '10px 12px' : '7px 12px'};
        background:${s.total ? 'var(--green-50)' : s.highlight ? 'var(--bg-2)' : 'transparent'};
        border:${s.total ? '1.5px solid var(--green-200)' : s.highlight ? '1px solid var(--line)' : 'none'};
        border-radius:${s.total || s.highlight ? 'var(--r-sm)' : '0'};
        border-bottom:${!s.total && !s.highlight ? '1px solid var(--line)' : 'none'};
        margin-bottom:2px">
        <div>
          <div style="font-size:${s.total ? '14px' : '13px'};font-weight:${s.total ? '700' : '500'};color:${s.total ? 'var(--green-800)' : 'var(--ink-2)'}">${s.label}</div>
          <div style="font-size:11px;color:var(--muted)">${s.note}</div>
        </div>
        <div style="font-family:var(--ff-head);font-size:${s.total ? '18px' : '14px'};font-weight:${s.total ? '800' : '600'};
          color:${s.total ? 'var(--green-600)' : 'var(--ink)'};white-space:nowrap;margin-left:1rem">${fmt(s.val)}</div>
      </div>`).join('');
  }

  // Insight: comparar con precio de venta sugerido
  const insightEl = $('imp-insight');
  if (insightEl && total > 0) {
    const margenSugerido = total * 1.40; // 40% de margen sobre costo real
    insightEl.style.display = 'flex';
    insightEl.className = 'alert info';
    insightEl.innerHTML = `<span class="alert-icon">💡</span>
      <div>Para un margen del 40% sobre tu costo real de importación, deberías vender a <strong style="color:var(--green-600)">${fmt(margenSugerido)}</strong>. Recuerda también considerar flete interno, bodegaje y comisión de pasarela de pago.</div>`;
  }
}

/* ============================================================
   EDIT 8: FICHA CLÍNICA FINANCIERA — exportPDF() mejorado
   Documento de 2 secciones: Executive Summary + Score + Budget + Inversión
   ============================================================ */
async function exportPDF() {
  const ing       = parseFloat($('b-ingreso').value) || 0;
  const deu       = parseFloat($('b-deuda').value)   || 0;
  const totReal   = budgetRows.reduce((s, r) => s + r.real,   0);
  const totPresup = budgetRows.reduce((s, r) => s + r.presup, 0);
  const ahorro    = Math.max(ing - totReal, 0);
  const mes       = $('b-mes').value;
  const hoy       = new Date().toLocaleDateString('es-CL');
  const ahorroAnualPDF = ahorro * 12;

  // Score para el PDF
  const ahoroPct = ing > 0 ? (ahorro / ing) * 100 : 0;
  const gastoPct = ing > 0 ? (totReal / ing) * 100 : 100;
  const deudaPct = ing > 0 ? ((deu / 12) / ing) * 100 : 0;
  let pdfScore = 600;
  if (ahoroPct >= 20) pdfScore += 350; else if (ahoroPct >= 10) pdfScore += 175;
  if (gastoPct > 80)  pdfScore -= 300; else if (gastoPct > 65) pdfScore -= 150;
  if (deudaPct > 30)  pdfScore -= 250; else if (deudaPct > 15) pdfScore -= 100;
  pdfScore = Math.min(1000, Math.max(0, pdfScore + badgeScore));
  const scoreColor = pdfScore >= 800 ? '#1da077' : pdfScore >= 650 ? '#1d4ed8' : pdfScore >= 450 ? '#d97706' : '#dc2626';
  const scoreLabel = pdfScore >= 800 ? 'Perfil Excelente' : pdfScore >= 650 ? 'Buen Perfil' : pdfScore >= 450 ? 'Perfil Moderado' : 'Requiere Atención';

  // Recomendación de inversión
  const recomendacion = pdfScore >= 800
    ? 'Con un perfil excelente, considera diversificar: 40% DAP, 30% Fondo Mutuo, 30% APV Régimen A o ETF internacional (S&P 500).'
    : pdfScore >= 650
    ? 'Buen momento para iniciar con un Depósito a Plazo o Fondo Mutuo conservador mientras consolidas el hábito de ahorro.'
    : 'Prioriza construir el Fondo de Emergencias (3–6 meses de gastos) antes de invertir. Luego evalúa APV Régimen A.';

  // Texto ejecutivo dinámico
  const execTextPDF = ahorro <= 0
    ? 'Este mes no se registra ahorro. Prioridad: reducir gastos variables o aumentar ingresos.'
    : `Manteniendo este presupuesto, el ahorro proyectado al año es $${Math.round(ahorroAnualPDF).toLocaleString('es-CL')}. ${recomendacion}`;

  // Badges ganados
  const badgeList = earnedBadges.length > 0
    ? earnedBadges.map(b => `<span style="background:#d8f7ed;color:#0f5240;padding:2px 8px;border-radius:99px;font-size:11px;margin-right:4px;font-weight:600">${b.replace('badge_','').replace('_',' ')}</span>`).join('')
    : '<span style="color:#9ca3af;font-size:11px">Sin badges aún</span>';

  // Construir filas tabla
  const filas = budgetRows.map((r, i) => {
    const diff    = r.real - r.presup;
    const rowBg   = i % 2 === 0 ? '#ffffff' : '#f9fafb';
    const diffCol = diff > 0 ? '#dc2626' : diff < 0 ? '#059669' : '#6b7280';
    return `<tr style="background:${rowBg}">
      <td style="padding:6px 9px;border-bottom:1px solid #e5e7eb;font-size:11.5px">${catConfig[r.cat]?.label || 'Otro'}</td>
      <td style="padding:6px 9px;border-bottom:1px solid #e5e7eb;font-size:11.5px;color:#6b7280">${r.desc}</td>
      <td style="padding:6px 9px;border-bottom:1px solid #e5e7eb;font-size:11.5px;text-align:right">${fmt(r.presup)}</td>
      <td style="padding:6px 9px;border-bottom:1px solid #e5e7eb;font-size:11.5px;text-align:right">${fmt(r.real)}</td>
      <td style="padding:6px 9px;border-bottom:1px solid #e5e7eb;font-size:11.5px;text-align:right;color:${diffCol};font-weight:600">${(diff>0?'+':'')+fmt(diff)}</td>
    </tr>`;
  }).join('');

  // Barras
  const catMap = {};
  budgetRows.forEach(r => {
    if (!catMap[r.cat]) catMap[r.cat] = { presup:0, real:0 };
    catMap[r.cat].presup += r.presup; catMap[r.cat].real += r.real;
  });
  const barras = Object.keys(catMap).map(ci => {
    const d   = catMap[ci];
    const p   = d.presup > 0 ? Math.min(pct(d.real, d.presup), 100) : 0;
    const col = p > 100 ? '#dc2626' : p > 80 ? '#d97706' : '#059669';
    return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:7px">
      <span style="width:120px;font-size:10.5px;text-align:right;color:#374151">${catConfig[ci]?.label || 'Otro'}</span>
      <div style="flex:1;height:9px;background:#f3f4f6;border-radius:99px;overflow:hidden">
        <div style="width:${p}%;height:100%;background:${col};border-radius:99px"></div>
      </div>
      <span style="width:36px;font-size:10.5px;font-weight:600;color:#374151;text-align:right">${p}%</span>
    </div>`;
  }).join('');

  const htmlPDF = `
  <div style="font-family:'Helvetica Neue',Arial,sans-serif;padding:20px;color:#111827;max-width:720px">

    <!-- ═══ ENCABEZADO ═══ -->
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;border-bottom:2.5px solid #0f5240;padding-bottom:14px">
      <div>
        <div style="font-size:21px;font-weight:800;color:#0f5240;margin-bottom:2px">💚 Salud Financiera — Ficha Clínica</div>
        <div style="font-size:11px;color:#6b7280">Reporte Mensual: ${mes} 2026 · Generado: ${hoy} · Badges: ${badgeList}</div>
      </div>
      <div style="text-align:center;background:#f0fdf8;border:1px solid #a8ecd4;border-radius:10px;padding:10px 16px">
        <div style="font-size:10px;color:#0f5240;font-weight:700;text-transform:uppercase;letter-spacing:.8px">Score</div>
        <div style="font-size:28px;font-weight:800;color:${scoreColor};letter-spacing:-1.5px;line-height:1">${pdfScore}</div>
        <div style="font-size:10px;color:${scoreColor};font-weight:600">${scoreLabel}</div>
      </div>
    </div>

    <!-- ═══ RESUMEN EJECUTIVO ═══ -->
    <div style="background:#f0fdf8;border:1px solid #a8ecd4;border-radius:10px;padding:14px 18px;margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#0f5240;margin-bottom:6px">📋 Resumen Ejecutivo Anualizado</div>
      <div style="font-size:13px;color:#1a3a2e;line-height:1.6">${execTextPDF}</div>
    </div>

    <!-- ═══ TARJETAS KPI ═══ -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-bottom:16px">
      <div style="background:#f0fdf8;border-radius:8px;padding:10px;text-align:center">
        <div style="font-size:9.5px;color:#6b7280;font-weight:700;text-transform:uppercase;margin-bottom:3px">Ingreso neto</div>
        <div style="font-size:17px;font-weight:700;color:#0f5240">${fmt(ing)}</div>
      </div>
      <div style="background:#fff1f1;border-radius:8px;padding:10px;text-align:center">
        <div style="font-size:9.5px;color:#6b7280;font-weight:700;text-transform:uppercase;margin-bottom:3px">Gastado real</div>
        <div style="font-size:17px;font-weight:700;color:#dc2626">${fmt(totReal)}</div>
      </div>
      <div style="background:#fffbeb;border-radius:8px;padding:10px;text-align:center">
        <div style="font-size:9.5px;color:#6b7280;font-weight:700;text-transform:uppercase;margin-bottom:3px">Ahorro mes</div>
        <div style="font-size:17px;font-weight:700;color:#d97706">${fmt(ahorro)}</div>
      </div>
      <div style="background:#eff6ff;border-radius:8px;padding:10px;text-align:center">
        <div style="font-size:9.5px;color:#6b7280;font-weight:700;text-transform:uppercase;margin-bottom:3px">Deuda total</div>
        <div style="font-size:17px;font-weight:700;color:#1d4ed8">${fmt(deu)}</div>
      </div>
    </div>

    <!-- ═══ TABLA DE GASTOS ═══ -->
    <div style="margin-bottom:16px">
      <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#6b7280;margin-bottom:8px">Detalle de Gastos</div>
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:#0f5240;color:#fff">
            <th style="padding:7px 9px;text-align:left;font-size:10.5px;font-weight:600">Categoría</th>
            <th style="padding:7px 9px;text-align:left;font-size:10.5px;font-weight:600">Descripción</th>
            <th style="padding:7px 9px;text-align:right;font-size:10.5px;font-weight:600">Presupuesto</th>
            <th style="padding:7px 9px;text-align:right;font-size:10.5px;font-weight:600">Real</th>
            <th style="padding:7px 9px;text-align:right;font-size:10.5px;font-weight:600">Dif.</th>
          </tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
    </div>

    <!-- ═══ EJECUCIÓN POR CATEGORÍA ═══ -->
    <div style="margin-bottom:16px">
      <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#6b7280;margin-bottom:10px">Ejecución por Categoría</div>
      ${barras}
    </div>

    <!-- ═══ RECOMENDACIÓN DE INVERSIÓN ═══ -->
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:14px 18px;margin-bottom:14px">
      <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#1d4ed8;margin-bottom:6px">📈 Recomendación de Inversión</div>
      <div style="font-size:12.5px;color:#1e3a5f;line-height:1.6">${recomendacion}</div>
      <div style="font-size:11.5px;color:#1e3a5f;margin-top:6px">Proyección anual de ahorro: <strong style="color:#1d4ed8">$${Math.round(ahorroAnualPDF).toLocaleString('es-CL')}</strong></div>
    </div>

    <!-- ═══ PIE ═══ -->
    <div style="border-top:1px solid #e5e7eb;padding-top:10px;display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:9.5px;color:#9ca3af">Salud Financiera · Proyecto ABP · Solo uso educativo · No constituye asesoría financiera</span>
      <span style="font-size:9.5px;color:#9ca3af">Score: ${pdfScore}/1000</span>
    </div>
  </div>`;

  // Contenedor temporal fuera de pantalla, en DOS niveles. Esto importa:
  //
  //  - display:none no sirve: un nodo sin layout no tiene dimensiones y se
  //    captura vacío.
  //  - Pero position:absolute sobre el nodo que se captura TAMPOCO sirve:
  //    html2pdf clona ese nodo dentro de su propio contenedor de medición, y
  //    un clon posicionado en absoluto queda fuera del flujo, así que el
  //    contenedor mide 0 de alto. El lienzo sale 794x0 y el PDF, en blanco.
  //    Esa era la causa real del bug.
  //
  // Por eso el posicionamiento fuera de pantalla va en el envoltorio y el
  // nodo que se le pasa a html2pdf queda en flujo normal, con altura real.
  // La clase pdf-force-light neutraliza el tema oscuro (ver css/app.css).
  const pdfWrap = document.createElement('div');
  pdfWrap.style.cssText = 'position:absolute;left:-9999px;top:0;width:794px;';

  const pdfTmp = document.createElement('div');
  pdfTmp.className = 'pdf-force-light';
  pdfTmp.style.cssText = 'width:794px;background:#fff;color:#111816;font-family:sans-serif;';
  pdfTmp.innerHTML = htmlPDF;

  pdfWrap.appendChild(pdfTmp);
  document.body.appendChild(pdfWrap);

  const opt = {
    margin      : [6, 6, 6, 6],
    filename    : `ficha-clinica-${mes.toLowerCase()}-2026.pdf`,
    image       : { type:'jpeg', quality:0.98 },
    html2canvas : { scale:2, useCORS:true, logging:false, backgroundColor:'#ffffff' },
    jsPDF       : { unit:'mm', format:'a4', orientation:'portrait' }
  };

  try {
    // Esperar a que el navegador pinte el nodo recién insertado. El doble
    // requestAnimationFrame garantiza que pasó un frame completo; sin esto
    // html2canvas puede capturar antes de que exista layout.
    //
    // Ojo: rAF NO dispara en pestañas ocultas. Si el usuario aprieta el botón
    // y se cambia de pestaña, esperar solo el rAF colgaría la descarga para
    // siempre. Por eso cada espera corre contra un plazo máximo: en pestaña
    // visible gana el rAF (unos 16 ms), y si está oculta gana el plazo.
    const pintado = new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await Promise.race([pintado, new Promise(r => setTimeout(r, 300))]);
    await new Promise(r => setTimeout(r, 50));

    // Las tipografías vienen de Google Fonts. Si aún no cargaron, el texto
    // se mide contra una fuente distinta a la que se pinta. Sin conexión esto
    // puede no resolverse nunca, así que también lleva plazo.
    if (document.fonts?.ready) {
      await Promise.race([
        document.fonts.ready.catch(() => {}),
        new Promise(r => setTimeout(r, 1500))
      ]);
    }

    await html2pdf().set(opt).from(pdfTmp).save();
  } catch (err) {
    console.error('exportPDF:', err);
    alert('Error al generar PDF. Verifica tu conexión a internet.');
  } finally {
    pdfWrap.remove();
  }
}

/* ============================================================
   MEJORA 4: Helpers para calculadoras mejoradas
   ============================================================ */

// Muestra u oculta un hint de validación junto al input
function _calcHint(inputId, msg) {
  const hintId = inputId + '-vhint';
  let el = $(hintId);
  if (!el) {
    el = document.createElement('div');
    el.id = hintId;
    el.className = 'calc-empty-hint';
    const inp = $(inputId);
    if (inp) inp.insertAdjacentElement('afterend', el);
    else return;
  }
  if (msg) { el.textContent = msg; el.style.display = 'block'; }
  else      { el.style.display = 'none'; }
}

// Copia texto al portapapeles y anima el botón
function copyCalcResult(text, btn) {
  const done = () => {
    const orig = btn.innerHTML;
    btn.innerHTML = '✅ ¡Copiado!';
    setTimeout(() => { btn.innerHTML = orig; }, 2000);
  };
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(done).catch(() => { _fbCopy(text); done(); });
  } else { _fbCopy(text); done(); }
}
function _fbCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } catch(e) {}
  document.body.removeChild(ta);
}

// Configura previews de formato de miles, botones copiar y textos explicativos
function setupCalcEnhancements() {
  // ── 1. Formato de miles en vivo + clamping negativo ──────────
  ['sii-liquido','iva-neto','s-ingreso','s-otras','s-gastos-op','imp-valor-usd','imp-flete-usd'].forEach(id => {
    const inp = $(id);
    if (!inp) return;
    inp.setAttribute('min', '0');
    const prev = document.createElement('div');
    prev.className = 'fmt-preview';
    inp.insertAdjacentElement('afterend', prev);
    const refresh = () => {
      const v = parseFloat(inp.value);
      prev.textContent = (inp.value.trim() !== '' && !isNaN(v) && v > 0)
        ? v.toLocaleString('es-CL', { maximumFractionDigits: 0 })
        : '';
    };
    inp.addEventListener('input', refresh);
    refresh();
  });

  // ── 2. Textos explicativos por calculadora ────────────────────
  const insertExpl = (afterId, html) => {
    if ($(afterId + '-expl') || !$(afterId)) return;
    const d = document.createElement('div');
    d.id = afterId + '-expl';
    d.className = 'calc-explanation';
    d.innerHTML = html;
    $(afterId).insertAdjacentElement('afterend', d);
  };
  insertExpl('sii-results',
    '💡 <strong>¿Qué significan estos números?</strong> El monto bruto es lo que indicas en la boleta. El SII retiene el 14,5% y deposita solo el líquido en tu cuenta. Siempre cobra más de lo que quieres recibir.');
  insertExpl('iva-results',
    '💡 <strong>¿Qué significan estos números?</strong> El IVA lo cobras al cliente, pero lo debes declarar al SII a fin de mes — no es ganancia tuya. Tu utilidad real es solo lo que queda tras descontar el costo del producto y la comisión de la pasarela.');
  insertExpl('imp-insight',
    '💡 <strong>¿Qué es el costo real en puerta?</strong> Es lo que pagas realmente para tener el producto en Chile: precio del proveedor + flete + arancel aduanero (6% del CIF) + IVA (19% sobre CIF+arancel). Usa esta cifra como base para calcular tu precio de venta.');

  // ── 3. Botones "Copiar resultado" ─────────────────────────────
  const insertCopy = (afterId, getText) => {
    if ($(afterId + '-cpybtn') || !$(afterId)) return;
    const btn = document.createElement('button');
    btn.id = afterId + '-cpybtn';
    btn.className = 'btn btn-outline btn-sm calc-copy-btn';
    btn.innerHTML = '📋 Copiar resultado';
    btn.onclick = () => copyCalcResult(getText(), btn);
    $(afterId).insertAdjacentElement('afterend', btn);
  };

  insertCopy('sii-results', () =>
    `Calculadora SII — Boleta de Honorarios\nBruto a cobrar: ${$('sii-bruto').textContent}\nRetención SII 14,5%: ${$('sii-retencion').textContent}\nLíquido a recibir: ${$('sii-liquido-out').textContent}`
  );
  insertCopy('iva-results', () =>
    `Calculadora IVA E-commerce\nPrecio al cliente: ${$('iva-total').textContent}\nIVA 19%: ${$('iva-monto').textContent}\nGanancia neta: ${$('iva-ganancia').textContent}\nMargen real: ${$('iva-margen-real').textContent}`
  );
  insertCopy('imp-steps', () => {
    const rows = [...($('imp-steps')?.querySelectorAll('div[style*="justify-content:space-between"]') || [])];
    const lines = rows.map(r => {
      const label = r.querySelector('div > div:first-child')?.textContent?.trim() || '';
      const val   = r.querySelector('[style*="font-family:var(--ff-head)"]')?.textContent?.trim() || '';
      return label && val ? `${label}: ${val}` : '';
    }).filter(Boolean);
    return ['Calculadora de Importaciones', ...lines].join('\n');
  });
  insertCopy('sim-result', () =>
    `Simulador de Crédito\nCuota mensual: ${$('r-cuota').textContent}\nTotal a pagar: ${$('r-total').textContent}\nIntereses totales: ${$('r-inter').textContent}\nRatio cuota/ingreso: ${$('r-pct').textContent}`
  );
}

// FEAT E: Renderizar vencimientos con datos cargados
renderVenc();

// Renderizar dashboard (lee de budgetRows recién cargados)
dashUpdate();

// Renderizar simulador con valores restaurados
simUpdate();

// FEAT B: Inicializar calculadora de inversiones
invUpdate();

// FEAT C: Inicializar comparador automotriz
autosUpdate();

// FEAT D: Inicializar calculadoras de emprendedores
siiCalc();
ivaCalc();

// EDIT 7: Inicializar calculadora de importaciones
importCalc();

// Mejora 4: Activar enhancements de calculadoras (después de que todas calcen por primera vez)
setupCalcEnhancements();

// Simulador de deudas y comparador de ofertas
loadDebts();
loadOfertas();

// Mejora 2: Inicializar indicador de nav y scroll spy
window.addEventListener('load', () => {
  updateNavIndicator();
  updateMobileTitle();
});

window.addEventListener('resize', updateNavIndicator, { passive: true });

window.addEventListener('scroll', () => {
  document.querySelector('.topbar').classList.toggle('scrolled', window.scrollY > 10);
}, { passive: true });

/* ============================================================
   MEJORA 5: WOW EXTRAS
   ============================================================ */

// ── Easing compartida ──
function _easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

// ── Utilidad count-up genérica ──
function countUp(el, end, duration, suffix) {
  const startTs = performance.now();
  (function step(now) {
    const t   = Math.min((now - startTs) / duration, 1);
    el.textContent = Math.round(_easeOutCubic(t) * end) + (suffix || '');
    if (t < 1) requestAnimationFrame(step);
  })(performance.now());
}

// ── 1. Count-up en página Acerca de ──
function runAboutCountUp() {
  document.querySelectorAll('.about-stat-num').forEach(el => {
    const raw    = el.textContent.trim();    // "7", "12", "25+", "100%"
    const suffix = raw.replace(/\d/g, '');  // "+", "%", ""
    const target = parseInt(raw, 10);
    if (!isNaN(target)) countUp(el, target, 900, suffix);
  });
}

// ── 2. Score Financiero animado ──
// var (not let) so it's hoisted before dashUpdate() runs during init
var _gaugeAnim = null;
function animateGaugeScore(score, color) {
  if (_gaugeAnim) { cancelAnimationFrame(_gaugeAnim); _gaugeAnim = null; }
  const startTs  = performance.now();
  const duration = 900;
  (function step(now) {
    const t   = Math.min((now - startTs) / duration, 1);
    const val = Math.round(_easeOutCubic(t) * score);
    $('gauge-score').textContent = val + '/1000';
    drawGauge(val, color);
    if (t < 1) { _gaugeAnim = requestAnimationFrame(step); }
    else { _gaugeAnim = null; $('gauge-score').textContent = score + '/1000'; drawGauge(score, color); }
  })(performance.now());
}

// ── 3. Tour guiado ──
const _tourSteps = [
  {
    sel  : '#gauge-wrap',
    title: '📊 Tu Score Financiero',
    desc : 'Esta aguja calcula tu salud financiera de 0 a 1000 puntos según tus ingresos, gastos y deudas. Se actualiza automáticamente.'
  },
  {
    sel  : '.g4.mb2',
    title: '💰 Resumen del mes',
    desc : 'Ingresos, gastos reales, deudas y capacidad de ahorro. Todos los datos provienen directamente del módulo Presupuesto.'
  },
  {
    sel  : '.topbar-nav',
    title: '🧭 Navegación completa',
    desc : 'Accede a los 8 módulos: Simulador de créditos con CAE, Educación financiera con quizzes, Presupuesto, Inversiones & APV, Autos y Emprendedores.'
  },
  {
    sel  : '.score-factors',
    title: '📈 Factores del Score',
    desc : 'Ve en detalle cómo se calcula tu puntuación: porcentaje de ahorro, porcentaje de gastos y porcentaje de deudas sobre tus ingresos mensuales.'
  }
];
let _tourIdx = 0;
let _tourHL  = null;

function startTour() {
  navigate('dashboard', document.querySelector('.topbar-nav .nav-pill'));
  _tourIdx = 0;
  document.getElementById('tour-overlay').classList.add('active');
  _showTourStep(_tourIdx);
}

function _showTourStep(i) {
  const step   = _tourSteps[i];
  const target = document.querySelector(step.sel);

  document.getElementById('tour-title').textContent   = step.title;
  document.getElementById('tour-desc').textContent    = step.desc;
  document.getElementById('tour-counter').textContent = (i + 1) + ' / ' + _tourSteps.length;
  document.getElementById('tour-prev').style.display  = i === 0 ? 'none' : '';
  document.getElementById('tour-next').textContent    = i === _tourSteps.length - 1 ? '✓ Finalizar' : 'Siguiente →';

  if (_tourHL) _tourHL.classList.remove('tour-highlight');
  if (target) {
    target.classList.add('tour-highlight');
    _tourHL = target;
    target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Position tooltip relative to highlighted element
    const tip  = document.getElementById('tour-tooltip');
    const rect = target.getBoundingClientRect();
    const tipW = Math.min(288, window.innerWidth - 20);
    tip.style.width = tipW + 'px';
    const left = Math.max(10, Math.min(rect.left, window.innerWidth - tipW - 10));
    let   top  = rect.bottom + 16;
    if (top + 180 > window.innerHeight - 10) top = Math.max(8, rect.top - 180 - 12);
    tip.style.left = left + 'px';
    tip.style.top  = top + 'px';
  }
}

function tourNext() {
  if (_tourHL) _tourHL.classList.remove('tour-highlight');
  if (_tourIdx < _tourSteps.length - 1) { _tourIdx++; _showTourStep(_tourIdx); }
  else closeTour();
}

function tourPrev() {
  if (_tourIdx > 0) {
    if (_tourHL) _tourHL.classList.remove('tour-highlight');
    _tourIdx--;
    _showTourStep(_tourIdx);
  }
}

function closeTour() {
  if (_tourHL) { _tourHL.classList.remove('tour-highlight'); _tourHL = null; }
  document.getElementById('tour-overlay').classList.remove('active');
}

// ── 4. Modo presentación — tecla P ──
document.addEventListener('keydown', e => {
  if (e.key !== 'p' && e.key !== 'P') return;
  if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
  document.body.classList.toggle('presentation');
  const on = document.body.classList.contains('presentation');
  let badge = document.getElementById('pres-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'pres-badge';
    badge.className = 'pres-badge';
    badge.innerHTML = '🎤 Modo Presentación activo &nbsp;·&nbsp; pulsa <kbd>P</kbd> para salir';
    document.body.appendChild(badge);
  }
  badge.classList.toggle('visible', on);
});

/* ============================================================
   SIMULADOR DE DEUDAS — Snowball vs Avalancha
   ============================================================ */
let debtRows = [];
let _debtId  = 0;
var _debtChart = null; // var: hoisted por si acaso

function addDebtRow(nombre, saldo, tasa, pagMin) {
  const id = ++_debtId;
  debtRows.push({ id,
    nombre : nombre || 'Deuda ' + id,
    saldo  : saldo  || 500000,
    tasa   : tasa   || 2.5,
    pagMin : pagMin || 20000
  });
  renderDebtTable();
  debtUpdate();
  saveDebts();
}

function removeDebtRow(id) {
  debtRows = debtRows.filter(d => d.id !== id);
  renderDebtTable();
  debtUpdate();
  saveDebts();
}

function updateDebtField(id, field, value) {
  const row = debtRows.find(d => d.id === id);
  if (!row) return;
  row[field] = field === 'nombre' ? value : (parseFloat(value) || 0);
  debtUpdate();
  saveDebts();
}

function renderDebtTable() {
  const tbody = $('debt-tbody');
  if (!tbody) return;
  if (debtRows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:.75rem;font-size:13px">Sin deudas. Haz clic en "Agregar deuda".</td></tr>`;
    $('debt-empty').style.display = '';
    return;
  }
  $('debt-empty').style.display = 'none';
  tbody.innerHTML = debtRows.map(d => `
    <tr>
      <td><input class="f-input" style="min-width:130px" value="${d.nombre}"
          onchange="updateDebtField(${d.id},'nombre',this.value)"></td>
      <td><input class="f-input" type="number" style="min-width:110px" value="${d.saldo}" min="0"
          onchange="updateDebtField(${d.id},'saldo',+this.value)"></td>
      <td><input class="f-input" type="number" style="min-width:80px" value="${d.tasa}" min="0" max="30" step="0.1"
          onchange="updateDebtField(${d.id},'tasa',+this.value)"></td>
      <td><input class="f-input" type="number" style="min-width:110px" value="${d.pagMin}" min="0"
          onchange="updateDebtField(${d.id},'pagMin',+this.value)"></td>
      <td><button class="btn btn-sm" style="background:var(--red-500);color:#fff;border:none;padding:3px 8px"
          onclick="removeDebtRow(${d.id})">✕</button></td>
    </tr>
  `).join('');
}

// Simula una estrategia de pago de deudas, devuelve {meses, totalIntereses, timeline}
function _calcDebtStrat(debts, extraPago, strategy) {
  if (!debts.length) return { meses: 0, totalIntereses: 0, timeline: [0] };
  let ds = debts.map(d => ({
    id    : d.id,
    tasa  : d.tasa / 100,
    pagMin: Math.max(d.pagMin, 1),
    saldo : d.saldo,
    freed : false
  }));
  let mes = 0, totalInt = 0, pool = extraPago;
  const timeline = [Math.round(ds.reduce((s, d) => s + d.saldo, 0))];

  while (ds.some(d => d.saldo > 0.5) && mes < 720) {
    mes++;

    // 1. Interés mensual
    ds.forEach(d => {
      if (d.saldo > 0) { const i = d.saldo * d.tasa; totalInt += i; d.saldo += i; }
    });

    // 2. Pagar mínimos
    ds.forEach(d => {
      if (d.saldo > 0) d.saldo = Math.max(0, d.saldo - Math.min(d.saldo, d.pagMin));
    });

    // 3. Pago extra al objetivo
    const active = ds.filter(d => d.saldo > 0.5);
    if (active.length) {
      const target = strategy === 'snowball'
        ? active.reduce((a, b) => a.saldo <= b.saldo ? a : b)
        : active.reduce((a, b) => a.tasa  >= b.tasa  ? a : b);
      target.saldo = Math.max(0, target.saldo - Math.min(target.saldo, pool));
    }

    // 4. Liberar mínimos de deudas saldadas
    ds.forEach(d => {
      if (d.saldo < 0.5 && !d.freed) { d.saldo = 0; d.freed = true; pool += d.pagMin; }
    });

    timeline.push(Math.round(ds.reduce((s, d) => s + d.saldo, 0)));
  }
  return { meses: mes, totalIntereses: Math.round(totalInt), timeline };
}

function debtUpdate() {
  const extra = parseFloat($('debt-extra')?.value) || 0;
  const resultsEl = $('debt-results');
  const emptyEl   = $('debt-empty');

  if (!debtRows.length || !debtRows.every(d => d.saldo > 0 && d.tasa > 0 && d.pagMin > 0)) {
    if (resultsEl) resultsEl.style.display = 'none';
    return;
  }
  if (resultsEl) resultsEl.style.display = '';

  const snow = _calcDebtStrat(debtRows, extra, 'snowball');
  const ava  = _calcDebtStrat(debtRows, extra, 'avalanche');
  const fmt  = n => '$' + Math.round(n).toLocaleString('es-CL');

  // Tarjetas de resultado
  const renderCard = (id, res) => {
    const el = $(id);
    if (el) el.innerHTML = `
      <div class="debt-strat-num">${res.meses}</div>
      <div style="font-size:11px;color:var(--muted);margin:.2rem 0 .6rem">meses para quedar libre de deudas</div>
      <div style="font-size:13px;color:var(--ink-3)">Intereses pagados:</div>
      <div style="font-size:17px;font-weight:700;color:var(--red-500)">${fmt(res.totalIntereses)}</div>`;
  };
  renderCard('debt-snow-result', snow);
  renderCard('debt-ava-result',  ava);

  // Ganador
  const winEl = $('debt-winner');
  if (winEl) {
    winEl.style.display = 'flex';
    const avaSaves = snow.totalIntereses - ava.totalIntereses;
    if (avaSaves > 5000) {
      winEl.className = 'alert success';
      winEl.innerHTML = `<span class="alert-icon">🏔️</span><div><strong>Avalancha ahorra ${fmt(avaSaves)} en intereses.</strong> Aunque las primeras victorias tardan más, el beneficio matemático es real. Recomendado si tienes disciplina y el ahorro importa más que la motivación rápida.</div>`;
    } else if (snow.meses < ava.meses) {
      winEl.className = 'alert info';
      winEl.innerHTML = `<span class="alert-icon">❄️</span><div><strong>Bola de Nieve termina ${ava.meses - snow.meses} mes(es) antes.</strong> La diferencia en intereses es pequeña (${fmt(Math.abs(avaSaves))}). Ideal si necesitas victorias rápidas para mantener la motivación.</div>`;
    } else {
      winEl.className = 'alert success';
      winEl.innerHTML = `<span class="alert-icon">🏔️</span><div><strong>Avalancha es la opción óptima:</strong> termina en ${ava.meses} meses y paga ${fmt(Math.abs(avaSaves))} menos en intereses que Bola de Nieve.</div>`;
    }
  }

  // Gráfico de líneas
  const canvas = $('debt-chart');
  if (!canvas) return;
  if (_debtChart) { _debtChart.destroy(); _debtChart = null; }

  const MAX = 52;
  const n    = Math.max(snow.timeline.length, ava.timeline.length);
  const step = Math.max(1, Math.ceil(n / MAX));
  const labels = [], snowD = [], avaD = [];
  for (let i = 0; i < n; i += step) {
    labels.push('Mes ' + i);
    snowD.push(snow.timeline[Math.min(i, snow.timeline.length - 1)]);
    avaD.push(ava.timeline[Math.min(i, ava.timeline.length - 1)]);
  }

  const dark = document.body.classList.contains('dark');
  const gc = dark ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.06)';
  const tc = dark ? '#9ca3af' : '#6b7280';

  _debtChart = new Chart(canvas, {
    type : 'line',
    data : {
      labels,
      datasets: [
        { label:'❄️ Bola de Nieve', data:snowD, borderColor:'#3b82f6', backgroundColor:'rgba(59,130,246,.1)', fill:true, tension:.35, pointRadius:0, borderWidth:2 },
        { label:'🏔️ Avalancha',    data:avaD,  borderColor:'#1da077', backgroundColor:'rgba(29,160,119,.1)', fill:true, tension:.35, pointRadius:0, borderWidth:2 }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position:'top', labels:{ color:tc, boxWidth:14, font:{ size:12 } } },
        tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + fmt(ctx.parsed.y) } }
      },
      scales: {
        x: { grid:{ color:gc }, ticks:{ color:tc, maxTicksLimit:10 } },
        y: { grid:{ color:gc }, ticks:{ color:tc, callback: v => v >= 1e6 ? (v/1e6).toFixed(1)+'M' : Math.round(v/1000)+'K' } }
      }
    }
  });
}

function saveDebts() {
  try { localStorage.setItem(LS.debts, JSON.stringify({ rows:debtRows, nid:_debtId })); } catch(e) {}
}

function loadDebts() {
  try {
    const s = localStorage.getItem(LS.debts);
    if (s) {
      const d = JSON.parse(s);
      debtRows = d.rows || [];
      _debtId  = d.nid  || debtRows.length;
    } else {
      // Datos de ejemplo para primera vez
      debtRows = [
        { id:1, nombre:'CMR Falabella',      saldo:250000,  tasa:3.2, pagMin:10000 },
        { id:2, nombre:'Tarjeta Ripley',     saldo:800000,  tasa:2.5, pagMin:28000 },
        { id:3, nombre:'Préstamo personal',  saldo:1500000, tasa:1.5, pagMin:55000 }
      ];
      _debtId = 3;
      saveDebts();
    }
  } catch(e) { debtRows = []; }
  renderDebtTable();
}

/* ============================================================
   COMPARADOR DE OFERTAS DE CRÉDITO
   ============================================================ */
let ofertaRows = [];
let _ofertaId  = 0;

function addOfertaRow(banco, monto, tasa, plazo, com) {
  const id = ++_ofertaId;
  ofertaRows.push({ id,
    banco   : banco || 'Banco ' + id,
    monto   : monto || 5000000,
    tasa    : tasa  || 1.5,
    plazo   : plazo || 36,
    comision: com   || 0
  });
  renderOfertaForms();
  ofertaUpdate();
  saveOfertas();
}

function removeOfertaRow(id) {
  ofertaRows = ofertaRows.filter(o => o.id !== id);
  renderOfertaForms();
  ofertaUpdate();
  saveOfertas();
}

function updateOfertaField(id, field, value) {
  const row = ofertaRows.find(o => o.id === id);
  if (!row) return;
  row[field] = field === 'banco' ? value : (parseFloat(value) || 0);
  ofertaUpdate();
  saveOfertas();
}

function renderOfertaForms() {
  const c = $('oferta-list');
  if (!c) return;
  c.innerHTML = ofertaRows.map(o => `
    <div class="oferta-form-card">
      <div class="oferta-form-hdr">
        <span class="oferta-pill">Oferta ${o.id}</span>
        <button class="btn btn-sm" style="background:var(--red-500);color:#fff;border:none;padding:3px 10px;font-size:12px"
            onclick="removeOfertaRow(${o.id})">✕ Eliminar</button>
      </div>
      <div class="oferta-form-grid">
        <div class="f-group">
          <label class="f-label">Banco / Institución</label>
          <input class="f-input" value="${o.banco}" onchange="updateOfertaField(${o.id},'banco',this.value)">
        </div>
        <div class="f-group">
          <label class="f-label">Monto del crédito ($)</label>
          <input class="f-input" type="number" value="${o.monto}" min="0"
              onchange="updateOfertaField(${o.id},'monto',+this.value)">
        </div>
        <div class="f-group">
          <label class="f-label">Tasa de interés mensual (%)</label>
          <input class="f-input" type="number" value="${o.tasa}" min="0" max="30" step="0.1"
              onchange="updateOfertaField(${o.id},'tasa',+this.value)">
        </div>
        <div class="f-group">
          <label class="f-label">Plazo (meses)</label>
          <input class="f-input" type="number" value="${o.plazo}" min="1" max="360"
              onchange="updateOfertaField(${o.id},'plazo',+this.value)">
        </div>
        <div class="f-group">
          <label class="f-label">Comisiones / gastos ($) <span style="font-size:11px;font-weight:400;color:var(--muted)">opcional</span></label>
          <input class="f-input" type="number" value="${o.comision}" min="0"
              onchange="updateOfertaField(${o.id},'comision',+this.value)">
          <div class="f-hint">Gastos operacionales, seguros, etc. (monto total del período).</div>
        </div>
      </div>
    </div>
  `).join('');
}

function _calcOferta(o) {
  const r = o.tasa / 100, n = o.plazo, P = o.monto, C = o.comision || 0;
  if (!r || !n || !P) return null;
  const fn  = Math.pow(1 + r, n);
  const cuota      = P * r * fn / (fn - 1);
  const costoTotal = cuota * n + C;
  const intereses  = costoTotal - P;
  const tasaAnual  = (Math.pow(1 + r, 12) - 1) * 100;

  // CAE con comisión inicial descontada (Newton-Raphson)
  let cae = tasaAnual;
  if (C > 0 && P > C) {
    const pNet = P - C;
    let x = r;
    for (let i = 0; i < 60; i++) {
      const ann  = (1 - Math.pow(1 + x, -n)) / x;
      const f    = cuota * ann - pNet;
      const df   = cuota * (Math.pow(1 + x, -n - 1) * n / x - ann / x);
      const xNew = x - f / df;
      if (!isFinite(xNew) || Math.abs(xNew - x) < 1e-10) { x = xNew; break; }
      x = xNew;
    }
    if (isFinite(x) && x > 0) cae = (Math.pow(1 + x, 12) - 1) * 100;
  }
  return { cuota, costoTotal, intereses, cae, tasaAnual };
}

function ofertaUpdate() {
  const resultsEl = $('oferta-results');
  const emptyEl   = $('oferta-empty');
  const explEl    = $('oferta-explain');

  if (!ofertaRows.length) {
    if (emptyEl)   emptyEl.style.display = '';
    if (resultsEl) resultsEl.style.display = 'none';
    if (explEl)    explEl.style.display = 'none';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  const calcs = ofertaRows
    .map(o => ({ o, c: _calcOferta(o) }))
    .filter(x => x.c)
    .sort((a, b) => a.c.costoTotal - b.c.costoTotal);

  if (!calcs.length) return;

  if (resultsEl) resultsEl.style.display = '';

  const fmt = n => '$' + Math.round(n).toLocaleString('es-CL');
  const best  = calcs[0];
  const worst = calcs[calcs.length - 1];

  // Explicación del ganador
  if (explEl) {
    explEl.style.display = 'flex';
    explEl.className = 'alert success';
    let why = `<strong>${best.o.banco}</strong> es la mejor oferta con un costo total de ${fmt(best.c.costoTotal)} y CAE de ${best.c.cae.toFixed(2)}%.`;
    if (calcs.length > 1) why += ` Te ahorra <strong>${fmt(worst.c.costoTotal - best.c.costoTotal)}</strong> respecto a la más cara (${worst.o.banco}).`;
    const motivos = [];
    if (best.c.cae === Math.min(...calcs.map(x => x.c.cae))) motivos.push('menor CAE');
    if (!best.o.comision && calcs.some(x => x.o.comision > 0)) motivos.push('sin comisión inicial');
    if (motivos.length) why += ` Ventajas: ${motivos.join(', ')}.`;
    explEl.innerHTML = `<span class="alert-icon">🏆</span><div>${why}</div>`;
  }

  // Tabla comparativa
  const tbody = $('oferta-tbl-body');
  if (tbody) {
    const ranks = ['🥇','🥈','🥉'];
    tbody.innerHTML = calcs.map(({ o, c }, i) => {
      const best = i === 0;
      return `<tr style="${best ? 'background:rgba(29,160,119,.07)' : ''}">
        <td style="font-size:15px">${ranks[i] || (i+1+'.')}</td>
        <td style="text-align:left;font-weight:${best?700:400};color:${best?'var(--green-700)':'inherit'}">${o.banco}</td>
        <td>${fmt(o.monto)}</td>
        <td>${o.tasa.toFixed(2)}%</td>
        <td>${c.tasaAnual.toFixed(2)}%</td>
        <td>${o.plazo} m</td>
        <td style="font-weight:600">${fmt(c.cuota)}</td>
        <td style="color:var(--red-500)">${fmt(c.intereses)}</td>
        <td>${o.comision>0?fmt(o.comision):'—'}</td>
        <td style="font-weight:700;color:${best?'var(--green-700)':'var(--ink)'}">${fmt(c.costoTotal)}</td>
        <td style="color:var(--amber-500);font-weight:600">${c.cae.toFixed(2)}%</td>
      </tr>`;
    }).join('');
  }
}

function saveOfertas() {
  try { localStorage.setItem(LS.ofertas, JSON.stringify({ rows:ofertaRows, nid:_ofertaId })); } catch(e) {}
}

function loadOfertas() {
  try {
    const s = localStorage.getItem(LS.ofertas);
    if (s) {
      const d = JSON.parse(s);
      ofertaRows = d.rows || [];
      _ofertaId  = d.nid  || ofertaRows.length;
    }
  } catch(e) { ofertaRows = []; }
  renderOfertaForms();
}