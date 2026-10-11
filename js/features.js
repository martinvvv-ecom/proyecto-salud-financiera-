/* ================================================================
   SALUD FINANCIERA — FEATURES.JS
   Funcionalidades añadidas al MVP original:
   1. Splash screen + Onboarding tour primera vez
   2. Login simulado (perfil con avatar e iniciales)
   3. Web Share API + fallback copiar al portapapeles
   4. PWA install prompt
   5. Página "Acerca de" con equipo, stats y QR
   6. Modo presentación (auto-tour)
   ================================================================ */

/* ============================================================
   MODALES ACCESIBLES
   Al abrir: el foco entra al modal y Tab no se escapa de él. Al cerrar:
   vuelve al botón que lo abrió. Escape cierra.
   ============================================================ */
const SF_MODAL = {
  _abierto: null,
  _origen : null,
  _cerrar : null,
  abrir(modal, cerrar) {
    if (!modal) return;
    this._origen  = document.activeElement;
    this._abierto = modal;
    this._cerrar  = cerrar;
    modal.classList.add('open');
    const foco = modal.querySelector('input, button:not(.modal-close), [href], select, textarea') || modal.querySelector('button');
    setTimeout(() => foco?.focus(), 30);
    document.addEventListener('keydown', this._tecla);
  },
  cerrar(modal) {
    if (!modal || !modal.classList.contains('open')) return;
    modal.classList.remove('open');
    if (this._abierto === modal) {
      document.removeEventListener('keydown', this._tecla);
      this._abierto = null;
      this._origen?.focus?.();
    }
  },
  _tecla(e) {
    const m = SF_MODAL._abierto;
    if (!m) return;
    if (e.key === 'Escape') { SF_MODAL._cerrar?.(); return; }
    if (e.key !== 'Tab') return;
    const f = [...m.querySelectorAll('a[href], button:not([disabled]), input:not([type="hidden"]), select, textarea')]
      .filter(el => el.offsetParent !== null);
    if (!f.length) return;
    const primero = f[0], ultimo = f[f.length - 1];
    if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
  }
};

const SF_FEATURES = {
  // ────────────────────────────────────────────────────────────
  // CONFIG
  // ────────────────────────────────────────────────────────────
  LS_KEYS: {
    onboardDone: 'sf_onboard_done',
    profile:     'sf_profile',
    pwaDismissed: 'sf_pwa_dismissed'
  },

  // Estado del onboarding
  onboardStep: 0,
  // Tres pasos que dicen qué hacer, no cinco diapositivas de presentación
  onboardSteps: [
    {
      emoji: '1',
      title: 'Anota tu sueldo',
      text: 'En Movimientos, toca "+" y anota lo que te llega al mes. Márcalo como "se repite cada mes" y no tendrás que volver a escribirlo.'
    },
    {
      emoji: '2',
      title: 'Anota tus gastos',
      text: 'Cada gasto en segundos con el botón "+", o importa la cartola de tu banco en CSV para cargar el mes de una vez.'
    },
    {
      emoji: '3',
      title: 'Mira tu disponible y tu score',
      text: 'En Inicio verás cuánto te queda para el mes y tu score de salud financiera, con la acción que más lo sube. Todo queda solo en este navegador.'
    }
  ],

  // ────────────────────────────────────────────────────────────
  // INIT — llamar desde app.js al final del DOMContentLoaded
  // ────────────────────────────────────────────────────────────
  init() {
    this.initProfile();
    this.initOnboarding();
    this.initShareButton();
    this.initPWA();
    this.initAboutPage();
  },

  // ============================================================
  // 1. ONBOARDING — Tour interactivo primera vez
  // ============================================================
  initOnboarding() {
    const done = localStorage.getItem(this.LS_KEYS.onboardDone);
    if (done === '1') return;

    // Antes se pedía el nombre en un "inicio de sesión" simulado antes de
    // mostrar nada. No hay cuentas: el nombre es opcional y está en Ajustes.
    setTimeout(() => this.startOnboarding(), 400);
  },

  startOnboarding() {
    this.onboardStep = 0;
    const overlay = document.createElement('div');
    overlay.className = 'splash-overlay';
    overlay.id = 'splash-overlay';
    // Diálogo accesible: lector de pantalla, foco adentro y Escape cierra
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'onboard-title');
    overlay.innerHTML = this.renderOnboardCard();
    document.body.appendChild(overlay);
    this._onboardTecla = e => { if (e.key === 'Escape') this.finishOnboarding(); };
    document.addEventListener('keydown', this._onboardTecla);
    setTimeout(() => overlay.querySelector('.onboard-next')?.focus(), 50);
  },

  renderOnboardCard() {
    const step = this.onboardSteps[this.onboardStep];
    const isLast = this.onboardStep === this.onboardSteps.length - 1;
    const dots = this.onboardSteps.map((_, i) =>
      `<div class="onboard-dot ${i === this.onboardStep ? 'active' : ''}"></div>`
    ).join('');

    return `
      <div class="onboard-card">
        <div class="onboard-emoji">${step.emoji}</div>
        <div class="onboard-title" id="onboard-title">${step.title}</div>
        <div class="onboard-text">${step.text}</div>
        <div class="onboard-dots">${dots}</div>
        <div class="onboard-actions">
          <button class="onboard-skip" onclick="SF_FEATURES.finishOnboarding()">
            ${isLast ? '' : 'Saltar tutorial'}
          </button>
          <button class="onboard-next" onclick="SF_FEATURES.nextOnboard()">
            ${isLast ? 'Empezar' : 'Siguiente →'}
          </button>
        </div>
      </div>
    `;
  },

  nextOnboard() {
    if (this.onboardStep < this.onboardSteps.length - 1) {
      this.onboardStep++;
      const overlay = document.getElementById('splash-overlay');
      if (overlay) { overlay.innerHTML = this.renderOnboardCard(); overlay.querySelector('.onboard-next')?.focus(); }
    } else {
      this.finishOnboarding();
    }
  },

  finishOnboarding() {
    if (this._onboardTecla) { document.removeEventListener('keydown', this._onboardTecla); this._onboardTecla = null; }
    const overlay = document.getElementById('splash-overlay');
    if (overlay) {
      overlay.classList.add('hiding');
      setTimeout(() => overlay.remove(), 500);
    }
    localStorage.setItem(this.LS_KEYS.onboardDone, '1');
  },

  // ============================================================
  // 2. NOMBRE (opcional, solo para saludar; no hay cuentas)
  // ============================================================
  initProfile() {
    const profile = this.getProfile();
    this.renderProfileButton(profile);
  },

  getProfile() {
    try {
      const raw = localStorage.getItem(this.LS_KEYS.profile);
      return raw ? JSON.parse(raw) : null;
    } catch(e) { return null; }
  },

  saveProfile(profile) {
    localStorage.setItem(this.LS_KEYS.profile, JSON.stringify(profile));
    this.renderProfileButton(profile);
  },

  getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || name[0].toUpperCase();
  },

  renderProfileButton(profile) {
    const btn = document.getElementById('profile-btn');
    if (!btn) return;
    if (profile && profile.name) {
      btn.classList.remove('empty');
      btn.textContent = this.getInitials(profile.name);
      btn.title = `${profile.name} — tu nombre`;
    } else {
      btn.classList.add('empty');
      btn.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#i-user"></use></svg>';
      btn.title = 'Agregar tu nombre (opcional)';
    }
  },

  openProfileModal() {
    const profile = this.getProfile();
    if (!profile) {
      this.showProfileSetup();
      return;
    }
    const modal = document.getElementById('profile-modal');
    document.getElementById('profile-modal-avatar').textContent = this.getInitials(profile.name);
    document.getElementById('profile-modal-name').textContent = profile.name;
    document.getElementById('profile-modal-meta').textContent =
      'Solo se usa para saludarte. Queda en este navegador.';
    SF_MODAL.abrir(modal, () => this.closeProfileModal());
  },

  closeProfileModal() {
    SF_MODAL.cerrar(document.getElementById('profile-modal'));
    SF_MODAL.cerrar(document.getElementById('profile-setup-modal'));
  },

  showProfileSetup(onDone) {
    const modal = document.getElementById('profile-setup-modal');
    SF_MODAL.abrir(modal, () => this.closeProfileModal());
    this._profileSetupCallback = onDone || null;
  },

  submitProfileSetup() {
    const name = document.getElementById('profile-name-input').value.trim();
    if (!name || name.length < 2) {
      document.getElementById('profile-name-input').focus();
      return;
    }
    const profile = { name, created: Date.now() };
    this.saveProfile(profile);
    this.closeProfileModal();
    if (this._profileSetupCallback) {
      const cb = this._profileSetupCallback;
      this._profileSetupCallback = null;
      setTimeout(cb, 200);
    }
  },

  logoutProfile() {
    if (!confirm('¿Borrar tu nombre? Tus datos se mantienen.')) return;
    localStorage.removeItem(this.LS_KEYS.profile);
    this.renderProfileButton(null);
    this.closeProfileModal();
  },

  resetAllData() {
    if (!confirm('⚠️ ¿Borrar TODOS tus datos? Esto eliminará presupuesto, gastos, vencimientos, badges y perfil. Esta acción no se puede deshacer.')) return;
    // Limpiar todas las claves de Salud Financiera
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith('sf_')) localStorage.removeItem(k);
    });
    location.reload();
  },

  // ============================================================
  // 3. WEB SHARE API + Portapapeles
  // ============================================================
  initShareButton() {
    // El botón se renderiza vía HTML en la página; solo se necesita la lógica
  },

  async shareReport() {
    // El score sale del cálculo, no del texto del velocímetro: el DOM
    // puede mostrar un número a mitad de animación (se llegó a
    // compartir "0/1000") o uno simulado.
    // Siempre el mes en curso, y sin puntaje si faltan datos
    const s = sinDatos(mesHoy()) ? null : calcularScore(mesHoy());
    const score = !s || s.incompleto ? null : s.score;
    const text = score === null
      ? `Estoy ordenando mis finanzas con Salud Financiera 💚\n\nUna plataforma gratuita para gestionar tus finanzas en Chile.`
      : `Estoy mejorando mi salud financiera 💚\n\nMi Score actual: ${score}/1000\n\nDescubre Salud Financiera, una plataforma gratuita para gestionar tus finanzas en Chile.`;
    const url = location.origin + location.pathname;
    return this.compartir(text, url);
  },

  /** "Compartir enlace" comparte solo el enlace, sin el score. */
  async shareLink() {
    return this.compartir('Salud Financiera: una plataforma gratuita para gestionar tus finanzas en Chile.',
      location.origin + location.pathname);
  },

  async compartir(text, url) {

    // Web Share API nativo
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Salud Financiera',
          text,
          url
        });
        return;
      } catch(e) {
        if (e.name === 'AbortError') return; // user cancelled
      }
    }

    // Fallback: copiar al portapapeles
    try {
      await navigator.clipboard.writeText(`${text}\n\n${url}`);
      this.showToast('✓ Texto copiado al portapapeles');
    } catch(e) {
      this.showToast('No se pudo compartir. Prueba en otro navegador.');
    }
  },

  showToast(msg) {
    let toast = document.getElementById('copy-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'copy-toast';
      toast.className = 'copy-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2400);
  },

  // ============================================================
  // 4. PWA INSTALL PROMPT
  // ============================================================
  deferredPrompt: null,

  initPWA() {
    // Registrar service worker
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
          .then(reg => console.log('[PWA] Service worker registrado:', reg.scope))
          .catch(err => console.warn('[PWA] Error en SW:', err));
      });
    }

    // Capturar evento beforeinstallprompt
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e;
      const dismissed = localStorage.getItem(this.LS_KEYS.pwaDismissed);
      if (dismissed !== '1') {
        // Mostrar banner después de 8s para no molestar de inmediato
        setTimeout(() => this.showPwaBanner(), 8000);
      }
    });

    // Detectar si ya está instalado
    window.addEventListener('appinstalled', () => {
      this.hidePwaBanner();
      this.showToast('✓ Salud Financiera instalada');
    });
  },

  showPwaBanner() {
    const banner = document.getElementById('pwa-banner');
    if (banner && this.deferredPrompt) banner.classList.add('show');
  },

  hidePwaBanner() {
    document.getElementById('pwa-banner')?.classList.remove('show');
  },

  async installPwa() {
    if (!this.deferredPrompt) return;
    this.deferredPrompt.prompt();
    const { outcome } = await this.deferredPrompt.userChoice;
    if (outcome === 'accepted') this.showToast('¡Listo! Buscala en tu pantalla de inicio.');
    this.deferredPrompt = null;
    this.hidePwaBanner();
  },

  dismissPwa() {
    this.hidePwaBanner();
    localStorage.setItem(this.LS_KEYS.pwaDismissed, '1');
  },

  // ============================================================
  // 5. PÁGINA "ACERCA DE" — Equipo, stats, QR
  // ============================================================
  initAboutPage() {
    // Si la página existe, renderizar el QR usando la URL actual
    const qrBox = document.getElementById('qr-box');
    if (qrBox) {
      const url = encodeURIComponent(window.location.href);
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${url}&color=0b3d2e&bgcolor=ffffff&margin=0`;
      qrBox.innerHTML = `<img src="${qrUrl}" alt="QR Salud Financiera" style="width:100%;height:100%;object-fit:contain" loading="lazy">`;
    }
  }
};

// Auto-inicializar al cargar el DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => SF_FEATURES.init());
} else {
  SF_FEATURES.init();
}

/* ============================================================
   FEEDBACK BETA — Encuesta corta con envío a Netlify Forms
   ============================================================
   El formulario del modal se arma acá (JS), así que Netlify no puede
   detectarlo escaneando el HTML. Por eso index.html lleva además un
   form estático oculto con name="beta-feedback" y los mismos campos:
   ese es el que Netlify registra. El envío real es este fetch().
   Requisitos del endpoint de Netlify Forms:
     - POST a "/" (una ruta del propio sitio)
     - Content-Type: application/x-www-form-urlencoded
     - el campo form-name con el nombre del formulario
   ============================================================ */
const SF_FEEDBACK = {

  ESCALAS: {
    utilidad : ['Nada útil', 'Poco útil', 'Más o menos', 'Útil', 'Muy útil'],
    facilidad: ['Muy difícil', 'Difícil', 'Normal', 'Fácil', 'Muy fácil']
  },

  _armado: false,

  /* --- Construcción de las escalas 1-5 ------------------------ */
  buildScales() {
    if (this._armado) return;
    document.querySelectorAll('[data-fb-scale]').forEach(cont => {
      const campo = cont.dataset.fbScale;
      const hints = this.ESCALAS[campo] || [];
      let html = '';
      for (let i = 1; i <= 5; i++) {
        html += `<input type="radio" name="${campo}" id="fb-${campo}-${i}" value="${i}" required>` +
                `<label class="fb-star" for="fb-${campo}-${i}" data-val="${i}" ` +
                `title="${i} — ${hints[i-1] || ''}" aria-label="${i} de 5: ${hints[i-1] || ''}">★</label>`;
      }
      html += `<span class="fb-scale-hint" id="fb-hint-${campo}"></span>`;
      cont.innerHTML = html;

      // Pintar hasta la estrella elegida (el CSS por sí solo no puede
      // seleccionar hermanos anteriores)
      cont.addEventListener('change', e => {
        if (e.target.type !== 'radio') return;
        const val = parseInt(e.target.value, 10);
        cont.querySelectorAll('.fb-star').forEach(s => {
          s.classList.toggle('on', parseInt(s.dataset.val, 10) <= val);
        });
        const hint = cont.querySelector('.fb-scale-hint');
        if (hint) hint.textContent = hints[val - 1] || '';
      });
    });
    this._armado = true;
  },

  /* --- Abrir / cerrar ----------------------------------------- */
  open() {
    this.buildScales();
    SF_MODAL.abrir(document.getElementById('fb-modal'), () => SF_FEEDBACK.close());
  },

  close() {
    SF_MODAL.cerrar(document.getElementById('fb-modal'));
  },

  /* --- Validación --------------------------------------------- */
  _error(msg) {
    const box = document.getElementById('fb-error');
    if (!box) return;
    box.textContent = msg;
    box.classList.add('show');
  },

  _clearError() {
    document.getElementById('fb-error')?.classList.remove('show');
  },

  /* --- Envío --------------------------------------------------- */
  encode(data) {
    return Object.keys(data)
      .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(data[key]))
      .join('&');
  },

  async submit(ev) {
    ev.preventDefault();
    this._clearError();

    const form  = document.getElementById('fb-form');
    const btn   = document.getElementById('fb-submit');
    const util  = form.querySelector('input[name="utilidad"]:checked');
    const facil = form.querySelector('input[name="facilidad"]:checked');
    const mod   = document.getElementById('fb-modulo');
    const com   = document.getElementById('fb-comentario');
    const cons  = document.getElementById('fb-consentimiento');
    const hp    = document.getElementById('fb-bot-field');

    if (!util)         return this._error('Falta responder qué tan útil te pareció la app.');
    if (!facil)        return this._error('Falta responder qué tan fácil fue de usar.');
    if (!mod.value)    return this._error('Falta elegir el módulo que más usaste.');
    if (!cons.checked) return this._error('Necesitamos tu consentimiento para usar la respuesta.');

    btn.disabled = true;
    btn.textContent = 'Enviando…';

    try {
      const res = await fetch('/', {
        method : 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body   : this.encode({
          'form-name'        : 'beta-feedback',
          'utilidad'         : util.value,
          'facilidad'        : facil.value,
          'modulo_mas_usado' : mod.value,
          'comentario'       : com.value.trim(),
          'consentimiento'   : cons.checked ? 'sí' : 'no',
          'bot-field'        : hp ? hp.value : ''
        })
      });

      if (!res.ok) throw new Error('HTTP ' + res.status);

      // Éxito: la confirmación reemplaza al formulario
      document.getElementById('fb-form-wrap').style.display = 'none';
      document.getElementById('fb-done').style.display      = 'block';

    } catch (err) {
      console.error('Feedback:', err);
      this._error('No pudimos enviar tu respuesta. Revisa tu conexión e inténtalo de nuevo.');
      btn.disabled = false;
      btn.textContent = 'Enviar';
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('fb-form')
    ?.addEventListener('submit', ev => SF_FEEDBACK.submit(ev));
});
