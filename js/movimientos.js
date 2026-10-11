/* ================================================================
   MOVIMIENTOS — registro de gastos e ingresos
   Lo que la app no tenía: un lugar donde anotar cada gasto. Ahora:
   - Movimientos sueltos (monto, categoría, fecha, nota).
   - Recurrentes (arriendo, streaming…) que se crean solos cada mes.
   - Importación de la cartola del banco en CSV, con reglas que
     categorizan solas ("contiene UBER → Transporte").
   Cuando un mes tiene gastos registrados acá, el Plan toma el gasto
   real de estos movimientos en vez de pedirlo a mano.
   Todo queda en localStorage, igual que el resto de la app: sin
   servidor ni cuenta. Se carga antes que app.js; las funciones usan
   $, fmt, esc y catConfig de app.js solo cuando se llaman.
   ================================================================ */
const MOV_LS = {
  mov   : 'sf_movimientos',
  rec   : 'sf_recurrentes',
  reglas: 'sf_reglas'
};

let movimientos = [];   // { id, fecha:'AAAA-MM-DD', tipo:'gasto'|'ingreso', monto, cat, nota, recId? }
let recurrentes = [];   // { id, tipo, monto, cat, nota, dia, desde:'AAAA-MM', excluidos:['AAAA-MM'] }
let reglas      = [];   // { texto, cat } definidas por el usuario
let _movId      = 0;
const movFiltro = { mes: null, tipo: 'todos', cat: '', q: '' };
let _movEditando = null;

/* Reglas que vienen de fábrica para la cartola. Van de lo más específico
   a lo más general: "UBER EATS" tiene que ganarle a "UBER". */
const REGLAS_BASE = [
  ['UBER EATS', 1], ['RAPPI', 1], ['PEDIDOSYA', 1], ['JUSTO', 1],
  ['LIDER', 1], ['JUMBO', 1], ['UNIMARC', 1], ['SANTA ISABEL', 1], ['TOTTUS', 1], ['ACUENTA', 1], ['MAYORISTA', 1],
  ['UBER', 2], ['DIDI', 2], ['CABIFY', 2], ['METRO', 2], ['BIP', 2], ['COPEC', 2], ['SHELL', 2], ['PETROBRAS', 2], ['ARAMCO', 2], ['TAG', 2], ['AUTOPISTA', 2],
  ['ENEL', 3], ['CGE', 3], ['AGUAS', 3], ['ESSBIO', 3], ['METROGAS', 3], ['ABASTIBLE', 3], ['LIPIGAS', 3], ['ENTEL', 3], ['MOVISTAR', 3], ['WOM', 3], ['CLARO', 3], ['VTR', 3], ['GTD', 3],
  ['NETFLIX', 4], ['SPOTIFY', 4], ['DISNEY', 4], ['HBO', 4], ['YOUTUBE', 4], ['STEAM', 4], ['CINEMARK', 4], ['CINEPLANET', 4],
  ['FARMACIA', 5], ['CRUZ VERDE', 5], ['SALCOBRAND', 5], ['AHUMADA', 5], ['ISAPRE', 5], ['FONASA', 5], ['CLINICA', 5],
  ['UNIVERSIDAD', 6], ['COLEGIO', 6], ['MATRICULA', 6],
  ['FALABELLA', 7], ['PARIS', 7], ['RIPLEY', 7], ['H&M', 7], ['ZARA', 7],
  ['CUOTA', 9], ['CREDITO', 9], ['AVANCE', 9], ['PAGO TARJETA', 9], ['PAGO TC', 9]
];

/* ── Fechas ─────────────────────────────────────────────────────── */
const pad2 = n => String(n).padStart(2, '0');
function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function mesHoy() { return hoyISO().slice(0, 7); }
function diasDelMes(clave) {
  const [a, m] = clave.split('-').map(Number);
  return new Date(a, m, 0).getDate();
}
function mesSiguiente(clave) {
  let [a, m] = clave.split('-').map(Number);
  m++; if (m > 12) { m = 1; a++; }
  return `${a}-${pad2(m)}`;
}
function nombreMes(clave) {
  const [a, m] = clave.split('-').map(Number);
  return `${MESES[m - 1]} ${a}`;
}

/* ── Carga y guardado ───────────────────────────────────────────── */
function cargarMovimientos() {
  try {
    movimientos = JSON.parse(localStorage.getItem(MOV_LS.mov) || '[]');
    recurrentes = JSON.parse(localStorage.getItem(MOV_LS.rec) || '[]');
    reglas      = JSON.parse(localStorage.getItem(MOV_LS.reglas) || '[]');
  } catch (e) { movimientos = []; recurrentes = []; reglas = []; }
  _movId = Math.max(0, ...movimientos.map(m => m.id), ...recurrentes.map(r => r.id));
  generarRecurrentes();
}
function guardarMovimientos() {
  try {
    localStorage.setItem(MOV_LS.mov, JSON.stringify(movimientos));
    localStorage.setItem(MOV_LS.rec, JSON.stringify(recurrentes));
    localStorage.setItem(MOV_LS.reglas, JSON.stringify(reglas));
  } catch (e) { console.warn('No se pudieron guardar los movimientos:', e); }
}

/** Crea los movimientos de cada recurrente hasta hoy, sin duplicar. */
function generarRecurrentes() {
  const hoy = hoyISO();
  let creados = 0;
  recurrentes.forEach(r => {
    for (let mes = r.desde; mes <= hoy.slice(0, 7); mes = mesSiguiente(mes)) {
      const fecha = `${mes}-${pad2(Math.min(r.dia, diasDelMes(mes)))}`;
      if (fecha > hoy) break;
      // Meses en que la persona borró o movió esta instancia: no se recrean
      if ((r.excluidos || []).includes(mes)) continue;
      if (movimientos.some(m => m.recId === r.id && m.fecha.slice(0, 7) === mes)) continue;
      movimientos.push({ id: ++_movId, fecha, tipo: r.tipo, monto: r.monto, cat: r.cat, nota: r.nota, recId: r.id });
      creados++;
    }
  });
  if (creados) guardarMovimientos();
}

/* ── Consultas que usa el resto de la app ───────────────────────── */
function movsDelMes(clave) {
  return movimientos.filter(m => m.fecha.slice(0, 7) === clave);
}
function totalMes(clave, tipo) {
  return movsDelMes(clave).filter(m => m.tipo === tipo).reduce((s, m) => s + m.monto, 0);
}
function gastoMesPorCat(clave) {
  const r = {};
  movsDelMes(clave).filter(m => m.tipo === 'gasto').forEach(m => { r[m.cat] = (r[m.cat] || 0) + m.monto; });
  return r;
}

/* ── Categorización ─────────────────────────────────────────────── */
function normalizar(t) {
  return String(t || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
/* Las reglas de fábrica calzan por palabra completa y de la más larga a la
   más corta: antes "PAGO METROGAS" caía en Transporte por contener
   "METRO", y "FARMACIA TAGLE" por contener "TAG". */
const _reglasOrdenadas = REGLAS_BASE.slice().sort((a, b) => b[0].length - a[0].length)
  .map(([k, cat]) => [new RegExp('(^|[^A-Z0-9])' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^A-Z0-9]|$)'), cat]);

function categoriaPara(texto) {
  const t = normalizar(texto);
  const propia = reglas.find(r => t.includes(normalizar(r.texto)));
  if (propia) return propia.cat;
  const base = _reglasOrdenadas.find(([re]) => re.test(t));
  return base ? base[1] : 8;   // Otros
}

/* ================================================================
   PÁGINA MOVIMIENTOS
   ================================================================ */
function opcionesMeses(seleccion) {
  // Los meses con movimientos más los últimos 12, del más nuevo al más viejo
  const set = new Set(movimientos.map(m => m.fecha.slice(0, 7)));
  let c = mesHoy();
  for (let i = 0; i < 12; i++) {
    set.add(c);
    let [a, m] = c.split('-').map(Number);
    m--; if (m < 1) { m = 12; a--; }
    c = `${a}-${pad2(m)}`;
  }
  return [...set].sort().reverse()
    .map(k => `<option value="${k}"${k === seleccion ? ' selected' : ''}>${nombreMes(k)}</option>`).join('');
}

function renderMovimientos() {
  const lista = $('mov-lista');
  if (!lista) return;
  if (!movFiltro.mes) movFiltro.mes = mesHoy();
  $('mov-mes').innerHTML = opcionesMeses(movFiltro.mes);
  $('mov-cat').innerHTML = '<option value="">Todas las categorías</option>' +
    catConfig.map((c, i) => `<option value="${i}"${String(i) === movFiltro.cat ? ' selected' : ''}>${c.label}</option>`).join('');

  const delMes = movsDelMes(movFiltro.mes);
  const ing = delMes.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + m.monto, 0);
  const gas = delMes.filter(m => m.tipo === 'gasto').reduce((s, m) => s + m.monto, 0);
  $('mov-tot-ing').textContent = '+' + fmt(ing);
  $('mov-tot-gas').textContent = '−' + fmt(gas);
  $('mov-tot-saldo').textContent = (ing - gas < 0 ? '−' : '') + fmt(Math.abs(ing - gas));
  $('mov-tot-saldo').style.color = ing - gas < 0 ? 'var(--red-500)' : 'var(--green-600)';

  const q = normalizar(movFiltro.q);
  const vis = delMes.filter(m =>
    (movFiltro.tipo === 'todos' || (movFiltro.tipo === 'recurrentes' ? !!m.recId : m.tipo === movFiltro.tipo)) &&
    (movFiltro.cat === '' || String(m.cat) === movFiltro.cat) &&
    (!q || normalizar(m.nota).includes(q) || normalizar(catConfig[m.cat]?.label).includes(q))
  ).sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id);

  document.querySelectorAll('#mov-tipos [data-tipo]').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.tipo === movFiltro.tipo)));

  if (!movimientos.length) {
    lista.innerHTML = `<div class="mov-vacio">
      <div class="mov-vacio-tit">Todavía no anotas movimientos</div>
      <p>Anota cada gasto en segundos, o importa la cartola de tu banco para cargar el mes de una vez.</p>
      <div class="mov-vacio-btns">
        <button type="button" class="btn btn-primary btn-sm" onclick="abrirMovSheet()">+ Anotar un gasto</button>
        <button type="button" class="btn btn-outline btn-sm" onclick="abrirImportar()">Importar cartola</button>
      </div></div>`;
  } else if (!vis.length) {
    lista.innerHTML = `<div class="mov-vacio"><p>No hay movimientos que coincidan en ${nombreMes(movFiltro.mes)}.</p></div>`;
  } else {
    const porDia = {};
    vis.forEach(m => (porDia[m.fecha] = porDia[m.fecha] || []).push(m));
    lista.innerHTML = Object.keys(porDia).map(f => {
      const d = new Date(f + 'T12:00:00');
      const etiqueta = f === hoyISO() ? 'Hoy' : d.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'short' });
      return `<div class="mov-dia">${esc(etiqueta)}</div>` + porDia[f].map(m => `
        <div class="mov-item">
          <span class="mov-cat-ico" style="background:${m.tipo === 'ingreso' ? '#12805c' : (catConfig[m.cat]?.color || '#6b7280')}1f" aria-hidden="true">${m.tipo === 'ingreso' ? '💵' : (catConfig[m.cat]?.label || '?').split(' ')[0]}</span>
          <span class="mov-txt">
            <span class="mov-nota">${esc(m.nota || (m.tipo === 'ingreso' ? 'Ingreso' : (catConfig[m.cat]?.label || '').replace(/^\S+\s/, '')))}</span>
            <span class="mov-meta">${m.tipo === 'ingreso' ? 'Ingreso' : esc((catConfig[m.cat]?.label || '').replace(/^\S+\s/, ''))}${m.recId ? ' · <span class="mov-rec">Mensual</span>' : ''}</span>
          </span>
          <span class="mov-monto ${m.tipo}">${m.tipo === 'ingreso' ? '+' : '−'}${fmt(m.monto)}</span>
          <button type="button" class="mov-accion" onclick="abrirMovSheet(${m.id})" aria-label="Editar ${esc(m.nota || 'movimiento')} del ${esc(f)}">Editar</button>
        </div>`).join('');
    }).join('');
  }
  renderRecurrentes();
}

function renderRecurrentes() {
  const cont = $('rec-lista');
  if (!cont) return;
  $('rec-count').textContent = recurrentes.length ? `(${recurrentes.length})` : '';
  cont.innerHTML = recurrentes.length
    ? recurrentes.map(r => `
      <div class="rec-item">
        <span><strong>${esc(r.nota || catConfig[r.cat]?.label || 'Recurrente')}</strong>
          <span class="mov-meta"> · día ${r.dia} de cada mes · ${r.tipo === 'ingreso' ? 'ingreso' : esc((catConfig[r.cat]?.label || '').replace(/^\S+\s/, ''))}</span></span>
        <span class="mov-monto ${r.tipo}">${fmt(r.monto)}</span>
        <button type="button" class="mov-accion" onclick="borrarRecurrente(${r.id})" aria-label="Dejar de repetir ${esc(r.nota || 'este movimiento')}">Quitar</button>
      </div>`).join('')
    : '<p class="mov-meta">Marca "Se repite cada mes" al anotar el arriendo, tu sueldo o una suscripción, y se anotan solos.</p>';
}

function movSetTipo(t) { movFiltro.tipo = t; renderMovimientos(); }
function movSetMes(v)  { movFiltro.mes = v; renderMovimientos(); }
function movSetCat(v)  { movFiltro.cat = v; renderMovimientos(); }
function movSetQ(v)    { movFiltro.q = v; renderMovimientos(); }

/** Después de cualquier cambio: guardar y refrescar lo que depende de los movimientos. */
function trasCambioMov() {
  guardarMovimientos();
  renderMovimientos();
  if (typeof refrescarTodo === 'function') refrescarTodo();
}

function borrarRecurrente(id) {
  if (!confirm('¿Dejar de repetir este movimiento? Los que ya se anotaron se mantienen.')) return;
  recurrentes = recurrentes.filter(r => r.id !== id);
  trasCambioMov();
}

/* ── Hoja para anotar o editar ──────────────────────────────────── */
let _movTipoSheet = 'gasto';
let _movCatSheet  = 1;

function abrirMovSheet(id) {
  const m = id ? movimientos.find(x => x.id === id) : null;
  _movEditando = m ? m.id : null;
  _movTipoSheet = m ? m.tipo : 'gasto';
  _movCatSheet  = m ? m.cat : 1;
  $('movs-titulo').textContent = m ? 'Editar movimiento' : 'Nuevo movimiento';
  $('movs-monto').value = m ? m.monto.toLocaleString('es-CL') : '';
  $('movs-fecha').value = m ? m.fecha : hoyISO();
  $('movs-fecha').max   = hoyISO();
  $('movs-nota').value  = m ? m.nota : '';
  $('movs-rec').checked = false;
  $('movs-rec-wrap').style.display = m ? 'none' : '';
  $('movs-borrar').style.display = m ? '' : 'none';
  $('movs-error').textContent = '';
  pintarSheet();
  SF_MODAL.abrir($('mov-sheet'), cerrarMovSheet);
  setTimeout(() => $('movs-monto').focus(), 60);
}
function cerrarMovSheet() { SF_MODAL.cerrar($('mov-sheet')); }

function movSheetTipo(t) { _movTipoSheet = t; pintarSheet(); }
function movSheetCat(c)  { _movCatSheet = c; pintarSheet(); }

function pintarSheet() {
  document.querySelectorAll('#movs-tipo [data-tipo]').forEach(b =>
    b.setAttribute('aria-checked', String(b.dataset.tipo === _movTipoSheet)));
  $('movs-cats-wrap').style.display = _movTipoSheet === 'gasto' ? '' : 'none';
  $('movs-cats').innerHTML = catConfig.map((c, i) => `
    <button type="button" class="movs-cat" aria-pressed="${i === _movCatSheet}" onclick="movSheetCat(${i})">
      <span aria-hidden="true">${c.label.split(' ')[0]}</span>${c.label.replace(/^\S+\s/, '')}</button>`).join('');
  $('movs-guardar').textContent = _movTipoSheet === 'gasto' ? 'Guardar gasto' : 'Guardar ingreso';
  movSheetAviso();
}

/** Lee "$ 12.990" o "12990" como número. */
function leerMonto(t) {
  return parseInt(String(t).replace(/[^\d]/g, ''), 10) || 0;
}
function movFormatear(inp) {
  const n = leerMonto(inp.value);
  inp.value = n ? n.toLocaleString('es-CL') : '';
  movSheetAviso();
}

/** Muestra al tiro cuánto queda en la categoría si se guarda el gasto. */
function movSheetAviso() {
  const el = $('movs-aviso');
  if (!el) return;
  const monto = leerMonto($('movs-monto').value);
  const fecha = $('movs-fecha').value || hoyISO();
  if (_movTipoSheet !== 'gasto' || !monto) { el.style.display = 'none'; return; }
  const mes = fecha.slice(0, 7);
  const plan = (typeof planDelMes === 'function') ? (planDelMes(mes)[_movCatSheet] || 0) : 0;
  const gastado = (gastoMesPorCat(mes)[_movCatSheet] || 0) -
    (_movEditando ? (movimientos.find(m => m.id === _movEditando)?.monto || 0) : 0);
  const nombre = catConfig[_movCatSheet].label.replace(/^\S+\s/, '');
  el.style.display = '';
  if (!plan) {
    el.className = 'movs-aviso';
    el.textContent = `${nombre} no tiene presupuesto este mes. Puedes asignarle uno en Plan.`;
  } else {
    const queda = plan - gastado - monto;
    el.className = 'movs-aviso ' + (queda < 0 ? 'excede' : 'ok');
    el.textContent = queda < 0
      ? `${nombre}: quedarías ${fmt(-queda)} sobre lo presupuestado.`
      : `${nombre}: te quedarán ${fmt(queda)} este mes.`;
  }
}

function guardarMovSheet() {
  const monto = leerMonto($('movs-monto').value);
  const fecha = $('movs-fecha').value;
  if (!monto) { $('movs-error').textContent = 'Escribe el monto.'; $('movs-monto').focus(); return; }
  if (!fecha) { $('movs-error').textContent = 'Elige la fecha.'; return; }
  const datos = {
    fecha, tipo: _movTipoSheet, monto,
    cat : _movTipoSheet === 'gasto' ? _movCatSheet : 8,
    nota: $('movs-nota').value.trim().slice(0, 80)
  };
  if (_movEditando) {
    const m = movimientos.find(x => x.id === _movEditando);
    // Si una instancia de un recurrente cambia de mes, su mes original
    // queda excluido para que no se vuelva a crear al recargar.
    if (m.recId && m.fecha.slice(0, 7) !== datos.fecha.slice(0, 7)) excluirMesRecurrente(m.recId, m.fecha.slice(0, 7));
    Object.assign(m, datos);
  } else if ($('movs-rec').checked) {
    const r = { id: ++_movId, tipo: datos.tipo, monto, cat: datos.cat, nota: datos.nota,
                dia: parseInt(fecha.slice(8), 10), desde: fecha.slice(0, 7) };
    recurrentes.push(r);
    movimientos.push({ id: ++_movId, ...datos, recId: r.id });
    generarRecurrentes();   // si empieza en un mes pasado, completa hasta hoy
  } else {
    movimientos.push({ id: ++_movId, ...datos });
  }
  movFiltro.mes = fecha.slice(0, 7);
  cerrarMovSheet();
  trasCambioMov();
  SF_FEATURES.showToast(_movEditando ? 'Movimiento actualizado' : 'Movimiento anotado');
}

function excluirMesRecurrente(recId, mes) {
  const r = recurrentes.find(x => x.id === recId);
  if (!r) return;
  r.excluidos = [...new Set([...(r.excluidos || []), mes])];
}

function borrarMovSheet() {
  if (!_movEditando) return;
  const m = movimientos.find(x => x.id === _movEditando);
  const msg = m?.recId
    ? '¿Borrar el movimiento de este mes? Los demás meses se siguen anotando solos (para dejar de repetirlo, quítalo en "Se repiten cada mes").'
    : '¿Borrar este movimiento?';
  if (!confirm(msg)) return;
  if (m?.recId) excluirMesRecurrente(m.recId, m.fecha.slice(0, 7));
  movimientos = movimientos.filter(x => x.id !== _movEditando);
  cerrarMovSheet();
  trasCambioMov();
}

/* ================================================================
   IMPORTAR CARTOLA (CSV)
   Los bancos chilenos exportan en formatos distintos, así que se pide
   indicar qué columna es qué. Se aceptan montos chilenos ("-12.990",
   "$ 1.234.567") y fechas dd/mm/aaaa, dd-mm-aaaa o aaaa-mm-dd.
   ================================================================ */
let _imp = { filas: [], cab: [], propuestos: [] };

function abrirImportar() {
  _imp = { filas: [], cab: [], propuestos: [] };
  $('cart-archivo').value = '';
  $('cart-paso2').style.display = 'none';
  $('cart-confirmar').disabled = true;
  $('cart-confirmar').textContent = 'Importar';
  $('cart-error').textContent = '';
  renderReglas();
  SF_MODAL.abrir($('cart-modal'), cerrarImportar);
}
function cerrarImportar() { SF_MODAL.cerrar($('cart-modal')); }

/** Parte una línea CSV respetando comillas. */
function partirCSV(linea, sep) {
  const out = []; let cur = '', comillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') { if (comillas && linea[i + 1] === '"') { cur += '"'; i++; } else comillas = !comillas; }
    else if (c === sep && !comillas) { out.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}

function leerCSV(texto) {
  const lineas = texto.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (lineas.length < 2) return null;
  const muestra = lineas.slice(0, 5).join('\n');
  const sep = [';', ',', '\t'].sort((a, b) => muestra.split(b).length - muestra.split(a).length)[0];
  const filas = lineas.map(l => partirCSV(l, sep));
  // La cabecera es la primera fila con 3 o más celdas no numéricas
  let iCab = filas.findIndex(f => f.filter(c => c && isNaN(leerNumeroCL(c))).length >= 3);
  if (iCab < 0) iCab = 0;
  return { cab: filas[iCab], filas: filas.slice(iCab + 1).filter(f => f.length >= 2) };
}

/** "−12.990", "$ 1.234.567", "1234,50" → número con signo. */
function leerNumeroCL(t) {
  let s = String(t).replace(/\s|\$|CLP/gi, '');
  if (!s) return NaN;
  const neg = /^[-−(]/.test(s) || /-$/.test(s);
  s = s.replace(/[-−()]/g, '');
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/[.,]/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? NaN : (neg ? -n : n);
}

/** Quita prefijos que los bancos ponen a todo ("COMPRA ", "PAGO EN ") para que se lea el comercio. */
function limpiarGlosa(t) {
  return String(t || '').replace(/^\s*(COMPRA|PAGO|CARGO|GIRO)( EN| DE)?\s+/i, '').trim().slice(0, 80);
}

/** dd/mm/aaaa, dd-mm-aaaa, dd/mm/aa o aaaa-mm-dd → AAAA-MM-DD. */
function leerFecha(t) {
  const s = String(t).trim();
  let a, mes, d, m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) { a = +m[1]; mes = +m[2]; d = +m[3]; }
  else if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) {
    a = m[3].length === 2 ? 2000 + +m[3] : +m[3]; mes = +m[2]; d = +m[1];
  } else return null;
  // Rechaza fechas que no existen, como 31/09 o 29/02 de un año no bisiesto
  const f = new Date(a, mes - 1, d);
  if (f.getFullYear() !== a || f.getMonth() !== mes - 1 || f.getDate() !== d) return null;
  return `${a}-${pad2(mes)}-${pad2(d)}`;
}

function importarArchivo(input) {
  const f = input.files?.[0];
  $('cart-error').textContent = '';
  if (!f) return;
  if (!/\.(csv|txt)$/i.test(f.name)) {
    $('cart-error').textContent = 'Por ahora se aceptan archivos CSV. Si tu banco entrega Excel, ábrelo y guárdalo como CSV.';
    return;
  }
  const lector = new FileReader();
  lector.onload = () => {
    const r = leerCSV(String(lector.result));
    if (!r) { $('cart-error').textContent = 'El archivo no tiene filas para importar.'; return; }
    _imp.cab = r.cab; _imp.filas = r.filas;
    const opts = '<option value="">—</option>' + r.cab.map((c, i) => `<option value="${i}">${esc(c || 'Columna ' + (i + 1))}</option>`).join('');
    ['cart-col-fecha', 'cart-col-desc', 'cart-col-monto', 'cart-col-cargo', 'cart-col-abono'].forEach(id => $(id).innerHTML = opts);
    // Adivinar columnas por el nombre
    const buscar = re => r.cab.findIndex(c => re.test(normalizar(c)));
    const sel = (id, i) => { if (i >= 0) $(id).value = String(i); };
    sel('cart-col-fecha', buscar(/FECHA/));
    sel('cart-col-desc', buscar(/DESCRIP|DETALLE|GLOSA|MOVIMIENTO|COMERCIO/));
    sel('cart-col-cargo', buscar(/CARGO|DEBITO|GIRO/));
    sel('cart-col-abono', buscar(/ABONO|CREDITO|DEPOSITO/));
    if ($('cart-col-cargo').value === '') sel('cart-col-monto', buscar(/MONTO|IMPORTE|VALOR/));
    $('cart-paso2').style.display = '';
    previsualizarImportacion();
  };
  lector.onerror = () => { $('cart-error').textContent = 'No se pudo leer el archivo.'; };
  lector.readAsText(f, 'utf-8');
}

function previsualizarImportacion() {
  const col = id => $(id).value === '' ? -1 : parseInt($(id).value, 10);
  const cF = col('cart-col-fecha'), cD = col('cart-col-desc'), cM = col('cart-col-monto'),
        cC = col('cart-col-cargo'), cA = col('cart-col-abono');
  const prop = [];
  let malas = 0;
  _imp.filas.forEach(f => {
    const fecha = cF >= 0 ? leerFecha(f[cF]) : null;
    let monto = NaN;
    if (cC >= 0 || cA >= 0) {
      const cargo = cC >= 0 ? Math.abs(leerNumeroCL(f[cC]) || 0) : 0;
      const abono = cA >= 0 ? Math.abs(leerNumeroCL(f[cA]) || 0) : 0;
      monto = abono - cargo;
    } else if (cM >= 0) monto = leerNumeroCL(f[cM]);
    if (!fecha || !monto || isNaN(monto)) { malas++; return; }
    const original = cD >= 0 ? String(f[cD]) : '';
    const nota = limpiarGlosa(original);
    const tipo = monto < 0 ? 'gasto' : 'ingreso';
    // Duplicado: mismo día, tipo y monto. No se exige la misma descripción
    // porque lo anotado a mano ("Netflix") casi nunca calza con la glosa
    // del banco ("NETFLIX.COM"). Queda desmarcado, pero se puede incluir.
    const dup = movimientos.some(m => m.fecha === fecha && m.monto === Math.round(Math.abs(monto)) && m.tipo === tipo);
    prop.push({ fecha, tipo, monto: Math.round(Math.abs(monto)), nota, cat: tipo === 'gasto' ? categoriaPara(original) : 8, original, incluir: !dup, dup });
  });
  _imp.propuestos = prop;
  const tabla = $('cart-preview');
  if (!prop.length) {
    tabla.innerHTML = '<p class="mov-meta">Indica al menos la columna de fecha y la de monto (o cargo y abono).</p>';
    $('cart-confirmar').disabled = true;
    return;
  }
  tabla.innerHTML = `<table class="cart-tabla">
    <thead><tr><th scope="col"><span class="sr-only">Incluir</span></th><th scope="col">Fecha</th><th scope="col">Descripción</th><th scope="col">Categoría</th><th scope="col" style="text-align:right">Monto</th></tr></thead>
    <tbody>${prop.slice(0, 300).map((p, i) => `<tr>
      <td><input type="checkbox" ${p.incluir ? 'checked' : ''} onchange="_imp.propuestos[${i}].incluir=this.checked;contarImportacion()" aria-label="Incluir ${esc(p.nota)}"></td>
      <td>${p.fecha.split('-').reverse().join('/')}</td>
      <td>${esc(p.nota)}${p.dup ? ' <span class="mov-rec">posible duplicado</span>' : ''}</td>
      <td>${p.tipo === 'gasto'
        ? `<select onchange="_imp.propuestos[${i}].cat=+this.value" aria-label="Categoría de ${esc(p.nota)}">${catConfig.map((c, ci) => `<option value="${ci}"${ci === p.cat ? ' selected' : ''}>${c.label}</option>`).join('')}</select>`
        : 'Ingreso'}</td>
      <td class="mov-monto ${p.tipo}" style="text-align:right">${p.tipo === 'ingreso' ? '+' : '−'}${fmt(p.monto)}</td>
    </tr>`).join('')}</tbody></table>
    ${malas ? `<p class="mov-meta">${malas} filas sin fecha o monto válidos se ignoran.</p>` : ''}
    ${prop.length > 300 ? '<p class="mov-meta">Se muestran las primeras 300 filas.</p>' : ''}`;
  contarImportacion();
}

function contarImportacion() {
  const n = _imp.propuestos.filter(p => p.incluir).length;
  $('cart-confirmar').disabled = n === 0;
  $('cart-confirmar').textContent = n ? `Importar ${n} ${n === 1 ? 'movimiento' : 'movimientos'}` : 'Nada nuevo para importar';
}

function confirmarImportacion() {
  const sel = _imp.propuestos.filter(p => p.incluir);
  sel.forEach(p => movimientos.push({ id: ++_movId, fecha: p.fecha, tipo: p.tipo, monto: p.monto, cat: p.cat, nota: p.nota }));
  if (sel.length) movFiltro.mes = sel.map(p => p.fecha).sort().pop().slice(0, 7);
  cerrarImportar();
  trasCambioMov();
  SF_FEATURES.showToast(sel.length === 1 ? '1 movimiento importado' : `${sel.length} movimientos importados`);
}

function agregarRegla() {
  const texto = $('regla-texto').value.trim();
  const cat = parseInt($('regla-cat').value, 10);
  if (!texto) return;
  reglas = reglas.filter(r => normalizar(r.texto) !== normalizar(texto));
  reglas.unshift({ texto, cat });
  $('regla-texto').value = '';
  guardarMovimientos();
  renderReglas();
  // Recategorizar la vista previa con la regla nueva
  _imp.propuestos.forEach(p => { if (p.tipo === 'gasto') p.cat = categoriaPara(p.original); });
  if (_imp.propuestos.length) previsualizarImportacion();
}
function borrarRegla(i) { reglas.splice(i, 1); guardarMovimientos(); renderReglas(); }
function renderReglas() {
  const c = $('regla-lista');
  if (!c) return;
  $('regla-cat').innerHTML = catConfig.map((x, i) => `<option value="${i}">${x.label}</option>`).join('');
  c.innerHTML = reglas.length
    ? reglas.map((r, i) => `<span class="regla-chip">"${esc(r.texto)}" → ${esc(catConfig[r.cat]?.label || '')}
        <button type="button" onclick="borrarRegla(${i})" aria-label="Borrar la regla ${esc(r.texto)}">×</button></span>`).join('')
    : '<span class="mov-meta">Sin reglas propias. Ya reconocemos comercios comunes (supermercados, Uber, Netflix, Enel…).</span>';
}
