/* ============================================================
   PARÁMETROS LEGALES CHILENOS
   Todas las cifras legales de la app viven acá, cada una con su
   fuente y la fecha desde la que rige. Antes estaban repartidas por
   el HTML y el JS, y al cambiar una ley quedaban copias viejas
   (la retención de boletas decía 14,5% "tasa legal 2026" cuando en
   2026 es 15,25%). Para actualizar un valor: se edita acá y nada más.
   Revisado: 9 de octubre de 2026.
   ============================================================ */
const PARAMS_CL = {
  retencionHonorarios: {
    valor: 0.1525,
    vigenteDesde: '2026-01-01',
    fuente: 'SII, Ley 21.133 (alza gradual hasta 17% en 2028)',
    url: 'https://www.sii.cl/destacados/boletas_honorarios/index.html'
  },
  jornadaSemanal: {
    valor: 42,
    vigenteDesde: '2026-04-26',
    fuente: 'Ley 21.561 (40 horas): 44 h desde 2024, 42 h desde abril de 2026, 40 h en abril de 2028',
    url: 'https://www.bcn.cl/leychile/navegar?idLey=21561'
  },
  topeImponibleUF: {
    valor: 90,
    vigenteDesde: '2026-02-01',
    fuente: 'Superintendencia de Pensiones, tope para AFP, salud y accidentes del trabajo',
    url: 'https://www.spensiones.cl'
  },
  topeCesantiaUF: {
    valor: 135.2,
    vigenteDesde: '2026-02-01',
    fuente: 'Superintendencia de Pensiones, tope del seguro de cesantía',
    url: 'https://www.spensiones.cl'
  },
  iva: {
    valor: 0.19,
    vigenteDesde: '2003-10-01',
    fuente: 'SII, DL 825',
    url: 'https://www.sii.cl'
  },
  /* Tasa Máxima Convencional, operaciones no reajustables en pesos de
     90 días o más. Es anual y lineal (base 360), así que la mensual es
     la anual dividida por 12. Cambia cada mes: hay que copiar el
     certificado nuevo de la CMF cuando se publica. */
  tmc: {
    tramos: [
      { hastaUF: 50,       anual: 0.4106, nombre: 'hasta 50 UF' },
      { hastaUF: 200,      anual: 0.3406, nombre: 'entre 50 y 200 UF' },
      { hastaUF: 5000,     anual: 0.3009, nombre: 'entre 200 y 5.000 UF' },
      { hastaUF: Infinity, anual: 0.0996, nombre: 'sobre 5.000 UF' }
    ],
    /* Operaciones reajustables en UF de 1 año o más y en moneda extranjera:
       tasas anuales compuestas, mucho más bajas que las de pesos. */
    reajustable: [
      { hastaUF: 2000,     anual: 0.0651, nombre: 'en UF de 1 año o más, hasta 2.000 UF' },
      { hastaUF: Infinity, anual: 0.0603, nombre: 'en UF de 1 año o más, sobre 2.000 UF' }
    ],
    extranjera: [
      { hastaUF: 2000,     anual: 0.1539, nombre: 'en moneda extranjera, hasta 2.000 UF' },
      { hastaUF: Infinity, anual: 0.0867, nombre: 'en moneda extranjera, sobre 2.000 UF' }
    ],
    vigenteDesde: '2026-09-15',
    fuente: 'CMF, certificado N° 09/2026 (Diario Oficial del 15/09/2026)',
    url: 'https://www.cmfchile.cl/portal/estadisticas/626/w4-propertyvalue-29487.html'
  },
  /* Compras internacionales. Desde la Ley 21.713, hasta USD 500 se
     paga solo IVA; sobre USD 500 rige el régimen general (arancel 6%
     más IVA). Un TLC con certificado de origen puede dejar el arancel
     en 0%. */
  importacion: {
    umbralUSD: 500,
    arancelGeneral: 0.06,
    vigenteDesde: '2025-10-25',
    fuente: 'Servicio Nacional de Aduanas, Ley 21.713',
    url: 'https://www.aduana.cl/sin-arancel-aduanero-hasta-usd-500/aduana/2025-10-20/174429.html'
  }
};

/** "15/09/2026" a partir de "2026-09-15". */
function fechaCL(iso) {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

/** Línea corta de procedencia para mostrar junto a un resultado. */
function vigenciaHTML(param) {
  return `Vigente desde el ${fechaCL(param.vigenteDesde)} · <a href="${param.url}" target="_blank" rel="noopener">${param.fuente}</a>`;
}

/** Porcentaje en formato chileno: 0.1525 → "15,25%". */
function pctCL(v, dec = 2) {
  return (v * 100).toLocaleString('es-CL', { minimumFractionDigits: 0, maximumFractionDigits: dec }) + '%';
}

/** Tramo de TMC que corresponde a un monto en UF y a la moneda del crédito.
    En pesos la tasa es anual lineal; en UF y en moneda extranjera, compuesta. */
function tmcPara(montoUF, moneda = 'CLP') {
  const T = PARAMS_CL.tmc;
  if (moneda === 'UF')  return { ...T.reajustable.find(t => montoUF <= t.hastaUF), compuesta: true };
  if (moneda === 'USD') return { ...T.extranjera.find(t => montoUF <= t.hastaUF), compuesta: true };
  return { ...T.tramos.find(t => montoUF <= t.hastaUF), compuesta: false };
}
