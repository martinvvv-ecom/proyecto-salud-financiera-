# 🤖 Instrucciones para Claude Code — Mejoras Salud Financiera

Este documento contiene prompts listos para copiar y pegar en **Claude Code**, en orden de prioridad. Cada bloque es una tarea independiente que puedes ejecutar por separado.

> **Cómo usar este archivo:** Abre la carpeta del proyecto en Claude Code (`claude` en la terminal dentro de la carpeta `salud-financiera`), y pega cada prompt cuando quieras esa mejora. Revisa los cambios antes de aceptar.

---

## ✅ YA ARREGLADO (no necesitas hacer nada)

- **Bug del espacio en blanco** en Inversiones, Autos, Emprendedores y Acerca de. Causa: el `</main>` cerraba antes de tiempo y esas 4 páginas quedaban fuera del contenedor principal. Ya está corregido en tu `index.html`.
- **Retención SII** corregida a 14,5% (era 15,25%).
- **HTML roto** en la sección emprendedores.

---

## 🎬 MEJORA 1: Videos reales de educación financiera chilena

**Prompt para Claude Code:**

```
En la página educativa (id="page-educativa") de index.html, cada módulo
temático tiene un placeholder de video con la clase .video-ph. Quiero
reemplazar esos placeholders por iframes reales de YouTube embebidos,
usando videos de educación financiera en español.

Para cada uno de los 6 módulos, agrega un iframe responsivo de YouTube
con esta estructura (wrapper 16:9):

<div class="video-embed">
  <iframe src="https://www.youtube.com/embed/VIDEO_ID"
    title="Título del video" frameborder="0"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
    allowfullscreen loading="lazy"></iframe>
</div>

Y agrega este CSS a css/features.css:

.video-embed { position:relative; width:100%; padding-bottom:56.25%;
  height:0; border-radius:12px; overflow:hidden; margin-bottom:1rem; }
.video-embed iframe { position:absolute; top:0; left:0; width:100%;
  height:100%; border:0; }

IMPORTANTE: Búscame primero videos REALES y vigentes en YouTube sobre:
1. Fondo de emergencia (finanzas personales Chile)
2. Cómo salir de deudas / CAE
3. Cómo empezar a invertir (S&P 500, fondos)
4. Tarjetas de crédito sin caer en trampas
5. Presupuesto 50/30/20
6. Hábitos financieros / ahorro

Usa el buscador web para encontrar los VIDEO_ID reales y verifica que
existan antes de insertarlos. Prioriza canales de la CMF (Comisión para
el Mercado Financiero), Banco Central de Chile, o educadores financieros
chilenos reconocidos.
```

> **Nota**: La CMF tiene videos oficiales en su canal de YouTube (cmfeduca.cl). Claude Code puede buscarlos en vivo y poner los IDs correctos.

---

## 🧭 MEJORA 2: Menú / navegación más profesional

**Prompt para Claude Code:**

```
Quiero mejorar la barra de navegación superior (.topbar) de index.html
para que se vea más profesional. Cambios deseados:

1. Agregar un indicador visual animado (línea inferior deslizante) que
   siga la pestaña activa, en vez del simple cambio de color actual.

2. En móvil, mejorar el drawer: que se deslice desde la derecha con
   overlay oscuro de fondo y animación suave.

3. Agregar "scroll spy": que al hacer scroll la topbar tenga una sombra
   sutil (.topbar.scrolled) y reduzca ligeramente su altura.

4. Agregar breadcrumbs o un título de sección activa visible en móvil
   (donde no caben todas las pestañas).

Mantén la paleta verde actual (variables CSS --green-*). No rompas la
funcionalidad de navigate() existente. Aplícalo en css/app.css y
js/app.js / js/features.js según corresponda.
```

---

## 📝 MEJORA 3: Quizzes más largos (10+ preguntas)

**Prompt para Claude Code:**

```
En js/app.js existe la lógica de los quizzes del módulo educativo
(busca la estructura de datos que contiene las preguntas, probablemente
un objeto/array con preguntas y respuestas).

Quiero que cada uno de los 6 módulos tenga un quiz de 10 preguntas
(actualmente tienen ~5). Agrega 5 preguntas nuevas por módulo, con:
- Pregunta clara sobre el tema del módulo
- 4 alternativas
- Indicación de la respuesta correcta
- Una explicación breve que aparezca al responder

Los temas son: fondo de emergencia, salir de deudas, invertir,
tarjetas de crédito, presupuesto 50/30/20, y hábitos financieros.

Las preguntas deben ser específicas a la realidad chilena (UF, CAE,
AFP, APV, tasas reales). Mantén el sistema de badges existente pero
ajusta el umbral de aprobación a 7/10 correctas.
```

---

## 🛠️ MEJORA 4: Mejorar las calculadoras (opcional)

**Prompt para Claude Code:**

```
Revisa las calculadoras de la página emprendedores (SII, IVA,
importaciones) y la del simulador de créditos. Quiero:

1. Que cada resultado tenga una pequeña explicación de "qué significa
   este número" debajo.
2. Botón "copiar resultado" en cada calculadora.
3. Validación de inputs: que no acepte valores negativos y muestre un
   mensaje amable si el campo está vacío.
4. Formato de miles automático mientras se escribe (1.000.000 en vez
   de 1000000).

Mantén el estilo visual actual. Trabaja en js/app.js.
```

---

## 🚀 MEJORA 5: Extras "WOW" para la defensa (opcional)

**Prompt para Claude Code:**

```
Quiero agregar estos detalles que impresionan en una defensa de
proyecto:

1. Un contador animado en la página "Acerca de" que muestre los números
   (7 módulos, 12 semanas, etc.) subiendo desde 0 cuando entras a la
   página (efecto count-up).

2. Animación de entrada del Score Financiero en el dashboard (que el
   número suba desde 0 hasta el valor final).

3. Un pequeño "tour" con botón "¿Cómo funciona?" que resalte cada
   sección con un tooltip explicativo.

4. Modo "presentación" activable con tecla P que oculte el onboarding
   y deje la app lista para demo.

Usa solo JavaScript vanilla y CSS. No agregues librerías nuevas.
```

---

## 📌 Orden recomendado para el 30 de mayo

1. **Hoy**: Sube la versión actual (bug arreglado) a Netlify. Ya funciona.
2. **Mañana**: Mejora 1 (videos) + Mejora 3 (quizzes). Son las que más
   contenido agregan.
3. **Si hay tiempo**: Mejora 2 (menú) + Mejora 5 (extras WOW).
4. **Re-deploy**: Cada vez que termines, arrastra la carpeta de nuevo a
   Netlify para actualizar.

---

## 🔄 Cómo actualizar Netlify después de cada cambio

1. Guarda los cambios en Claude Code.
2. Ve a tu dashboard de Netlify → tu sitio.
3. En "Production deploys", arrastra la carpeta `salud-financiera`
   actualizada al recuadro de drag & drop.
4. En ~30 segundos tu sitio en vivo se actualiza.

> Cuando conectes GitHub (siguiente paso), esto se hará automático con
> cada `git push`.
