# 💚 Salud Financiera

> Plataforma web interactiva para educación financiera y gestión personal en Chile.

Proyecto ABP — 4to Medio · The Almondale School Valle · 2026

**Equipo:**
- Martín Vergara Valenzuela — Arquitecto Web & Programador
- Tomás Carrasco — Redactor Principal
- Matías Toloza — Investigador Teórico

---

## 📁 Estructura de archivos

```
salud-financiera/
├── index.html                # Página principal (SPA)
├── manifest.json             # Manifest PWA
├── sw.js                     # Service Worker (offline support)
├── favicon.ico               # Favicon
├── GUIA_DEPLOY.md            # Guía paso a paso de despliegue
│
├── css/
│   ├── app.css               # Estilos del MVP original
│   └── features.css          # Estilos de nuevas funciones (PWA, login, etc.)
│
├── js/
│   ├── app.js                # Lógica principal de los 7 módulos
│   └── features.js           # Nuevas: onboarding, perfil, share, PWA
│
└── assets/
    └── icons/
        ├── icon-192.png      # Icono PWA Android
        ├── icon-512.png      # Icono PWA grande
        ├── apple-touch-icon.png  # iOS home screen
        ├── favicon-16.png
        └── favicon-32.png
```

---

## 🎯 Características

### Los 7 módulos originales
1. **Panel (Dashboard)** — Score Financiero 0-1000 + resumen ejecutivo
2. **Simulador de Créditos** — Cálculo de CAE con seguros
3. **Aprende y Crece** — 6 módulos gamificados + glosario chileno
4. **Presupuesto Mensual** — Regla 50/30/20 + export PDF
5. **Inversiones & APV** — Metas libres + simulador AFP con APV
6. **Comparador Automotriz** — Crédito tradicional vs. Compra Inteligente
7. **Emprendedores** — Calculadoras SII, IVA e-commerce, importaciones

### Nuevas funcionalidades (v2)
- ✨ **PWA Instalable** — Se agrega como app al celular
- 👋 **Onboarding interactivo** — Tour guiado primera vez
- 👤 **Perfil con avatar** — Login simulado con iniciales
- 📤 **Compartir progreso** — Web Share API + portapapeles
- ℹ️ **Página "Acerca de"** — Equipo, stats y QR para defensa
- 🎨 **Estructura modular** — CSS/JS separados, listos para producción
- 🐛 **Bugs corregidos** — Tasa SII 2026 actualizada a 14,5%

---

## 🚀 Cómo ejecutar

### Local (desarrollo)
```bash
# Desde la carpeta del proyecto
python3 -m http.server 8000

# Abrir en navegador
http://localhost:8000
```

### Producción
Ver `GUIA_DEPLOY.md` para deploy paso a paso en Netlify o GitHub Pages.

---

## 🔧 Tecnologías

- HTML5, CSS3, JavaScript ES6+ (vanilla, sin frameworks)
- Chart.js 4.4.0 (gráficos)
- html2pdf.js 0.10.1 (exportación PDF)
- Service Worker API (PWA offline)
- localStorage (persistencia local)
- API mindicador.cl (indicadores económicos en vivo)
- API qrserver.com (generación de QR)

---

## 🔒 Privacidad

Toda la información del usuario se almacena exclusivamente en `localStorage` del navegador. No se envía ningún dato a servidores externos (excepto las llamadas a las APIs públicas para obtener indicadores económicos y generar QR, que no transmiten datos personales).

---

## 📝 Licencia

Proyecto académico. Uso libre para fines educativos.
