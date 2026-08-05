# 🚀 Guía de Deploy — Salud Financiera

Esta guía te lleva paso a paso desde tu computador hasta tener la plataforma **publicada en internet con URL pública y QR funcional**.

---

## ⚡ Antes de empezar — Prueba local

**IMPORTANTE:** Por restricciones de seguridad del navegador, el Service Worker (PWA) **NO funciona** abriendo el `index.html` directamente con doble click. Necesitas un servidor local.

### Opción A — Python (más simple, viene preinstalado en Mac)

1. Abre la Terminal
2. Navega a la carpeta del proyecto:
   ```bash
   cd /ruta/a/salud-financiera
   ```
3. Ejecuta:
   ```bash
   python3 -m http.server 8000
   ```
4. Abre en tu navegador: `http://localhost:8000`

Ya está corriendo. Para detenerlo: `Ctrl+C` en la Terminal.

### Opción B — VS Code (recomendado si lo tienes)

1. Instala la extensión **Live Server** (Ritwick Dey)
2. Abre la carpeta del proyecto en VS Code
3. Click derecho sobre `index.html` → "Open with Live Server"

---

## 🌐 Opción 1 — Deploy en Netlify (RECOMENDADA — la más fácil)

**Tiempo:** 5 minutos. **Costo:** $0.

### Paso 1 — Crear cuenta
1. Ve a **[netlify.com](https://www.netlify.com)**
2. Click en "Sign up" → puedes registrarte con Google, GitHub o email

### Paso 2 — Deploy ULTRA RÁPIDO (drag & drop)
1. Una vez logueado, baja un poco en el dashboard hasta ver el área que dice:
   > **"Want to deploy a new site without connecting to Git? Drag and drop your site output folder here"**
2. Toma la carpeta `salud-financiera` completa (con todos sus archivos) y **arrástrala a esa área**
3. Netlify te dará una URL como `https://animado-pavlov-123abc.netlify.app` en menos de 30 segundos

### Paso 3 — Cambiar a un nombre amigable (opcional pero recomendado)
1. En tu sitio recién creado, ve a **Site settings → Site information → Change site name**
2. Pon algo como `salud-financiera-chile` o `saludfinanciera-almondale`
3. Tu URL quedará: `https://salud-financiera-chile.netlify.app`

### Paso 4 — Verificar que la PWA funciona
1. Abre tu URL en Chrome
2. Mira la barra de direcciones — debería aparecer un ícono de "Instalar app" (un monitor pequeño con flecha hacia abajo)
3. En celular: abre en Chrome o Safari → menú "..." → "Agregar a pantalla de inicio"

---

## 🌐 Opción 2 — Deploy en GitHub Pages

**Tiempo:** 10 minutos. Útil si ya usas GitHub.

### Paso 1 — Crear repositorio
1. Ve a **[github.com](https://github.com)** y logueate
2. Click en el `+` arriba a la derecha → **"New repository"**
3. Nombre: `salud-financiera` (o el que prefieras)
4. **Public** (necesario para Pages gratis)
5. NO marques "Add README" ni nada más
6. Click "Create repository"

### Paso 2 — Subir archivos
**Opción más fácil (sin terminal):**
1. En la pantalla del repo vacío, click en **"uploading an existing file"**
2. Arrastra **TODOS** los archivos de la carpeta `salud-financiera` (NO la carpeta, sino su contenido)
3. Importante: incluye las subcarpetas `css/`, `js/`, `assets/`
4. Scroll abajo → "Commit changes"

### Paso 3 — Activar GitHub Pages
1. En tu repo, click en **Settings** (arriba a la derecha)
2. En el menú lateral, click **Pages**
3. En "Source", selecciona **Deploy from a branch**
4. Branch: **main** → Folder: **/ (root)** → click "Save"
5. Espera 1-2 minutos. Aparecerá: `Your site is live at https://TU_USUARIO.github.io/salud-financiera/`

---

## 📱 Generar el QR para la defensa

Una vez tengas tu URL pública (de Netlify o GitHub Pages):

### Método 1 — Desde la app misma (ya integrado)
- Ve a la página **"Acerca de"** dentro de tu plataforma desplegada
- El QR se genera automáticamente apuntando a la URL actual

### Método 2 — QR personalizado para imprimir grande
1. Ve a **[qr-code-generator.com](https://www.qr-code-generator.com)** o **[qrcode-monkey.com](https://www.qrcode-monkey.com)**
2. Pega tu URL pública
3. Personaliza colores (verde `#0b3d2e` para que combine con el logo)
4. Descarga en alta resolución
5. **Imprime tamaño A4 o más grande** para que los profesores escaneen desde lejos

---

## ✅ Checklist antes del 30 de mayo

- [ ] Plataforma probada localmente — todos los módulos funcionan
- [ ] Desplegada en Netlify o GitHub Pages — URL pública accesible
- [ ] Probada en celular — instalable como PWA
- [ ] QR generado e impreso grande
- [ ] Verificar que indicadores en vivo (UF, USD) cargan al abrir
- [ ] Probar el flujo de onboarding desde una ventana de incógnito
- [ ] El presupuesto guarda y restaura datos al recargar
- [ ] El simulador de CAE calcula correctamente
- [ ] El módulo de jubilación muestra proyecciones

---

## 🆘 Solución de problemas comunes

**El PWA no se instala / no aparece el ícono de instalar**
- Solo funciona sobre HTTPS (Netlify y GitHub Pages lo dan automáticamente)
- En modo local debes usar `http://localhost`, no `file://`

**Los indicadores UF/USD no cargan**
- La API `mindicador.cl` ocasionalmente falla. El código tiene fallback que muestra "N/D"
- En la defensa, asegúrate de tener conexión a internet

**El modo oscuro no se mantiene al cambiar de página**
- Es correcto: se guarda en localStorage. Si abres en incógnito sí se reinicia

**El PDF no se genera**
- Verifica que html2pdf.js cargue desde CDN (revisa la consola del navegador)
- Algunos bloqueadores de scripts pueden interferir

---

## 🎯 Plan para el día de la defensa

**Antes de entrar a la sala:**
1. Abre tu URL en tu celular y déjala lista en pestaña
2. Asegúrate que tu celular tenga datos móviles o WiFi de respaldo
3. Lleva el QR impreso GRANDE (mínimo A4)
4. Lleva un cable USB-C/Lightning por si necesitas cargar

**Durante la defensa:**
1. **Abre con el QR**: "Profes, antes de explicarles, sáquenle una foto a este QR y abran la página en sus celulares para que vayan navegando junto a nosotros"
2. Hacer que CALCULEN algo real (su propia jubilación con sus años actuales, o el CAE de un crédito hipotético)
3. Mostrar la **instalación PWA** en vivo: "Y miren, se instala como una app real"
4. Demostrar el **modo oscuro** y los **indicadores en vivo**
5. Cerrar con la página "Acerca de" mostrando al equipo

---

¡Éxito el 30 de mayo! 🚀💚
