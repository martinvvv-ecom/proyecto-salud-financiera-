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
  onboardSteps: [
    {
      emoji: '👋',
      title: 'Bienvenido a Salud Financiera',
      text: 'Tu plataforma personal para tomar el control de tus finanzas. Sin letra chica, sin complicaciones.'
    },
    {
      emoji: '📊',
      title: 'Tu Score Financiero',
      text: 'Recibe un puntaje de 0 a 1000 que mide tu salud financiera. Mientras más alto, mejor preparado estás.'
    },
    {
      emoji: '🧮',
      title: 'Simula antes de firmar',
      text: 'Calcula la CAE real de cualquier crédito y compara instituciones. Nunca más pagues de más.'
    },
    {
      emoji: '📚',
      title: 'Aprende mientras avanzas',
      text: 'Módulos gamificados con quizzes, badges y un glosario financiero chileno completo.'
    },
    {
      emoji: '🚀',
      title: '¡Todo listo!',
      text: 'Tus datos se guardan automáticamente en tu navegador. Privado y seguro. Empieza por el Presupuesto.'
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

    // Verificar si hay perfil; si no, mostrar onboarding después de crearlo
    const hasProfile = !!localStorage.getItem(this.LS_KEYS.profile);
    if (!hasProfile) {
      // El onboarding se dispara desde el flujo de profile setup
      this.showProfileSetup(() => this.startOnboarding());
    } else {
      // Tiene perfil pero no onboarding, mostrar
      setTimeout(() => this.startOnboarding(), 400);
    }
  },

  startOnboarding() {
    this.onboardStep = 0;
    const overlay = document.createElement('div');
    overlay.className = 'splash-overlay';
    overlay.id = 'splash-overlay';
    overlay.innerHTML = this.renderOnboardCard();
    document.body.appendChild(overlay);
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
        <div class="onboard-title">${step.title}</div>
        <div class="onboard-text">${step.text}</div>
        <div class="onboard-dots">${dots}</div>
        <div class="onboard-actions">
          <button class="onboard-skip" onclick="SF_FEATURES.finishOnboarding()">
            ${isLast ? '' : 'Saltar tutorial'}
          </button>
          <button class="onboard-next" onclick="SF_FEATURES.nextOnboard()">
            ${isLast ? 'Comenzar ✨' : 'Siguiente →'}
          </button>
        </div>
      </div>
    `;
  },

  nextOnboard() {
    if (this.onboardStep < this.onboardSteps.length - 1) {
      this.onboardStep++;
      const overlay = document.getElementById('splash-overlay');
      if (overlay) overlay.innerHTML = this.renderOnboardCard();
    } else {
      this.finishOnboarding();
    }
  },

  finishOnboarding() {
    const overlay = document.getElementById('splash-overlay');
    if (overlay) {
      overlay.classList.add('hiding');
      setTimeout(() => overlay.remove(), 500);
    }
    localStorage.setItem(this.LS_KEYS.onboardDone, '1');
  },

  // ============================================================
  // 2. PROFILE (LOGIN SIMULADO)
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
      btn.title = `${profile.name} — Click para ver perfil`;
    } else {
      btn.classList.add('empty');
      btn.innerHTML = '👤';
      btn.title = 'Crear perfil';
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
      `Miembro desde ${new Date(profile.created).toLocaleDateString('es-CL', {day:'numeric', month:'long', year:'numeric'})}`;
    modal.classList.add('open');
  },

  closeProfileModal() {
    document.getElementById('profile-modal')?.classList.remove('open');
    document.getElementById('profile-setup-modal')?.classList.remove('open');
  },

  showProfileSetup(onDone) {
    const modal = document.getElementById('profile-setup-modal');
    modal.classList.add('open');
    document.getElementById('profile-name-input').focus();
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
    if (!confirm('¿Cerrar sesión? Tus datos del presupuesto se mantendrán guardados.')) return;
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
    const profile = this.getProfile();
    const score = document.getElementById('gauge-score')?.textContent || '—';
    const text = `${profile?.name || 'Yo'} estoy mejorando mi salud financiera 💚\n\nMi Score actual: ${score}\n\nDescubre Salud Financiera, una plataforma gratuita para gestionar tus finanzas en Chile.`;
    const url = window.location.href;

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
    const modal = document.getElementById('fb-modal');
    modal?.classList.add('open');
    document.addEventListener('keydown', this._onKey);
  },

  close() {
    document.getElementById('fb-modal')?.classList.remove('open');
    document.removeEventListener('keydown', this._onKey);
  },

  _onKey(e) { if (e.key === 'Escape') SF_FEEDBACK.close(); },

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
