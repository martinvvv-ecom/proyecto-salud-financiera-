# Arranque local — Claude Code + skill del proyecto

## 1. Instalar Claude Code

Elegí una:

- **App de escritorio (Mac/Windows)** — la más simple, sin terminal: https://claude.ai/download
- **Extensión** — buscá "Claude Code" en el marketplace de VS Code o JetBrains
- **CLI**:
  ```bash
  # macOS / Linux
  curl -fsSL https://claude.ai/install.sh | bash

  # Windows (PowerShell)
  irm https://claude.ai/install.ps1 | iex

  # o con npm
  npm install -g @anthropic-ai/claude-code
  ```

Docs oficiales si algo falla: https://code.claude.com/docs

## 2. Instalar la skill del proyecto

Descomprimí `salud-financiera-abp-skill.zip` de modo que quede así:

```
~/.claude/skills/salud-financiera-abp/
├── SKILL.md
└── references/
    ├── equipo.md
    ├── estado-actual.md
    ├── historial-decisiones.md
    ├── informe-apa7.md
    ├── producto-tecnico.md
    ├── proyecto.md
    └── rubrica-evaluacion.md
```

Rutas de `~/.claude/` según sistema:

- **macOS / Linux**: `/Users/tu-usuario/.claude/skills/` — la carpeta empieza con punto, está oculta.
  En Finder: `Cmd + Shift + G` y pegá `~/.claude/skills`
- **Windows**: `C:\Users\tu-usuario\.claude\skills\`
  En el Explorador, pegá `%USERPROFILE%\.claude\skills` en la barra de direcciones

Si `skills` no existe, creala.

Para verificar que quedó bien: abrí Claude Code y escribí `/` — la skill
`salud-financiera-abp` tiene que aparecer en la lista.

## 3. Abrir el proyecto

```bash
cd salud-financiera
claude
```

O en la app de escritorio: abrí la carpeta `salud-financiera`.

## 4. Antes de pedir cualquier cambio: verificar que la carpeta sea la actual

Esto es lo más importante. Pedile a Claude:

```
Verificá y decime: (a) qué valor tiene CACHE_NAME en sw.js, (b) si existe
js/scenario.js, (c) si index.html menciona "escenario" en algún lado, y
(d) si los módulos de la página educativa tienen iframes de YouTube o
todavía placeholders .video-ph.
```

Interpretación de la respuesta:

- `CACHE_NAME = 'salud-financiera-v2'` + existe `js/scenario.js` → **es la carpeta correcta**, seguí.
- `CACHE_NAME = 'salud-financiera-v1'` + no hay `scenario.js` → **es una copia vieja**,
  hay que encontrar la carpeta buena antes de tocar nada. Es la misma versión
  que se subió al repo por error.

## 5. Contexto de la sesión en la nube (pegale esto a Claude local)

```
Contexto de una sesión previa que no pudo completar el trabajo:

- El repo github.com/martinvvv-ecom/proyecto-salud-financiera- tiene en main
  una versión INCOMPLETA Y VIEJA del proyecto: solo index.html, manifest.json,
  sw.js, favicon.ico y tres .md. Faltan css/ y js/ enteras. Ese sw.js está en
  CACHE_NAME v1 y no hay Modo Escenarios ni videos de YouTube embebidos.
  No uses ese main como base — la fuente de verdad es esta carpeta local.
- Cuando pushees, vas a tener que sobreescribir esos archivos viejos.
- El repo ya existe, así que NO corras `gh repo create`. Usá:
    git remote add origin https://github.com/martinvvv-ecom/proyecto-salud-financiera-.git
    git push -u origin main
- Tarea 4 del plan decía "subir CACHE_NAME de v2 a v3". Verificá el valor real
  antes: si la carpeta está en v2, subilo a v3; si estás en la copia vieja (v1),
  pará y avisá.
```

## 6. Después, el prompt de las 5 tareas

Pegá tu prompt original de las 5 tareas (fix del PDF, módulo de feedback con
Netlify Forms, badge de beta, sw v3, push a GitHub). Con la skill instalada y
los archivos delante, Claude local puede además abrir el navegador y verificar
el PDF en modo claro, oscuro y con datos nuevos — la verificación que la sesión
en la nube no pudo hacer.
