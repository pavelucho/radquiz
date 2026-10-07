// RadQuiz — ampliación de una figura, compartida por la práctica, la sala, el tablero, el Tabú y el estudio.
// Toda imagen con data-zoom se abre a pantalla completa. Ahí se acerca con un toque (o clic) en el punto que
// interesa, con la rueda o pellizcando; se mueve arrastrando, y otro toque sin arrastrar la vuelve a ajustar.
// ✕, Esc, un toque en el fondo o el botón «atrás» del celular la cierran, y también deslizarla hacia abajo cuando
// está ajustada. Mientras está abierta se queda con el teclado: el «1» que en el tablero marca un acierto aquí no
// hace nada.
//
// «Ventana», como en un visor DICOM pero sobre un JPG: arrastrar a los lados cambia el ancho (el contraste) y arriba
// y abajo el centro (el brillo), en la escala de 0 a 255 del archivo. No recupera lo que la ventana original del
// autor dejó fuera: solo reparte de otra forma los 256 grises que ya hay. Lo hace un filtro SVG (feComponentTransfer)
// y no un canvas, porque las figuras vienen de Drive y el navegador no deja leer los píxeles de otro dominio. En
// escritorio, el botón derecho ajusta la ventana sin activar el modo. Cada figura se abre siempre como es.

const ACERCAR_TOQUE = 2.5;   // un toque sobre la figura ajustada la deja a 2,5 veces, centrada en el punto tocado
const PASO = 1.5;            // botones + y −, y teclas + y −
const MOVER = 80;            // flechas, en píxeles de pantalla
const DOBLE = 320;           // ms: el segundo toque de un doble toque no deshace el primero
const MINIMO_PELLIZCO = 0.8; // el pellizco puede achicarla un poco más que ajustada; al soltar, rebota
const CERRAR_DESLIZANDO = 110; // px hacia abajo (o arriba) que cierran la figura ajustada
const VENTANA = { ancho: 255, centro: 127.5 };   // la figura tal cual
const ANCHO_MINIMO = 4, ANCHO_MAXIMO = 510;

let capa, img, nivel, alejar, acercar, ayuda, panel, lectura, botonVentana, botonInvertir, funciones;
let ancho = VENTANA.ancho, centroV = VENTANA.centro, invertida = false, modoVentana = false;
let s = 1, tx = 0, ty = 0;   // escala sobre el tamaño ajustado y desplazamiento, en píxeles de pantalla
let maximo = 4;
let area = { w: 0, h: 0 };   // el hueco donde el CSS ajusta la figura: la pantalla sin la barra
const dedos = new Map();      // pointerId → {x, y}
let gesto = null;             // lo que hacen los dedos desde que el último bajó o subió
let ultimoToque = 0;
let inercia = 0;              // requestAnimationFrame del deslizamiento que sigue a un arrastre rápido
let foco = null;              // lo que tenía el foco antes de abrir, para devolvérselo
let volviendo = false;        // cerrar con ✕ hace history.back(), y su popstate llega después

export function activarAmpliacion() {
  capa = document.createElement("div");
  capa.className = "ampliar";
  capa.hidden = true;
  capa.setAttribute("role", "dialog");
  capa.setAttribute("aria-modal", "true");
  capa.setAttribute("aria-label", "Figura ampliada");
  // sRGB: sin él, el filtro trabaja en RGB lineal y la figura «tal cual» ya saldría más clara.
  capa.innerHTML = `<svg class="ampliar-filtro" aria-hidden="true" focusable="false"><filter id="ampliar-ventana"
      color-interpolation-filters="sRGB"><feComponentTransfer><feFuncR type="linear"/><feFuncG type="linear"/>
      <feFuncB type="linear"/></feComponentTransfer></filter></svg>
    <img alt="" draggable="false">
    <p class="ampliar-ayuda"></p>
    <div class="ampliar-ventana" hidden>
      <span class="ampliar-lectura"></span>
      <button type="button" data-a="invertir" aria-pressed="false">Invertir</button>
      <button type="button" data-a="restablecer">Restablecer</button>
      <p>↔ ancho (contraste) · ↕ centro (brillo)</p>
    </div>
    <div class="ampliar-barra">
      <button type="button" data-a="alejar" aria-label="Alejar">−</button>
      <span class="ampliar-nivel" aria-live="polite">100 %</span>
      <button type="button" data-a="acercar" aria-label="Acercar">+</button>
      <button type="button" data-a="ajustar">Ajustar</button>
      <button type="button" data-a="ventana" aria-pressed="false" title="Ventana: contraste y brillo (V)">Ventana</button>
      <button type="button" data-a="cerrar" aria-label="Cerrar">✕</button>
    </div>`;
  document.body.append(capa);
  img = capa.querySelector("img");
  nivel = capa.querySelector(".ampliar-nivel");
  alejar = capa.querySelector("[data-a=alejar]");
  acercar = capa.querySelector("[data-a=acercar]");
  ayuda = capa.querySelector(".ampliar-ayuda");
  panel = capa.querySelector(".ampliar-ventana");
  lectura = capa.querySelector(".ampliar-lectura");
  botonVentana = capa.querySelector("[data-a=ventana]");
  botonInvertir = capa.querySelector("[data-a=invertir]");
  funciones = [...capa.querySelectorAll("feFuncR, feFuncG, feFuncB")];

  document.addEventListener("click", (e) => {
    const origen = e.target.closest("[data-zoom]");
    if (origen && origen.src && !capa.contains(origen)) abrir(origen);
  });
  img.addEventListener("load", ajustar);
  capa.addEventListener("click", (e) => {
    const accion = e.target.closest("[data-a]")?.dataset.a;
    if (accion === "cerrar") cerrar();
    else if (accion === "ajustar") ajustar(true);
    else if (accion === "acercar") escalar(s * PASO, centro(), true);
    else if (accion === "alejar") escalar(s / PASO, centro(), true);
    else if (accion === "ventana") alternarVentana();
    else if (accion === "invertir") { invertida = !invertida; pintarVentana(); }
    else if (accion === "restablecer") restablecerVentana();
  });
  capa.addEventListener("pointerdown", bajar);
  capa.addEventListener("pointermove", mover);
  capa.addEventListener("pointerup", subir);
  capa.addEventListener("pointercancel", subir);
  capa.addEventListener("wheel", rueda, { passive: false });
  // Ni el menú de mantener pulsado ni el zoom de la página de Safari: los dedos son de la figura.
  capa.addEventListener("contextmenu", (e) => e.preventDefault());
  capa.addEventListener("gesturestart", (e) => e.preventDefault());
  // Fase de captura: la ampliación atiende el teclado antes que la página.
  window.addEventListener("keydown", tecla, true);
  window.addEventListener("resize", () => { if (!capa.hidden) { medirArea(); aplicar(); } });
  // «Atrás» en el celular cierra la figura en vez de salir de la página (en la sala, salir de la sala).
  window.addEventListener("popstate", () => {
    if (volviendo) {
      // Es el regreso que pidió cerrar(). Si mientras tanto se abrió otra figura, vuelve a tener su entrada.
      volviendo = false;
      if (!capa.hidden && !history.state?.ampliar) history.pushState({ ampliar: true }, "");
    } else if (!capa.hidden) cerrar(true);
  });
}

function abrir(origen) {
  foco = document.activeElement;
  img.alt = origen.alt || "";
  ayuda.textContent = matchMedia("(pointer: coarse)").matches
    ? "Toca o pellizca para acercar · desliza hacia abajo para cerrar"
    : "Clic o rueda para acercar · arrastra para mover · botón derecho: ventana · Esc cierra";
  restablecerVentana();
  alternarVentana(false);
  capa.hidden = false;
  capa.style.backgroundColor = "";
  if (!volviendo && !history.state?.ampliar) history.pushState({ ampliar: true }, "");
  if (img.getAttribute("src") === origen.src && img.complete) ajustar();
  else img.src = origen.src;   // el load la ajusta
  capa.querySelector("[data-a=cerrar]").focus({ preventScroll: true });
}

function cerrar(desdeHistoria = false) {
  capa.hidden = true;
  dedos.clear();
  gesto = null;
  frenar();
  if (!desdeHistoria && history.state?.ampliar && !volviendo) {
    volviendo = true;
    history.back();
  }
  if (foco && foco.focus) foco.focus({ preventScroll: true });
}

// ------------------------------------------------------------------ geometría
// La figura queda ajustada por el CSS; la transformación (origen en su centro) la escala y la mueve. offsetLeft y
// offsetWidth no ven la transformación, y la capa es fija en toda la pantalla: dan la figura ajustada.
function base() {
  return { cx: img.offsetLeft + img.offsetWidth / 2, cy: img.offsetTop + img.offsetHeight / 2, w: img.offsetWidth, h: img.offsetHeight };
}

function medirArea() {
  const estilo = getComputedStyle(capa);
  area = {
    w: capa.clientWidth - parseFloat(estilo.paddingLeft) - parseFloat(estilo.paddingRight),
    h: capa.clientHeight - parseFloat(estilo.paddingTop) - parseFloat(estilo.paddingBottom),
  };
}

const centro = () => {
  const b = base();
  return { x: b.cx, y: b.cy };
};

// Mantiene en su lugar el punto de la figura que está bajo «p» mientras cambia la escala.
function escalar(nueva, p, suave = false, minimo = 1) {
  const b = base();
  const ux = (p.x - b.cx - tx) / s;
  const uy = (p.y - b.cy - ty) / s;
  s = Math.min(maximo, Math.max(minimo, nueva));
  tx = p.x - b.cx - s * ux;
  ty = p.y - b.cy - s * uy;
  aplicar(suave);
}

// Sin bordes negros de más. Mientras cabe en el hueco de la barra, queda centrada en él; si pasa la pantalla, se
// mueve sin despegarse de sus bordes (y puede pasar bajo la barra). Entre una cosa y otra, el centro se corre de a
// poco, para que el pellizco no dé saltos.
function limitar(b) {
  const rango = (lado, hueco, pantalla, centroBase) => {
    const centrada = pantalla / 2 - centroBase;
    if (lado <= pantalla) {
      const f = Math.min(1, Math.max(0, (lado - hueco) / Math.max(1, pantalla - hueco)));
      return [centrada * f, centrada * f];
    }
    return [pantalla - centroBase - lado / 2, lado / 2 - centroBase];
  };
  const [x0, x1] = rango(s * b.w, area.w, innerWidth, b.cx);
  const [y0, y1] = rango(s * b.h, area.h, innerHeight, b.cy);
  tx = Math.min(x1, Math.max(x0, tx));
  ty = Math.min(y1, Math.max(y0, ty));
}

function aplicar(suave = false) {
  limitar(base());
  pintar(suave);
}

function pintar(suave = false, extra = "") {
  img.classList.toggle("suave", suave);
  img.style.transform = `translate(${tx}px, ${ty}px) scale(${s})${extra}`;
  capa.classList.toggle("acercada", s > 1.001);
  nivel.textContent = `${Math.round(s * 100)} %`;
  alejar.disabled = s <= 1.001;
  acercar.disabled = s >= maximo - 0.001;
}

function ajustar(suave = false) {
  s = 1; tx = 0; ty = 0;
  frenar();
  medirArea();
  // Hasta el doble de la resolución real, y nunca menos de 4 veces el tamaño ajustado.
  const ancho = img.offsetWidth || 1;
  maximo = Math.min(10, Math.max(4, 2 * (img.naturalWidth || ancho) / ancho));
  capa.style.backgroundColor = "";
  aplicar(suave === true);
}

// ------------------------------------------------------------------ dedos y ratón
function bajar(e) {
  if (e.target.closest(".ampliar-barra, .ampliar-ventana")) return;
  const derecho = e.pointerType === "mouse" && e.button === 2;
  if (e.pointerType === "mouse" && e.button !== 0 && !derecho) return;
  try { capa.setPointerCapture(e.pointerId); } catch { /* el puntero ya se fue */ }
  frenar();
  dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (dedos.size === 1) {
    gesto = {
      toque: !derecho, enFigura: e.target === img, umbral: e.pointerType === "mouse" ? 5 : 10,
      modo: derecho || modoVentana ? "ventana" : null,
    };
  } else {
    gesto.toque = false;
    if (gesto.modo === "cerrar") devolver();
    gesto.modo = "pellizco";
  }
  anclar();
}

// Cada vez que baja o sube un dedo, el gesto vuelve a partir del estado actual.
function anclar() {
  const p = [...dedos.values()];
  Object.assign(gesto, { x: p[0].x, y: p[0].y, tx, ty, s, huellas: [], ancho0: ancho, centro0: centroV });
  if (p.length >= 2) {
    gesto.distancia = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y) || 1;
    gesto.medio = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
  }
}

function mover(e) {
  if (!dedos.has(e.pointerId) || !gesto) return;
  dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const p = [...dedos.values()];
  if (p.length >= 2) {
    // Pellizco: escala alrededor del punto medio inicial y, encima, lo que se corrió ese punto.
    const distancia = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y) || 1;
    const medio = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
    const b = base();
    const ux = (gesto.medio.x - b.cx - gesto.tx) / gesto.s;
    const uy = (gesto.medio.y - b.cy - gesto.ty) / gesto.s;
    s = Math.min(maximo, Math.max(MINIMO_PELLIZCO, gesto.s * distancia / gesto.distancia));
    tx = medio.x - b.cx - s * ux;
    ty = medio.y - b.cy - s * uy;
    aplicar();
    return;
  }
  const dx = p[0].x - gesto.x, dy = p[0].y - gesto.y;
  if (gesto.toque && Math.hypot(dx, dy) < gesto.umbral) return;
  gesto.toque = false;
  // Las últimas posiciones del dedo dan la velocidad al soltar (inercia, y cerrar con un deslizamiento rápido).
  const ahora = performance.now();
  gesto.huellas.push({ x: p[0].x, y: p[0].y, t: ahora });
  while (gesto.huellas.length > 2 && ahora - gesto.huellas[0].t > 100) gesto.huellas.shift();

  // Ajustada no hay nada que mover: arrastrar en vertical es para cerrarla, como en la galería del celular.
  if (!gesto.modo) gesto.modo = s <= 1.001 ? (Math.abs(dy) > Math.abs(dx) ? "cerrar" : "nada") : "mover";
  if (gesto.modo === "ventana") {
    // A la derecha, ventana más ancha (menos contraste); hacia abajo, centro más alto (más oscura), como en Horos.
    // Unos 0,65 grises por píxel en un celular y 0,5 en escritorio: el recorrido entero cabe en un arrastre.
    const k = Math.max(0.5, 240 / innerWidth);
    ancho = Math.min(ANCHO_MAXIMO, Math.max(ANCHO_MINIMO, gesto.ancho0 + dx * k));
    centroV = Math.min(255, Math.max(0, gesto.centro0 + dy * k));
    pintarVentana();
  } else if (gesto.modo === "cerrar") {
    const avance = Math.min(1, Math.abs(dy) / (CERRAR_DESLIZANDO * 3));
    capa.style.backgroundColor = `rgba(0, 0, 0, ${1 - 0.65 * avance})`;
    img.classList.remove("suave");
    img.style.transform = `translate(0px, ${dy}px) scale(${1 - 0.12 * avance})`;
  } else if (gesto.modo === "mover") {
    tx = gesto.tx + dx;
    ty = gesto.ty + dy;
    aplicar();
  }
}

function subir(e) {
  if (!dedos.has(e.pointerId)) return;
  const fue = gesto;
  dedos.delete(e.pointerId);
  if (dedos.size) {
    if (gesto.modo === "pellizco" && dedos.size === 1) gesto.modo = "mover";   // el dedo que queda la arrastra
    anclar();
    return;
  }
  gesto = null;
  if (!fue) return;
  const v = velocidad(fue.huellas);
  if (fue.modo === "cerrar") {
    const dy = e.clientY - fue.y;
    if (Math.abs(dy) > CERRAR_DESLIZANDO || (Math.abs(dy) > 40 && Math.abs(v.y) > 0.6)) cerrar();
    else devolver();
    return;
  }
  if (fue.modo === "pellizco" || fue.modo === "mover") {
    if (s < 1) ajustar(true);
    else if (fue.modo === "mover") deslizar(v.x, v.y);
    return;
  }
  if (!fue.toque || e.type === "pointercancel") return;
  // En un doble toque el segundo no cuenta: acercar con doble toque, como en el celular, también funciona.
  const ahora = performance.now();
  if (ahora - ultimoToque < DOBLE) { ultimoToque = 0; return; }
  ultimoToque = ahora;
  if (s > 1.001) ajustar(true);          // acercada, cualquier toque la ajusta: el fondo no la cierra por error
  else if (!fue.enFigura) cerrar();
  else escalar(ACERCAR_TOQUE, { x: e.clientX, y: e.clientY }, true);
}

// px/ms en los últimos 100 ms; cero si el dedo se quedó quieto antes de soltar.
function velocidad(huellas = []) {
  const ultima = huellas[huellas.length - 1];
  if (!ultima || huellas.length < 2 || performance.now() - ultima.t > 80) return { x: 0, y: 0 };
  const primera = huellas[0], dt = ultima.t - primera.t;
  if (dt < 16) return { x: 0, y: 0 };
  return { x: (ultima.x - primera.x) / dt, y: (ultima.y - primera.y) / dt };
}

// La figura vuelve a su sitio tras un deslizamiento que no llegó a cerrarla.
function devolver() {
  capa.style.backgroundColor = "";
  aplicar(true);
}

// Tras soltar un arrastre rápido la figura sigue un poco y se frena, hasta topar con un borde.
function deslizar(vx, vy) {
  if (Math.hypot(vx, vy) < 0.15) return;
  let antes = performance.now();
  const paso = (ahora) => {
    const dt = Math.min(40, ahora - antes);
    antes = ahora;
    const x0 = tx, y0 = ty;
    tx += vx * dt;
    ty += vy * dt;
    aplicar();
    const freno = Math.pow(0.994, dt);
    vx = tx === x0 + vx * dt ? vx * freno : 0;   // si topó con un borde, en ese eje se detiene
    vy = ty === y0 + vy * dt ? vy * freno : 0;
    inercia = Math.hypot(vx, vy) > 0.02 ? requestAnimationFrame(paso) : 0;
  };
  inercia = requestAnimationFrame(paso);
}

function frenar() {
  if (inercia) cancelAnimationFrame(inercia);
  inercia = 0;
}

function rueda(e) {
  e.preventDefault();
  frenar();
  const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1);
  escalar(s * Math.exp(-delta * 0.0018), { x: e.clientX, y: e.clientY });
}

// ------------------------------------------------------------------ ventana
// salida = (gris − (centro − ancho/2)) / ancho, recortada a 0–1, en cada canal; invertida, 1 − eso.
function pintarVentana() {
  let pendiente = 255 / ancho;
  let corte = -(centroV - ancho / 2) / ancho;
  if (invertida) { pendiente = -pendiente; corte = 1 - corte; }
  for (const f of funciones) {
    f.setAttribute("slope", pendiente);
    f.setAttribute("intercept", corte);
  }
  const tal = !invertida && ancho === VENTANA.ancho && centroV === VENTANA.centro;
  img.style.filter = tal ? "" : "url(#ampliar-ventana)";
  lectura.innerHTML = `<span>A <b>${Math.round(ancho)}</b></span> <span>C <b>${Math.round(centroV)}</b></span>`;
  botonInvertir.setAttribute("aria-pressed", String(invertida));
}

function restablecerVentana() {
  ancho = VENTANA.ancho;
  centroV = VENTANA.centro;
  invertida = false;
  pintarVentana();
}

function alternarVentana(activar = !modoVentana) {
  modoVentana = activar;
  panel.hidden = !activar;
  capa.classList.toggle("en-ventana", activar);
  botonVentana.setAttribute("aria-pressed", String(activar));
}

// ------------------------------------------------------------------ teclado
function tecla(e) {
  if (capa.hidden || e.key === "Tab") return;
  e.stopImmediatePropagation();
  const acciones = {
    Escape: () => cerrar(),
    "+": () => escalar(s * PASO, centro(), true),
    "=": () => escalar(s * PASO, centro(), true),
    "-": () => escalar(s / PASO, centro(), true),
    0: () => ajustar(true),
    v: () => alternarVentana(),
    i: () => { invertida = !invertida; pintarVentana(); },
    r: restablecerVentana,
    ArrowLeft: () => { tx += MOVER; aplicar(true); },
    ArrowRight: () => { tx -= MOVER; aplicar(true); },
    ArrowUp: () => { ty += MOVER; aplicar(true); },
    ArrowDown: () => { ty -= MOVER; aplicar(true); },
  };
  const accion = acciones[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (accion && (e.ctrlKey || e.metaKey || e.altKey)) return;
  // Enter y espacio sobre un botón de la barra siguen funcionando.
  if (!accion) { if (!e.target.closest?.(".ampliar-barra, .ampliar-ventana")) e.preventDefault(); return; }
  e.preventDefault();
  accion();
}
