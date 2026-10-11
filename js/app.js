/* ============================================================
   UTILIDADES GENERALES
   ============================================================ */
const $   = id => document.getElementById(id);
const fmt = v  => '$' + Math.round(v).toLocaleString('es-CL');
const pct = (v, t) => t > 0 ? Math.round(v / t * 100) : 0;
/** Monto con signo adelante: +$1.000, −$1.000 (fmt() daba "$-1.000"). */
const fmtSigno = v => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v));
/* Escapa texto que escribió el usuario antes de meterlo en HTML. Sin
   esto, una descripción con comillas (Salidas "con amigos") se cortaba
   en la comilla, y cualquier < se interpretaba como etiqueta. */
const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let donutChart = null, trendChart = null;

// ============================================================
// REQ 2 & 3: ESTADO GLOBAL DE MONEDA DEL SIMULADOR
// indUF e indUSD se populan cuando fetchIndicadores() responde.
// simMoneda controla qué prefijo y límites se usan en todo el simulador.
// ============================================================
let simMoneda = 'CLP';   // 'CLP' | 'UF' | 'USD'
let indUF     = 41141;   // valor por defecto hasta que responda la API (UF del 11/10/2026)
let indUSD    = 982;     // valor por defecto hasta que responda la API (dólar del 09/10/2026)
// PART 1 (Chile 2026): UTM se usa como base legal para el tope del bono APV Régimen A (6 UTM)
let indUTM    = 72151;   // valor por defecto: UTM de octubre de 2026

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
  ofertas: 'sf_ofertas',        // Comparador de ofertas
  ejemplo: 'sf_modo_ejemplo',   // El presupuesto cargado es el de ejemplo
  hist   : 'sf_historial',      // Foto mensual: ingreso, gasto, ahorro, deuda, score
  pres   : 'sf_presupuestos',   // Presupuesto por mes: { 'AAAA-MM': { ingreso, filas } }
  metas  : 'sf_metas',          // Metas de ahorro, incluido el fondo de emergencia
  debtsEj: 'sf_debts_ejemplo'   // Las deudas cargadas son las de ejemplo
};

/* Presupuesto por mes. Antes había una sola lista para todos los meses:
   cambiar el mes no cargaba nada, y para tener historial había que
   sobrescribir el mes anterior a mano. */
let presupuestos = {};
let mesCargado   = null;

/* Metas de ahorro: { id, nombre, objetivo, ahorrado, fecha:'AAAA-MM'|'', tipo:'emergencia'|'libre' } */
let metas = [];

/* Constantes que se usan durante la carga (al mostrar la primera página):
   tienen que estar declaradas antes, o el script se corta con un error
   de inicialización. */
const HAB_LS = { rev: 'sf_revisiones', cierres: 'sf_cierres' };
const RUTA_POR_INDICADOR = {
  ahorro     : ['presupuesto_tip', 'habitos'],
  carga      : ['deudas', 'tarjetas'],
  colchon    : ['emergencias', 'presupuesto_tip'],
  deudaCara  : ['tarjetas', 'deudas'],
  presupuesto: ['presupuesto_tip', 'habitos']
};
const _scriptsCargados = {};


/* ============================================================
   HISTORIAL MENSUAL
   Antes la app no tenía memoria: cada mes sobrescribía al anterior
   y el gráfico de "últimos 6 meses" mostraba el ahorro actual
   multiplicado por factores fijos, o sea una historia que nunca
   ocurrió. Acá se guarda una foto real por mes.
   ============================================================ */
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
               'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

let historial = {};   // { '2026-03': {ingreso, gasto, ahorro, deuda, score, ts} }

/** Clave del mes seleccionado en el Presupuesto, formato AAAA-MM. */
function claveMesActual() {
  const v = $('b-mes')?.value || '';
  return /^\d{4}-\d{2}$/.test(v) ? v : mesHoy();
}

/** Etiqueta corta para el gráfico: "Mar", "Abr"… */
function etiquetaMes(clave) {
  const m = parseInt(clave.split('-')[1], 10) - 1;
  return (MESES[m] || '').slice(0, 3);
}

/** Guarda la foto del mes cargado en Plan. Se llama desde saveAll(). */
function guardarSnapshot() {
  const clave = mesCargado || claveMesActual();
  // Un mes que todavía no ocurre no tiene historia: antes, mirar
  // noviembre en Plan guardaba un "score 800" de un mes inexistente.
  if (clave > mesHoy()) return;
  // Con el presupuesto vacío no hay nada que registrar: guardar ceros
  // ensuciaría la tendencia con meses que el usuario nunca usó.
  if (sinDatos(clave)) return;
  const s = calcularScore(clave);
  if (s.incompleto) return;
  historial[clave] = {
    ingreso: s.ing,
    gasto  : s.gasReal,
    ahorro : Math.max(s.ing - s.gasReal, 0),
    deuda  : s.deu,
    score  : s.score,
    ts     : Date.now()
  };
  try { localStorage.setItem(LS.hist, JSON.stringify(historial)); } catch(e) {}
}

/** Meses con datos, del más antiguo al más reciente. Junta las fotos
    guardadas con los meses que tienen movimientos (de esos se recalcula
    ingreso, gasto y ahorro, porque los movimientos mandan). */
function historialOrdenado() {
  const hoy = mesHoy();
  const meses = new Set(Object.keys(historial).filter(k => k <= hoy));
  movimientos.forEach(m => { const k = m.fecha.slice(0, 7); if (k <= hoy) meses.add(k); });
  return [...meses].sort().map(k => {
    const conMov = movsDelMes(k).length > 0;
    if (historial[k] && !conMov) return { clave: k, ...historial[k] };
    const ing = ingresoDelMes(k);
    const gas = filasDelMes(k).reduce((x, r) => x + (r.real || 0), 0);
    return { clave: k, ingreso: ing, gasto: gas, ahorro: Math.max(ing - gas, 0), score: historial[k]?.score ?? null };
  });
}

/** Borra todo el historial (lo usa limpiarEjemplo). */
function borrarHistorial() {
  historial = {};
  try { localStorage.removeItem(LS.hist); } catch(e) {}
}

// EDIT 4: badges ganados (se carga de localStorage)
let earnedBadges = [];

/** Guarda el estado completo del presupuesto en localStorage */
function saveAll() {
  try {
    presupuestos[mesCargado || claveMesActual()] = { ingreso: $('b-ingreso').value, filas: budgetRows };
    localStorage.setItem(LS.pres,   JSON.stringify(presupuestos));
    localStorage.setItem(LS.debt,   $('b-deuda').value);
    localStorage.setItem(LS.venc,   JSON.stringify(vencRows));
    localStorage.setItem(LS.badges, JSON.stringify(earnedBadges)); // EDIT 4
  } catch(e) { console.warn('localStorage no disponible:', e); }
  // Registrar la foto del mes. Va acá y no en dashUpdate porque saveAll
  // se dispara al cambiar un dato, no en cada repintado.
  guardarSnapshot();
}

/** Guarda los parámetros del simulador en localStorage */
function saveSim() {
  try {
    const d = {
      monto  : $('s-monto').value,
      plazo  : $('s-plazo').value,
      tasa   : $('s-tasa').value,
      costos : $('s-costos-ini').value,
      gastosOp: $('s-gastos-op').value,
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
    // Presupuesto por mes. Si solo existe la lista única de la versión
    // anterior, se migra al mes en curso.
    const savedPres = localStorage.getItem(LS.pres);
    if (savedPres) {
      presupuestos = JSON.parse(savedPres) || {};
    } else {
      const savedBudget = localStorage.getItem(LS.budget);
      const savedIncome = localStorage.getItem(LS.income);
      if (savedBudget || savedIncome) {
        presupuestos[mesHoy()] = { ingreso: savedIncome || '', filas: savedBudget ? JSON.parse(savedBudget) : [] };
      }
    }
    const savedMetas = localStorage.getItem(LS.metas);
    if (savedMetas) metas = JSON.parse(savedMetas) || [];

    // Si lo guardado venía del presupuesto de ejemplo, seguir avisándolo
    modoEjemplo = localStorage.getItem(LS.ejemplo) === '1';

    const savedHist = localStorage.getItem(LS.hist);
    if (savedHist) historial = JSON.parse(savedHist) || {};
    // Fotos de meses futuros que guardaba la versión anterior: no existieron
    Object.keys(historial).filter(k => k > mesHoy()).forEach(k => delete historial[k]);

    // Emblemas ganados. Antes nunca se leían: el siguiente saveAll()
    // guardaba el arreglo vacío y los logros desaparecían al recargar.
    const savedBadges = localStorage.getItem(LS.badges);
    if (savedBadges) earnedBadges = JSON.parse(savedBadges) || [];

    const savedDebt = localStorage.getItem(LS.debt);
    if (savedDebt) $('b-deuda').value = savedDebt;

    poblarSelectorMes();
    cargarMes(mesHoy());

    // Simulador
    const savedSim = localStorage.getItem(LS.sim);
    if (savedSim) {
      const d = JSON.parse(savedSim);
      $('s-monto').value   = d.monto;
      $('s-plazo').value   = d.plazo;
      $('s-tasa').value    = d.tasa;
      if (d.costos != null)   $('s-costos-ini').value = d.costos;
      if (d.gastosOp != null) $('s-gastos-op').value  = d.gastosOp;
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
    // El ejemplo de la versión anterior se reconoce por su contenido
    const firmaVenc = vencRows.map(v => `${v.nombre}|${v.monto}|${v.dia}`).join(',');
    if (firmaVenc === 'Cuenta de Luz|35000|10,Agua / Sanitario|18000|15,Internet|28000|5') vencRows = [];
  } catch(e) {}
}

/* ============================================================
   FEATURE 3: MODO OSCURO
   Añade/quita la clase 'dark' en <body> y guarda la preferencia
   ============================================================ */
function toggleDarkMode() {
  const isDark = document.body.classList.toggle('dark');
  pintarBotonTema(isDark);
  try { localStorage.setItem(LS.dark, isDark ? '1' : '0'); } catch(e) {}
  // Refrescar gráficos para adaptar colores
  dashUpdate();
}

function pintarBotonTema(isDark) {
  $('dark-icon').innerHTML = `<svg class="ico" aria-hidden="true"><use href="#i-${isDark ? 'sun' : 'moon'}"></use></svg>`;
  $('dark-btn').setAttribute('aria-label', isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
}

/** Aplica el modo guardado al cargar la página */
function applyDarkMode() {
  try {
    const saved = localStorage.getItem(LS.dark);
    if (saved === '1') {
      document.body.classList.add('dark');
      pintarBotonTema(true);
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
/* Cada página tiene su dirección (#/plan, #/herramientas/creditos…), así
   que funcionan el botón atrás, recargar sin volver al inicio, los
   enlaces directos y los atajos del manifest. Antes navigate() solo
   cambiaba clases: recargar siempre llevaba al Panel y el botón atrás
   del celular cerraba la app. */
const RUTAS = {
  dashboard    : 'inicio',
  movimientos  : 'movimientos',
  presupuesto  : 'plan',
  educativa    : 'aprender',
  herramientas : 'herramientas',
  simulador    : 'herramientas/creditos',
  autos        : 'herramientas/autos',
  sueldo       : 'herramientas/sueldo',
  emprendedores: 'herramientas/emprender',
  inversiones  : 'herramientas/inversiones',
  escenarios   : 'herramientas/escenarios',
  ajustes      : 'ajustes',
  metodologia  : 'acerca/metodologia',
  about        : 'acerca'
};
const TITULOS = {
  dashboard: 'Inicio', movimientos: 'Movimientos', presupuesto: 'Plan', educativa: 'Aprender',
  herramientas: 'Herramientas', simulador: 'Créditos', autos: 'Comprar auto',
  sueldo: 'Mi sueldo', emprendedores: 'Emprender', inversiones: 'Inversiones',
  escenarios: '¿Qué pasa si…?', ajustes: 'Ajustes y datos', metodologia: 'Metodología', about: 'Acerca del proyecto'
};
const TITULO_BASE = document.title;

/** Página que corresponde a la dirección actual. Acepta las viejas (#presupuesto). */
function paginaDesdeHash() {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  if (!h) return 'dashboard';
  const nueva = Object.keys(RUTAS).find(k => RUTAS[k] === h);
  if (nueva) return nueva;
  return RUTAS[h] ? h : 'dashboard';
}

/** Lleva a una página. El segundo argumento se ignora: lo dejan llamadas viejas. */
function navigate(page) {
  const ruta = '#/' + (RUTAS[page] || 'inicio');
  if (location.hash !== ruta) location.hash = ruta;   // el hashchange la muestra
  else mostrarPagina(page);
}

function mostrarPagina(page) {
  if (!RUTAS[page] || !$('page-' + page)) page = 'dashboard';
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + page));

  // Marca el destino activo en la barra lateral y en la inferior
  const seccion = RUTAS[page].split('/')[0];
  document.querySelectorAll('[data-seccion]').forEach(el => {
    if (el.dataset.seccion === seccion) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
  // En móvil, Aprender, Herramientas, Ajustes y Acerca viven en "Más"
  $('tab-mas')?.classList.toggle('activo', ['aprender', 'herramientas', 'ajustes', 'acerca'].includes(seccion));
  $('topbar-titulo').textContent = TITULOS[page];
  document.title = page === 'dashboard' ? TITULO_BASE : `${TITULOS[page]} · Salud Financiera`;

  if (page === 'dashboard')      { dashUpdate(); renderHabito(); }
  if (page === 'simulador')      { simUpdate(); debtUpdate(); ofertaUpdate(); }
  if (page === 'presupuesto')    { renderBudgetTable(); budgetCalc(); renderVenc(); renderMetas(); }
  if (page === 'movimientos')    { renderMovimientos(); }
  if (page === 'inversiones')    invUpdate();
  if (page === 'autos')          autosUpdate();
  if (page === 'emprendedores')  { siiCalc(); ivaCalc(); }
  if (page === 'sueldo')         { sueldoCalc(); }
  if (page === 'escenarios')     { escenarioCalc(); estresCalc(); }
  if (page === 'about')          { runAboutCountUp(); }
  if (page === 'educativa')      { renderRuta(); renderLogros(); }
  if (page === 'ajustes')        { renderAjustes(); }
  if (page === 'metodologia')    { renderMetodologia(); }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', () => {
  const h = location.hash.replace(/^#/, '');
  if (h && !h.startsWith('/') && !RUTAS[h]) return;   // ancla interna, como #contenido
  mostrarPagina(paginaDesdeHash());
});

/** Primera carga: respeta la dirección y traduce las viejas a las nuevas. */
function iniciarRutas() {
  const page = paginaDesdeHash();
  const ruta = '#/' + RUTAS[page];
  if (location.hash && location.hash !== ruta) history.replaceState(null, '', ruta);
  mostrarPagina(page);
}

/* Hoja "Más" (solo móvil) */
function toggleMobileMenu() {
  const open = $('mobile-drawer').classList.toggle('open');
  $('mobile-drawer').inert = !open;
  $('drawer-overlay').classList.toggle('open', open);
  $('tab-mas')?.setAttribute('aria-expanded', String(open));
  if (open) {
    $('mobile-drawer').querySelector('a, button')?.focus();
    document.addEventListener('keydown', _escCierraMenu);
  } else {
    document.removeEventListener('keydown', _escCierraMenu);
  }
}
function closeMobileMenu() {
  if (!$('mobile-drawer').classList.contains('open')) return;
  $('mobile-drawer').classList.remove('open');
  $('mobile-drawer').inert = true;
  $('drawer-overlay').classList.remove('open');
  $('tab-mas')?.setAttribute('aria-expanded', 'false');
  document.removeEventListener('keydown', _escCierraMenu);
  $('tab-mas')?.focus();
}
function _escCierraMenu(e) { if (e.key === 'Escape') closeMobileMenu(); }

/* ============================================================
   FEATURE 1: DASHBOARD — SINGLE SOURCE OF TRUTH
   Lee de budgetRows (gastos reales), b-ingreso y b-deuda.
   No tiene inputs propios.
   ============================================================ */
/* ============================================================
   SCORE FINANCIERO — fuente única
   ============================================================
   Antes esta regla estaba escrita dos veces: una en dashUpdate() para
   la pantalla y otra dentro de exportPDF() para la ficha en PDF. Daban
   el mismo número, pero los colores ya se habían separado, y cualquier
   ajuste de umbral en un lado dejaba al otro diciendo algo distinto en
   silencio. El PDF es el documento que queda impreso, así que esa
   divergencia era la más cara.

   Reglas:
     Ahorro ≥ 20% de ingresos   → +350
     Ahorro 10–20%              → +175
     Gastos > 80% de ingresos   → −300
     Gastos 65–80%              → −150
     Cuota de deuda > 30%       → −250
     Cuota de deuda 15–30%      → −100
     Base                       →  600
   Los emblemas de los quizzes NO suman: el score mide finanzas, no
   cuántos quizzes aprobaste. Antes daban +50 cada uno, y con seis
   quizzes alguien con deuda alta llegaba a "Perfil Excelente".
   ============================================================ */
const SCORE_NIVELES = [
  // 'impreso' es más oscuro a propósito: el PDF va sobre papel blanco
  { min: 800, label: 'Perfil Excelente',  pantalla: '#1da077', impreso: '#1da077' },
  { min: 650, label: 'Buen Perfil',       pantalla: '#3b82f6', impreso: '#1d4ed8' },
  { min: 450, label: 'Perfil Moderado',   pantalla: '#f59e0b', impreso: '#d97706' },
  { min:   0, label: 'Requiere Atención', pantalla: '#ef4444', impreso: '#dc2626' },
];

/* ============================================================
   SCORE 2.0 — cinco indicadores con peso publicado (suman 1000)
     Tasa de ahorro        250  meta: 20% o más del ingreso
     Carga financiera      250  cuotas / ingreso: 15% o menos
     Fondo de emergencia   200  meta: 3 meses de gastos
     Deuda cara            150  ninguna deuda sobre 30% anual
     Presupuesto cumplido  150  categorías dentro de lo planeado
   Antes eran tres reglas con saltos fijos y la cuota se suponía igual
   a deuda ÷ 12: con deuda de 1,4 veces el ingreso daba "Excelente".
   ============================================================ */
const SCORE_PESOS = { ahorro: 250, carga: 250, colchon: 200, deudaCara: 150, presupuesto: 150 };

/** ¿Las deudas del simulador son las de ejemplo? Entonces no son del usuario. */
function deudasSonEjemplo() {
  try { if (localStorage.getItem(LS.debtsEj) === '1') return true; } catch (e) {}
  // Guardadas antes de que existiera la marca: se reconocen por su contenido
  let filas = [];
  try { filas = debtRows; } catch (e) {}
  const firma = filas.map(d => `${d.nombre}|${d.saldo}`).join(',');
  return firma === 'CMR Falabella|250000,Tarjeta Ripley|800000,Préstamo personal|1500000';
}

/** Deudas que entran al score: las registradas en Créditos o el total escrito en Plan. */
function datosDeudas(clave = claveMesActual()) {
  let filas = [];
  try { filas = debtRows; } catch (e) { filas = []; }   // aún no declarada al iniciar
  if (filas.length && !deudasSonEjemplo()) {
    return {
      total : filas.reduce((s, d) => s + (+d.saldo || 0), 0),
      cuotas: filas.reduce((s, d) => s + (+d.pagMin || 0), 0),
      cara  : filas.some(d => (+d.tasa || 0) > 2.21),   // 2,21% mensual ≈ 30% anual
      cuotasEstimadas: false
    };
  }
  const total = parseFloat($('b-deuda').value) || 0;
  const cuotasMov = gastoMesPorCat(clave)[9] || 0;
  return {
    total,
    cuotas: cuotasMov > 0 ? cuotasMov : total / 12,
    cara  : total > 0 ? null : false,
    cuotasEstimadas: cuotasMov <= 0 && total > 0
  };
}

/** Lo ahorrado en todas las metas. */
function ahorrosTotales() {
  return metas.reduce((s, m) => s + (+m.ahorrado || 0), 0);
}

/** Mes anterior a uno dado, "AAAA-MM". */
function mesAnterior(clave) {
  let [y, m] = clave.split('-').map(Number);
  m--; if (m < 1) { m = 12; y--; }
  return `${y}-${pad2(m)}`;
}

/** Gasto real de un mes: lo anotado en Movimientos o lo escrito en Plan. */
function gastoDeMes(clave) {
  return filasDelMes(clave).reduce((x, r) => x + (r.real || 0), 0);
}

/** Score de un mes (por defecto, el que se ve en Plan).
    En el mes en curso lo anotado es parcial: el día 2 casi no hay gastos y
    todo salía perfecto. Por eso, para el ahorro y el fondo de emergencia
    se usa lo que sea mayor entre lo anotado, tu plan del mes y lo que
    gastaste el mes anterior. Si no hay ninguno de los tres, no se puntúa. */
function calcularScore(clave = claveMesActual()) {
  const filas = filasDelMes(clave);
  const d = datosDeudas(clave);
  const ing = ingresoDelMes(clave);
  const gasReal = filas.reduce((x, r) => x + (r.real || 0), 0);
  const planTotal = filas.reduce((x, r) => x + (r.presup || 0), 0);
  let gas = gasReal, gastoFuente = 'real';
  if (clave === mesHoy()) {
    const previo = gastoDeMes(mesAnterior(clave));
    const base = Math.max(planTotal, previo);
    if (base > gasReal) { gas = base; gastoFuente = planTotal >= previo ? 'plan' : 'mesAnterior'; }
  }
  const conPlan = filas.filter(r => r.presup > 0);
  const s = calcularScoreDe(ing, gas, d.total, {
    cuotas: d.cuotas,
    cuotasEstimadas: d.cuotasEstimadas,
    deudaCara: d.cara,
    fondo: metas.filter(m => m.tipo === 'emergencia').reduce((x, m) => x + (+m.ahorrado || 0), 0),
    planTotal: conPlan.length,
    planCumplido: conPlan.filter(r => r.real <= r.presup).length,
    enCurso: clave === mesHoy(),
    gastoFuente
  });
  s.gasReal = gasReal;
  s.mes = clave;
  // Con ingreso pero sin ningún gasto, plan ni mes anterior no hay
  // diagnóstico posible: antes eso daba "650 Buen Perfil".
  s.incompleto = ing > 0 && gas <= 0;
  return s;
}

/** ¿Tiene sentido sugerir invertir? Solo con fondo de emergencia
    completo, cuotas sanas y sin deuda cara. Todos los mensajes del panel
    usan esta misma regla, para que no se contradigan. */
function puedeInvertir(s) {
  const pleno = id => { const i = s.indicadores.find(x => x.id === id); return i && i.pts >= i.max; };
  return !s.incompleto && pleno('colchon') && pleno('carga') && pleno('deudaCara');
}

/** Score para cualquier combinación de datos. No lee la página ni guarda
    nada: el Modo Escenarios la usa para simular. */
function calcularScoreDe(ing, gas, deu, x = {}) {
  const P = SCORE_PESOS;
  const cuotas = x.cuotas ?? deu / 12;
  const aho = Math.max(ing - gas, 0);
  const ahorroPct = ing > 0 ? ((ing - gas) / ing) * 100 : 0;
  const gastoPct  = ing > 0 ? (gas / ing) * 100 : 100;
  const deudaPct  = ing > 0 ? (cuotas / ing) * 100 : 0;
  const lim = v => Math.max(0, Math.min(1, v));

  const ptAhorro = P.ahorro * lim(ahorroPct / 20);
  const ptCarga  = ing <= 0 ? 0 : deudaPct <= 15 ? P.carga : P.carga * lim((40 - deudaPct) / 25);
  const fondo    = x.fondo || 0;
  const meses    = gas > 0 ? fondo / gas : null;
  const ptColchon = meses === null ? 0 : P.colchon * lim(meses / 3);
  const cara     = deu <= 0 ? false : (x.deudaCara ?? null);
  const ptCara   = cara === false ? P.deudaCara : cara === true ? 0 : P.deudaCara / 2;
  const plan     = x.planTotal || 0;
  const ptPres   = plan ? P.presupuesto * (x.planCumplido / plan) : 0;

  const n1 = v => v.toLocaleString('es-CL', { maximumFractionDigits: 1 });
  const indicadores = [
    { id: 'ahorro', nombre: 'Tasa de ahorro', valor: `${Math.round(ahorroPct)}%`, pts: ptAhorro, max: P.ahorro,
      porque: 'Lo que te queda del ingreso después de tus gastos. La meta es 20% o más.',
      subir: ahorroPct >= 20 ? 'Mantén tu ahorro sobre el 20% del ingreso.'
        : `Gasta ${fmt(gas - ing * 0.8)} menos al mes para ahorrar el 20% de tu ingreso.` },
    { id: 'carga', nombre: 'Carga financiera', valor: `${Math.round(deudaPct)}%`, pts: ptCarga, max: P.carga,
      porque: 'Parte del ingreso que se va en cuotas de deuda. Sobre 25% es riesgoso y sobre 40%, grave.' +
        (x.cuotasEstimadas ? ' Está estimada como deuda total ÷ 12: registra tus deudas en Créditos para calcularla con tus cuotas reales.' : ''),
      subir: deudaPct <= 15 ? 'Tus cuotas están en un nivel sano: evita sumar créditos nuevos.'
        : 'Baja tus cuotas: prioriza pagar la deuda más cara o renegocia el plazo.' },
    { id: 'colchon', nombre: 'Fondo de emergencia', valor: meses === null ? '—' : `${n1(meses)} meses`, pts: ptColchon, max: P.colchon,
      porque: 'Cuántos meses de gastos cubre lo que tienes en tu meta de fondo de emergencia. La meta mínima es 3.',
      subir: !fondo ? 'Crea tu fondo de emergencia en Plan → Metas y aporta algo cada mes.'
        : meses !== null && meses < 3 ? `Aporta ${fmt(gas * 3 - fondo)} más a tu fondo para cubrir 3 meses.`
        : 'Tu fondo cubre 3 meses o más: mantenlo y no lo uses para gastos planificados.' },
    { id: 'deudaCara', nombre: 'Deuda cara', valor: cara === true ? 'Sí' : cara === false ? 'No' : 'Sin datos', pts: ptCara, max: P.deudaCara,
      porque: 'Deudas con tasa sobre 30% anual (más de 2,2% mensual), como tarjetas de casas comerciales y avances.',
      subir: cara === true ? 'Paga primero la deuda de tasa más alta: compara bola de nieve y avalancha en Créditos.'
        : cara === null ? 'Registra tus deudas con su tasa en Créditos para saber si alguna es cara.'
        : 'No tienes deudas caras: evita los avances en efectivo y el pago mínimo de la tarjeta.' },
    { id: 'presupuesto', nombre: 'Presupuesto cumplido', valor: plan ? `${x.planCumplido} de ${plan}${x.enCurso ? ' a la fecha' : ''}` : 'Sin plan', pts: ptPres, max: P.presupuesto,
      porque: 'Categorías en que gastaste lo planeado o menos' + (x.enCurso ? ', hasta hoy.' : '.'),
      subir: !plan ? 'Define en Plan cuánto quieres gastar en cada categoría.'
        : x.planCumplido < plan ? 'Revisa las categorías en rojo de tu Plan y ajusta el gasto o el monto planeado.'
        : 'Cumpliste tu plan en todas las categorías.' }
  ];
  indicadores.forEach(i => { i.pts = Math.round(i.pts); });
  const score = Math.max(0, Math.min(1000, indicadores.reduce((s, i) => s + i.pts, 0)));
  const nivel = SCORE_NIVELES.find(n => score >= n.min);
  // La próxima acción es la del indicador con más puntos por ganar
  const proxima = [...indicadores].sort((p, q) => (q.max - q.pts) - (p.max - p.pts))[0];

  return {
    ing, gas, deu, aho, cuotas,
    ahorroPct, gastoPct, deudaPct,
    indicadores, proxima: proxima.max - proxima.pts > 0 ? proxima : null,
    entradas: x,
    score,
    label       : nivel.label,
    color       : nivel.pantalla,
    colorImpreso: nivel.impreso
  };
}

/** Los cinco indicadores del score, con su porqué y cómo subir. */
function renderIndicadores(s, sinNada, incompleto) {
  const cont = $('indicadores');
  if (!cont) return;
  if (sinNada || incompleto) {
    cont.innerHTML = sinNada
      ? '<p class="ind-vacio">Tu score se calcula con cinco indicadores: tasa de ahorro, carga financiera, fondo de emergencia, deuda cara y presupuesto cumplido. Aparecen apenas anotes tu sueldo y tus gastos en <a href="#/movimientos">Movimientos</a> o en tu <a href="#/plan">Plan</a>.</p>'
      : '<p class="ind-vacio">Ya tenemos tu ingreso. Falta saber cuánto gastas: anota tus gastos en <a href="#/movimientos">Movimientos</a> o define cuánto planeas gastar en tu <a href="#/plan">Plan</a>. Sin eso, cualquier puntaje sería engañoso.</p>';
    $('proxima-accion').innerHTML = '';
    return;
  }
  const nota = s.entradas.gastoFuente && s.entradas.gastoFuente !== 'real'
    ? `<p class="ind-nota">El mes va en curso. Para que el puntaje no suba por anotar menos, la tasa de ahorro y el fondo se calculan con ${s.entradas.gastoFuente === 'plan' ? 'tu plan del mes' : 'lo que gastaste el mes anterior'} (${fmt(s.gas)}), que es más que lo anotado hasta hoy (${fmt(s.gasReal)}).</p>`
    : '';
  cont.innerHTML = s.indicadores.map(i => {
    const r = i.pts / i.max;
    const tono = r >= 0.8 ? 'ok' : r >= 0.4 ? 'medio' : 'bajo';
    return `<div class="ind-fila">
      <div class="ind-top"><span class="ind-nombre">${i.nombre}</span><span class="ind-valor">${i.valor}</span><span class="ind-pts">${i.pts}/${i.max}</span></div>
      <div class="ind-barra" role="img" aria-label="${i.pts} de ${i.max} puntos"><div class="ind-fill ${tono}" style="width:${Math.round(r * 100)}%"></div></div>
      <div class="ind-porque">${i.porque}</div>
    </div>`;
  }).join('') + nota;
  $('proxima-accion').innerHTML = s.proxima
    ? `<div class="proxima"><span class="proxima-lbl">Tu próxima acción</span><span>${s.proxima.subir}</span><span class="proxima-gana">hasta +${s.proxima.max - s.proxima.pts} puntos</span></div>`
    : '';
}

/** "Disponible para gastar": lo que queda del ingreso del mes en curso. */
function renderDisponible(s, sinNada, clave) {
  const cont = $('disponible-card');
  if (!cont) return;
  if (sinNada) { cont.style.display = 'none'; return; }
  cont.style.display = '';
  const disp = s.ing - s.gasReal;
  const quedan = diasDelMes(clave) - new Date().getDate() + 1;
  const pctUsado = s.ing > 0 ? Math.min(100, Math.round(s.gasReal / s.ing * 100)) : 100;
  cont.innerHTML = `
    <div class="disp-top">
      <div>
        <h2 class="disp-tit">Disponible para gastar en ${MESES[+clave.slice(5) - 1].toLowerCase()}</h2>
        <div class="disp-monto ${disp < 0 ? 'neg' : ''}">${disp < 0 ? '−' : ''}${fmt(Math.abs(disp))}</div>
        <div class="disp-sub">${disp < 0 ? 'Llevas gastado más de lo que ingresó este mes.'
          : !(s.ing > 0) ? 'Anota tu sueldo para saber cuánto te queda.'
          : `Quedan ${quedan} ${quedan === 1 ? 'día' : 'días'}: unos <strong>${fmt(disp / quedan)} al día</strong>.`}</div>
      </div>
      <a class="btn btn-primary btn-sm" href="#/movimientos" onclick="setTimeout(()=>abrirMovSheet(),50)">+ Anotar gasto</a>
    </div>
    <div class="disp-barra" role="img" aria-label="Usaste el ${pctUsado}% de tu ingreso"><div style="width:${pctUsado}%"></div></div>
    <div class="disp-leyenda"><span>Ingreso ${fmt(s.ing)}</span><span>Gastado ${fmt(s.gasReal)}</span>${usaMovimientos(clave) ? '' : '<span>Gasto escrito a mano en Plan</span>'}</div>`;
}

function dashUpdate() {
  // El panel muestra siempre el mes en curso, aunque en Plan se esté
  // mirando otro mes. Antes el selector de Plan cambiaba todo el Inicio.
  const MES = mesHoy();
  const s = calcularScore(MES);
  const { ing, deu, score } = s;
  const gasReal = s.gasReal;
  const aho = Math.max(ing - gasReal, 0);
  const scoreLabel = s.label, scoreColor = s.color;

  // Tarjetas del panel (solo lectura): lo anotado de verdad
  $('d-ingreso').textContent = fmt(ing);
  $('d-gasto').textContent   = fmt(gasReal);
  $('d-deuda').textContent   = fmt(deu);
  $('d-ahorro').textContent  = fmt(aho);

  // Sin datos, o con ingreso pero sin ningún gasto, no hay diagnóstico:
  // ni puntaje, ni felicitaciones, ni alertas.
  const sinNada = sinDatos(MES);
  const vacio = sinNada || s.incompleto;
  renderIndicadores(s, sinNada, s.incompleto);
  renderDisponible(s, sinNada, MES);

  // Velocímetro
  $('gauge-score').style.color = '#fff';
  if (vacio) {
    if (_gaugeAnim) { cancelAnimationFrame(_gaugeAnim); _gaugeAnim = null; }
    drawGauge(0, '#7a9490');
    $('gauge-score').textContent = '—';
    $('gauge-label').textContent = sinNada ? 'Sin datos aún' : 'Faltan tus gastos';
  } else {
    animateGaugeScore(score, scoreColor);
    $('gauge-label').textContent = scoreLabel;
  }
  $('gauge-label').className   = 'gauge-label';
  $('gauge-label').style.cssText = 'background:rgba(255,255,255,.15);color:#fff;';

  // Todas las recomendaciones salen de los mismos indicadores del score:
  // solo se sugiere invertir si puedeInvertir(). Antes cada mensaje tenía
  // su propia regla y el panel felicitaba e invitaba a invertir a alguien
  // con el fondo de emergencia en cero.
  const listo = puedeInvertir(s);
  const siguiente = s.proxima ? s.proxima.subir : '';
  const ahorroMes = Math.max(ing - s.gas, 0);

  // Resumen ejecutivo anualizado
  let execText;
  if (sinNada) {
    execText = `Cuando anotes tu sueldo y tus gastos en <a href="#/movimientos">Movimientos</a> o en tu <a href="#/plan">Plan</a>, aquí verás cuánto ahorrarías en un año y qué conviene hacer con ese dinero.`;
  } else if (s.incompleto) {
    execText = `Ya tenemos tu ingreso. Anota tus gastos o define tu plan del mes para calcular cuánto ahorrarías en un año.`;
  } else if (ing - s.gas <= 0) {
    execText = `⚠️ Con lo que gastas, este mes no queda ahorro. Si se repite, terminarás el año con un <strong>déficit acumulado</strong>. Prioridad: reducir gastos o aumentar ingresos.`;
  } else {
    execText = `Si el mes termina como va, ahorrarías <strong style="color:var(--green-600)">${fmt(ahorroMes * 12)}</strong> en un año. ` +
      (listo ? 'Tienes fondo de emergencia, cuotas sanas y ninguna deuda cara: puedes evaluar un <strong>Depósito a Plazo</strong>, un <strong>Fondo Mutuo</strong> o un <strong>APV</strong>.'
             : `Antes de invertir: ${siguiente}`);
  }
  const execEl = $('exec-summary-text');
  if (execEl) execEl.innerHTML = execText;

  // Alerta bajo el velocímetro
  const insightScore = $('score-insight');
  insightScore.style.display = 'flex';
  if (sinNada) {
    insightScore.className = 'alert';
    insightScore.innerHTML = `<span class="alert-icon">👋</span><div><strong>Todavía no hay datos.</strong> Anota tu sueldo y tus gastos en <a href="#/movimientos" style="color:inherit;text-decoration:underline">Movimientos</a>, o escríbelos en tu <a href="#/plan" style="color:inherit;text-decoration:underline">Plan</a>. Tu score aparece apenas sepamos cuánto ganas y cuánto gastas.</div>`;
  } else if (s.incompleto) {
    insightScore.className = 'alert info';
    insightScore.innerHTML = `<span class="alert-icon">ℹ️</span><div><strong>Falta saber cuánto gastas.</strong> Anota tus gastos en <a href="#/movimientos" style="color:inherit;text-decoration:underline">Movimientos</a> o define cuánto planeas gastar en tu <a href="#/plan" style="color:inherit;text-decoration:underline">Plan</a>.</div>`;
  } else if (score < 450) {
    insightScore.className = 'alert danger';
    insightScore.innerHTML = `<span class="alert-icon">🚨</span><div><strong>Tu perfil requiere atención.</strong> Lo primero: ${siguiente}</div>`;
  } else if (!listo) {
    insightScore.className = 'alert warning';
    insightScore.innerHTML = `<span class="alert-icon">💡</span><div><strong>Vas por buen camino.</strong> Lo que más sube tu score ahora: ${siguiente}</div>`;
  } else {
    insightScore.className = 'alert success';
    insightScore.innerHTML = `<span class="alert-icon">🏆</span><div><strong>¡Felicidades!</strong> Tienes fondo de emergencia, cuotas sanas y ninguna deuda cara. Es buen momento para hacer crecer tu ahorro: revisa <a href="#/herramientas/inversiones" style="color:inherit;text-decoration:underline">Inversiones y APV</a>.</div>`;
  }

  const th = chartTheme();

  // Dona: reparte el ingreso sin contar dos veces las cuotas. Si las
  // cuotas ya están anotadas como gasto (categoría Deudas), se separan
  // de los gastos; lo que sobra es lo disponible.
  const cuotasAnotadas = filasDelMes(MES).filter(r => r.cat === 9).reduce((x, r) => x + (r.real || 0), 0);
  const gastosSinCuotas = Math.max(gasReal - cuotasAnotadas, 0);
  const cuotasDona = Math.max(s.cuotas, cuotasAnotadas);
  const donutData = [gastosSinCuotas, cuotasDona, Math.max(ing - gastosSinCuotas - cuotasDona, 0)];
  const donutCols = ['#c4320a', '#b45309', '#12805c'];
  const donutLbls = ['Gastos', s.entradas.cuotasEstimadas ? 'Cuotas (estimadas)' : 'Cuotas de deudas', 'Disponible'];
  const ctx = $('donut-chart').getContext('2d');
  if (donutChart) donutChart.destroy();
  donutChart = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: donutLbls, datasets: [{ data: donutData, backgroundColor: donutCols, borderWidth: 3, borderColor: document.body.classList.contains('dark') ? '#121b18' : '#fff', hoverBorderWidth: 3 }] },
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
  filasDelMes(MES).forEach(r => { catMap[r.cat] = (catMap[r.cat] || 0) + r.real; });
  let barsHtml = '';
  Object.keys(catMap).forEach(ci => {
    const val = catMap[ci] || 0;
    const p   = ing > 0 ? Math.min(pct(val, ing), 100) : 0;
    barsHtml += `<div class="bar-row">
      <span class="bar-cat" style="width:110px;font-size:12px">${catConfig[ci]?.label || 'Otro'}</span>
      <div class="bar-track2"><div class="bar-fill2" style="width:${p}%;background:${catConfig[ci]?.color || '#6b7280'}"></div></div>
      <span class="bar-amount" style="width:75px;font-size:11.5px">${fmt(val)}</span>
    </div>`;
  });
  $('dash-bars').innerHTML = barsHtml || '<div style="font-size:13px;color:var(--muted)">Anota gastos en Movimientos o en tu Plan para ver en qué se va tu plata.</div>';

  // Regla 50/30/20 por grupo de categoría
  const porGrupo = { necesidad: 0, deseo: 0, deuda: 0 };
  filasDelMes(MES).forEach(r => { porGrupo[catConfig[r.cat]?.grupo || 'deseo'] += r.real || 0; });
  const pN = pct(porGrupo.necesidad, ing), pD = pct(porGrupo.deseo, ing);
  const pA = Math.max(0, 100 - pN - pD);
  $('dash-rule').innerHTML = vacio
    ? `<div style="margin-bottom:4px"><strong>Regla 50/30/20:</strong></div>
       <div>50% para necesidades, 30% para deseos y al menos 20% para ahorro o deudas. La comparamos con tus gastos apenas los anotes.</div>`
    : `<div style="margin-bottom:4px"><strong>Regla 50/30/20${s.entradas.enCurso ? ' (lo anotado hasta hoy)' : ''}:</strong></div>
    <div class="regla-503020">
      <span class="${pN > 50 ? 'pasa' : ''}">Necesidades <strong>${pN}%</strong> <small>meta ≤ 50%</small></span>
      <span class="${pD > 30 ? 'pasa' : ''}">Deseos <strong>${pD}%</strong> <small>meta ≤ 30%</small></span>
      <span class="${pA < 20 ? 'pasa' : ''}">Ahorro y deudas <strong>${pA}%</strong> <small>meta ≥ 20%</small></span>
    </div>
    <div>${pA >= 20 && pN <= 50 && pD <= 30 ? '✅ Dentro de la regla.' : pA < 20 ? `⚠️ Te queda menos del 20% para ahorrar o pagar deudas.${pD > 30 ? ' Lo primero a revisar son los deseos.' : ''}` : pD > 30 ? '⚠️ Los deseos pasan del 30%.' : '⚠️ Las necesidades pasan del 50%: revisa vivienda y servicios.'}</div>`;

  // Tendencia: los últimos 6 meses con datos reales (fotos guardadas y
  // meses con movimientos). Nunca meses futuros.
  const hist     = historialOrdenado().slice(-6);
  const months   = hist.map(h => etiquetaMes(h.clave));
  const saveData = hist.map(h => h.ahorro);
  const avisoTend = $('trend-empty');
  if (avisoTend) avisoTend.style.display = hist.length < 2 ? 'flex' : 'none';
  const cajaTend = $('trend-box');
  if (cajaTend) cajaTend.style.display = hist.length < 2 ? 'none' : '';
  if (hist.length < 2) { if (trendChart) { trendChart.destroy(); trendChart = null; } }

  // Comparación con el mes anterior
  const cmp = $('comparativa-mes');
  if (cmp) {
    const previo = historialOrdenado().filter(h => h.clave < MES).slice(-1)[0];
    if (!previo || vacio) {
      cmp.style.display = 'none';
    } else {
      const dAho = aho - previo.ahorro;
      const flecha = v => v > 0 ? '▲' : v < 0 ? '▼' : '=';
      const color  = v => v > 0 ? 'var(--green-600)' : v < 0 ? 'var(--red-500)' : 'var(--muted)';
      const dSco = previo.score === null || previo.score === undefined ? null : score - previo.score;
      cmp.style.display = 'flex';
      cmp.innerHTML =
        `<span class="cmp-lbl">vs ${MESES[parseInt(previo.clave.split('-')[1],10)-1]}</span>
         <span class="cmp-item" style="color:${color(dAho)}">${flecha(dAho)} ${fmt(Math.abs(dAho))} de ahorro${s.entradas.enCurso ? ' (mes en curso)' : ''}</span>` +
        (dSco === null ? '' : `<span class="cmp-item" style="color:${color(dSco)}">${flecha(dSco)} ${Math.abs(dSco)} pts de score</span>`);
    }
  }

  const tCtx = $('trend-chart').getContext('2d');
  if (trendChart) trendChart.destroy();
  trendChart = hist.length < 2 ? null : new Chart(tCtx, {
    type: 'line',
    data: { labels: months, datasets: [{ label: 'Ahorro del mes', data: saveData, borderColor: '#12805c', backgroundColor: 'rgba(18,128,92,.08)', fill: true, tension: 0.4, pointBackgroundColor: '#12805c', pointRadius: 4, borderWidth: 2.5 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: i => ' ' + fmt(i.raw) } } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { family: th.font }, color: th.tick } },
        y: { grid: { color: th.grid }, ticks: { callback: v => '$' + (v/1000) + 'k', color: th.tick, font: { family: th.font } } }
      }
    }
  });

  // Alertas automáticas, con la misma regla de inversión
  const alertsEl = $('dash-alerts');
  let html = '';
  if (!vacio) {
    if (ing - gasReal <= 0) html += `<div class="alert danger mb1"><span class="alert-icon">🚨</span><div><strong>Déficit:</strong> lo que llevas gastado este mes ya supera tu ingreso. Revisa tus gastos fijos.</div></div>`;
    else if (s.ahorroPct < 10) html += `<div class="alert warning mb1"><span class="alert-icon">⚠️</span><div><strong>Ahorro bajo:</strong> si el mes sigue así, te quedaría el ${Math.max(0, Math.round(s.ahorroPct))}% de tu ingreso. El mínimo recomendado es 10–20%.</div></div>`;
    if (deu > ing * 4) html += `<div class="alert warning mb1"><span class="alert-icon">⚠️</span><div><strong>Deuda elevada:</strong> tu deuda supera 4 veces tu ingreso mensual. Considera renegociar las condiciones.</div></div>`;
    if (s.ahorroPct >= 20) html += listo
      ? `<div class="alert success mb1"><span class="alert-icon">✅</span><div><strong>¡Excelente!</strong> Te quedaría el ${Math.round(s.ahorroPct)}% de tu ingreso, y tu fondo de emergencia está completo: puedes invertir parte en un APV o un fondo mutuo.</div></div>`
      : `<div class="alert success mb1"><span class="alert-icon">✅</span><div><strong>Buen margen:</strong> te quedaría el ${Math.round(s.ahorroPct)}% de tu ingreso. Úsalo primero en esto: ${siguiente}</div></div>`;
  }
  alertsEl.innerHTML = html || `<div class="alert info mb1"><span class="alert-icon">ℹ️</span><div>Anota tus gastos en <a href="#/movimientos">Movimientos</a> para ver alertas personalizadas aquí.</div></div>`;
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
  // Convertir lo ya escrito a la nueva moneda. Antes $850.000 pasaba a
  // leerse como 850.000 UF y el crédito salía "0% de tus ingresos".
  const anterior = simMoneda;
  if (anterior !== moneda) {
    const factor = m => m === 'UF' ? indUF : m === 'USD' ? indUSD : 1;
    ['s-ingreso', 's-otras'].forEach(id => {
      const el = $(id);
      const v = parseFloat(el?.value);
      if (!el || !(v > 0)) return;
      // Se guarda el monto en pesos para que ir y volver no lo redondee
      const enPesos = String(v) === el.dataset.mostrado && el.dataset.clp ? +el.dataset.clp : v * factor(anterior);
      const n = enPesos / factor(moneda);
      el.value = moneda === 'CLP' ? Math.round(n) : Math.round(n * 100) / 100;
      el.dataset.clp = enPesos;
      el.dataset.mostrado = String(parseFloat(el.value));
    });
  }
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
  const cuota      = cuotaFrancesa(monto, tasa, plazo);
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
    res.innerHTML = `<div class="calc-result-card danger"><div class="calc-result-title">🚨 Crédito muy riesgoso</div><div class="calc-result-txt">Tus cuotas serían el <strong>${ratioPct}%</strong> de tus ingresos, sobre el 40%. Considera un monto menor o un plazo mayor.</div></div>`;
  } else if (ratioPct > 30) {
    res.innerHTML = `<div class="calc-result-card warn"><div class="calc-result-title">⚠️ En el límite</div><div class="calc-result-txt">El <strong>${ratioPct}%</strong> de tus ingresos se iría en cuotas, entre 30% y 40%. Es posible, pero deja poco margen: asegúrate de tener fondo de emergencia.</div></div>`;
  } else {
    res.innerHTML = `<div class="calc-result-card ok"><div class="calc-result-title">✅ Cuota manejable</div><div class="calc-result-txt">Tus cuotas serían el <strong>${ratioPct}%</strong> de tus ingresos, bajo el 30%. Compara la CAE de varias ofertas antes de firmar.</div></div>`;
  }

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

  // TASA MÁXIMA CONVENCIONAL: la tasa del simulador es mensual; la TMC
  // se publica anual y lineal, así que se compara tasa × 12.
  const montoUF = simMoneda === 'UF' ? monto : simMoneda === 'USD' ? monto * indUSD / indUF : monto / indUF;
  // La TMC depende de la moneda: en pesos es lineal (tasa × 12); en UF y
  // en moneda extranjera es compuesta y mucho más baja. Antes se usaba
  // la de pesos para todo, y un crédito en UF al 12% anual no avisaba.
  const tramo   = tmcPara(montoUF, simMoneda);
  const tasaAnualComparable = tramo?.compuesta ? Math.pow(1 + tasa, 12) - 1 : tasa * 12;
  const tmcAviso = $('tmc-aviso');
  if (tmcAviso) {
    const vencido = tmcVencida();
    if (tramo && tasaAnualComparable > tramo.anual) {
      tmcAviso.style.display = 'flex';
      tmcAviso.className = 'alert danger';
      tmcAviso.innerHTML = `<span class="alert-icon">⚠️</span><div><strong>Esta tasa supera el máximo legal.</strong> Para créditos ${tramo.nombre} la Tasa Máxima Convencional es ${pctCL(tramo.anual)} anual. Ninguna institución puede cobrarla: si te la ofrecen, denúncialo al SERNAC o a la CMF.${vencido ? ' <em>Ojo: el certificado de la TMC que usa la app podría estar desactualizado.</em>' : ''}</div>`;
    } else if (vencido) {
      tmcAviso.style.display = 'flex';
      tmcAviso.className = 'alert info';
      tmcAviso.innerHTML = `<span class="alert-icon">ℹ️</span><div>El certificado de la Tasa Máxima Convencional que usa la app es del ${fechaCL(PARAMS_CL.tmc.vigenteDesde)} y ya podría haber uno nuevo. Revisa el vigente en la <a href="${PARAMS_CL.tmc.url}" target="_blank" rel="noopener">CMF</a>.</div>`;
    } else {
      tmcAviso.style.display = 'none';
    }
  }

  // CAE (Carga Anual Equivalente). Es la tasa que iguala lo que de verdad
  // recibes (monto menos costos iniciales) con todo lo que pagas (cuota
  // más seguros y cargos mensuales). Antes solo aparecía si se escribían
  // gastos mensuales, y no consideraba costos iniciales, que son los que
  // más separan la CAE de la tasa.
  const gastosOp  = Math.max(0, parseFloat($('s-gastos-op')?.value) || 0);
  const costosIni = Math.max(0, parseFloat($('s-costos-ini')?.value) || 0);
  const liquido   = monto - costosIni;
  const caeEl     = $('cae-result');
  if (monto > 0 && liquido > 0 && plazo > 0 && caeEl) {
    const cuotaReal = cuota + gastosOp;
    const caeAnual = caeAnualDe(liquido, cuotaReal, plazo) * 100;
    const tasaBaseAnual = (Math.pow(1 + tasa, 12) - 1) * 100;
    const caeDiff = caeAnual - tasaBaseAnual;
    const n2 = v => v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';

    caeEl.style.display = 'block';
    $('cae-cuota-real').textContent = fmtSim(cuotaReal);
    $('cae-tasa-base').textContent  = n2(tasaBaseAnual);
    $('cae-anual').textContent      = n2(caeAnual);
    const caeWarn = $('cae-warn');
    if (caeWarn) {
      if (caeDiff > 2) {
        caeWarn.style.display = 'flex';
        caeWarn.className = 'alert warning';
        caeWarn.innerHTML = `<span class="alert-icon">⚠️</span><div><strong>La CAE (${n2(caeAnual)}) supera en ${caeDiff.toLocaleString('es-CL', { maximumFractionDigits: 1 })} puntos a la tasa.</strong> La diferencia son los costos iniciales y los seguros: revisa en la Hoja Resumen cuáles son voluntarios.</div>`;
      } else {
        caeWarn.style.display = 'none';
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
    <div class="alert info"><span class="alert-icon">📊</span><div>Sin un fondo de emergencias, cualquier imprevisto (un despido, una enfermedad, un arreglo) se termina pagando con tarjeta o avance, que es como empieza el sobreendeudamiento.</div></div>
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
    ${acc('El poder del interés compuesto','$50.000/mes durante 30 años al 6% anual = unos $49 a $50 millones. Guardados sin invertir = $18 millones. La diferencia es el interés compuesto, y crece más mientras antes empiezas.')}
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
/* Glosario chileno. Revisado en octubre de 2026: se corrigió que el IPC
   lo mide el INE (no el Banco Central), se quitó la cita apócrifa de
   Einstein y el 40% de sobreendeudamiento dejó de presentarse como
   regla oficial. Se amplió de 18 a 60 términos. */
const glosario = [
  // ── Indicadores y unidades ──
  { term:'UF (Unidad de Fomento)',
    def:'Unidad de cuenta que se reajusta cada día según la inflación (IPC) del mes anterior. Se usa en créditos hipotecarios, arriendos y contratos largos. Su valor del día aparece en la barra superior.' },
  { term:'UTM (Unidad Tributaria Mensual)',
    def:'Unidad en pesos que se reajusta cada mes según el IPC y publica el SII. Sirve de referencia para multas, tramos del impuesto a la renta y el tope del APV.' },
  { term:'IPC (Índice de Precios al Consumidor)',
    def:'Indicador que mide cada mes cuánto cambian los precios de una canasta de bienes y servicios. Lo publica el INE y es la medida oficial de la inflación en Chile.' },
  { term:'Inflación',
    def:'Alza general y sostenida de los precios. Si la inflación es 5% y tu ahorro gana 3%, en realidad pierdes poder de compra.' },
  { term:'Rentabilidad real',
    def:'Lo que gana una inversión descontada la inflación. Una inversión que rinde 6% con inflación de 4% tiene una rentabilidad real cercana a 2%.' },
  // ── Créditos ──
  { term:'CAE (Carga Anual Equivalente)',
    def:'Costo anual de un crédito expresado como porcentaje, con intereses, comisiones y seguros incluidos. Es el número para comparar créditos: aparece en la Hoja Resumen.' },
  { term:'CTC (Costo Total del Crédito)',
    def:'Todo lo que terminarás pagando en pesos: capital, intereses, comisiones y seguros. Junto con la CAE, es lo que hay que comparar entre ofertas.' },
  { term:'Tasa de interés',
    def:'Lo que cobra la institución por prestarte, sin seguros ni comisiones. En la Hoja Resumen aparece separada de la CAE, que suma todos los costos: la CAE es igual o mayor, por eso la tasa sola no sirve para comparar.' },
  { term:'TMC (Tasa Máxima Convencional)',
    def:'El interés más alto que la ley permite cobrar. La CMF la publica cada mes según el tipo, monto y plazo de la operación. Cobrar sobre ella es ilegal.' },
  { term:'Hoja Resumen',
    def:'Documento obligatorio y gratuito que debe entregarte la institución antes de firmar un crédito. Resume CAE, costo total, cuotas, seguros y comisiones.' },
  { term:'Carga financiera',
    def:'Parte de tu ingreso mensual que se va en cuotas de deudas. Si ganas $800.000 y pagas $200.000 en cuotas, tu carga financiera es 25%.' },
  { term:'Sobreendeudamiento',
    def:'Situación en que las deudas superan lo que puedes pagar con tus ingresos. Una señal es que las cuotas se llevan una parte grande del sueldo y cualquier imprevisto obliga a pedir otro crédito.' },
  { term:'Crédito de consumo',
    def:'Préstamo en pesos para gastos personales, sin una garantía específica. Suele tener tasas más altas que un crédito hipotecario.' },
  { term:'Crédito hipotecario',
    def:'Préstamo de largo plazo para comprar una vivienda, que queda en garantía. Normalmente se expresa en UF y se paga en 15 a 30 años.' },
  { term:'Dividendo',
    def:'Tiene dos usos: la cuota mensual de un crédito hipotecario, y la parte de las utilidades que una empresa reparte a sus accionistas.' },
  { term:'Pie',
    def:'El monto que pagas al contado al comprar una vivienda o un auto. En un crédito hipotecario suele ser entre 10% y 20% del valor.' },
  { term:'Prepago',
    def:'Pagar un crédito, completo o en parte, antes de plazo. Reduce los intereses futuros, aunque puede tener una comisión que debe indicar la Hoja Resumen.' },
  { term:'Tasa fija y tasa variable',
    def:'Con tasa fija la cuota no cambia en todo el crédito. Con tasa variable cambia según una referencia del mercado: puede bajar, pero también subir.' },
  { term:'Seguro de desgravamen',
    def:'Seguro que paga la deuda si la persona deudora fallece. Es común en créditos de consumo e hipotecarios y se suma al costo, por eso entra en la CAE.' },
  { term:'Repactación',
    def:'Cambiar las condiciones de una deuda: más plazo, otra tasa o juntar varias. Puede bajar la cuota mensual, pero muchas veces sube el costo total.' },
  { term:'Mora',
    def:'Atraso en el pago de una cuota. Genera intereses por mora y gastos de cobranza, y si se prolonga puede terminar en un registro de morosidad.' },
  { term:'DICOM',
    def:'Registro comercial de deudas impagas que administra la empresa Equifax. Aparecer ahí dificulta conseguir créditos o arrendar. Una deuda pagada debe borrarse, y las impagas dejan de informarse a los 5 años.' },
  { term:'Boletín Comercial',
    def:'Otro registro de morosidades, que publica la Cámara de Comercio de Santiago (CCS). Incluye cheques protestados y letras o pagarés impagos. Es distinto de DICOM, aunque se suelen confundir.' },
  { term:'Procedimiento de renegociación',
    def:'Trámite gratuito ante la Superintendencia de Insolvencia y Reemprendimiento para personas que no pueden pagar sus deudas: busca un acuerdo de pago con todos los acreedores a la vez.' },
  // ── Tarjetas y cuentas ──
  { term:'Pago mínimo',
    def:'Lo mínimo que debes pagar de la tarjeta para no quedar en mora. El resto del saldo sigue cobrando intereses, así que pagar solo el mínimo alarga y encarece la deuda.' },
  { term:'Avance en efectivo',
    def:'Dinero que sacas con la tarjeta de crédito. Suele cobrar comisión e intereses desde el primer día: es de los créditos más caros.' },
  { term:'Cupo',
    def:'El monto máximo que puedes usar de una tarjeta o línea de crédito. Tener cupo disponible no significa poder pagarlo.' },
  { term:'Facturación y vencimiento',
    def:'La facturación es el día en que se cierra el estado de cuenta de la tarjeta; el vencimiento, el último día para pagarlo sin intereses ni mora.' },
  { term:'Línea de crédito',
    def:'Crédito asociado a la cuenta corriente que se usa automáticamente cuando el saldo no alcanza. Es cómodo, pero cobra intereses altos.' },
  { term:'Cuenta vista',
    def:'Cuenta para recibir y pagar dinero, sin chequera ni línea de crédito, con costos bajos. La CuentaRUT de BancoEstado es una cuenta vista.' },
  { term:'Cuenta corriente',
    def:'Cuenta bancaria para manejar el dinero del día a día, que suele venir con línea de crédito y tarjetas. Tiene costos de mantención y requiere evaluación del banco.' },
  // ── Sueldo, previsión y salud ──
  { term:'Sueldo bruto y sueldo líquido',
    def:'El bruto es lo que pacta el contrato; el líquido, lo que llega a tu cuenta después de descontar AFP, salud, seguro de cesantía e impuesto.' },
  { term:'Renta imponible',
    def:'La parte del sueldo sobre la que se calculan las cotizaciones. Algunos pagos, como colación y movilización, no son imponibles.' },
  { term:'Tope imponible',
    def:'Monto máximo de sueldo sobre el que se cotiza para AFP y salud: 90 UF en 2026. Lo que se gane por encima no paga cotización.' },
  { term:'AFP (Administradora de Fondos de Pensiones)',
    def:'Entidad que administra tu ahorro obligatorio para la pensión: 10% de tu renta imponible, más una comisión que varía según la AFP.' },
  { term:'Multifondos',
    def:'Los cinco tipos de fondos de las AFP, del A al E. El A tiene más acciones (más riesgo y potencial), el E más renta fija (más estable).' },
  { term:'APV (Ahorro Previsional Voluntario)',
    def:'Ahorro adicional para la jubilación con beneficio tributario. En el Régimen A el Estado bonifica el 15% de lo ahorrado (tope de 6 UTM al año); en el B se rebaja la base del impuesto.' },
  { term:'PGU (Pensión Garantizada Universal)',
    def:'Pensión que paga el Estado a personas de 65 años o más que no están en el grupo de mayores ingresos. Se suma a la pensión de la AFP.' },
  { term:'Seguro de cesantía (AFC)',
    def:'Seguro que entrega ingresos si pierdes el trabajo. Con contrato indefinido el trabajador aporta 0,6% de su renta y el empleador 2,4%.' },
  { term:'Fonasa e Isapre',
    def:'Los dos sistemas de salud. La cotización legal es 7% del sueldo imponible: en Fonasa se paga eso; en una Isapre el plan puede costar más.' },
  // ── Impuestos y emprendimiento ──
  { term:'Impuesto Único de Segunda Categoría',
    def:'Impuesto mensual al sueldo de trabajadores dependientes. Se calcula por tramos en UTM: hasta 13,5 UTM no se paga.' },
  { term:'Boleta de honorarios',
    def:'Documento que emite quien presta servicios de forma independiente. El que paga retiene un porcentaje y lo entera al SII.' },
  { term:'Retención de honorarios',
    def:'Porcentaje de una boleta de honorarios que se descuenta para impuestos y cotizaciones: 15,25% en 2026. Sube gradualmente hasta 17% en 2028.' },
  { term:'Operación Renta',
    def:'Proceso de abril de cada año en que se declara el impuesto a la renta del año anterior ante el SII. Ahí se recuperan o pagan diferencias, por ejemplo de las retenciones de honorarios.' },
  { term:'IVA (Impuesto al Valor Agregado)',
    def:'Impuesto de 19% que se agrega al precio de bienes y servicios. Quien vende lo cobra al cliente y lo paga al SII: no es ganancia del negocio.' },
  { term:'Débito y crédito fiscal',
    def:'El débito fiscal es el IVA que cobras en tus ventas; el crédito fiscal, el IVA que pagaste en tus compras del negocio. Al SII se le paga la diferencia.' },
  { term:'Inicio de actividades',
    def:'Trámite ante el SII para empezar a emitir boletas o facturas como persona o empresa. Se hace en línea en sii.cl.' },
  // ── Ahorro e inversión ──
  { term:'Interés compuesto',
    def:'Interés que se calcula sobre el capital más los intereses ya ganados. Hace crecer el ahorro cada vez más rápido con el tiempo, y también las deudas impagas.' },
  { term:'Interés simple',
    def:'Interés que se calcula solo sobre el capital original, sin sumar los intereses anteriores. Crece más lento que el compuesto.' },
  { term:'Depósito a Plazo (DAP)',
    def:'Dinero que dejas en el banco por un plazo fijo a cambio de una tasa conocida de antemano. Si lo retiras antes, normalmente pierdes los intereses.' },
  { term:'Fondo mutuo',
    def:'Inversión en que tu dinero se junta con el de otras personas y un administrador lo invierte. Hay fondos conservadores y otros con más riesgo; ninguno garantiza ganancias.' },
  { term:'Acción',
    def:'Una parte de la propiedad de una empresa. Su precio sube y baja en la bolsa, y puede pagar dividendos.' },
  { term:'Bono',
    def:'Un préstamo que le haces a una empresa o al Estado a cambio de intereses. Suele variar menos que las acciones, por eso se llama renta fija.' },
  { term:'ETF',
    def:'Fondo que copia un índice bursátil y se compra y vende en bolsa como una acción. Permite diversificar con poco dinero.' },
  { term:'Índice bursátil',
    def:'Indicador que resume cómo se mueven las acciones de un grupo de empresas, como el IPSA en Chile o el S&P 500 en Estados Unidos.' },
  { term:'Diversificación',
    def:'Repartir el dinero en distintos instrumentos para que la caída de uno no arrastre todo.' },
  { term:'Perfil de inversionista',
    def:'Cuánto riesgo puedes y quieres asumir, según tu plazo, tus ingresos y cómo reaccionas ante pérdidas. Las instituciones deben evaluarlo antes de ofrecerte inversiones.' },
  { term:'Liquidez',
    def:'Qué tan rápido puedes convertir algo en dinero sin perder valor. Una cuenta de ahorro es muy líquida; un departamento, poco.' },
  { term:'Activo y pasivo',
    def:'Un activo es algo que tienes y vale dinero: ahorros, una casa, un auto. Un pasivo es lo que debes: un crédito, la deuda de la tarjeta. Un auto es un activo que pierde valor con los años; el crédito con que lo compraste es el pasivo.' },
  { term:'Patrimonio',
    def:'Lo que tienes menos lo que debes. Si tienes $3 millones en ahorros y un auto de $5 millones, pero debes $4 millones, tu patrimonio es $4 millones.' },
  // ── Instituciones ──
  { term:'CMF (Comisión para el Mercado Financiero)',
    def:'Organismo que supervisa a bancos, aseguradoras y el mercado de valores. Publica la TMC y estadísticas de tasas, y recibe reclamos contra entidades financieras.' },
  { term:'SERNAC',
    def:'Servicio Nacional del Consumidor. Protege a los consumidores, también en productos financieros, recibe reclamos y tiene un simulador para comparar créditos de consumo.' }
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
    results.innerHTML = `<div class="glosario-empty">Sin resultados para "<strong>${esc(query)}</strong>". Prueba con otro término.</div>`;
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
    <button type="button" class="acc-head" aria-expanded="false" aria-controls="${id}" onclick="toggleAcc('${id}', this)"><span>${q}</span><span class="acc-arrow" id="arr-${id}" aria-hidden="true">▼</span></button>
    <div class="acc-body" id="${id}">${a}</div>
  </div>`;
}
function toggleAcc(id, btn) {
  const body = $(id), arr = $('arr-' + id);
  const abierto = body.classList.toggle('open');
  arr.classList.toggle('open', abierto);
  if (btn) btn.setAttribute('aria-expanded', String(abierto));
}
function openModule(key) {
  const m = modData[key];
  $('mod-emoji').textContent = m.emoji;
  $('mod-title').textContent = m.title;
  $('mod-badge').textContent = m.badge;
  $('mod-badge').className   = 'badge ' + m.badgeCls;
  $('mod-body').innerHTML    = conTusNumeros(key) + m.body;
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
/* grupo: a qué parte de la regla 50/30/20 pertenece. "deuda" (cuotas y
   pagos de crédito) cuenta en el 20% de ahorro y deudas. El índice de
   cada categoría es el que se guarda: solo se agregan al final. */
const catConfig = [
  { label:'🏠 Vivienda',      color:'#0f5240', grupo:'necesidad' },
  { label:'🍽️ Alimentación', color:'#126b53', grupo:'necesidad' },
  { label:'🚌 Transporte',   color:'#d97706', grupo:'necesidad' },
  { label:'💡 Servicios',    color:'#1d4ed8', grupo:'necesidad' },
  { label:'🎬 Entretención', color:'#dc2626', grupo:'deseo' },
  { label:'💊 Salud',        color:'#7c3aed', grupo:'necesidad' },
  { label:'📚 Educación',    color:'#0891b2', grupo:'necesidad' },
  { label:'👕 Vestuario',    color:'#db2777', grupo:'deseo' },
  { label:'📦 Otros',        color:'#6b7280', grupo:'deseo' },
  { label:'💳 Deudas',       color:'#9a3412', grupo:'deuda' },
];

// ► Estado inicial de budgetRows (se sobrescribe con localStorage si existe)
/* Presupuesto de ejemplo. NO se carga solo: antes arrancaba precargado y
   quien abría la app por primera vez veía el presupuesto de otra persona
   sin saber si debía borrarlo o construir encima. Ahora es opt-in, con
   cargarEjemplo(), y mientras está activo se avisa en pantalla. */
const DATOS_EJEMPLO = {
  ingreso: 900000,
  deuda  : 320000,
  filas  : [
    { cat:0, desc:'Arriendo / dividendo',          presup:250000, real:250000 },
    { cat:1, desc:'Supermercado + delivery',        presup:120000, real:138000 },
    { cat:2, desc:'Transporte público / bencina',   presup:55000,  real:52000  },
    { cat:3, desc:'Luz, agua, internet, gas',       presup:48000,  real:44000  },
    { cat:4, desc:'Streaming + salidas',            presup:35000,  real:42000  },
    { cat:5, desc:'Medicamentos / consultas',       presup:20000,  real:15000  },
  ]
};

let budgetRows = [];
let modoEjemplo = false;

/** Carga el presupuesto de ejemplo y lo marca como tal. */
function cargarEjemplo() {
  budgetRows = DATOS_EJEMPLO.filas.map(f => ({ ...f }));
  $('b-ingreso').value = DATOS_EJEMPLO.ingreso;
  $('b-deuda').value   = DATOS_EJEMPLO.deuda;
  modoEjemplo = true;
  try { localStorage.setItem(LS.ejemplo, '1'); } catch(e) {}
  renderBudgetTable(); budgetCalc(); dashUpdate(); actualizarAvisoEjemplo(); saveAll();
}

/** Deja el presupuesto en blanco para empezar de cero. */
function limpiarEjemplo() {
  budgetRows = [];
  $('b-ingreso').value = '';
  $('b-deuda').value   = '';
  modoEjemplo = false;
  try { localStorage.removeItem(LS.ejemplo); } catch(e) {}
  // El historial del ejemplo no es del usuario: empezar de cero es de verdad
  borrarHistorial();
  renderBudgetTable(); budgetCalc(); dashUpdate(); actualizarAvisoEjemplo(); saveAll();
}

/** Muestra u oculta el aviso de "datos de ejemplo" en el panel. */
function actualizarAvisoEjemplo() {
  const aviso = $('aviso-ejemplo');
  if (aviso) aviso.style.display = modoEjemplo ? 'flex' : 'none';
}

/** Llena el selector de mes: 12 meses atrás, el próximo y los que tengan datos. */
function poblarSelectorMes() {
  const set = new Set(Object.keys(presupuestos));
  let c = mesSiguiente(mesHoy());
  for (let i = 0; i < 14; i++) {
    set.add(c);
    let [y, m] = c.split('-').map(Number);
    m--; if (m < 1) { m = 12; y--; }
    c = `${y}-${pad2(m)}`;
  }
  $('b-mes').innerHTML = [...set].sort().reverse()
    .map(k => `<option value="${k}">${nombreMes(k)}</option>`).join('');
}

/** Carga el presupuesto de un mes. Un mes nuevo hereda el plan del anterior, con lo real en cero. */
function cargarMes(clave) {
  mesCargado = clave;
  $('b-mes').value = clave;
  const p = presupuestos[clave];
  if (p) {
    budgetRows = (p.filas || []).map(f => ({ ...f }));
    $('b-ingreso').value = p.ingreso ?? '';
  } else {
    const prev = Object.keys(presupuestos).filter(k => k < clave).sort().pop();
    const base = prev ? presupuestos[prev] : null;
    budgetRows = base ? (base.filas || []).map(f => ({ ...f, real: 0 })) : [];
    $('b-ingreso').value = base ? (base.ingreso ?? '') : '';
  }
}

/** El selector cambió: guarda el mes que estaba y carga el elegido. */
function cambiarMes() {
  const nuevo = $('b-mes').value;
  $('b-mes').value = mesCargado;   // para que saveAll guarde el mes correcto
  saveAll();
  cargarMes(nuevo);
  refrescarTodo();
}

/** Presupuestado por categoría de un mes. */
function planDelMes(clave) {
  const filas = !clave || clave === mesCargado ? budgetRows : (presupuestos[clave]?.filas || []);
  const p = {};
  filas.forEach(r => { p[r.cat] = (p[r.cat] || 0) + (r.presup || 0); });
  return p;
}

/** ¿El mes tiene gastos anotados en Movimientos? Entonces el gasto real sale de ahí. */
function usaMovimientos(clave = claveMesActual()) {
  return movsDelMes(clave).some(m => m.tipo === 'gasto');
}

/** Filas del presupuesto del mes. Con movimientos, una por categoría con lo real sumado. */
function filasDelMes(clave = claveMesActual()) {
  const manual = clave === mesCargado ? budgetRows : (presupuestos[clave]?.filas || []);
  if (!usaMovimientos(clave)) return manual;
  const plan = planDelMes(clave);
  const real = gastoMesPorCat(clave);
  const cats = [...new Set([...Object.keys(plan), ...Object.keys(real)].map(Number))].sort((x, y) => x - y);
  return cats.map(c => ({
    cat: c,
    desc: catConfig[c]?.label.replace(/^\S+\s/, '') || 'Otro',
    presup: plan[c] || 0,
    real: real[c] || 0
  }));
}

/** Ingreso del mes: lo anotado en Movimientos, o lo escrito a mano en Plan. */
function ingresoDelMes(clave = claveMesActual()) {
  const mov = totalMes(clave, 'ingreso');
  if (mov > 0) return mov;
  const escrito = clave === mesCargado ? $('b-ingreso').value : presupuestos[clave]?.ingreso;
  return parseFloat(escrito) || 0;
}

/** Cambia lo presupuestado de una categoría (modo Movimientos). */
function setPlanCat(cat, valor) {
  const v = Math.max(0, parseFloat(valor) || 0);
  const filas = budgetRows.filter(r => r.cat === cat);
  if (filas.length) { filas[0].presup = v; filas.slice(1).forEach(r => { r.presup = 0; }); }
  else budgetRows.push({ cat, desc: catConfig[cat].label.replace(/^\S+\s/, ''), presup: v, real: 0 });
  // Repintar la tabla: antes la columna "Diferencia" quedaba con el valor viejo
  renderBudgetTable(); budgetCalc(); dashUpdate(); saveAll();
}

/** Después de cambios en movimientos, metas o mes: repintar lo que depende de ellos. */
function refrescarTodo() {
  renderBudgetTable();
  budgetCalc();
  dashUpdate();
  renderMetas();
  saveAll();
}

/** ¿El usuario todavía no cargó nada propio? */
function sinDatos(clave = claveMesActual()) {
  return filasDelMes(clave).length === 0 && !(ingresoDelMes(clave) > 0);
}

/** Renderiza la tabla de presupuesto en el DOM */
function renderBudgetTable() {
  const tbody = $('budget-tbody');
  tbody.innerHTML = '';

  // Ingreso: si hay ingresos anotados, sale de Movimientos
  const ingMov = totalMes(claveMesActual(), 'ingreso');
  $('b-ingreso').readOnly = ingMov > 0;
  if (ingMov > 0) $('b-ingreso').value = ingMov;
  const hint = $('b-ingreso-hint');
  if (hint) hint.textContent = ingMov > 0
    ? 'Suma de los ingresos anotados en Movimientos este mes.'
    : 'Escríbelo aquí, o anota tu sueldo en Movimientos.';

  const modo = $('b-modo-mov');
  const btnFila = $('b-add-fila');
  if (btnFila) btnFila.style.display = usaMovimientos() ? 'none' : '';
  if (usaMovimientos()) {
    if (modo) modo.style.display = 'flex';
    $('budget-tbl').classList.add('modo-mov');
    const plan = planDelMes(claveMesActual());
    const real = gastoMesPorCat(claveMesActual());
    tbody.innerHTML = catConfig.map((c, ci) => {
      const p = plan[ci] || 0, r = real[ci] || 0, diff = r - p;
      const diffClass = diff > 0 ? 'diff-positive' : diff < 0 ? 'diff-negative' : 'diff-zero';
      return `<tr class="${!p && !r ? 'fila-vacia' : ''}">
        <td><span class="cat-fija">${c.label}</span></td>
        <td><a href="#/movimientos" onclick="movFiltro.mes='${claveMesActual()}';movFiltro.cat='${ci}'">${movsDelMes(claveMesActual()).filter(m => m.tipo === 'gasto' && m.cat === ci).length} mov.</a></td>
        <td style="text-align:right"><input class="b-num" type="number" min="0" aria-label="Presupuesto de ${esc(c.label)}" value="${p || ''}" placeholder="0" onchange="setPlanCat(${ci}, this.value)"></td>
        <td style="text-align:right">${fmt(r)}</td>
        <td style="text-align:right" class="${diffClass}">${fmtSigno(diff)}</td>
        <td></td>
      </tr>`;
    }).join('');
    budgetCalc();
    return;
  }
  if (modo) modo.style.display = 'none';
  $('budget-tbl').classList.remove('modo-mov');

  // Estado vacío: en vez de una tabla en blanco, ofrecer los dos caminos
  if (budgetRows.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="6" class="budget-vacio">
        <div class="budget-vacio-ico" aria-hidden="true">📋</div>
        <div class="budget-vacio-tit">Tu presupuesto está vacío</div>
        <div class="budget-vacio-sub">
          Agrega tus gastos del mes, o mira primero un ejemplo armado para
          entender cómo funciona.
        </div>
        <div class="budget-vacio-btns">
          <button class="btn btn-primary btn-sm" onclick="addBudgetRow()">+ Agregar mi primer gasto</button>
          <button class="btn btn-outline btn-sm" onclick="cargarEjemplo()">Ver un ejemplo</button>
        </div>
      </td></tr>`;
    budgetCalc();
    return;
  }

  budgetRows.forEach((row, i) => {
    const diff      = row.real - row.presup;
    const diffClass = diff > 0 ? 'diff-positive' : diff < 0 ? 'diff-negative' : 'diff-zero';
    const diffStr   = fmtSigno(diff);
    tbody.innerHTML += `<tr>
      <td>
        <select aria-label="Categoría del gasto ${i + 1}" onchange="budgetRows[${i}].cat=+this.value;renderBudgetTable();budgetCalc();saveAll()"
                style="background:transparent;border:1px solid var(--line);border-radius:6px;padding:4px 6px;font-size:12px;color:var(--ink);cursor:pointer;max-width:150px">
          ${catConfig.map((c, ci) => `<option value="${ci}"${ci === row.cat ? ' selected' : ''}>${c.label}</option>`).join('')}
        </select>
      </td>
      <td><input class="b-input" aria-label="Descripción del gasto ${i + 1}" value="${esc(row.desc)}" onchange="budgetRows[${i}].desc=this.value;saveAll()"></td>
      <td style="text-align:right"><input class="b-num" type="number" aria-label="Monto presupuestado del gasto ${i + 1}" value="${row.presup}" onchange="budgetRows[${i}].presup=+this.value;budgetCalc();saveAll()"></td>
      <td style="text-align:right"><input class="b-num" type="number" aria-label="Monto real gastado ${i + 1}" value="${row.real}"   onchange="budgetRows[${i}].real=+this.value;budgetCalc();dashUpdate();saveAll()"></td>
      <td style="text-align:right" class="${diffClass}">${diffStr}</td>
      <td><button onclick="deleteBudgetRow(${i})" class="btn btn-danger btn-sm" style="padding:4px 8px;font-size:12px" aria-label="Eliminar el gasto ${i + 1}">✕</button></td>
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
  const filas     = filasDelMes();
  const ingreso   = ingresoDelMes();
  const totPresup = filas.reduce((s, r) => s + r.presup, 0);
  const totReal   = filas.reduce((s, r) => s + r.real,   0);
  const diff      = totPresup - totReal;
  const ahorro    = Math.max(ingreso - totReal, 0);

  $('b-tot-presup').textContent  = fmt(totPresup);
  $('b-tot-real').textContent    = fmt(totReal);
  $('b-diferencia').textContent  = fmtSigno(diff);
  $('b-diferencia').style.color  = diff >= 0 ? 'var(--green-600)' : 'var(--red-500)';
  $('b-ahorro-card').textContent = fmt(ahorro);
  $('b-ahorro').textContent      = fmt(ahorro);
  $('b-ahorro-pct').textContent  = ingreso > 0 ? `${pct(ahorro, ingreso)}% de tus ingresos` : '';

  // Barra de tasa de gasto
  const rate   = pct(totReal, ingreso);
  const rateEl = $('b-rate-bar');
  rateEl.style.width      = Math.min(rate, 100) + '%';
  rateEl.style.background = rate > 85 ? '#ef4444' : rate > 65 ? '#f59e0b' : '#1da077';
  // Sin datos, un "0% de gastos ✅ Rango saludable" es engañoso: no hay
  // nada que evaluar todavía.
  $('b-rate-text').textContent = sinDatos()
    ? 'Ingresa tu ingreso neto y tus gastos para ver tu tasa de gasto.'
    : `Usas el ${rate}% de tus ingresos en gastos. ${rate > 85 ? '⚠️ Nivel crítico.' : rate > 65 ? 'Poco margen de ahorro.' : '✅ Rango saludable.'}`;

  // Barras de ejecución por categoría
  const catMap = {};
  filas.forEach(r => {
    if (!catMap[r.cat]) catMap[r.cat] = { presup:0, real:0 };
    catMap[r.cat].presup += r.presup;
    catMap[r.cat].real   += r.real;
  });
  let barsHtml = '';
  Object.keys(catMap).forEach(ci => {
    const d   = catMap[ci];
    // Gastar exactamente lo planeado no es una advertencia: ámbar solo
    // entre 80% y 99%, rojo sobre 100%. Sin plan pero con gasto: aviso.
    const sinPlan = !(d.presup > 0) && d.real > 0;
    const p   = d.presup > 0 ? Math.min(pct(d.real, d.presup), 150) : 0;
    const col = sinPlan ? '#b45309' : p > 100 ? '#c4320a' : (p >= 80 && p < 100) ? '#b45309' : '#12805c';
    barsHtml += `<div class="bar-row">
      <span class="bar-cat" style="width:120px;font-size:12px">${catConfig[ci]?.label || 'Otro'}</span>
      <div class="bar-track2"><div class="bar-fill2" style="width:${sinPlan ? 100 : Math.min(p,100)}%;background:${col}"></div></div>
      <span class="bar-amount" style="width:58px;font-size:11.5px;text-align:right">${sinPlan ? 'sin plan' : p + '%'}</span>
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
    c.innerHTML = `<span class="alert-icon">🏆</span><div>¡Te queda el ${pct(ahorro,ingreso)}% de tus ingresos! Primero completa tu fondo de emergencia en Metas; después considera un APV o fondo mutuo.</div>`;
  } else if (ahorro > 0) {
    c.style.display = 'flex'; c.className = 'alert info';
    c.innerHTML = `<span class="alert-icon">💡</span><div>Tienes ${fmt(ahorro)} disponibles. Destina al menos el 50% a tu fondo de emergencias.</div>`;
  } else {
    c.style.display = 'none';
  }

  // Gasto hormiga: la suma de compras chicas y frecuentes del mes (hasta
  // $5.000 cada una). Antes se calculaba como Entretención + Otros, que
  // no es lo mismo: un gasto hormiga no es una categoría.
  const chicas = movsDelMes(claveMesActual()).filter(m => m.tipo === 'gasto' && m.monto <= 5000);
  const gastoHormiga = chicas.reduce((s, m) => s + m.monto, 0);
  const hormigas = $('b-hormiga-insight');
  if (hormigas) {
    const horPct = ingreso > 0 ? (gastoHormiga / ingreso) * 100 : 0;
    if (chicas.length >= 8 && horPct >= 3) {
      hormigas.style.display = 'flex';
      hormigas.className = 'alert warning';
      hormigas.innerHTML = `<span class="alert-icon">☕</span>
        <div><strong>Gasto hormiga:</strong> este mes anotaste <strong>${chicas.length} compras de $5.000 o menos</strong> que suman <strong>${fmt(gastoHormiga)}</strong>, el ${horPct.toFixed(1).replace('.', ',')}% de tu ingreso. Al año serían ${fmt(gastoHormiga * 12)}.</div>`;
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

  // Aguja: ángulo desde 180° (izq) hasta 0° (der) según score.
  // En SVG el eje Y crece hacia abajo, así que el seno se RESTA: con +
  // la aguja apuntaba hacia abajo, fuera del arco.
  const needleAngle = 180 - pct * 180;
  const needleLen = 54;
  const nx = cx + needleLen * Math.cos(toRad(needleAngle));
  const ny = cy - needleLen * Math.sin(toRad(needleAngle));

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
      const ix = cx + (r+10)*Math.cos(a), iy = cy - (r+10)*Math.sin(a);
      const ox = cx + (r+16)*Math.cos(a), oy = cy - (r+16)*Math.sin(a);
      return `<line x1="${ix}" y1="${iy}" x2="${ox}" y2="${oy}" stroke="${trackC}" stroke-width="2"/>
              <text x="${cx+(r+26)*Math.cos(a)}" y="${cy-(r+26)*Math.sin(a)}"
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
  // Se cotiza sobre la renta imponible, que tiene tope (90 UF en 2026).
  // El aporte del empleador a tu cuenta, si lo indicas, se suma al 10%.
  const imponible = Math.min(sueldo, PARAMS_CL.topeImponibleUF.valor * indUF);
  const aporteEmp = Math.max(0, parseFloat($('jub-empleador')?.value) || 0) / 100;
  const aporteMensAFP = imponible * (0.10 + aporteEmp);

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
  // La pensión depende de la expectativa de vida y la modalidad (retiro
  // programado o renta vitalicia). En vez de un número exacto ("fondo ÷
  // 240"), se muestra un rango: el fondo repartido en 20 a 25 años.
  const pensionAlta    = Math.round(fondoTotal / 240);
  const pensionBaja    = Math.round(fondoTotal / 300);

  $('jub-r-afp').textContent    = fmt(fondoAFPFinal);
  $('jub-r-apv').textContent    = fmt(fondoAPVFinal);
  $('jub-r-total').textContent  = fmt(fondoTotal);
  $('jub-r-bono').textContent   = fmt(bonoTotal);
  $('jub-r-pension').textContent= `${fmt(pensionBaja)} a ${fmt(pensionAlta)}`;

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
    winner.className = 'auto-winner neutral';
    winner.innerHTML = `<div class="auto-winner-icon" aria-hidden="true">⚖️</div>
      <div><div class="auto-winner-title">Crédito tradicional paga ${fmt(diff)} menos en intereses</div>
      <div style="font-size:13px;color:var(--muted)">El crédito estándar es más económico a largo plazo. La cuota inicial es mayor pero el costo total es menor.</div></div>`;
  } else {
    winner.className = 'auto-winner neutral';
    winner.innerHTML = `<div class="auto-winner-icon" aria-hidden="true">⚖️</div>
      <div><div class="auto-winner-title">Compra inteligente paga ${fmt(diff)} menos en intereses</div>
      <div style="font-size:13px;color:var(--muted)">Ojo con el cuotón final de ${fmt(sCuoton)}: tienes que pagarlo, refinanciarlo (con más intereses) o devolver el auto. Planifícalo desde el primer mes.</div></div>`;
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
        { label:'Crédito tradicional',  data:[financ, tInter, tCuota*tPlazo], backgroundColor:'rgba(36,87,197,.8)',  borderRadius:6 },
        { label:'Compra inteligente',   data:[financ, sInter, sCuota*sPlazo+sCuoton], backgroundColor:'rgba(180,83,9,.8)', borderRadius:6 }
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
   La tasa de retención sale de PARAMS_CL (15,25% en 2026).
   Bruto = Líquido / (1 − tasa)
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
  const tasa  = PARAMS_CL.retencionHonorarios.valor;
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
      Apenas te paguen, transfiere ese monto a una cuenta separada para no desfinanciarte a fin de mes cuando debas declararlo al SII. Si compraste la mercadería con factura, el IVA de esa compra (crédito fiscal) se descuenta: al SII le pagas la diferencia.</div>`;
  } else {
    insightEl.style.display = 'none';
  }
}

/* ============================================================
   FEAT E: VENCIMIENTOS — CRUD + render + localStorage
   ============================================================ */
// Antes venían tres cuentas inventadas (luz, agua, internet) que se
// guardaban como del usuario y entraban al calendario .ics.
let vencRows = [];
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
      <button type="button" class="venc-check ${row.paid ? 'paid' : ''}" onclick="toggleVenc(${row.id})" aria-pressed="${row.paid}" aria-label="${esc(row.nombre)}: marcar como ${row.paid ? 'pendiente' : 'pagada'}">
        ${row.paid ? '✓' : ''}
      </button>
      <span class="venc-nombre">${esc(row.nombre)}</span>
      <span class="venc-monto">${fmt(row.monto)}</span>
      <span class="venc-dia ${diaCls}">Día ${row.dia}${daysLeft === 0 && !row.paid ? ' ⚡' : daysLeft < 0 && !row.paid ? ' ❗' : ''}</span>
      <button class="venc-del" onclick="deleteVenc(${row.id})" title="Eliminar" aria-label="Eliminar el vencimiento ${esc(row.nombre)}">✕</button>
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

/** Pinta en la página las cifras legales y su procedencia, desde PARAMS_CL. */
function aplicarParametrosCL() {
  const ret = PARAMS_CL.retencionHonorarios;
  document.querySelectorAll('.ret-pct').forEach(el => el.textContent = pctCL(ret.valor));
  document.querySelectorAll('.ret-dec').forEach(el =>
    el.textContent = ret.valor.toLocaleString('es-CL', { maximumFractionDigits: 4 }));
  if ($('sii-vigencia')) $('sii-vigencia').innerHTML = vigenciaHTML(ret);
  if ($('imp-vigencia')) $('imp-vigencia').innerHTML = vigenciaHTML(PARAMS_CL.importacion);
  if ($('hrs-jornada')) $('hrs-jornada').value = PARAMS_CL.jornadaSemanal.valor;

  const tmc = PARAMS_CL.tmc;
  if ($('tmc-tbody')) {
    $('tmc-tbody').innerHTML = tmc.tramos.slice(0, 2).map(t => `
      <tr class="tmc-row"><td><strong>TMC — tope legal, ${t.nombre}</strong></td><td>Límite</td>
        <td><strong>${pctCL(t.anual / 12)}</strong></td><td><strong>${pctCL(t.anual)}</strong></td></tr>`).join('');
  }
  if ($('tmc-vigencia')) $('tmc-vigencia').innerHTML =
    `La TMC es el máximo legal para créditos en pesos de 90 días o más, y cambia cada mes. ${vigenciaHTML(tmc)}.`;
}

// Movimientos primero: el presupuesto y el score leen de ellos
cargarMovimientos();

// FEATURE 2: Cargar datos persistidos ANTES de renderizar
loadFromStorage();
aplicarParametrosCL();

// FEATURE 3: Aplicar modo oscuro guardado
applyDarkMode();

// FEATURE 5: Obtener indicadores económicos en vivo (async)
fetchIndicadores();

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
/* Preguntas de los quizzes. Reescritas en octubre de 2026: antes, en 55
   de 60 la correcta era la opción más larga y en 58 de 60 estaba en la
   posición B o C, así que se aprobaba sin leer. Ahora las opciones
   incorrectas son igual de largas y creíbles (la correcta casi nunca es
   la más larga) y el orden se baraja en cada intento. También se
   quitaron afirmaciones sin fuente ("según estudios…") y cifras que ya
   no calzan con la ley. */
const quizData = {
  emergencias: {
    badge: '🏅 Experto en Ahorro',
    key:   'badge_emergencias',
    preguntas: [
      { q: '¿Cuántos meses de gastos esenciales se suele recomendar tener en un fondo de emergencias?',
        opts: ['1 mes, que es lo que dura un sueldo', '3 a 6 meses, según qué tan estable sea tu ingreso', '12 a 18 meses, para estar completamente cubierto', 'Lo que sobre a fin de mes, sin una meta fija'], correct: 1,
        feedback: 'Lo habitual es 3 a 6 meses: 3 si tienes trabajo estable, 6 si tus ingresos son variables o eres independiente.' },
      { q: '¿Dónde conviene guardar el fondo de emergencias?',
        opts: ['En acciones de empresas grandes y estables', 'En efectivo guardado en la casa', 'En una cuenta de ahorro con giro inmediato', 'En criptomonedas estables, que no cambian de valor'], correct: 2,
        feedback: 'Tiene que estar disponible en uno o dos días y sin perder valor. Las acciones o las criptomonedas pueden bajar justo cuando lo necesitas, y el efectivo en la casa se puede perder o gastar.' },
      { q: 'Si ahorras el 10% de tu sueldo cada mes, ¿cuántos sueldos juntas en un año?',
        opts: ['Medio sueldo, porque se descuentan comisiones', '1,2 sueldos', '3 sueldos, gracias a los intereses', '10 sueldos'], correct: 1,
        feedback: '10% × 12 meses = 120% de un sueldo, o sea 1,2 sueldos. Por eso armar un fondo de 3 meses toma un par de años si se ahorra solo el 10%.' },
      { q: 'Tus gastos esenciales son $400.000 al mes. ¿Cuánto necesitas para cubrir 3 meses?',
        opts: ['$400.000', '$800.000', '$1.200.000', '$2.400.000'], correct: 2,
        feedback: '$400.000 × 3 = $1.200.000. Es el mínimo para aguantar tres meses sin ingresos.' },
      { q: '¿Por qué no conviene tener el fondo de emergencias en acciones?',
        opts: ['Porque las acciones nunca entregan ganancias en Chile', 'Porque su valor puede caer justo cuando lo necesitas', 'Porque el SII cobra un impuesto mensual a las acciones', 'Porque los bancos prohíben usarlas como ahorro'], correct: 1,
        feedback: 'Una caída de la bolsa puede reducir el fondo en el peor momento: cuando pierdes el trabajo o tienes una urgencia.' },
      { q: '¿Qué significa que el fondo de emergencias sea "líquido"?',
        opts: ['Que lo sacas rápido y sin perder plata', 'Que está guardado en billetes y no en el banco', 'Que se reajusta automáticamente según la UF', 'Que está repartido en varios bancos distintos'], correct: 0,
        feedback: 'Líquido es que lo puedes usar de inmediato, sin multas ni pérdidas. Una cuenta de ahorro o una cuenta vista lo cumplen.' },
      { q: 'Una persona independiente, con ingresos que cambian mes a mes, debería apuntar a un fondo de al menos:',
        opts: ['1 mes de gastos, porque cobra seguido', '3 meses, igual que un trabajador con contrato', '6 meses de gastos', '2 años de gastos antes de gastar en cualquier otra cosa'], correct: 2,
        feedback: 'Con ingresos variables conviene el extremo alto: 6 meses, porque un mes malo puede repetirse.' },
      { q: '¿Cuál de estos gastos NO se cuenta al calcular el fondo de emergencias?',
        opts: ['El arriendo o dividendo de la vivienda', 'Un viaje de vacaciones', 'La comida y los productos básicos de la casa', 'El transporte para ir al trabajo o estudiar'], correct: 1,
        feedback: 'El fondo cubre lo esencial para vivir. Las vacaciones son una meta de ahorro aparte, no una emergencia.' },
      { q: '¿Qué ventaja tiene programar una transferencia automática al ahorro el día de pago?',
        opts: ['Que genera más intereses que ahorrar a fin de mes', 'Que el dinero sale antes de que lo gastes', 'Que ese ahorro queda libre de impuestos', 'Que mejora tu puntaje en los registros de deuda'], correct: 1,
        feedback: 'Si el ahorro sale apenas llega el sueldo, no compite con los gastos del mes. Es la forma más simple de ahorrar sin depender de la fuerza de voluntad.' },
      { q: '¿Cuál es la opción más adecuada para el fondo de emergencias en Chile?',
        opts: ['Un depósito a plazo a un año, que rinde más', 'Un fondo mutuo de acciones de alto rendimiento', 'Una cuenta de ahorro o vista con giro inmediato', 'Dólares en efectivo, que protegen de la inflación'], correct: 2,
        feedback: 'Un depósito a plazo te hace perder intereses si lo rompes antes; las acciones y el dólar cambian de valor. La cuenta de ahorro con giro inmediato da acceso rápido y estable.' }
    ]
  },
  deudas: {
    badge: '🏔️ Maestro de Deudas',
    key:   'badge_deudas',
    preguntas: [
      { q: '¿Qué estrategia paga menos intereses en total?',
        opts: ['Bola de nieve, partiendo por la deuda más chica', 'Avalancha', 'Pagar siempre el mínimo de cada deuda', 'Pagar primero la deuda más reciente'], correct: 1,
        feedback: 'La avalancha ataca primero la deuda con la tasa más alta, así que en total pagas menos intereses. La bola de nieve da victorias rápidas, pero suele costar algo más.' },
      { q: '¿Qué indica mejor que una persona está sobreendeudada?',
        opts: ['Que tiene más de una tarjeta de crédito a su nombre', 'Que sus cuotas se llevan gran parte de su ingreso', 'Que alguna vez pidió un crédito de consumo', 'Que tiene una cuenta corriente con línea de crédito'], correct: 1,
        feedback: 'Lo que importa es la carga financiera: qué parte del ingreso se va en cuotas. Tener tarjetas o créditos no es problema si las cuotas son manejables.' },
      { q: '¿Qué es la CAE (Carga Anual Equivalente)?',
        opts: ['El monto total que te presta el banco', 'El costo anual del crédito con todos sus gastos', 'La cantidad de cuotas que tiene el crédito', 'La tasa de interés mensual sin seguros ni comisiones'], correct: 1,
        feedback: 'La CAE incluye intereses, comisiones y seguros, y se expresa como porcentaje anual. Sirve para comparar créditos de distintas instituciones.' },
      { q: 'Tienes deudas al 15%, 28% y 8% anual. Con el método avalancha, ¿cuál pagas primero?',
        opts: ['La del 8%, porque es la más fácil de cerrar', 'La del 15%, que está al medio', 'La del 28%', 'La que tenga el saldo más alto'], correct: 2,
        feedback: 'Avalancha: primero la de mayor tasa (28%), mientras pagas el mínimo en las demás.' },
      { q: '¿Qué es el método bola de nieve?',
        opts: ['Pagar primero la deuda que tiene la tasa de interés más alta de todas', 'Pagar primero la deuda de menor saldo, para cerrarla rápido', 'Juntar todas las deudas en un solo crédito nuevo', 'Pagar solo las deudas grandes y dejar las chicas'], correct: 1,
        feedback: 'Se paga primero la deuda más chica para cerrarla rápido y ganar motivación; luego esa cuota se suma a la siguiente.' },
      { q: '¿Qué es el DICOM?',
        opts: ['Un crédito del Estado para estudiantes', 'Un registro comercial de deudas impagas que revisan bancos y tiendas', 'Una oficina del SII que revisa las boletas', 'Un seguro obligatorio que paga tu deuda si falleces o quedas sin trabajo'], correct: 1,
        feedback: 'Es el registro comercial de morosidades de Equifax. Aparecer ahí dificulta conseguir créditos, arrendar o incluso algunos trabajos.' },
      { q: 'Una tarjeta cobra 3% mensual. ¿Cuánto es eso al año con interés compuesto?',
        opts: ['3%, porque la tasa es la misma todo el año', '18%, porque se cobra la mitad de los meses', '36% exacto, que es 3% por 12', 'Cerca de 43%'], correct: 3,
        feedback: '(1,03)¹² − 1 ≈ 42,6% al año. Por eso una tasa mensual que parece baja es cara.' },
      { q: '¿Qué es un avance en efectivo?',
        opts: ['Un préstamo caro que se saca retirando dinero con la tarjeta', 'Una compra en cuotas sin interés en un comercio', 'Un descuento que da el banco en tiendas asociadas', 'Un premio en dinero por pagar siempre a tiempo'], correct: 0,
        feedback: 'Es sacar plata con la tarjeta de crédito. Suele tener tasas y comisiones altas, y los intereses corren desde el primer día.' },
      { q: '¿Qué pasa si pagas solo el mínimo de la tarjeta todos los meses?',
        opts: ['La deuda se cierra sola en un año', 'La deuda dura años y pagas mucho más', 'El banco te premia bajándote la tasa', 'Dejas de pagar intereses sobre el saldo'], correct: 1,
        feedback: 'El mínimo cubre poco más que los intereses, así que el saldo baja muy lento y el costo total crece.' },
      { q: '¿Qué es renegociar una deuda?',
        opts: ['Dejar de pagar hasta que el banco ofrezca un descuento', 'Acordar con el acreedor una nueva tasa, plazo o cuota', 'Pasarle la deuda a un familiar con mejor sueldo', 'Pedir otro crédito para pagar el anterior sin avisar'], correct: 1,
        feedback: 'Es pedir nuevas condiciones antes de caer en mora. Si no hay acuerdo, en Chile existe el procedimiento de renegociación de la Superintendencia de Insolvencia y Reemprendimiento.' }
    ]
  },
  inversion: {
    badge: '📈 Inversor Principiante',
    key:   'badge_inversion',
    preguntas: [
      { q: '¿Qué es el APV Régimen A?',
        opts: ['Una tarjeta de crédito con beneficios para jubilados', 'Ahorro para la jubilación con bono estatal de 15%', 'Un seguro médico del Estado para trabajadores', 'Una cuenta corriente sin costo de mantención'], correct: 1,
        feedback: 'En el Régimen A el Estado bonifica el 15% de lo que ahorras, con un tope anual de 6 UTM de bonificación.' },
      { q: '¿Qué es el interés compuesto?',
        opts: ['Un interés que se calcula una sola vez, al final del plazo', 'Que también ganas intereses sobre los intereses ya ganados', 'Un interés que cobran solo las deudas, no los ahorros', 'Un descuento que da el banco por ahorrar más tiempo'], correct: 1,
        feedback: 'Los intereses se suman al capital y la próxima vez generan intereses también. Con los años, el efecto se acelera.' },
      { q: '¿En qué orden conviene empezar?',
        opts: ['Invertir todo lo posible y después ahorrar', 'Fondo de emergencia, deudas caras, invertir', 'Pagar todas las deudas y no invertir nunca', 'Invertir y pagar deudas en partes iguales desde el inicio'], correct: 1,
        feedback: 'Primero un colchón para imprevistos; después eliminar deudas caras, que cuestan más de lo que rinde casi cualquier inversión; recién ahí invertir.' },
      { q: '¿Qué diferencia al APV Régimen A del Régimen B?',
        opts: ['Ninguna: son dos nombres para el mismo ahorro', 'El A da un bono estatal de 15%; el B rebaja la base del impuesto', 'El B es solo para trabajadores independientes que emiten boleta de honorarios', 'El A es solo para personas mayores de 40 años'], correct: 1,
        feedback: 'El A conviene a quienes pagan poco o nada de impuesto a la renta; el B, a quienes están en tramos de impuesto más altos.' },
      { q: '¿Qué es un ETF?',
        opts: ['Una cuenta de ahorro que ofrece el Banco Central', 'Un fondo que copia un índice y se transa en bolsa', 'Un seguro de vida que incluye un ahorro mensual', 'Una moneda digital regulada por la CMF'], correct: 1,
        feedback: 'Un ETF replica un índice, por ejemplo el S&P 500, y se compra y vende como una acción. Permite diversificar con poco dinero.' },
      { q: '¿Qué es el S&P 500?',
        opts: ['Un banco de inversiones chileno con sede en Santiago', 'Un índice de 500 grandes empresas de EE. UU.', 'La tasa de interés que fija la Reserva Federal', 'Un fondo de pensiones de los Estados Unidos'], correct: 1,
        feedback: 'Es un índice bursátil que agrupa a unas 500 de las empresas más grandes que cotizan en Estados Unidos.' },
      { q: 'Inviertes $50.000 al mes durante 30 años al 7% anual. ¿Cuánto tendrías, aproximadamente?',
        opts: ['$18 millones, lo mismo que aportaste', '$30 millones', 'Cerca de $60 millones', '$150 millones, porque el 7% se duplica cada año'], correct: 2,
        feedback: 'Aportas $18 millones en total, pero con interés compuesto llegas a unos $58 a $61 millones. Más de dos tercios son intereses.' },
      { q: '¿Qué es diversificar?',
        opts: ['Poner todo en el activo que más subió el último año, para ganar más rápido', 'Repartir el dinero en varios instrumentos para bajar el riesgo', 'Invertir solo en empresas chilenas conocidas', 'Cambiar de inversión todos los meses para no perder'], correct: 1,
        feedback: 'Repartir reduce el riesgo: si un instrumento cae, los otros amortiguan la pérdida.' },
      { q: '¿Qué es un fondo mutuo de renta fija?',
        opts: ['Un fondo que garantiza la misma ganancia todos los meses, sin ningún riesgo', 'Un fondo que invierte en bonos y depósitos, con menos variación', 'Una cuenta corriente que paga intereses diarios', 'Un fondo al que solo pueden entrar empresas'], correct: 1,
        feedback: 'Invierte en instrumentos de deuda, con menos variación que las acciones. Ojo: no garantiza ganancias, también puede bajar.' },
      { q: '¿Por qué conviene empezar a invertir joven, aunque sea con poco?',
        opts: ['Porque los jóvenes pagan menos impuestos por todas sus inversiones financieras', 'Porque el interés compuesto tiene más años para hacer crecer el dinero', 'Porque las comisiones son menores para menores de 30', 'Porque los bancos dan bonos de bienvenida a los jóvenes'], correct: 1,
        feedback: 'El tiempo es lo que más pesa en el interés compuesto: diez años más de inversión pueden duplicar el resultado final.' }
    ]
  },
  tarjetas: {
    badge: '💳 Experto en Crédito',
    key:   'badge_tarjetas',
    preguntas: [
      { q: '¿Cuándo cobra intereses una tarjeta de crédito en compras normales?',
        opts: ['Siempre, desde el momento de la compra', 'Si no pagas el total facturado a tiempo', 'Solo en compras de más de tres cuotas', 'Nunca, si la tarjeta es de un banco grande'], correct: 1,
        feedback: 'Si pagas el total facturado antes del vencimiento, las compras en una cuota no generan intereses.' },
      { q: '¿Cuál es la mejor forma de usar una tarjeta de crédito?',
        opts: ['Para todo, pagando el mínimo cada mes', 'Como medio de pago, pagando el total facturado', 'Para sacar avances cuando falta plata a fin de mes', 'Solo para compras en el extranjero, nunca en Chile'], correct: 1,
        feedback: 'Usada así es un medio de pago gratis. El problema empieza cuando se arrastra saldo de un mes a otro.' },
      { q: '¿Qué pone el límite legal a las tasas de interés de tarjetas y créditos en Chile?',
        opts: ['Nada: cada banco decide su tasa sin límite', 'La Tasa Máxima Convencional, que publica la CMF cada mes', 'Una tasa única que fija el Banco Central para todos', 'El SERNAC, que aprueba cada crédito antes de que lo firmes en el banco'], correct: 1,
        feedback: 'Ningún crédito puede superar la Tasa Máxima Convencional, que la CMF publica cada mes según el monto y el plazo.' },
      { q: '¿Qué significa "cuotas sin interés del comercio"?',
        opts: ['Que ni el banco ni el comercio cobran nada a nadie', 'Que el comercio le paga ese interés al banco por ti', 'Que el banco te regala los intereses de ese mes', 'Que solo aplica a compras de menos de $50.000'], correct: 1,
        feedback: 'El comercio asume el costo financiero. A veces lo compensa con un precio más alto que si pagaras al contado.' },
      { q: 'Si tienes deuda en la tarjeta, ¿cuál es el primer paso?',
        opts: ['Pedir otro crédito de consumo para pagarla', 'Dejar de usarla y calcular cuánto debes', 'Pagar el mínimo y esperar a que baje sola', 'Pedir un aumento de cupo para tener más margen'], correct: 1,
        feedback: 'Primero hay que frenar el crecimiento de la deuda y saber el monto exacto. Después, un plan de pago.' },
      { q: '¿Qué es el pago mínimo?',
        opts: ['Lo justo para no quedar moroso', 'El monto que cierra toda la deuda en un año', 'Un pago especial que no tiene intereses', 'Siempre la mitad del saldo de la tarjeta'], correct: 0,
        feedback: 'Evita la mora, pero el resto del saldo sigue cobrando intereses.' },
      { q: '¿Por qué un avance en efectivo suele ser una mala idea?',
        opts: ['Porque no se puede pagar en cuotas bajo ninguna forma', 'Porque cobra comisión e intereses desde el día uno', 'Porque baja tu cupo de la tarjeta para siempre', 'Porque se informa al SII como un ingreso tuyo'], correct: 1,
        feedback: 'Es de los créditos más caros: comisión por el giro e intereses desde el día uno.' },
      { q: '¿Para qué sirve activar el pago automático del total de la tarjeta?',
        opts: ['Para no pagar intereses por olvidar la fecha de pago', 'Para que el banco te baje la comisión de mantención', 'Para bloquear las compras en sitios extranjeros', 'Para que el banco te suba el cupo cada año'], correct: 0,
        feedback: 'El banco descuenta el total facturado de tu cuenta al vencimiento. Así no hay olvidos ni intereses, siempre que tengas saldo.' },
      { q: '¿Qué es el CTC (Costo Total del Crédito)?',
        opts: ['La tasa de interés mensual que te cobran', 'Todo lo que pagas: capital, intereses y gastos', 'El número de cuotas que te quedan por pagar', 'La tasa anual del crédito, sin contar impuestos'], correct: 1,
        feedback: 'Aparece en la Hoja Resumen. Junto con la CAE, es lo que hay que comparar entre ofertas.' },
      { q: '¿Cuál de estas opciones es la más cara?',
        opts: ['Comprar en cuotas sin interés del comercio', 'Pagar el total facturado al vencimiento', 'Un avance en efectivo', 'Comprar en tres cuotas con interés del banco'], correct: 2,
        feedback: 'El avance suma comisión de giro e intereses desde el primer día.' }
    ]
  },
  presupuesto_tip: {
    badge: '📊 Maestro del Presupuesto',
    key:   'badge_presupuesto',
    preguntas: [
      { q: '¿En qué consiste la regla 50/30/20?',
        opts: ['50% inversión, 30% gastos, 20% deudas', '50% necesidades, 30% deseos, 20% ahorro', '50% ahorro, 30% comida, 20% ocio', '50% deudas, 30% ropa, 20% comida'], correct: 1,
        feedback: 'Hasta 50% del ingreso en necesidades, hasta 30% en deseos y al menos 20% para ahorro o pago de deudas.' },
      { q: '¿Por qué fracasan muchos presupuestos?',
        opts: ['Porque son demasiado rígidos y no dejan margen para imprevistos', 'Porque el dinero nunca alcanza para lo que se planea', 'Porque los bancos no entregan la información necesaria', 'Porque requieren conocimientos de contabilidad'], correct: 0,
        feedback: 'Un presupuesto sin espacio para imprevistos o gustos se abandona al primer mes. Conviene dejar una categoría flexible.' },
      { q: 'Ganas $900.000 líquidos. ¿Cuánto va a ahorro y deudas según la regla 50/30/20?',
        opts: ['$90.000', '$150.000', '$180.000', '$270.000'], correct: 2,
        feedback: '$900.000 × 20% = $180.000 al mes.' },
      { q: '¿Cuál de estos es una "necesidad"?',
        opts: ['Las suscripciones de streaming y música', 'Arriendo y comida', 'Salir a comer con amigos el fin de semana', 'Renovar la ropa con cada temporada'], correct: 1,
        feedback: 'Necesidades son los gastos sin los que no puedes vivir o trabajar: vivienda, comida, transporte, salud.' },
      { q: '¿Qué es un gasto hormiga?',
        opts: ['Lo que se gasta en el supermercado cada semana', 'Compras chicas y frecuentes que suman mucho', 'El impuesto que descuenta el empleador del sueldo', 'Una cuota de crédito de monto muy pequeño'], correct: 1,
        feedback: 'Un café, un snack, un delivery: cada uno es poco, pero juntos pueden ser una parte importante del mes.' },
      { q: 'Con ingresos variables, ¿con qué ingreso conviene armar el presupuesto?',
        opts: ['Con el mes más alto del año, para no limitarse', 'Con el promedio del año, que equilibra los meses', 'Con el mes más bajo', 'Con el sueldo mínimo, sin importar lo que ganes'], correct: 2,
        feedback: 'Si presupuestas con el mes más bajo, los meses buenos dejan excedente para ahorrar en vez de cubrir un hoyo.' },
      { q: 'Tus cuotas suman $360.000 y ganas $900.000. ¿Qué parte de tu ingreso se va en deudas?',
        opts: ['25%', '40%', '36%', '60%'], correct: 1,
        feedback: '$360.000 ÷ $900.000 = 40%. Es una carga financiera alta: deja poco margen para imprevistos.' },
      { q: '¿Cuál de estos es un "deseo"?',
        opts: ['El arriendo del departamento', 'La cuenta de luz y agua del mes', 'Streaming y salidas', 'El plan de salud obligatorio'], correct: 2,
        feedback: 'Los deseos hacen la vida más agradable, pero se pueden recortar si hace falta.' },
      { q: '¿Qué conviene hacer cuando una categoría se pasa del presupuesto?',
        opts: ['Ignorarlo y revisar recién a fin de mes', 'Compensar con otra categoría o ajustar el plan', 'Cubrir la diferencia con un avance en efectivo', 'Borrar el presupuesto porque ya no sirve'], correct: 1,
        feedback: 'El presupuesto es un plan vivo: si una categoría se pasa, se compensa con otra o se corrige el monto para el mes siguiente.' },
      { q: '¿Cada cuánto conviene revisar el presupuesto?',
        opts: ['Una vez al año, al hacer la declaración de renta', 'Solo cuando aparece un problema de plata', 'Una vez por semana', 'Solo en enero, cuando se arma el del año'], correct: 2,
        feedback: 'Una revisión corta cada semana permite corregir antes de que el mes se descuadre.' }
    ]
  },
  habitos: {
    badge: '🧠 Psicólogo Financiero',
    key:   'badge_habitos',
    preguntas: [
      { q: '¿Qué es el sesgo del presente?',
        opts: ['Preferir gastar hoy antes que ahorrar para el futuro', 'Comprar solo lo que está en oferta esta semana', 'Revisar la cuenta del banco todos los días', 'Comparar precios en varias tiendas antes de comprar'], correct: 0,
        feedback: 'Le damos más valor a lo de hoy que a lo de mañana, aunque mañana valga más. Por eso cuesta ahorrar.' },
      { q: 'Según el estudio de Lally y colegas (University College London, 2010), ¿cuánto tarda en promedio en formarse un hábito?',
        opts: ['7 días, si se repite cada mañana', '21 días, el tiempo que tarda el cerebro en adaptarse', 'Unos 66 días', 'Un año completo de práctica sin interrupciones'], correct: 2,
        feedback: 'El estudio de Lally y su equipo encontró un promedio de 66 días, con mucha variación entre personas. Los "21 días" son un mito.' },
      { q: '¿En qué consiste la regla de las 48 horas?',
        opts: ['Esperar 2 días antes de una compra no planeada', 'Ir al banco cada 48 horas a revisar los movimientos', 'Revisar el presupuesto completo cada dos días', 'Ahorrar todo lo que se gane los dos primeros días'], correct: 0,
        feedback: 'Si después de dos días todavía lo quieres y cabe en el presupuesto, la compra es pensada, no impulsiva.' },
      { q: '¿Qué significa vivir bajo tus posibilidades?',
        opts: ['Ganar bastante más de lo que necesitas para vivir', 'Gastar de forma constante menos de lo que ganas', 'No tener ninguna tarjeta de crédito a tu nombre', 'No deberle nada a nadie, ni siquiera un dividendo'], correct: 1,
        feedback: 'La diferencia entre lo que ganas y lo que gastas es lo que permite ahorrar e invertir.' },
      { q: '¿Cuál es un ejemplo de automatización financiera?',
        opts: ['Anotar cada gasto en una aplicación del celular', 'Una transferencia automática al ahorro el día de pago', 'Revisar la cartola del banco una vez al mes', 'Pagar todo con tarjeta en lugar de efectivo'], correct: 1,
        feedback: 'Automatizar es que el ahorro ocurra solo, sin que tengas que decidirlo cada mes.' },
      { q: '¿Qué complica más el ahorro, según la psicología del consumo?',
        opts: ['Los impuestos que se descuentan del sueldo', 'Las compras impulsivas', 'Las tasas de interés de los bancos', 'Que los sueldos se paguen una vez al mes'], correct: 1,
        feedback: 'Las compras no planificadas son las que más desordenan el presupuesto, porque no se ven venir.' },
      { q: '¿Qué es una meta SMART?',
        opts: ['Una meta pensada solo para personas de ingresos altos y estables', 'Específica, medible, alcanzable, relevante y con plazo', 'Una meta que fija un asesor financiero certificado', 'Una meta de largo plazo, de al menos cinco años'], correct: 1,
        feedback: '"Ahorrar $600.000 para diciembre de 2027" es SMART. "Ahorrar más" no lo es.' },
      { q: '¿Por qué ayuda anotar los gastos aunque sea por un mes?',
        opts: ['Porque el banco lo exige para dar créditos', 'Porque muestra en qué se va de verdad la plata', 'Porque permite pagar menos impuesto a la renta', 'Porque sube automáticamente el puntaje crediticio'], correct: 1,
        feedback: 'La mayoría subestima sus gastos chicos. Anotarlos muestra dónde recortar sin adivinar.' },
      { q: '¿Para qué sirven las notificaciones de gasto del banco?',
        opts: ['Para que el banco te baje la tasa de la tarjeta', 'Para ver cada cargo al momento', 'Para subir el cupo disponible de la tarjeta', 'Para no tener que hacer un presupuesto mensual'], correct: 1,
        feedback: 'Te avisan de cada cargo apenas ocurre. Así detectas gastos que no esperabas, cobros duplicados o fraudes, pero no reemplazan al presupuesto.' },
      { q: 'Compras un auto con un crédito. ¿Qué es el activo y qué es el pasivo?',
        opts: ['El auto es el activo y el crédito es el pasivo', 'Los dos son pasivos, porque ambos cuestan plata', 'El crédito es el activo, porque te dio dinero', 'El auto es el pasivo y el crédito es el activo del banco'], correct: 0,
        feedback: 'Un activo es lo que tienes y vale dinero (el auto, aunque pierda valor con los años); un pasivo es lo que debes (el crédito). Tu patrimonio es la diferencia entre ambos.' }
    ]
  }
};

/* Antes, en 58 de 60 preguntas la correcta era la B o la C, cada
   respuesta mostraba la correcta al instante y el reintento era
   inmediato: el segundo intento siempre daba 10/10. Ahora el orden de
   las opciones se baraja en cada intento, la corrección se ve recién al
   final y, si no apruebas, hay que esperar un minuto para reintentar. */
const QUIZ_ESPERA_MS = 60 * 1000;
let quizState = { module: null, step: 0, correct: 0, orden: [], respuestas: [] };

/** Mezcla Fisher-Yates; devuelve un arreglo nuevo. */
function barajar(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function quizEsperaRestante(key) {
  try {
    const hasta = parseInt(localStorage.getItem('sf_quiz_espera_' + key), 10) || 0;
    return Math.max(0, hasta - Date.now());
  } catch(e) { return 0; }
}

function startQuiz() {
  const key    = quizState.module;
  const data   = quizData[key];
  if (!data) return;
  const espera = quizEsperaRestante(key);
  if (espera > 0) {
    $('quiz-container').style.display = 'block';
    $('quiz-container').innerHTML = `<div class="quiz-wrap"><div style="font-size:14px">⏳ Podrás reintentar en ${Math.ceil(espera / 1000)} segundos. Aprovecha de releer el módulo.</div></div>`;
    return;
  }
  quizState.step       = 0;
  quizState.correct    = 0;
  quizState.respuestas = [];
  quizState.orden      = data.preguntas.map(q => barajar(q.opts.map((_, i) => i)));
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
        ${quizState.orden[step].map(i => `
          <button class="quiz-opt" data-opt="${i}" onclick="answerQuiz(${i},${step})">${q.opts[i]}</button>
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
  opts.forEach(btn => {
    btn.disabled = true;
    if (parseInt(btn.dataset.opt, 10) === chosen) btn.classList.add('selected');
  });
  quizState.respuestas[step] = chosen;
  if (chosen === q.correct) quizState.correct++;
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
    // Corrección al final. Si apruebas, ves la respuesta y la explicación
    // de lo que fallaste. Si no, solo qué preguntas fallaste: antes se
    // mostraban las correctas y el reintento salía 10/10 sin releer.
    const errores = data.preguntas
      .map((q, i) => ({ q, elegida: quizState.respuestas[i] }))
      .filter(r => r.elegida !== r.q.correct);
    const repaso = errores.length === 0 ? '' : !passed ? `
      <div class="quiz-wrap" style="margin-top:.75rem">
        <div style="font-weight:700;margin-bottom:.5rem">Preguntas que fallaste (relee el módulo antes de reintentar)</div>
        <ul style="margin:0;padding-left:1.1rem;font-size:13px;line-height:1.6">${errores.map(r => `<li>${r.q.q}</li>`).join('')}</ul>
      </div>` : `
      <div class="quiz-wrap" style="margin-top:.75rem">
        <div style="font-weight:700;margin-bottom:.5rem">Repasa las que fallaste</div>
        ${errores.map(r => `
          <div style="padding:.6rem 0;border-top:1px solid var(--line);font-size:13px">
            <div style="font-weight:600">${r.q.q}</div>
            <div style="color:var(--red-500)">Tu respuesta: ${r.q.opts[r.elegida]}</div>
            <div style="color:var(--green-600)">Correcta: ${r.q.opts[r.q.correct]}</div>
            <div style="color:var(--ink-3)">${r.q.feedback}</div>
          </div>`).join('')}
      </div>`;
    if (!passed) {
      try { localStorage.setItem('sf_quiz_espera_' + key, String(Date.now() + QUIZ_ESPERA_MS)); } catch(e) {}
    }
    if (passed && !earnedBadges.includes(data.key)) {
      earnBadge(data.key, data.badge);
      con.innerHTML = `
        <div class="badge-earned">
          <div class="badge-earned-icon">${data.badge.split(' ')[0]}</div>
          <div>
            <div style="font-family:var(--ff-head);font-size:16px;font-weight:700;margin-bottom:3px">¡${data.badge} desbloqueado!</div>
            <div style="font-size:13px;color:var(--muted)">Respondiste ${correct}/${total} correctamente. Queda en tus logros de aprendizaje; tu Score Financiero no cambia, porque mide tus finanzas.</div>
          </div>
        </div>${repaso}`;
    } else if (passed) {
      con.innerHTML = `<div class="quiz-wrap"><div style="color:var(--green-600);font-weight:600">✅ ${correct}/${total} correctas — Ya habías ganado este emblema.</div></div>${repaso}`;
    } else {
      con.innerHTML = `<div class="quiz-wrap">
        <div style="font-size:14px;margin-bottom:.75rem">❌ ${correct}/${total} correctas. Necesitas 7/10 para ganar el emblema. Relee el módulo: podrás reintentar en un minuto.</div>
        <button class="btn btn-outline btn-sm" onclick="startQuiz()">🔁 Reintentar</button>
      </div>${repaso}`;
    }
  }
}

function earnBadge(key, label) {
  earnedBadges.push(key);
  try { localStorage.setItem(LS.badges, JSON.stringify(earnedBadges)); } catch(e) {}
  renderLogros();
}

/** Panel "Tus logros" de Aprender. Antes se guardaban pero no se mostraban. */
function renderLogros() {
  const cont = $('badges-display');
  if (!cont) return;
  const ganados = Object.values(quizData).filter(d => earnedBadges.includes(d.key));
  cont.innerHTML = ganados.length
    ? ganados.map(d => `<span class="logro">${d.badge}</span>`).join('')
    : '<span class="mov-meta">Aprueba un quiz con 7 de 10 o más para ganar tu primer logro.</span>';
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

  // Cálculo paso a paso. Desde la Ley 21.713 (25/10/2025), las compras
  // de hasta USD 500 pagan solo IVA; sobre USD 500 rige el régimen
  // general, con arancel de 6% sobre el CIF más IVA.
  const P        = PARAMS_CL.importacion;
  const comercial = !!$('imp-comercial')?.checked;
  const { cifCLP, arancel, baseIVA, iva, total, bajoUmbral } = costoImportacion(fob, flete, tc, comercial);

  const steps = [
    { label:'Valor FOB del producto',       val: fob * tc,  note:'USD ' + fob + ' × $' + Math.round(tc).toLocaleString('es-CL') },
    { label:'+ Flete internacional',         val: flete * tc, note:'USD ' + flete + ' × tipo de cambio' },
    { label:'= Valor CIF (base aduanera)',   val: cifCLP,    note:'Costo + Seguro + Flete', highlight:true },
    { label: bajoUmbral ? '+ Arancel (no aplica)' : '+ Arancel (6% del CIF)', val: arancel,
      note: bajoUmbral ? 'Uso personal hasta USD 500: sin arancel' : comercial ? 'Importación para vender: régimen general. Con TLC y certificado de origen puede ser 0%' : 'Sobre USD 500. Con TLC y certificado de origen puede ser 0%' },
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
  // Misma regla y mismos insumos que la pantalla, para que la ficha
  // impresa nunca diga un número distinto al del panel.
  const _s        = calcularScore();
  const ing       = _s.ing;
  const deu       = _s.deu;
  const totReal   = _s.gasReal;
  const ahorro    = Math.max(_s.ing - _s.gasReal, 0);
  const pdfScore  = _s.score;
  const scoreLabel = _s.label;
  const scoreColor = _s.colorImpreso;   // variante oscura, va sobre papel blanco

  const filasPDF  = filasDelMes();
  const totPresup = filasPDF.reduce((s, r) => s + (r.presup || 0), 0);
  const mes       = nombreMes(claveMesActual());
  const hoy       = new Date().toLocaleDateString('es-CL');
  const ahorroAnualPDF = ahorro * 12;

  // Recomendación de inversión
  const recomendacion = _s.proxima
    ? `Próxima acción: ${_s.proxima.subir}`
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
  const filas = filasPDF.map((r, i) => {
    const diff    = r.real - r.presup;
    const rowBg   = i % 2 === 0 ? '#ffffff' : '#f9fafb';
    const diffCol = diff > 0 ? '#dc2626' : diff < 0 ? '#059669' : '#6b7280';
    return `<tr style="background:${rowBg}">
      <td style="padding:6px 9px;border-bottom:1px solid #e5e7eb;font-size:11.5px">${catConfig[r.cat]?.label || 'Otro'}</td>
      <td style="padding:6px 9px;border-bottom:1px solid #e5e7eb;font-size:11.5px;color:#6b7280">${esc(r.desc)}</td>
      <td style="padding:6px 9px;border-bottom:1px solid #e5e7eb;font-size:11.5px;text-align:right">${fmt(r.presup)}</td>
      <td style="padding:6px 9px;border-bottom:1px solid #e5e7eb;font-size:11.5px;text-align:right">${fmt(r.real)}</td>
      <td style="padding:6px 9px;border-bottom:1px solid #e5e7eb;font-size:11.5px;text-align:right;color:${diffCol};font-weight:600">${(diff>0?'+':'')+fmt(diff)}</td>
    </tr>`;
  }).join('');

  // Barras
  const catMap = {};
  filasPDF.forEach(r => {
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
        <div style="font-size:11px;color:#6b7280">Reporte mensual: ${mes} · Generado: ${hoy} · Badges: ${badgeList}</div>
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
            <th scope="col" style="padding:7px 9px;text-align:left;font-size:10.5px;font-weight:600">Categoría</th>
            <th scope="col" style="padding:7px 9px;text-align:left;font-size:10.5px;font-weight:600">Descripción</th>
            <th scope="col" style="padding:7px 9px;text-align:right;font-size:10.5px;font-weight:600">Presupuesto</th>
            <th scope="col" style="padding:7px 9px;text-align:right;font-size:10.5px;font-weight:600">Real</th>
            <th scope="col" style="padding:7px 9px;text-align:right;font-size:10.5px;font-weight:600">Dif.</th>
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
    filename    : `ficha-clinica-${claveMesActual()}.pdf`,
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

    await cargarScript('https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js');
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
    '💡 <strong>¿Qué significan estos números?</strong> El monto bruto es lo que indicas en la boleta. El SII retiene el ' + pctCL(PARAMS_CL.retencionHonorarios.valor) + ' y deposita solo el líquido en tu cuenta. Siempre cobra más de lo que quieres recibir.');
  insertExpl('iva-results',
    '💡 <strong>¿Qué significan estos números?</strong> El IVA lo cobras al cliente, pero lo debes declarar al SII a fin de mes — no es ganancia tuya. Tu utilidad real es solo lo que queda tras descontar el costo del producto y la comisión de la pasarela.');
  insertExpl('imp-insight',
    '💡 <strong>¿Qué es el costo real en puerta?</strong> Es lo que pagas realmente para tener el producto en Chile: precio del proveedor + flete + IVA (19%), y sobre USD 500 también el arancel general (6% del CIF). Usa esta cifra como base para calcular tu precio de venta.');

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
    `Calculadora SII — Boleta de Honorarios\nBruto a cobrar: ${$('sii-bruto').textContent}\nRetención SII ${pctCL(PARAMS_CL.retencionHonorarios.valor)}: ${$('sii-retencion').textContent}\nLíquido a recibir: ${$('sii-liquido-out').textContent}`
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

/* ------------------------------------------------------------------
   Estado de deudas y ofertas
   Se declara ACÁ, y no junto a sus funciones más abajo, porque el
   bloque de inicialización que sigue llama a loadDebts() y
   loadOfertas(), y let/const no se izan: leerlas antes de su
   declaración lanza ReferenceError por la temporal dead zone. Eso
   abortaba la inicialización completa y dejaba sin registrar los
   listeners de load, resize y scroll que vienen más abajo.
   (Por eso _debtChart, unas líneas más abajo, estaba declarado con
   var: es el mismo problema, parchado a medias en su momento.)
   ------------------------------------------------------------------ */
let debtRows   = [];
let _debtId    = 0;
let ofertaRows = [];
let _ofertaId  = 0;

// FEAT E: Renderizar vencimientos con datos cargados
renderVenc();

// Renderizar dashboard (lee de budgetRows recién cargados)
dashUpdate();

// Mostrar el aviso si lo cargado es el presupuesto de ejemplo
actualizarAvisoEjemplo();

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
    desc : 'Ingresos, gastos, deudas y lo que te queda. Se calculan con tus Movimientos y tu Plan del mes.'
  },
  {
    sel  : () => innerWidth >= 1024 ? '.app-nav' : '.tabbar',
    title: '🧭 Navegación',
    desc : 'Cinco destinos: Inicio (tu panel), Movimientos (anotar gastos e ingresos), Plan (presupuesto, metas y vencimientos), Aprender (lecciones y quizzes) y Herramientas (créditos, sueldo, inversiones, emprender y ¿qué pasa si?).'
  },
  {
    sel  : '#score-factors',
    title: '📈 Factores del Score',
    desc : 'Tu puntaje suma cinco indicadores: tasa de ahorro, carga financiera, fondo de emergencia, deuda cara y presupuesto cumplido. Cada uno dice por qué tiene ese puntaje y cómo subirlo.'
  }
];
let _tourIdx = 0;
let _tourHL  = null;

function startTour() {
  navigate('dashboard');
  _tourIdx = 0;
  document.getElementById('tour-overlay').classList.add('active');
  _showTourStep(_tourIdx);
}

function _showTourStep(i) {
  const step   = _tourSteps[i];
  const target = document.querySelector(typeof step.sel === 'function' ? step.sel() : step.sel);

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
// debtRows y _debtId se declaran junto al bloque de inicialización,
// más arriba: loadDebts() los usa y corre antes que esta línea.
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
  tbody.innerHTML = debtRows.map((d, i) => `
    <tr>
      <td><input class="f-input" style="min-width:130px" value="${esc(d.nombre)}"
          aria-label="Nombre de la deuda ${i + 1}" onchange="updateDebtField(${d.id},'nombre',this.value)"></td>
      <td><input class="f-input" type="number" style="min-width:110px" value="${d.saldo}" min="0"
          aria-label="Saldo de ${esc(d.nombre)}" onchange="updateDebtField(${d.id},'saldo',+this.value)"></td>
      <td><input class="f-input" type="number" style="min-width:80px" value="${d.tasa}" min="0" max="30" step="0.1"
          aria-label="Tasa mensual de ${esc(d.nombre)}" onchange="updateDebtField(${d.id},'tasa',+this.value)"></td>
      <td><input class="f-input" type="number" style="min-width:110px" value="${d.pagMin}" min="0"
          aria-label="Pago mínimo de ${esc(d.nombre)}" onchange="updateDebtField(${d.id},'pagMin',+this.value)"></td>
      <td><button class="btn btn-sm" style="background:var(--red-500);color:#fff;border:none;padding:3px 8px"
          onclick="removeDebtRow(${d.id})" aria-label="Eliminar la deuda ${esc(d.nombre)}">✕</button></td>
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
      <div class="debt-strat-num">${res.meses >= 720 ? 'Nunca' : res.meses}</div>
      <div style="font-size:11px;color:var(--muted);margin:.2rem 0 .6rem">meses para quedar libre de deudas</div>
      <div style="font-size:13px;color:var(--ink-3)">Intereses pagados:</div>
      <div style="font-size:17px;font-weight:700;color:var(--red-500)">${fmt(res.totalIntereses)}</div>`;
  };
  renderCard('debt-snow-result', snow);
  renderCard('debt-ava-result',  ava);
  // Si el pago mínimo no cubre los intereses, la simulación llega al
  // tope de 720 meses: no es un plazo, es una deuda que no se paga.
  const impagables = debtRows.filter(d => d.pagMin <= d.saldo * d.tasa / 100);
  const avisoDeuda = $('debt-aviso');
  if (avisoDeuda) {
    avisoDeuda.style.display = impagables.length || snow.meses >= 720 ? 'flex' : 'none';
    avisoDeuda.innerHTML = `<span class="alert-icon">⚠️</span><div><strong>${impagables.length ? impagables.map(d => esc(d.nombre)).join(', ') : 'Alguna deuda'} no se termina de pagar con ese pago mensual:</strong> el pago no alcanza a cubrir los intereses del mes. Hay que pagar más o renegociar.</div>`;
  }

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
      // Antes se precargaban tres deudas inventadas, y al agregar una real
      // pasaban a contar como del usuario (la deuda total saltaba de $0 a
      // $2,9 millones). Si lo guardado es ese ejemplo, se borra.
      if (deudasSonEjemplo()) { debtRows = []; _debtId = 0; saveDebts(); }
    } else {
      debtRows = [];
    }
    try { localStorage.removeItem(LS.debtsEj); } catch(e) {}
  } catch(e) { debtRows = []; }
  renderDebtTable();
}

/* ============================================================
   COMPARADOR DE OFERTAS DE CRÉDITO
   ============================================================ */
// ofertaRows y _ofertaId se declaran junto al bloque de inicialización,
// más arriba: loadOfertas() los usa y corre antes que esta línea.

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
          <input class="f-input" aria-label="Banco o institución de la oferta ${o.id}" value="${esc(o.banco)}" onchange="updateOfertaField(${o.id},'banco',this.value)">
        </div>
        <div class="f-group">
          <label class="f-label">Monto del crédito ($)</label>
          <input class="f-input" aria-label="Monto del crédito ($)" type="number" value="${o.monto}" min="0"
              onchange="updateOfertaField(${o.id},'monto',+this.value)">
        </div>
        <div class="f-group">
          <label class="f-label">Tasa de interés mensual (%)</label>
          <input class="f-input" aria-label="Tasa de interés mensual (%)" type="number" value="${o.tasa}" min="0" max="30" step="0.1"
              onchange="updateOfertaField(${o.id},'tasa',+this.value)">
        </div>
        <div class="f-group">
          <label class="f-label">Plazo (meses)</label>
          <input class="f-input" aria-label="Plazo (meses)" type="number" value="${o.plazo}" min="1" max="360"
              onchange="updateOfertaField(${o.id},'plazo',+this.value)">
        </div>
        <div class="f-group">
          <label class="f-label">Comisiones / gastos ($) <span style="font-size:11px;font-weight:400;color:var(--muted)">opcional</span></label>
          <input class="f-input" aria-label="Comisiones y gastos (opcional)" type="number" value="${o.comision}" min="0"
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
    let why = `<strong>${esc(best.o.banco)}</strong> es la mejor oferta con un costo total de ${fmt(best.c.costoTotal)} y CAE de ${best.c.cae.toFixed(2)}%.`;
    if (calcs.length > 1) why += ` Te ahorra <strong>${fmt(worst.c.costoTotal - best.c.costoTotal)}</strong> respecto a la más cara (${esc(worst.o.banco)}).`;
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
        <td style="text-align:left;font-weight:${best?700:400};color:${best?'var(--green-700)':'inherit'}">${esc(o.banco)}</td>
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
/* ============================================================
   MI SUELDO — Liquidación explicada y precio en horas de vida
   ============================================================ */

/* Parámetros legales chilenos. OJO: cambian todos los años, y las
   comisiones de AFP cambian cuando una administradora las ajusta.
   Están todos acá juntos justamente para que actualizarlos sea
   editar un solo bloque. Valores referenciales 2026. */
const PARAMS_SUELDO = {
  afpObligatorio : 0.10,     // cotización obligatoria
  saludFonasa    : 0.07,     // 7% legal
  cesantia       : 0.006,    // AFC trabajador, contrato indefinido
  topeImponibleUF: PARAMS_CL.topeImponibleUF.valor,   // tope AFP y salud
  topeCesantiaUF : PARAMS_CL.topeCesantiaUF.valor,    // tope seguro de cesantía
  // Comisión que cobra cada AFP, sobre la renta imponible
  afps: [
    { nombre: 'AFP Uno',       comision: 0.0046 },
    { nombre: 'AFP Modelo',    comision: 0.0058 },
    { nombre: 'AFP PlanVital', comision: 0.0116 },
    { nombre: 'AFP Habitat',   comision: 0.0127 },
    { nombre: 'AFP Capital',   comision: 0.0144 },
    { nombre: 'AFP Cuprum',    comision: 0.0144 },
    { nombre: 'AFP Provida',   comision: 0.0145 },
  ],
  // Comisiones vigentes a junio de 2026 según la Superintendencia de
  // Pensiones; pueden cambiar con 30 días de aviso (rebaja) o 90 (alza).
  /* Impuesto único de segunda categoría. Los tramos se expresan en UTM
     y el impuesto se calcula como base × factor − rebaja. */
  tramos: [
    { desdeUTM:   0,   hastaUTM:  13.5, factor: 0,      rebajaUTM:  0     },
    { desdeUTM:  13.5, hastaUTM:  30,   factor: 0.04,   rebajaUTM:  0.54  },
    { desdeUTM:  30,   hastaUTM:  50,   factor: 0.08,   rebajaUTM:  1.74  },
    { desdeUTM:  50,   hastaUTM:  70,   factor: 0.135,  rebajaUTM:  4.49  },
    { desdeUTM:  70,   hastaUTM:  90,   factor: 0.23,   rebajaUTM: 11.14  },
    { desdeUTM:  90,   hastaUTM: 120,   factor: 0.304,  rebajaUTM: 17.80  },
    { desdeUTM: 120,   hastaUTM: 310,   factor: 0.35,   rebajaUTM: 23.32  },
    { desdeUTM: 310,   hastaUTM: Infinity, factor: 0.40, rebajaUTM: 38.82 },
  ]
};

/**
 * Calcula la liquidación a partir del sueldo bruto imponible.
 * Devuelve cada descuento por separado para poder explicarlo, que es
 * el punto: no basta con dar el líquido.
 */
function calcularLiquidacion(bruto, comisionAfp, saludPct) {
  const P = PARAMS_SUELDO;
  const topeImp = P.topeImponibleUF * indUF;
  const topeAfc = P.topeCesantiaUF  * indUF;

  // Las cotizaciones se calculan sobre la renta imponible topada
  const imponible    = Math.min(bruto, topeImp);
  const imponibleAfc = Math.min(bruto, topeAfc);

  const afp      = imponible * P.afpObligatorio;
  const comision = imponible * comisionAfp;
  const salud    = imponible * saludPct;
  const afc      = imponibleAfc * P.cesantia;

  // Base tributable: bruto menos cotizaciones previsionales. La comisión
  // de la AFP también se rebaja; de la salud, solo el 7% legal (un plan
  // de isapre más caro no rebaja más impuesto).
  const saludRebaja = Math.min(salud, imponible * P.saludFonasa);
  const baseTributable = bruto - afp - comision - saludRebaja - afc;
  const baseUTM = indUTM > 0 ? baseTributable / indUTM : 0;

  const tramo = P.tramos.find(t => baseUTM > t.desdeUTM && baseUTM <= t.hastaUTM) || P.tramos[0];
  const impuesto = Math.max(0, baseTributable * tramo.factor - tramo.rebajaUTM * indUTM);

  const totalDesc = afp + comision + salud + afc + impuesto;
  return {
    bruto, imponible, afp, comision, salud, afc, impuesto,
    baseTributable, baseUTM, tramo, totalDesc,
    liquido: bruto - totalDesc,
    topado : bruto > topeImp,
    pctDesc: bruto > 0 ? (totalDesc / bruto) * 100 : 0
  };
}

function sueldoCalc() {
  const bruto = parseFloat($('sue-bruto')?.value) || 0;
  const comi  = parseFloat($('sue-afp')?.value)   || 0;
  const salud = (parseFloat($('sue-salud')?.value) || 7) / 100;
  const cont  = $('sue-resultado');
  if (!cont) return;

  if (bruto <= 0) {
    cont.innerHTML = `<div class="sue-vacio">Ingresa tu sueldo bruto para ver el desglose.</div>`;
    _sueldoLiquido = 0;
    horasCalc();
    return;
  }

  const r = calcularLiquidacion(bruto, comi, salud);
  _sueldoLiquido = r.liquido;

  const fila = (icono, etiqueta, monto, detalle, clase) => `
    <div class="sue-fila ${clase || ''}">
      <div class="sue-fila-ico" aria-hidden="true">${icono}</div>
      <div class="sue-fila-txt">
        <div class="sue-fila-lbl">${etiqueta}</div>
        <div class="sue-fila-det">${detalle}</div>
      </div>
      <div class="sue-fila-monto">−${fmt(Math.round(monto))}</div>
    </div>`;

  cont.innerHTML = `
    <div class="sue-bruto-row">
      <span>Sueldo bruto</span><strong>${fmt(Math.round(r.bruto))}</strong>
    </div>
    ${r.topado ? `<div class="f-hint" style="margin:-4px 0 10px">
       Tu sueldo supera el tope imponible de ${PARAMS_SUELDO.topeImponibleUF} UF
       (${fmt(Math.round(PARAMS_SUELDO.topeImponibleUF * indUF))}). Las cotizaciones
       se calculan solo hasta ese tope.</div>` : ''}

    ${fila('🏦', 'AFP — cotización obligatoria', r.afp,
           `10% de tu renta imponible. Va a tu cuenta individual: es tuyo, no es un impuesto.`)}
    ${fila('💼', 'AFP — comisión', r.comision,
           `Lo que cobra la administradora por gestionar tu fondo. Es lo único que cambia entre AFP.`)}
    ${fila('🏥', 'Salud', r.salud,
           `${(salud*100).toFixed(1)}% de tu renta imponible.`)}
    ${fila('🛟', 'Seguro de cesantía', r.afc,
           `0,6% si tienes contrato indefinido. Tu empleador aporta otro 2,4%.`)}
    ${fila('🧾', 'Impuesto único de segunda categoría', r.impuesto,
           r.impuesto <= 0
             ? `Tu base tributable son ${r.baseUTM.toFixed(1)} UTM, bajo las 13,5 UTM exentas. No pagas impuesto.`
             : `Tramo de ${r.tramo.desdeUTM} a ${r.tramo.hastaUTM === Infinity ? '∞' : r.tramo.hastaUTM} UTM:
                ${(r.tramo.factor*100).toFixed(1)}% menos una rebaja de ${fmt(Math.round(r.tramo.rebajaUTM * indUTM))}.`,
           'sue-impuesto')}

    <div class="sue-liquido">
      <div>
        <div class="sue-liquido-lbl">Esto es lo que te llega</div>
        <div class="sue-liquido-sub">Te descuentan ${r.pctDesc.toFixed(1)}% del bruto</div>
      </div>
      <div class="sue-liquido-monto">${fmt(Math.round(r.liquido))}</div>
    </div>`;

  horasCalc();
}

/* ── Precio en horas de trabajo ───────────────────────────────
   La jornada legal sale de PARAMS_CL: 42 horas desde el 26 de abril
   de 2026 (ley 21.561), 40 en abril de 2028. */
let _sueldoLiquido = 0;

function horasCalc() {
  const precio  = parseFloat($('hrs-precio')?.value) || 0;
  const jornada = parseFloat($('hrs-jornada')?.value) || PARAMS_CL.jornadaSemanal.valor;
  const cont    = $('hrs-resultado');
  if (!cont) return;

  // Si no hay liquidación calculada, usar el ingreso del Presupuesto
  const ingreso = _sueldoLiquido > 0
    ? _sueldoLiquido
    : ingresoDelMes(mesHoy());

  if (ingreso <= 0 || precio <= 0) {
    cont.innerHTML = `<div class="sue-vacio">${
      ingreso <= 0
        ? 'Calcula tu líquido arriba, o anota tu sueldo en Movimientos.'
        : 'Ingresa el precio de algo para verlo en horas de tu vida.'
    }</div>`;
    return;
  }

  const horasMes  = jornada * 52 / 12;          // semanas al año / meses
  const valorHora = ingreso / horasMes;
  const horas     = precio / valorHora;
  const jornadas  = horas / (jornada / 5);      // días de trabajo

  cont.innerHTML = `
    <div class="hrs-resultado-box">
      <div class="hrs-grande">${horas < 1 ? horas.toFixed(1) : Math.round(horas)} <span>horas</span></div>
      <div class="hrs-sub">
        de tu trabajo. Son <strong>${jornadas < 1 ? jornadas.toFixed(1) : Math.round(jornadas)} jornadas</strong>
        completas, a ${fmt(Math.round(valorHora))} la hora.
      </div>
    </div>
    <div class="f-hint">
      Calculado sobre tu líquido y una jornada de ${jornada} horas semanales
      (${Math.round(horasMes)} horas al mes).
    </div>`;
}

/* ============================================================
   ¿PAGO LA DEUDA O INVIERTO?
   El simulador de deudas y el de inversiones ya existían, pero no
   se hablaban. La pregunta real de quien tiene ambas cosas es cuál
   de las dos, y los dos números necesarios ya están cargados.
   ============================================================ */
function deudaVsInversion() {
  const cont = $('dvi-resultado');
  if (!cont) return;

  const retornoAnual = (parseFloat($('dvi-retorno')?.value) || 7) / 100;

  if (!debtRows.length) {
    cont.innerHTML = `<div class="sue-vacio">Agrega al menos una deuda arriba para comparar.</div>`;
    return;
  }

  // Anualizar la tasa mensual de cada deuda: (1+i)^12 − 1
  const filas = debtRows
    .filter(d => d.tasa > 0)
    .map(d => ({ ...d, anual: (Math.pow(1 + d.tasa / 100, 12) - 1) * 100 }))
    .sort((a, b) => b.anual - a.anual);

  if (!filas.length) {
    cont.innerHTML = `<div class="sue-vacio">Ninguna de tus deudas tiene tasa registrada.</div>`;
    return;
  }

  const rAnualPct = retornoAnual * 100;
  const ganan     = filas.filter(f => f.anual > rAnualPct);
  const peor      = filas[0];

  cont.innerHTML = `
    <table class="dvi-tabla">
      <thead><tr>
        <th scope="col">Deuda</th>
        <th scope="col" style="text-align:right">Tasa mensual</th>
        <th scope="col" style="text-align:right">Equivale al año</th>
        <th scope="col" style="text-align:right">¿Qué conviene?</th>
      </tr></thead>
      <tbody>
        ${filas.map(f => `<tr>
          <td>${esc(f.nombre)}</td>
          <td style="text-align:right">${f.tasa}%</td>
          <td style="text-align:right;font-weight:700">${f.anual.toFixed(1)}%</td>
          <td style="text-align:right;font-weight:600;color:${f.anual > rAnualPct ? 'var(--red-500)' : 'var(--green-600)'}">
            ${f.anual > rAnualPct ? 'Pagar la deuda' : 'Invertir'}
          </td>
        </tr>`).join('')}
      </tbody>
    </table>

    <div class="alert ${ganan.length ? 'warning' : 'success'}" style="margin-top:1rem">
      <span class="alert-icon">${ganan.length ? '⚠️' : '✅'}</span>
      <div>${ganan.length
        ? `<strong>Paga primero la deuda.</strong> Tu ${esc(peor.nombre)} cuesta
           <strong>${peor.anual.toFixed(1)}% al año</strong>, muy por encima del
           ${rAnualPct.toFixed(1)}% que esperas ganar invirtiendo. Pagarla es un retorno
           garantizado de ${peor.anual.toFixed(1)}%: ninguna inversión te ofrece eso sin riesgo.
           ${ganan.length > 1 ? `Lo mismo aplica a ${ganan.length - 1} deuda(s) más.` : ''}`
        : `<strong>Tus deudas son baratas.</strong> Ninguna supera el ${rAnualPct.toFixed(1)}%
           que esperas ganar invirtiendo, así que invertir rinde más que adelantar pagos.
           Mantén al día los pagos mínimos.`}
      </div>
    </div>

    <div class="f-hint" style="margin-top:.5rem">
      Una tasa de ${peor.tasa}% mensual no es ${(peor.tasa*12).toFixed(1)}% al año:
      es ${peor.anual.toFixed(1)}%, porque los intereses se capitalizan mes a mes.
      Es la diferencia que casi nadie calcula.
    </div>`;
}

/* ============================================================
   ¿QUÉ PASA SI…? — Prueba de estrés sobre los datos cargados
   ============================================================ */
function estresCalc() {
  const cont = $('estres-resultado');
  if (!cont) return;

  const MES = mesHoy();
  const filas = filasDelMes(MES);
  const ing = ingresoDelMes(MES);
  const gas = calcularScore(MES).gas;   // gasto del mes (proyectado si va en curso)
  const aho = Math.max(ing - gas, 0);

  if (sinDatos(MES) || gas <= 0) {
    cont.innerHTML = `<div class="sue-vacio">Carga tu presupuesto para poner a prueba tus finanzas.</div>`;
    return;
  }

  // Ahorro disponible: lo que tienes ahorrado en tus metas. Antes se
  // suponía que todo el "ahorro potencial" de cada mes seguía guardado.
  const acumulado = ahorrosTotales();

  const meses    = parseInt($('estres-meses')?.value)   || 3;
  const alzaPct  = parseFloat($('estres-alza')?.value)  || 10;
  const imprevRaw = parseFloat($('estres-gasto')?.value);
  const imprev   = isNaN(imprevRaw) ? 500000 : Math.max(0, imprevRaw);

  // Escenario 1: sin ingresos N meses
  const mesesQueAguanta = gas > 0 ? acumulado / gas : 0;
  const sobrevive       = mesesQueAguanta >= meses;

  // Escenario 2: sube un gasto fijo
  const mayorGasto = filas.reduce((m, r) => (r.real > (m?.real || 0) ? r : m), null);
  const alza       = mayorGasto ? mayorGasto.real * (alzaPct / 100) : 0;
  const ahorroTras = aho - alza;

  // Escenario 3: gasto imprevisto
  const cubre = acumulado >= imprev;

  const tarjeta = (icono, titulo, veredicto, ok, detalle) => `
    <div class="estres-card ${ok ? 'ok' : 'riesgo'}">
      <div class="estres-ico" aria-hidden="true">${icono}</div>
      <div class="estres-tit">${titulo}</div>
      <div class="estres-veredicto">${veredicto}</div>
      <div class="estres-det">${detalle}</div>
    </div>`;

  cont.innerHTML = `
    <div class="estres-grid">
      ${tarjeta('💼', `Pierdo mi trabajo ${meses} ${meses === 1 ? 'mes' : 'meses'}`,
        sobrevive ? 'Aguantas' : 'No alcanzas',
        sobrevive,
        `Con ${fmt(Math.round(acumulado))} ahorrados y gastos de ${fmt(Math.round(gas))} al mes,
         cubres <strong>${mesesQueAguanta.toLocaleString('es-CL', { maximumFractionDigits: 1 })} meses</strong>.
         ${sobrevive ? 'Tu colchón resiste el escenario.'
                     : `Te faltan ${fmt(Math.round(gas * meses - acumulado))} para llegar.`}`)}

      ${tarjeta('🏠', `Mi mayor gasto sube ${alzaPct}%`,
        ahorroTras > 0 ? 'Sigues ahorrando' : 'Quedas en rojo',
        ahorroTras > 0,
        mayorGasto
          ? `${esc(mayorGasto.desc)} pasa de ${fmt(mayorGasto.real)} a ${fmt(Math.round(mayorGasto.real + alza))}.
             Tu ahorro mensual quedaría en <strong>${fmt(Math.round(ahorroTras))}</strong>.`
          : 'Sin gastos registrados.')}

      ${tarjeta('🚑', `Me llega un gasto de ${fmt(imprev)}`,
        cubre ? 'Lo cubres' : 'Tendrías que endeudarte',
        cubre,
        cubre
          ? `Te quedarían ${fmt(Math.round(acumulado - imprev))} de colchón.`
          : `Te faltarían ${fmt(Math.round(imprev - acumulado))}. Ese es exactamente
             el hueco que llena un fondo de emergencia.`)}
    </div>`;
}

/* Poblar el select de AFP desde PARAMS_SUELDO, para que agregar o
   cambiar una administradora sea editar una sola lista. */
(function poblarAFPs() {
  const sel = $('sue-afp');
  if (!sel) return;
  sel.innerHTML = PARAMS_SUELDO.afps
    .map(a => `<option value="${a.comision}">${a.nombre} — ${(a.comision*100).toFixed(2)}%</option>`)
    .join('');
  sel.value = PARAMS_SUELDO.afps.find(a => a.nombre === 'AFP Modelo').comision;
})();

// Inicializar las herramientas nuevas
sueldoCalc();
deudaVsInversion();
estresCalc();

/* ============================================================
   ¿QUÉ PASA SI…? — MODO ESCENARIOS
   La versión original vivía en un js/scenario.js que nunca llegó a
   GitHub. Esta la rehace sobre calcularScoreDe(): toma los datos
   guardados, les aplica los cambios de los controles y compara. No
   escribe nada en localStorage, así que tus datos reales no cambian.
   ============================================================ */
function escenarioCalc() {
  const res = $('esc-resultado');
  if (!res) return;
  const dIng  = parseFloat($('esc-ingreso').value) || 0;
  const dGas  = parseFloat($('esc-gasto').value)   || 0;
  const cuota = Math.max(0, parseFloat($('esc-cuota').value) || 0);
  const signo = v => (v > 0 ? '+' : '') + v + '%';
  $('esc-ingreso-out').textContent = signo(dIng);
  $('esc-gasto-out').textContent   = signo(dGas);

  if (sinDatos(mesHoy()) || calcularScore(mesHoy()).incompleto) {
    res.innerHTML = `<div class="alert info mb1"><span class="alert-icon">ℹ️</span><div>Para simular necesitas tus datos: ve a <a href="#/plan">Plan</a> e ingresa tu ingreso y tus gastos del mes.</div></div>`;
    return;
  }

  const hoy = calcularScore(mesHoy());
  const ing = hoy.ing * (1 + dIng / 100);
  const gas = hoy.gas * (1 + dGas / 100) + cuota;
  // El score estima la cuota como deuda / 12; una cuota nueva equivale
  // entonces a 12 cuotas más de deuda.
  const deu = hoy.deu + cuota * 12;
  const sim = calcularScoreDe(ing, gas, deu, { ...hoy.entradas, cuotas: hoy.cuotas + cuota, cuotasEstimadas: false });

  const sinCambios = dIng === 0 && dGas === 0 && cuota === 0;
  const dScore = sim.score - hoy.score;
  const dAho   = sim.aho - hoy.aho;
  let msg;
  if (sinCambios)      msg = 'Mueve un control para ver el efecto.';
  else if (ing - gas < 0) msg = `<strong>En este escenario no te alcanza:</strong> gastarías ${fmt(gas - ing)} más de lo que ganas cada mes.`;
  else msg = `Tu ahorro mensual ${dAho >= 0 ? 'sube' : 'baja'} <strong>${fmt(Math.abs(dAho))}</strong> y tu score ${dScore >= 0 ? 'sube' : 'baja'} <strong>${Math.abs(dScore)} puntos</strong>.`;

  const fila = (lbl, a, b) => `<tr><th scope="row">${lbl}</th><td>${a}</td><td class="${a === b ? '' : 'esc-cambia'}">${b}</td></tr>`;
  res.innerHTML = `
    <table class="esc-tabla">
      <thead><tr><th scope="col"><span class="sr-only">Dato</span></th><th scope="col">Hoy</th><th scope="col">Escenario</th></tr></thead>
      <tbody>
        ${fila('Ingreso', fmt(hoy.ing), fmt(ing))}
        ${fila('Gastos y cuotas', fmt(hoy.gas), fmt(gas))}
        ${fila('Ahorro mensual', fmt(hoy.aho), fmt(sim.aho))}
        ${fila('Score', `${hoy.score} · ${hoy.label}`, `${sim.score} · ${sim.label}`)}
      </tbody>
    </table>
    <p class="esc-msg">${msg}</p>
    <p class="esc-nota">La cuota nueva se suma a tus gastos y a tu deuda. Es una aproximación.</p>`;
}

function escenarioReset() {
  $('esc-ingreso').value = 0;
  $('esc-gasto').value   = 0;
  $('esc-cuota').value   = 0;
  escenarioCalc();
}

/* ============================================================
   METAS DE AHORRO
   El fondo de emergencia va primero: se sugiere solo, con 3 meses de
   tus gastos. Lo ahorrado en las metas es lo que usan el score (meses
   de colchón) y la prueba de estrés (ahorros disponibles).
   ============================================================ */
function guardarMetas() {
  try { localStorage.setItem(LS.metas, JSON.stringify(metas)); } catch (e) {}
}

function renderMetas() {
  const cont = $('metas-lista');
  if (!cont) return;
  const gasto = calcularScore(mesHoy()).gas;   // gasto del mes, proyectado si va en curso
  const sug = $('metas-sugerencia');
  const tieneFondo = metas.some(m => m.tipo === 'emergencia');
  if (sug) {
    sug.style.display = tieneFondo ? 'none' : '';
    sug.innerHTML = gasto > 0
      ? `<span><strong>Empieza por un fondo de emergencia.</strong> Con tus gastos de este mes, 3 meses son ${fmt(gasto * 3)}.</span>
         <button type="button" class="btn btn-primary btn-sm" onclick="crearFondoEmergencia(${Math.round(gasto * 3)})">Crear fondo de emergencia</button>`
      : `<span><strong>Empieza por un fondo de emergencia:</strong> 3 a 6 meses de tus gastos, guardados donde los puedas sacar rápido.</span>
         <button type="button" class="btn btn-primary btn-sm" onclick="crearFondoEmergencia(0)">Crear fondo de emergencia</button>`;
  }
  if (!metas.length) { cont.innerHTML = ''; return; }
  const hoy = mesHoy();
  cont.innerHTML = metas.map(m => {
    const p = m.objetivo > 0 ? Math.min(100, Math.round(m.ahorrado / m.objetivo * 100)) : 0;
    let plazo = '';
    if (m.fecha && m.objetivo > m.ahorrado) {
      const [ya, ma] = hoy.split('-').map(Number), [yb, mb] = m.fecha.split('-').map(Number);
      const meses = (yb - ya) * 12 + (mb - ma);
      plazo = meses > 0 ? ` · aporta ${fmt((m.objetivo - m.ahorrado) / meses)} al mes para llegar en ${nombreMes(m.fecha)}`
                        : ` · la fecha (${nombreMes(m.fecha)}) ya pasó`;
    }
    return `<div class="meta-item">
      <div class="meta-top">
        <span class="meta-nombre">${esc(m.nombre)}${m.tipo === 'emergencia' ? ' <span class="meta-chip">Va primero</span>' : ''}</span>
        <span class="meta-pct">${p}%</span>
      </div>
      <div class="ind-barra"><div class="ind-fill ${p >= 100 ? 'ok' : 'azul'}" style="width:${p}%"></div></div>
      <div class="meta-sub">${fmt(m.ahorrado)} de ${m.objetivo ? fmt(m.objetivo) : '—'}${plazo}</div>
      <div class="meta-acciones">
        <label class="sr-only" for="aporte-${m.id}">Monto a aportar a ${esc(m.nombre)}</label>
        <input class="f-input" id="aporte-${m.id}" type="number" min="0" step="1000" placeholder="Monto">
        <button type="button" class="btn btn-outline btn-sm" onclick="aportarMeta(${m.id}, 1)">Aportar</button>
        <button type="button" class="btn btn-outline btn-sm" onclick="aportarMeta(${m.id}, -1)">Retirar</button>
        <button type="button" class="mov-accion" onclick="borrarMeta(${m.id})" aria-label="Borrar la meta ${esc(m.nombre)}">Borrar</button>
      </div>
    </div>`;
  }).join('');
}

function crearFondoEmergencia(objetivo) {
  metas.unshift({ id: Date.now(), nombre: 'Fondo de emergencia', objetivo, ahorrado: 0, fecha: '', tipo: 'emergencia' });
  guardarMetas(); refrescarTodo();
}

function agregarMeta() {
  const nombre = $('meta-nombre').value.trim();
  const objetivo = parseFloat($('meta-objetivo').value) || 0;
  if (!nombre || objetivo <= 0) { SF_FEATURES.showToast('Escribe el nombre y el monto de la meta'); return; }
  metas.push({ id: Date.now(), nombre: nombre.slice(0, 40), objetivo, ahorrado: 0, fecha: $('meta-fecha').value || '', tipo: 'libre' });
  $('meta-nombre').value = ''; $('meta-objetivo').value = ''; $('meta-fecha').value = '';
  guardarMetas(); refrescarTodo();
}

function aportarMeta(id, signo) {
  const m = metas.find(x => x.id === id);
  const monto = parseFloat($('aporte-' + id).value) || 0;
  if (!m || monto <= 0) return;
  m.ahorrado = Math.max(0, m.ahorrado + signo * monto);
  guardarMetas(); refrescarTodo();
}

function borrarMeta(id) {
  if (!confirm('¿Borrar esta meta?')) return;
  metas = metas.filter(m => m.id !== id);
  guardarMetas(); refrescarTodo();
}

/* ============================================================
   RESPALDO DE DATOS
   Todo vive en localStorage: si se borra el navegador, se pierde. El
   respaldo es un .json con todas las claves sf_ de la app.
   ============================================================ */
function exportarRespaldo() {
  const datos = {};
  Object.keys(localStorage).filter(k => k.startsWith('sf_')).forEach(k => { datos[k] = localStorage.getItem(k); });
  const archivo = { app: 'salud-financiera', version: 1, creado: new Date().toISOString(), datos };
  const blob = new Blob([JSON.stringify(archivo, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `salud-financiera-respaldo-${hoyISO()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  try { localStorage.setItem('sf_ultimo_respaldo', new Date().toISOString()); } catch (e) {}
  renderAjustes();
}

function importarRespaldo(input) {
  const f = input.files?.[0];
  if (!f) return;
  const lector = new FileReader();
  lector.onload = () => {
    let archivo;
    try { archivo = JSON.parse(String(lector.result)); } catch (e) { archivo = null; }
    if (!archivo || archivo.app !== 'salud-financiera' || typeof archivo.datos !== 'object') {
      SF_FEATURES.showToast('Ese archivo no es un respaldo de Salud Financiera');
      input.value = '';
      return;
    }
    const n = Object.keys(archivo.datos).filter(k => k.startsWith('sf_')).length;
    if (!confirm(`Restaurar el respaldo del ${new Date(archivo.creado).toLocaleDateString('es-CL')} (${n} conjuntos de datos)? Reemplaza lo que tienes ahora en este navegador.`)) { input.value = ''; return; }
    Object.keys(localStorage).filter(k => k.startsWith('sf_')).forEach(k => localStorage.removeItem(k));
    Object.entries(archivo.datos).forEach(([k, v]) => { if (k.startsWith('sf_') && typeof v === 'string') localStorage.setItem(k, v); });
    location.reload();
  };
  lector.readAsText(f);
}

function renderAjustes() {
  const el = $('aj-ultimo');
  if (!el) return;
  let ult = null;
  try { ult = localStorage.getItem('sf_ultimo_respaldo'); } catch (e) {}
  el.textContent = ult
    ? `Tu último respaldo es del ${new Date(ult).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })}.`
    : 'Todavía no descargas ningún respaldo.';
}

/** Tabla de parámetros legales, sacada de PARAMS_CL para que nunca se desfase. */
function renderMetodologia() {
  const t = $('met-params');
  if (!t) return;
  const P = PARAMS_CL;
  const fila = (nombre, valor, p) => `<tr><td>${nombre}</td><td>${valor}</td><td>${fechaCL(p.vigenteDesde)}</td><td><a href="${p.url}" target="_blank" rel="noopener">${p.fuente}</a></td></tr>`;
  t.innerHTML = `<thead><tr><th scope="col">Parámetro</th><th scope="col">Valor</th><th scope="col">Vigente desde</th><th scope="col">Fuente</th></tr></thead><tbody>
    ${fila('Retención de boletas de honorarios', pctCL(P.retencionHonorarios.valor), P.retencionHonorarios)}
    ${fila('Jornada laboral semanal', P.jornadaSemanal.valor + ' horas', P.jornadaSemanal)}
    ${fila('Tope imponible AFP y salud', P.topeImponibleUF.valor.toLocaleString('es-CL') + ' UF', P.topeImponibleUF)}
    ${fila('Tope del seguro de cesantía', P.topeCesantiaUF.valor.toLocaleString('es-CL') + ' UF', P.topeCesantiaUF)}
    ${fila('IVA', pctCL(P.iva.valor), P.iva)}
    ${P.tmc.tramos.map(tr => fila('TMC, crédito en pesos ' + tr.nombre, pctCL(tr.anual) + ' anual', P.tmc)).join('')}
    ${fila('Compras internacionales sin arancel', 'hasta USD ' + P.importacion.umbralUSD, P.importacion)}
    ${fila('Arancel general', pctCL(P.importacion.arancelGeneral), P.importacion)}
  </tbody>`;
}

/** Carga un script externo una sola vez (html2pdf se pide recién al exportar). */
function cargarScript(src) {
  if (!_scriptsCargados[src]) {
    _scriptsCargados[src] = new Promise((ok, fallo) => {
      const s = document.createElement('script');
      s.src = src; s.onload = ok; s.onerror = () => fallo(new Error('No se pudo cargar ' + src));
      document.head.appendChild(s);
    });
  }
  return _scriptsCargados[src];
}

/* ============================================================
   RUTA RECOMENDADA EN APRENDER
   El módulo que más ayuda según el indicador del score con más puntos
   por ganar. Conecta lo que la persona aprende con sus propios números.
   ============================================================ */
function renderRuta() {
  const cont = $('ruta-card');
  if (!cont) return;
  if (sinDatos(mesHoy())) { cont.style.display = 'none'; return; }
  const s = calcularScore(mesHoy());
  if (s.incompleto || !s.proxima) { cont.style.display = 'none'; return; }
  const mods = RUTA_POR_INDICADOR[s.proxima.id] || [];
  cont.style.display = '';
  cont.innerHTML = `
    <h2 class="card-title" id="ruta-tit">Tu ruta recomendada</h2>
    <p class="card-sub">Elegida por tus números: tu indicador con más puntos por ganar es <strong>${s.proxima.nombre.toLowerCase()}</strong> (${s.proxima.valor}). ${s.proxima.subir}</p>
    <div class="ruta-pasos">${mods.map((k, i) => `
      <button type="button" class="ruta-paso" onclick="openModule('${k}')">
        <span class="ruta-num">${i + 1}</span>
        <span><strong>${modData[k]?.title || k}</strong><span class="mov-meta">${earnedBadges.includes(quizData[k]?.key) ? ' · completado' : ' · lección y quiz'}</span></span>
      </button>`).join('')}
    </div>`;
}

/* ============================================================
   VENCIMIENTOS EN EL CALENDARIO (.ics)
   Un evento mensual por cuenta, con aviso dos días antes. El archivo se
   abre en el calendario del celular o del computador.
   ============================================================ */
function exportarVencimientosICS() {
  if (!vencRows.length) { SF_FEATURES.showToast('Agrega primero un vencimiento'); return; }
  const hoy = new Date();
  const ymd = d => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
  const escICS = t => String(t).replace(/[\\;,]/g, m => '\\' + m).replace(/\n/g, ' ');
  const eventos = vencRows.map(v => {
    let fecha = new Date(hoy.getFullYear(), hoy.getMonth(), Math.min(v.dia, 28));
    if (fecha < new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())) fecha = new Date(hoy.getFullYear(), hoy.getMonth() + 1, Math.min(v.dia, 28));
    const fin = new Date(fecha); fin.setDate(fin.getDate() + 1);
    return ['BEGIN:VEVENT',
      `UID:sf-venc-${v.id}@salud-financiera`,
      `DTSTAMP:${ymd(hoy)}T000000Z`,
      `DTSTART;VALUE=DATE:${ymd(fecha)}`,
      `DTEND;VALUE=DATE:${ymd(fin)}`,
      `RRULE:FREQ=MONTHLY;BYMONTHDAY=${Math.min(v.dia, 28)}`,
      `SUMMARY:${escICS('Pagar ' + v.nombre + ' (' + fmt(v.monto) + ')')}`,
      'BEGIN:VALARM', 'TRIGGER:-P2D', 'ACTION:DISPLAY', `DESCRIPTION:${escICS('Vence ' + v.nombre)}`, 'END:VALARM',
      'END:VEVENT'].join('\r\n');
  });
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Salud Financiera//Vencimientos//ES', 'CALSCALE:GREGORIAN', ...eventos, 'END:VCALENDAR'].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  a.download = 'vencimientos-salud-financiera.ics';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ============================================================
   LECCIONES CON TUS NÚMEROS
   Cada módulo de Aprender parte con un cálculo hecho con los datos de
   la persona. Ninguna app chilena de educación financiera conecta la
   lección con los números propios: ese es el aporte de esta.
   ============================================================ */
function conTusNumeros(key) {
  const caja = html => `<div class="con-tus-numeros"><span class="ctn-lbl">Con tus números</span>${html}</div>`;
  const MES = mesHoy();
  const s = calcularScore(MES);
  if (sinDatos(MES) || s.incompleto) return caja('Anota tu sueldo y tus gastos en <a href="#/movimientos">Movimientos</a> o en tu <a href="#/plan">Plan</a> y esta lección se calculará con tus números.');
  const fondo = s.entradas.fondo || 0;
  const d = datosDeudas(MES);
  let filas = [];
  try { filas = debtRows; } catch (e) {}
  switch (key) {
    case 'emergencias': {
      const meta = s.gas * 3;
      return caja(`Gastas unos <strong>${fmt(s.gas)}</strong> al mes, así que 3 meses son <strong>${fmt(meta)}</strong>. ` +
        (fondo >= meta ? `Ya tienes ${fmt(fondo)}: tu fondo está completo.`
          : fondo > 0 ? `Tienes ${fmt(fondo)} en tu fondo: te faltan ${fmt(meta - fondo)}.`
          : `Todavía no tienes un fondo registrado: créalo en Plan → Metas.`));
    }
    case 'deudas': {
      if (!d.total) return caja('No tienes deudas registradas. Si alguna vez tomas un crédito, compara su CAE antes de firmar.');
      const caraTxt = filas.length
        ? (() => { const peor = filas.reduce((m, x) => (+x.tasa > +m.tasa ? x : m)); return ` Con el método avalancha, la primera a pagar es <strong>${esc(peor.nombre)}</strong> (${String(peor.tasa).replace('.', ',')}% mensual).`; })()
        : ' Registra cada deuda con su tasa en Créditos para saber cuál pagar primero.';
      return caja(`Debes <strong>${fmt(d.total)}</strong> y tus cuotas se llevan el <strong>${Math.round(s.deudaPct)}%</strong> de tu ingreso${d.cuotasEstimadas ? ' (estimado)' : ''}.${caraTxt}`);
    }
    case 'inversion': {
      const mensual = Math.max(0, s.ing - s.gas);
      if (!mensual) return caja('Este mes no te queda margen para invertir: primero ordena tu presupuesto en Plan.');
      const aporte = Math.round(mensual / 2);
      const r = Math.pow(1.04, 1 / 12) - 1;
      const fv = aporte * (Math.pow(1 + r, 240) - 1) / r;
      return caja(`Te quedan unos ${fmt(mensual)} al mes. Si invirtieras la mitad, <strong>${fmt(aporte)}</strong>, durante 20 años con una rentabilidad real de 4% anual, tendrías cerca de <strong>${fmt(fv)}</strong> de hoy, habiendo aportado ${fmt(aporte * 240)}. Es una proyección, no una promesa.` +
        (fondo < s.gas * 3 ? ' Antes, completa tu fondo de emergencia.' : ''));
    }
    case 'tarjetas': {
      const caras = filas.filter(x => +x.tasa > 2.21);
      if (!caras.length) return caja(d.cara === null
        ? 'Registra tus deudas con su tasa en Créditos para ver cuánto te cuesta cada una al año.'
        : 'No tienes deudas con tasa sobre 30% anual. Mantenlo pagando el total de la tarjeta cada mes.');
      return caja(caras.map(x => {
        const anual = Math.pow(1 + x.tasa / 100, 12) - 1;
        return `Tu <strong>${esc(x.nombre)}</strong> cobra ${String(x.tasa).replace('.', ',')}% mensual: si el saldo de ${fmt(x.saldo)} se quedara un año, pagarías unos <strong>${fmt(x.saldo * anual)}</strong> en intereses.`;
      }).join(' '));
    }
    case 'presupuesto_tip':
      return caja(`Con tu ingreso de <strong>${fmt(s.ing)}</strong>, la regla 50/30/20 da: hasta ${fmt(s.ing * .5)} para necesidades, hasta ${fmt(s.ing * .3)} para deseos y al menos <strong>${fmt(s.ing * .2)}</strong> para ahorro y deudas. Hoy te queda el ${Math.max(0, Math.round(s.ahorroPct))}%.`);
    case 'habitos': {
      const chicas = movsDelMes(MES).filter(m => m.tipo === 'gasto' && m.monto <= 5000);
      if (chicas.length) {
        const total = chicas.reduce((x, m) => x + m.monto, 0);
        return caja(`Este mes anotaste <strong>${chicas.length} compras de $5.000 o menos</strong>, que suman ${fmt(total)}. A ese ritmo son <strong>${fmt(total * 12)}</strong> al año.`);
      }
      const mayor = filasDelMes(MES).reduce((m, r) => (r.real > (m?.real || 0) ? r : m), null);
      return caja(mayor ? `Tu categoría con más gasto este mes es <strong>${esc(catConfig[mayor.cat]?.label.replace(/^\S+\s/, '') || mayor.desc)}</strong>, con ${fmt(mayor.real)}. Es el primer lugar donde mirar si quieres ahorrar más.` : 'Anota tus gastos en Movimientos para descubrir tus gastos hormiga.');
    }
    default: return '';
  }
}

/* ============================================================
   HÁBITO: REVISIÓN SEMANAL, RACHA Y CIERRE DE MES
   La app no tenía ninguna razón para volver. Ahora:
   - Cada semana, una revisión de dos minutos de lo anotado; marcarla
     suma a la racha de semanas seguidas.
   - Al empezar un mes, el cierre del anterior: cuánto entró, cuánto
     salió, el score y en qué categorías te pasaste.
   ============================================================ */

function leerLista(k) { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) { return []; } }
function guardarLista(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

/** Semana ISO "AAAA-Www" de una fecha. */
function semanaISO(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dia = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dia);
  const inicio = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const n = Math.ceil(((t - inicio) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${pad2(n)}`;
}

/** Semanas seguidas revisadas, contando hacia atrás desde esta o la anterior. */
function rachaSemanas() {
  const hechas = new Set(leerLista(HAB_LS.rev));
  const d = new Date();
  if (!hechas.has(semanaISO(d))) d.setDate(d.getDate() - 7);
  let n = 0;
  while (hechas.has(semanaISO(d))) { n++; d.setDate(d.getDate() - 7); }
  return n;
}

/** Gastos anotados entre hace (desde) y hace (hasta) días. */
function gastosEntre(desde, hasta) {
  const f = dias => { const d = new Date(); d.setDate(d.getDate() - dias); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
  const ini = f(desde), fin = f(hasta);
  return movimientos.filter(m => m.tipo === 'gasto' && m.fecha > ini && m.fecha <= fin);
}

function marcarRevisada() {
  const l = leerLista(HAB_LS.rev);
  const s = semanaISO();
  if (!l.includes(s)) l.push(s);
  guardarLista(HAB_LS.rev, l);
  renderHabito();
  SF_FEATURES.showToast('Semana revisada');
}

/** Resumen de un mes ya terminado: ingreso, gasto y categorías que se pasaron. */
function resumenMes(clave) {
  const p = presupuestos[clave];
  const movG = movsDelMes(clave).filter(m => m.tipo === 'gasto');
  const ing = totalMes(clave, 'ingreso') || parseFloat(p?.ingreso) || 0;
  const real = movG.length ? gastoMesPorCat(clave) : (p?.filas || []).reduce((o, r) => { o[r.cat] = (o[r.cat] || 0) + (r.real || 0); return o; }, {});
  const gas = Object.values(real).reduce((x, v) => x + v, 0);
  const plan = planDelMes(clave);
  const tienePlan = Object.values(plan).some(v => v > 0);
  const pasadas = Object.keys(plan).filter(c => plan[c] > 0 && (real[c] || 0) > plan[c])
    .map(c => ({ nombre: catConfig[c]?.label.replace(/^\S+\s/, '') || 'Otro', exceso: real[c] - plan[c] }));
  return { ing, gas, pasadas, tienePlan, score: historial[clave]?.score ?? null };
}

function cerrarMes(clave) {
  const l = leerLista(HAB_LS.cierres);
  if (!l.includes(clave)) l.push(clave);
  guardarLista(HAB_LS.cierres, l);
  renderHabito();
}

function renderHabito() {
  const cierre = $('cierre-card'), rev = $('revision-card');
  if (!cierre || !rev) return;

  // Cierre del mes anterior: se ofrece mientras no se cierre, si tuvo datos
  let [y, m] = mesHoy().split('-').map(Number);
  m--; if (m < 1) { m = 12; y--; }
  const ant = `${y}-${pad2(m)}`;
  const r = resumenMes(ant);
  const cerrado = leerLista(HAB_LS.cierres).includes(ant);
  if (!cerrado && (r.ing > 0 || r.gas > 0)) {
    const queda = r.ing - r.gas;
    cierre.style.display = '';
    cierre.innerHTML = `
      <h2 class="card-title" id="cierre-tit">Cierre de ${nombreMes(ant)}</h2>
      <div class="cierre-cifras">
        <div><span class="mov-res-lbl">Ingresó</span><strong>${fmt(r.ing)}</strong></div>
        <div><span class="mov-res-lbl">Gastaste</span><strong>${fmt(r.gas)}</strong></div>
        <div><span class="mov-res-lbl">${queda >= 0 ? 'Te quedó' : 'Faltó'}</span><strong class="${queda < 0 ? 'neg' : ''}">${fmt(Math.abs(queda))}</strong></div>
        ${r.score !== null ? `<div><span class="mov-res-lbl">Score</span><strong>${r.score}</strong></div>` : ''}
      </div>
      <p class="card-sub">${!r.tienePlan
        ? 'Ese mes no tenía un plan. Define uno para este mes en tu Plan y el próximo cierre te dirá en qué te pasaste.'
        : r.pasadas.length
        ? 'Te pasaste en ' + r.pasadas.map(p => `<strong>${esc(p.nombre)}</strong> (${fmt(p.exceso)})`).join(', ') + '. Ajusta esos montos en el Plan de este mes o busca dónde recortar.'
        : 'Cumpliste tu plan en todas las categorías con presupuesto.'}</p>
      <div class="aj-botones"><a class="btn btn-outline btn-sm" href="#/plan">Ajustar el plan de este mes</a>
        <button type="button" class="btn btn-primary btn-sm" onclick="cerrarMes('${ant}')">Listo, cerrar ${MESES[m - 1].toLowerCase()}</button></div>`;
  } else {
    cierre.style.display = 'none';
  }

  // Revisión semanal: solo si la persona usa Movimientos
  if (!movimientos.length) { rev.style.display = 'none'; return; }
  rev.style.display = '';
  const semana = gastosEntre(7, 0), previa = gastosEntre(14, 7);
  const tot = semana.reduce((x, g) => x + g.monto, 0), totPrev = previa.reduce((x, g) => x + g.monto, 0);
  const porCat = {};
  semana.forEach(g => { porCat[g.cat] = (porCat[g.cat] || 0) + g.monto; });
  const top = Object.keys(porCat).sort((p, q) => porCat[q] - porCat[p])[0];
  const hecha = leerLista(HAB_LS.rev).includes(semanaISO());
  const racha = rachaSemanas();
  const delta = totPrev > 0 ? Math.round((tot - totPrev) / totPrev * 100) : null;
  rev.innerHTML = `
    <div class="rev-head">
      <h2 class="card-title" id="rev-tit">Revisión de la semana</h2>
      <span class="racha" title="Semanas seguidas revisadas">${racha === 0 ? 'Empieza tu racha' : racha === 1 ? '1 semana revisada' : racha + ' semanas seguidas'}</span>
    </div>
    <p class="card-sub">En los últimos 7 días anotaste <strong>${semana.length} ${semana.length === 1 ? 'gasto' : 'gastos'}</strong> por <strong>${fmt(tot)}</strong>${delta !== null ? `, ${delta >= 0 ? delta + '% más' : -delta + '% menos'} que la semana anterior` : ''}.${top !== undefined ? ` Lo que más pesó: ${esc(catConfig[top]?.label.replace(/^\S+\s/, '') || 'Otros')} (${fmt(porCat[top])}).` : ''}</p>
    <ol class="rev-pasos">
      <li>¿Falta algún gasto por anotar? Revisa la cartola o las notificaciones del banco.</li>
      <li>¿Alguna categoría va pasada? Mira las barras en rojo del <a href="#/plan">Plan</a>.</li>
      <li>¿Vence algo esta semana? Revisa tus vencimientos.</li>
    </ol>
    <div class="aj-botones"><a class="btn btn-outline btn-sm" href="#/movimientos">Ver movimientos</a>
      ${hecha ? '<span class="rev-hecha">Semana revisada ✓</span>' : '<button type="button" class="btn btn-primary btn-sm" onclick="marcarRevisada()">Marcar semana revisada</button>'}</div>`;
}

/* ============================================================
   ARRANQUE DE LAS RUTAS
   Va al final del archivo a propósito: mostrar la primera página puede
   usar cualquier constante del archivo (PARAMS_SUELDO, _sueldoLiquido…),
   y si se llama antes de que estén declaradas el script se corta.
   ============================================================ */
iniciarRutas();

/** Lleva a una página y baja hasta una sección (dos tarjetas de
    Herramientas apuntan a distintas partes de Emprender). */
function irA(page, id) {
  navigate(page);
  setTimeout(() => {
    const el = $(id);
    if (!el) return;
    (el.closest('.emp-tool-card, .import-section, .card') || el).scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.focus({ preventScroll: true });
  }, 80);
}

/** ¿Pasó más de un mes desde el certificado de la TMC? La CMF publica uno
    nuevo cada mes, a mediados de mes. */
function tmcVencida() {
  const desde = new Date(PARAMS_CL.tmc.vigenteDesde + 'T12:00:00');
  return (Date.now() - desde.getTime()) / 86400000 > 35;
}

/* ============================================================
   FÓRMULAS PURAS
   Sin DOM ni estado: las usa la app y las prueba tests/index.html.
   ============================================================ */

/** Cuota de un crédito con amortización francesa. tasa es mensual (0,015 = 1,5%). */
function cuotaFrancesa(monto, tasa, plazo) {
  if (!(plazo > 0)) return 0;
  if (!tasa) return monto / plazo;
  const f = Math.pow(1 + tasa, plazo);
  return monto * tasa * f / (f - 1);
}

/** CAE como fracción anual. Es la tasa mensual i que iguala el monto líquido
    recibido con el valor presente de las cuotas (incluidos seguros y cargos),
    anualizada como (1 + i)^12 − 1, según la definición del Compendio de Normas
    de la SUSESO (3.7.3.1) para el cálculo de la CAE. */
function caeAnualDe(liquido, cuotaReal, plazo) {
  if (!(liquido > 0) || !(cuotaReal > 0) || !(plazo > 0)) return 0;
  const va = r => r === 0 ? cuotaReal * plazo : cuotaReal * (1 - Math.pow(1 + r, -plazo)) / r;
  let lo = 0, hi = 1;   // bisección: VA(r) baja cuando r sube
  for (let k = 0; k < 100; k++) {
    const mid = (lo + hi) / 2;
    if (va(mid) > liquido) lo = mid; else hi = mid;
  }
  return Math.pow(1 + (lo + hi) / 2, 12) - 1;
}

/** Costo en pesos de traer un producto a Chile. Hasta USD 500 y para uso
    personal: solo IVA. Para vender o sobre USD 500: arancel general más IVA. */
function costoImportacion(fobUSD, fleteUSD, tc, comercial = false) {
  const P = PARAMS_CL.importacion;
  const cifUSD = fobUSD + fleteUSD;
  const cifCLP = cifUSD * tc;
  const bajoUmbral = !comercial && cifUSD <= P.umbralUSD;
  const arancel = bajoUmbral ? 0 : cifCLP * P.arancelGeneral;
  const baseIVA = cifCLP + arancel;
  const iva = baseIVA * PARAMS_CL.iva.valor;
  return { cifCLP, arancel, baseIVA, iva, total: cifCLP + arancel + iva, bajoUmbral };
}
