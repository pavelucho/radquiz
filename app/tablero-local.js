// RadQuiz — tablero por equipos en el proyector, al estilo Jeopardy, sin celulares ni sala en vivo.
//
// El presentador arma el tablero con casos publicados; los equipos eligen casilla y responden en voz alta, y él
// marca quién acertó: la app suma o resta, pasa el turno y proyecta la enseñanza del caso (app/diapositivas.js).
// La partida (nombres de los equipos y puntajes) se guarda solo en este navegador, para aguantar una recarga.
// De Firebase solo lee lo publicado (app/publicado.js), así que funciona aunque la sala en vivo no conecte.
import { $, esc, md, cargarJSON, credito, barajar, SEGMENTOS, NIVELES, nivelDe } from "./comun.js";
import { cargarPaquete, indiceEnVivo, fusionarIndice } from "./publicado.js";
import { reportar } from "./reportar.js";
import {
  MAX_COLUMNAS, MAX_COMPARAR, claveDe, valores, grupoDe, respuestaDe, normal, figurasDe, proponerGrupos, juntar,
  armarColumnas, enTablero, sortearDobles, proponerFinal, proponerSimilares, reservasDe, maxApuestaDoble,
  maxApuestaFinal, minutos,
} from "./tablero.js";
import { diapositivas } from "./diapositivas.js";

const LETRAS = "ABCDE";
const GUARDADO = "radquiz.tablero";
const MAX_EQUIPOS = 6;
const MAX_DOBLES = 2;
const app = $("#app");

let indice = [];                 // temas con casos publicados, del sitio y del estudio
const datosDe = new Map();       // ruta → { paquete, fuentes, imagen(ref) }
let catalogo = new Map();        // clave «<paquete>/<caso>» → { clave, ruta, paquete, caso, grupo }
let borrador = null;             // el tablero mientras se arma
let config = null;               // el tablero con que se juega
let juego = null;                // la partida en curso
let vistaPrevia = "";
const precargadas = new Set();

// ------------------------------------------------------------------ guardado local
function guardar() {
  try { localStorage.setItem(GUARDADO, JSON.stringify({ config, juego })); } catch { /* sin almacenamiento: se juega igual */ }
}
function leerGuardado() {
  try {
    const g = JSON.parse(localStorage.getItem(GUARDADO) || "null");
    return g && g.config && g.config.v === 1 && Array.isArray(g.config.columnas) && g.juego ? g : null;
  } catch {
    return null;
  }
}
function borrarGuardado() {
  try { localStorage.removeItem(GUARDADO); } catch { /* idem */ }
}

// ------------------------------------------------------------------ utilidades
const fmt = (n) => (n < 0 ? `−${Math.abs(n)}` : String(n));
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

function aviso(texto) {
  const nodo = document.createElement("div");
  nodo.className = "chip toast";
  nodo.textContent = texto;
  document.body.append(nodo);
  setTimeout(() => nodo.remove(), 4000);
}

function panel(titulo, texto, extra = "") {
  return `<section class="panel stack angosto"><h2>${esc(titulo)}</h2><p class="muted">${esc(texto)}</p>${extra}</section>`;
}

function cabecera() {
  $("#subtitulo").textContent = config ? config.titulo : "Tablero por equipos";
  // En la ronda final juegan todos a la vez: no hay turno que mostrar.
  const chip = $("#turno");
  chip.hidden = !config || !juego || juego.fase === "resultado" || juego.fase.startsWith("final")
    || (juego.fase === "diapos" && juego.abierta === config.final);
  if (!chip.hidden) chip.textContent = `${juego.fase === "tablero" ? "Elige" : "Turno"}: ${config.equipos[juego.turno]}`;
}

// ------------------------------------------------------------------ temas y casos
async function cargarIndice() {
  if (indice.length) return;
  const [estatico, vivo] = await Promise.all([cargarJSON("temas/indice.json").catch(() => null), indiceEnVivo()]);
  const orden = Object.keys(SEGMENTOS);
  indice = fusionarIndice(estatico?.paquetes || [], vivo)
    .filter((p) => (p.casos?.publicado || 0) > 0)
    .sort((a, b) => orden.indexOf(a.segmento) - orden.indexOf(b.segmento) || a.titulo.localeCompare(b.titulo));
}

async function cargarTemas(rutas) {
  const faltan = rutas.filter((ruta) => !datosDe.has(ruta));
  const cargados = await Promise.all(faltan.map((ruta) => cargarPaquete(ruta).then((d) => [ruta, d], () => [ruta, null])));
  for (const [ruta, datos] of cargados) if (datos) datosDe.set(ruta, datos);
}

// Solo casos publicados; sin «Incluir casos sin verificar», solo los que tienen el sello de un radiólogo.
function armarCatalogo(rutas, sinVerificar) {
  catalogo = new Map();
  for (const ruta of rutas) {
    const datos = datosDe.get(ruta);
    for (const caso of datos?.paquete.casos || []) {
      if (caso.estado !== "publicado" || (!sinVerificar && !caso.revisor)) continue;
      const clave = claveDe(datos.paquete.id, caso.id);
      catalogo.set(clave, { clave, ruta, paquete: datos.paquete.id, caso, grupo: grupoDe(caso) });
    }
  }
}

const datosDeClave = (clave) => datosDe.get(catalogo.get(clave)?.ruta);
const nivelClave = (clave) => nivelDe(catalogo.get(clave)?.caso);
const necesitaOpciones = (clave) => Boolean(catalogo.get(clave)?.caso.requiere_opciones);

// Alternativas: «pedido», el presentador las muestra con la tecla O (como antes); «nunca», se responde sin ellas
// salvo los casos que las necesitan; «siempre», a la vista desde el principio. Las partidas guardadas de antes
// no traen el campo: son «pedido».
const ALTERNATIVAS = {
  pedido: "A pedido: el presentador las muestra con la tecla O",
  nunca: "Nunca: se responde sin alternativas",
  siempre: "Siempre a la vista",
};
const modoAlternativas = (c) => (ALTERNATIVAS[c?.alternativas] ? c.alternativas : "pedido");
const evitarDe = (b) => (modoAlternativas(b) === "nunca" ? necesitaOpciones : () => false);
const tituloDe = (rutas) => (rutas.length === 1 ? datosDe.get(rutas[0])?.paquete.titulo || "Tablero" : `${rutas.length} temas`);

// ------------------------------------------------------------------ armado, paso 1: temas, tamaño y equipos
const PREDETERMINADO = {
  temas: [], sinVerificar: false, columnas: 4, filas: 4, equipos: ["Equipo 1", "Equipo 2", "Equipo 3"],
  doble: true, conFinal: true, restar: true, diapositivas: true, alternativas: "pedido",
};

async function pantallaArmado(previo = null) {
  config = juego = null;
  vistaPrevia = "";
  cabecera();
  app.innerHTML = `<p class="muted">Cargando temas…</p>`;
  await cargarIndice();
  if (!indice.length) {
    app.innerHTML = panel("Todavía no hay casos publicados",
      "El tablero usa los casos publicados. Cuando se publique el primer tema, aparecerá aquí.",
      `<div class="row"><a class="boton" href="./">Volver</a></div>`);
    return;
  }
  const b = { ...PREDETERMINADO, ...(previo || {}) };
  if (!b.temas.length) b.temas = [(indice.find((p) => p.casos.verificado) || indice[0]).ruta];
  const numeros = (desde, hasta, elegido, texto = (n) => n) => Array.from({ length: hasta - desde + 1 }, (_, i) => desde + i)
    .map((n) => `<option value="${n}" ${n === elegido ? "selected" : ""}>${texto(n)}</option>`).join("");
  app.innerHTML = `<form class="panel stack angosto" id="armado" novalidate>
    <p class="eyebrow">Presentador</p>
    <h2>Armar un tablero</h2>
    <p class="muted">Un juego por categorías, al estilo Jeopardy, para proyectar en clase. Los equipos responden en voz
      alta y tú marcas quién acertó: la app lleva la cuenta. No hacen falta celulares.</p>
    <div class="grid-label" role="group" aria-labelledby="titulo-temas"><span id="titulo-temas">Temas</span>
      <div class="casillas">${indice.map((p) => `<label class="row tb-opcion"><input type="checkbox" name="tema" value="${esc(p.ruta)}"
        ${b.temas.includes(p.ruta) ? "checked" : ""}> <span>${esc(p.titulo)}
        <span class="src">· ${p.casos.verificado || 0} verificados de ${p.casos.publicado}</span></span></label>`).join("")}</div>
    </div>
    <label class="row"><input type="checkbox" id="sin-verificar" ${b.sinVerificar ? "checked" : ""}> Incluir casos sin verificar</label>
    <div class="campos">
      <label class="grid-label">Columnas <select id="columnas">${numeros(2, MAX_COLUMNAS, b.columnas)}</select></label>
      <label class="grid-label">Filas <select id="filas">${numeros(3, 5, b.filas, (n) => `${n} (100 a ${n * 100})`)}</select></label>
      <label class="grid-label">Equipos <select id="n-equipos">${numeros(2, MAX_EQUIPOS, b.equipos.length)}</select></label>
      <label class="grid-label">Alternativas <select id="alternativas">${Object.entries(ALTERNATIVAS).map(([v, t]) =>
        `<option value="${v}" ${v === modoAlternativas(b) ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
    </div>
    <div class="campos" id="nombres"></div>
    <div class="casillas">
      <label class="row tb-opcion"><input type="checkbox" id="doble" ${b.doble ? "checked" : ""}> Una casilla doble escondida: el equipo apuesta antes de ver la pista</label>
      <label class="row tb-opcion"><input type="checkbox" id="con-final" ${b.conFinal ? "checked" : ""}> Ronda final con apuestas</label>
      <label class="row tb-opcion"><input type="checkbox" id="restar" ${b.restar ? "checked" : ""}> Restar el valor al equipo que falla</label>
      <label class="row tb-opcion"><input type="checkbox" id="diapositivas" ${b.diapositivas ? "checked" : ""}> Diapositivas de enseñanza después de cada casilla</label>
    </div>
    <p class="src" id="duracion"></p>
    <div class="row"><button class="primary lg" type="submit">Armar el tablero</button><a class="boton lg" href="./">Cancelar</a></div>
  </form>`;

  const nombres = () => [...app.querySelectorAll("[data-equipo]")].map((input) => input.value);
  const pintarNombres = (lista) => {
    $("#nombres").innerHTML = Array.from({ length: Number($("#n-equipos").value) }, (_, i) => `<label class="grid-label">Equipo ${i + 1}
      <input type="text" id="equipo-${i}" data-equipo="${i}" maxlength="24" value="${esc(lista[i] ?? `Equipo ${i + 1}`)}"></label>`).join("");
  };
  const duracion = () => {
    const casillas = Number($("#columnas").value) * Number($("#filas").value);
    const conFinal = $("#con-final").checked;
    $("#duracion").textContent = `${plural(casillas, "casilla", "casillas")}${conFinal ? " y la ronda final" : ""}: unos `
      + `${minutos(casillas, conFinal, $("#diapositivas").checked)} minutos. Si un grupo tiene menos casos, salen menos casillas.`;
  };
  pintarNombres(b.equipos);
  duracion();
  $("#n-equipos").onchange = () => pintarNombres(nombres());
  ["#columnas", "#filas", "#con-final", "#diapositivas"].forEach((sel) => { $(sel).onchange = duracion; });
  $("#armado").onsubmit = (e) => {
    e.preventDefault();
    const temas = [...app.querySelectorAll('input[name="tema"]:checked')].map((input) => input.value);
    if (!temas.length) return aviso("Elige al menos un tema.");
    armar({
      temas,
      sinVerificar: $("#sin-verificar").checked,
      columnas: Number($("#columnas").value),
      filas: Number($("#filas").value),
      equipos: nombres().map((n, i) => n.trim().replace(/\s+/g, " ") || `Equipo ${i + 1}`),
      doble: $("#doble").checked,
      conFinal: $("#con-final").checked,
      restar: $("#restar").checked,
      diapositivas: $("#diapositivas").checked,
      alternativas: $("#alternativas").value,
    });
  };
}

async function armar(b) {
  app.innerHTML = `<p class="muted">Cargando los casos…</p>`;
  await cargarTemas(b.temas);
  const rutas = b.temas.filter((ruta) => datosDe.has(ruta));
  armarCatalogo(rutas, b.sinVerificar);
  const volver = `<div class="row"><button id="volver">Volver</button></div>`;
  if (!rutas.length || !catalogo.size) {
    app.innerHTML = !rutas.length
      ? panel("No se pudieron cargar los temas", "Revisa la conexión y vuelve a intentarlo.", volver)
      : panel("Ningún caso cumple el filtro",
        "Los temas elegidos no tienen casos verificados. Vuelve y marca «Incluir casos sin verificar».", volver);
    $("#volver").onclick = () => pantallaArmado(b);
    return;
  }
  const temas = rutas.map((ruta) => ({
    ruta, titulo: datosDe.get(ruta).paquete.titulo, entradas: [...catalogo.values()].filter((e) => e.ruta === ruta),
  }));
  const grupos = proponerGrupos(temas, b.filas);
  // Columnas propuestas: primero los grupos que llenan todas las filas, en su orden; si faltan, los más grandes.
  const elegidos = new Set(grupos.filter((g) => g.claves.length >= b.filas).slice(0, b.columnas).map((g) => g.id));
  grupos.filter((g) => !elegidos.has(g.id)).sort((x, y) => y.claves.length - x.claves.length)
    .slice(0, Math.max(0, b.columnas - elegidos.size)).forEach((g) => elegidos.add(g.id));
  borrador = {
    ...b, temas: rutas, grupos: grupos.map((g) => ({ ...g, usar: elegidos.has(g.id) })), tablero: [], dobles: [],
    final: null, finalNombre: "", comparar: {}, propuestas: {}, tocado: {}, empieza: 0,
  };
  rehacerColumnas();
  rehacerDerivados({ sortear: true });
  pantallaRevision();
}

// ------------------------------------------------------------------ armado, paso 2: revisar el tablero
function rehacerColumnas({ sortear = false } = {}) {
  borrador.tablero = armarColumnas(borrador.grupos.filter((g) => g.usar), borrador.filas, sortear ? [] : borrador.tablero,
    nivelClave, evitarDe(borrador));
}

// La casilla doble, la final y los casos para comparar dependen de qué casos quedaron en el tablero.
function rehacerDerivados({ sortear = false } = {}) {
  const b = borrador;
  const enJuego = enTablero(b.tablero);
  b.dobles = b.doble ? (sortear ? [] : b.dobles.filter((k) => enJuego.has(k))) : [];
  if (b.doble && !b.dobles.length) b.dobles = sortearDobles(b.tablero, 1, nivelClave);
  if (!b.conFinal) {
    b.final = null;
  } else if (sortear || !b.final || enJuego.has(b.final) || !catalogo.has(b.final)) {
    b.final = proponerFinal(b.grupos, b.tablero, nivelClave, evitarDe(b));
    b.finalNombre = b.final ? catalogo.get(b.final).grupo : "";
  }
  if (sortear) b.tocado = {};
  const propuestas = {};
  const comparar = {};
  for (const clave of enTablero(b.tablero, b.final)) {
    const lista = proponerSimilares(clave, catalogo, b.tablero, b.final, 50);
    const validas = new Set(lista.map((p) => p.clave));
    const previas = sortear ? [] : (b.comparar[clave] || []).filter((k) => validas.has(k));
    propuestas[clave] = lista;
    // Si el presentador no tocó la casilla, va marcado el más parecido del mismo grupo.
    comparar[clave] = previas.length || b.tocado[clave] ? previas
      : lista.filter((p) => p.mismoGrupo).slice(0, 1).map((p) => p.clave);
  }
  b.propuestas = propuestas;
  b.comparar = comparar;
}

function comparacion(clave) {
  const e = catalogo.get(clave);
  if (!figurasDe(e).length) return "";
  const elegidas = borrador.comparar[clave] || [];
  const mostrar = [...new Set([...(borrador.propuestas[clave] || []).slice(0, 3).map((p) => p.clave), ...elegidas])];
  if (!mostrar.length) return `<span class="src">Ningún caso parecido fuera del tablero para comparar.</span>`;
  return `<div class="tb-comparar"><span>Comparar con:</span>${mostrar.map((k) => {
    const otro = catalogo.get(k);
    const ref = (otro.caso.imagenes.find((r) => r.mostrar_en === "pregunta") || otro.caso.imagenes[0])?.ref;
    const ficha = datosDeClave(k)?.paquete.imagenes[ref];
    return `<label class="row tb-opcion"><input type="checkbox" data-comparar="${esc(clave)}" value="${esc(k)}" ${elegidas.includes(k) ? "checked" : ""}>
      <span>${esc(respuestaDe(otro.caso))}${ficha ? ` <span class="src">· ${esc(ficha.figura)}</span>` : ""}</span></label>`;
  }).join("")}</div>`;
}

// Solo en la revisión, que no se proyecta: el nivel de dificultad y el porqué.
function chipNivel(caso) {
  const n = caso.dificultad?.nivel;
  if (!NIVELES[n]) return `<span class="chip nivel" title="El caso no tiene dificultad: cuenta como intermedio">Sin nivel</span>`;
  return `<span class="chip nivel n${n}" title="${esc([NIVELES[n].referente, caso.dificultad.motivo].filter(Boolean).join(" · "))}">${n} · ${esc(NIVELES[n].nombre)}</span>`;
}

function filaRevision(clave, c, r, libres, filas) {
  const valor = (r + 1) * 100;
  if (!clave) {
    return `<div class="tb-fila vacia"><div class="tb-fila-cabeza"><span class="tb-valor">${valor}</span>
      <span class="src">Casilla vacía: el grupo no tiene más casos.</span></div></div>`;
  }
  const e = catalogo.get(clave);
  const doble = borrador.dobles.includes(clave);
  return `<div class="tb-fila ${doble ? "doble" : ""}">
    <div class="tb-fila-cabeza"><span class="tb-valor">${valor}</span><b>${esc(e.caso.tema)}</b></div>
    <span class="src">Respuesta: ${esc(respuestaDe(e.caso))}</span>
    <div class="row">${chipNivel(e.caso)}${modoAlternativas(borrador) === "nunca" && e.caso.requiere_opciones
      ? `<span class="src">Necesita las opciones: saldrán a la vista.</span>` : ""}</div>
    <div class="acciones">
      <button type="button" data-mover="${c}:${r}:-1" ${r === 0 ? "disabled" : ""} aria-label="Subir">↑</button>
      <button type="button" data-mover="${c}:${r}:1" ${r === filas - 1 ? "disabled" : ""} aria-label="Bajar">↓</button>
      <label class="row src"><input type="checkbox" data-doble="${esc(clave)}" ${doble ? "checked" : ""}> Casilla doble</label>
      ${libres.length ? `<select data-cambiar="${c}:${r}" aria-label="Cambiar por otro caso del grupo"><option value="">Cambiar por…</option>
        ${libres.map((k) => `<option value="${esc(k)}">${esc(catalogo.get(k).caso.tema)}</option>`).join("")}</select>` : ""}
    </div>
    ${comparacion(clave)}
  </div>`;
}

function pantallaRevision() {
  const b = borrador;
  const conNivel = [...enTablero(b.tablero)].some((k) => catalogo.get(k)?.caso.dificultad?.nivel);
  const enJuego = enTablero(b.tablero);
  const casillas = b.tablero.reduce((n, col) => n + col.casos.filter(Boolean).length, 0);
  const columnas = b.tablero.map((col, c) => {
    const grupo = b.grupos.find((g) => g.id === col.grupo);
    const libres = (grupo?.claves || []).filter((k) => !enJuego.has(k));
    return `<section class="panel tb-col"><h3>${esc(col.nombre)}</h3>
      ${col.casos.map((clave, r) => filaRevision(clave, c, r, libres, col.casos.length)).join("")}</section>`;
  }).join("");
  const libresFinal = [...catalogo.values()].filter((e) => !enJuego.has(e.clave));
  app.innerHTML = `
    <section class="panel stack">
      <div class="row"><h2>Revisar el tablero</h2><span class="spacer"></span>
        <span class="src">${plural(casillas, "casilla", "casillas")}${b.final ? " y la ronda final" : ""} · unos ${minutos(casillas, Boolean(b.final), b.diapositivas)} minutos</span></div>
      <p class="nota">Todavía no lo proyectes: aquí se ve de qué trata cada casilla y su respuesta.</p>
      <h3>Columnas</h3>
      <p class="src">Marca hasta ${MAX_COLUMNAS}. Salen de lo que va antes de « · » en el tema de cada caso; puedes
        cambiarles el nombre o juntar una con la siguiente. ${conNivel
          ? "Dentro de cada columna, el valor sube con la dificultad del caso (1 básico a 4 subespecialidad, asignada por el contenido y la bibliografía); puedes reordenarlos."
          : "Estos casos todavía no tienen dificultad: el orden dentro de cada columna es al azar y el valor no la mide."}</p>
      <div class="tb-grupos">${b.grupos.map((g, i) => `<div class="tb-grupo">
        <input type="checkbox" id="usar-${i}" data-usar="${i}" ${g.usar ? "checked" : ""} aria-label="Usar como columna">
        <input type="text" id="nombre-${i}" data-nombre="${i}" value="${esc(g.nombre)}" maxlength="60" aria-label="Nombre de la columna">
        <span class="src">${plural(g.claves.length, "caso", "casos")}</span>
        ${i < b.grupos.length - 1 ? `<button type="button" data-juntar="${i}">Juntar con la siguiente</button>` : ""}
      </div>`).join("")}</div>
    </section>
    ${columnas ? `<div class="tb-revision">${columnas}</div>` : `<p class="nota">Marca al menos una columna.</p>`}
    <section class="panel stack">
      <h3>Ronda final</h3>
      <div class="campos">
        <label class="grid-label">Caso <select id="final-caso"><option value="">Sin ronda final</option>
          ${libresFinal.map((e) => `<option value="${esc(e.clave)}" ${e.clave === b.final ? "selected" : ""}>${esc(e.caso.tema)}</option>`).join("")}</select></label>
        <label class="grid-label">Categoría que se anuncia
          <input type="text" id="final-nombre" maxlength="60" value="${esc(b.finalNombre)}" ${b.final ? "" : "disabled"}></label>
      </div>
      ${b.final ? `<span class="src">Respuesta: ${esc(respuestaDe(catalogo.get(b.final).caso))}</span>${comparacion(b.final)}` : ""}
      <label class="grid-label">Empieza eligiendo <select id="empieza">${b.equipos.map((n, i) =>
        `<option value="${i}" ${i === b.empieza ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></label>
    </section>
    <div class="ctrl"><button id="volver">Volver</button><button id="sortear">Otro sorteo</button>
      <span class="spacer"></span><button class="primary lg" id="empezar">Empezar la partida</button></div>`;

  const otraVez = ({ columnas: tambienColumnas = false, derivados = true } = {}) => {
    if (tambienColumnas) rehacerColumnas();
    if (derivados) rehacerDerivados();
    pantallaRevision();
  };
  app.querySelectorAll("[data-usar]").forEach((input) => {
    input.onchange = () => {
      if (input.checked && b.grupos.filter((g) => g.usar).length >= MAX_COLUMNAS) {
        input.checked = false;
        return aviso(`Caben hasta ${MAX_COLUMNAS} columnas.`);
      }
      b.grupos[Number(input.dataset.usar)].usar = input.checked;
      otraVez({ columnas: true });
    };
  });
  app.querySelectorAll("[data-nombre]").forEach((input) => {
    input.onchange = () => {
      const g = b.grupos[Number(input.dataset.nombre)];
      g.nombre = input.value.trim().replace(/\s+/g, " ") || g.nombre;
      otraVez({ columnas: true, derivados: false });
    };
  });
  app.querySelectorAll("[data-juntar]").forEach((boton) => {
    boton.onclick = () => {
      const i = Number(boton.dataset.juntar);
      b.grupos.splice(i, 2, juntar(b.grupos[i], b.grupos[i + 1]));
      otraVez({ columnas: true });
    };
  });
  app.querySelectorAll("[data-mover]").forEach((boton) => {
    boton.onclick = () => {
      const [c, r, paso] = boton.dataset.mover.split(":").map(Number);
      const casos = b.tablero[c].casos;
      [casos[r], casos[r + paso]] = [casos[r + paso], casos[r]];
      otraVez({ derivados: false });
    };
  });
  app.querySelectorAll("[data-doble]").forEach((input) => {
    input.onchange = () => {
      if (input.checked && b.dobles.length >= MAX_DOBLES) {
        input.checked = false;
        return aviso(`Caben hasta ${MAX_DOBLES} casillas dobles.`);
      }
      b.dobles = input.checked ? [...b.dobles, input.dataset.doble] : b.dobles.filter((k) => k !== input.dataset.doble);
      b.doble = b.dobles.length > 0;
      otraVez({ derivados: false });
    };
  });
  app.querySelectorAll("[data-cambiar]").forEach((select) => {
    select.onchange = () => {
      if (!select.value) return;
      const [c, r] = select.dataset.cambiar.split(":").map(Number);
      const anterior = b.tablero[c].casos[r];
      b.tablero[c].casos[r] = select.value;
      b.dobles = b.dobles.map((k) => (k === anterior ? select.value : k));   // la casilla doble sigue en su lugar
      otraVez();
    };
  });
  app.querySelectorAll("[data-comparar]").forEach((input) => {
    input.onchange = () => {
      const clave = input.dataset.comparar;
      const elegidas = b.comparar[clave] || [];
      if (input.checked && elegidas.length >= MAX_COMPARAR) {
        input.checked = false;
        return aviso(`Caben hasta ${MAX_COMPARAR} casos para comparar por casilla.`);
      }
      b.comparar[clave] = input.checked ? [...elegidas, input.value] : elegidas.filter((k) => k !== input.value);
      b.tocado[clave] = true;
    };
  });
  $("#final-caso").onchange = () => {
    b.final = $("#final-caso").value || null;
    b.conFinal = Boolean(b.final);
    b.finalNombre = b.final ? catalogo.get(b.final).grupo : "";
    otraVez();
  };
  $("#final-nombre").onchange = () => { b.finalNombre = $("#final-nombre").value.trim() || b.finalNombre; };
  $("#empieza").onchange = () => { b.empieza = Number($("#empieza").value); };
  $("#volver").onclick = () => pantallaArmado(b);
  $("#sortear").onclick = () => {
    rehacerColumnas({ sortear: true });
    rehacerDerivados({ sortear: true });
    pantallaRevision();
  };
  $("#empezar").onclick = empezarPartida;
}

function empezarPartida() {
  const b = borrador;
  const columnas = b.tablero.filter((col) => col.casos.some(Boolean));
  if (!columnas.length) return aviso("Marca al menos una columna con casos.");
  const enJuego = enTablero(columnas);
  config = {
    v: 1,
    titulo: tituloDe(b.temas),
    temas: b.temas,
    sinVerificar: b.sinVerificar,
    filas: b.filas,
    valores: valores(b.filas),
    columnas: columnas.map((col) => ({ nombre: col.nombre, casos: [...col.casos] })),
    dobles: b.dobles.filter((k) => enJuego.has(k)),
    final: b.final,
    finalNombre: b.final ? b.finalNombre || catalogo.get(b.final).grupo : "",
    equipos: b.equipos,
    restar: b.restar,
    diapositivas: b.diapositivas,
    comparar: b.comparar,
    alternativas: modoAlternativas(b),
  };
  juego = {
    fase: "tablero", puntos: b.equipos.map(() => 0), turno: Math.min(b.empieza, b.equipos.length - 1), usadas: {},
    abierta: null, fuera: [], ganador: null, apuesta: null, diapo: 0, opciones: false, orden: null, historial: [],
  };
  borrador = null;
  guardar();
  mostrar();
}

// ------------------------------------------------------------------ la partida
function mostrar() {
  cerrarDialogo();
  cabecera();
  const vistas = {
    tablero: vistaTablero, apuesta: vistaApuesta, pista: vistaPista, diapos: vistaDiapos,
    "final-intro": vistaFinalIntro, "final-pista": vistaPista, "final-juicio": vistaFinalJuicio, resultado: vistaResultado,
  };
  (vistas[juego.fase] || vistaTablero)();
  const clave = `${juego.fase}:${juego.abierta}:${juego.diapo}`;
  if (clave !== vistaPrevia) window.scrollTo({ top: 0 });
  vistaPrevia = clave;
}

function posicion(clave) {
  for (const col of config.columnas) {
    const r = col.casos.indexOf(clave);
    if (r >= 0) return { columna: col.nombre, valor: config.valores[r] };
  }
  return { columna: config.finalNombre, valor: 0 };
}
const esDoble = (clave) => config.dobles.includes(clave);
const jugable = (clave) => Boolean(clave) && catalogo.has(clave) && !juego.usadas[clave];
const quedanCasillas = () => config.columnas.some((col) => col.casos.some(jugable));

// Cada acción que cambia puntajes o avanza la partida deja una copia del estado: «Deshacer» vuelve a ella.
function anotar() {
  const { historial, ...estado } = juego;
  historial.push(JSON.stringify(estado));
  if (historial.length > 80) historial.shift();
}

function deshacer() {
  const previo = juego.historial.pop();
  if (!previo) return aviso("No hay nada que deshacer.");
  juego = { ...JSON.parse(previo), historial: juego.historial };
  guardar();
  mostrar();
}

function marcador({ juez = false, ajustar = false } = {}) {
  const doble = juez && esDoble(juego.abierta);
  return `<div class="tb-equipos">${config.equipos.map((nombre, i) => {
    const puntos = juego.puntos[i];
    const clase = `tb-puntos ${puntos < 0 ? "negativo" : ""}`;
    let pie = "";
    if (juez) {
      if (juego.fuera.includes(i)) pie = `<span class="tb-estado mal">Falló</span>`;
      else if (doble && i !== juego.turno) pie = `<span class="tb-estado">No responde</span>`;
      else {
        pie = `<div class="tb-juez">
          <button class="si" data-marcar="${i}" data-acierto="1" aria-label="${esc(nombre)} acertó">Acertó</button>
          <button class="no" data-marcar="${i}" data-acierto="0" aria-label="${esc(nombre)} falló">Falló</button></div>`;
      }
    }
    return `<div class="tb-equipo ${i === juego.turno ? "turno" : ""}">
      <div class="tb-nombre"><span>${esc(nombre)}</span>${juez ? `<kbd>${i + 1}</kbd>` : ""}</div>
      ${ajustar ? `<button class="${clase}" data-ajustar="${i}" title="Corregir el puntaje"
        aria-label="${esc(nombre)}: ${fmt(puntos)} puntos. Corregir el puntaje">${fmt(puntos)}</button>`
        : `<span class="${clase}">${fmt(puntos)}</span>`}
      ${pie}</div>`;
  }).join("")}</div>`;
}

// Los botones que se repiten en varias pantallas.
function enganchar() {
  app.querySelectorAll("[data-marcar]").forEach((b) => { b.onclick = () => marcar(Number(b.dataset.marcar), b.dataset.acierto === "1"); });
  app.querySelectorAll("[data-ajustar]").forEach((b) => { b.onclick = () => ajustar(Number(b.dataset.ajustar)); });
  const acciones = { deshacer, nueva: nuevaPartida, "ver-opciones": verOpciones, nadie };
  for (const [id, accion] of Object.entries(acciones)) {
    const boton = $(`#${id}`);
    if (boton) boton.onclick = () => accion();
  }
}

function vistaTablero() {
  const celdas = [];
  for (let r = 0; r < config.filas; r++) {
    for (const col of config.columnas) {
      const clave = col.casos[r];
      const valor = config.valores[r];
      if (!clave) celdas.push(`<div class="tb-celda vacia"></div>`);
      else if (!catalogo.has(clave)) celdas.push(`<div class="tb-celda falta" title="Este caso ya no está publicado">—</div>`);
      else if (juego.usadas[clave]) celdas.push(`<div class="tb-celda usada" aria-label="${esc(col.nombre)}, ${valor}: jugada"></div>`);
      else celdas.push(`<button class="tb-celda" data-clave="${esc(clave)}" aria-label="${esc(col.nombre)}, ${valor}">${valor}</button>`);
    }
  }
  const terminado = !quedanCasillas();
  const quedaFinal = config.final && catalogo.has(config.final) && !juego.usadas[config.final];
  app.innerHTML = `
    <div class="tablero" style="--cols:${config.columnas.length}">
      ${config.columnas.map((col) => `<div class="tb-cab">${esc(col.nombre)}</div>`).join("")}
      ${celdas.join("")}
    </div>
    ${marcador({ ajustar: true })}
    <div class="ctrl">
      ${quedaFinal ? `<button class="${terminado ? "primary" : ""}" id="a-final">Ronda final</button>`
        : `<button class="${terminado ? "primary" : ""}" id="a-resultado">Ver el resultado</button>`}
      <button id="deshacer" ${juego.historial.length ? "" : "disabled"}>Deshacer</button>
      <span class="spacer"></span>
      <span class="src teclas">Toca un puntaje para corregirlo</span>
      <button id="nueva">Nueva partida</button>
    </div>`;
  app.querySelectorAll("button.tb-celda").forEach((boton) => { boton.onclick = () => abrir(boton.dataset.clave); });
  enganchar();
  if (quedaFinal) $("#a-final").onclick = irAFinal;
  else $("#a-resultado").onclick = () => {
    if (!terminado && !confirm("Todavía quedan casillas sin jugar. ¿Terminar igual?")) return;
    anotar();
    juego.fase = "resultado";
    guardar();
    mostrar();
  };
  for (const col of config.columnas) for (const clave of col.casos) if (jugable(clave)) precargar(clave, false);
}

function abrir(clave) {
  if (!jugable(clave)) return;
  anotar();
  Object.assign(juego, {
    abierta: clave, fase: esDoble(clave) ? "apuesta" : "pista", fuera: [], ganador: null, apuesta: null,
    diapo: 0, opciones: false, orden: null,
  });
  guardar();
  mostrar();
}

function vistaApuesta() {
  const pos = posicion(juego.abierta);
  const max = maxApuestaDoble(juego.puntos[juego.turno], config.valores);
  app.innerHTML = `<section class="stack tb-anuncio">
    <p class="eyebrow">${esc(pos.columna)} · ${pos.valor}</p>
    <h1>Casilla doble</h1>
    <p class="lead">Responde solo ${esc(config.equipos[juego.turno])}, y apuesta antes de ver la pista: hasta ${max} puntos.</p>
    <div class="row">
      <button type="button" data-apuesta="${pos.valor}">El valor de la casilla (${pos.valor})</button>
      <button type="button" data-apuesta="${max}">Todo (${max})</button>
    </div>
    <label class="grid-label tb-apuesta">Apuesta
      <input type="number" id="apuesta" min="0" max="${max}" step="1" inputmode="numeric" value="${Math.min(pos.valor, max)}"></label>
    <p class="nota" id="error-apuesta" hidden></p>
    <div class="row"><button class="primary lg" id="ver-pista">Mostrar la pista</button><button id="deshacer">Deshacer</button></div>
  </section>`;
  enganchar();
  app.querySelectorAll("[data-apuesta]").forEach((b) => { b.onclick = () => { $("#apuesta").value = b.dataset.apuesta; }; });
  const confirmar = () => {
    const campo = $("#apuesta");
    const n = Number(campo.value);
    if (campo.value.trim() === "" || !Number.isInteger(n) || n < 0 || n > max) {
      $("#error-apuesta").textContent = `La apuesta va de 0 a ${max}.`;
      $("#error-apuesta").hidden = false;
      campo.focus();
      return;
    }
    anotar();
    juego.apuesta = n;
    juego.fase = "pista";
    guardar();
    mostrar();
  };
  $("#ver-pista").onclick = confirmar;
  $("#apuesta").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); confirmar(); } };
}

function visor(datos, refs) {
  const figuras = refs.map((r) => {
    const ficha = datos?.paquete.imagenes[r.ref];
    if (!ficha) return "";
    return `<figure><img src="${esc(datos.imagen(r.ref))}" alt="${esc(ficha.figura)}" data-zoom>
      <figcaption class="cap"><span>${credito(ficha, datos.fuentes[ficha.fuente])}</span><span>Toca para ampliar</span></figcaption></figure>`;
  }).join("");
  return figuras ? `<div class="viewer">${figuras}</div>` : "";
}

function opcionesHTML(caso) {
  const orden = juego.orden || caso.opciones.map((_, i) => i);
  return `<div class="opts">${orden.map((original, pos) => `<div class="opt" data-k="${pos}"><span class="k">${LETRAS[pos]}</span>
    <span>${esc(caso.opciones[original])}</span></div>`).join("")}</div>`;
}

// La pista de una casilla y la de la ronda final: la misma pantalla, sin los botones de cada equipo en la final.
function vistaPista() {
  const clave = juego.abierta;
  const e = catalogo.get(clave);
  if (!e) {
    Object.assign(juego, { fase: "tablero", abierta: null });
    guardar();
    return mostrar();
  }
  const esFinal = juego.fase === "final-pista";
  const pos = posicion(clave);
  const doble = !esFinal && esDoble(clave);
  const imagenes = visor(datosDeClave(clave), e.caso.imagenes.filter((r) => r.mostrar_en === "pregunta"));
  const modo = modoAlternativas(config);
  // «Siempre», o «nunca» con un caso que las necesita: las opciones salen solas, barajadas una vez.
  if (!juego.opciones && (modo === "siempre" || (modo === "nunca" && e.caso.requiere_opciones))) {
    const indices = e.caso.opciones.map((_, i) => i);
    juego.opciones = true;
    juego.orden = e.caso.barajar === false ? indices : barajar(indices);
    guardar();
  }
  app.innerHTML = `
    <div class="qhead"><span class="qnum">${esc(pos.columna)}</span>
      <span class="tb-valor">${esFinal ? "Ronda final" : doble ? `Doble · ${fmt(juego.apuesta)}` : pos.valor}</span></div>
    <section class="stage ${imagenes ? "" : "sin-imagen"}">
      ${imagenes}
      <div class="pregunta">
        <div class="stem md">${md(e.caso.enunciado)}</div>
        ${juego.opciones ? opcionesHTML(e.caso) : modo === "nunca" ? ""
          : `<div class="row"><button id="ver-opciones">Mostrar opciones <kbd>O</kbd></button></div>`}
        ${esFinal ? "" : marcador({ juez: true })}
      </div>
    </section>
    <div class="ctrl">
      ${esFinal ? `<button class="primary" id="revelar-final">Revelar la respuesta</button>`
        : `<button id="nadie">${doble ? "Revelar sin puntuar" : "Nadie acertó: revelar"} <kbd>R</kbd></button>`}
      <button id="deshacer">Deshacer <kbd>Z</kbd></button>
      <span class="spacer"></span>
      ${esFinal ? "" : `<span class="src teclas"><kbd>1</kbd>–<kbd>${config.equipos.length}</kbd> acertó · <kbd>Mayús</kbd> + número falló</span>`}
    </div>`;
  enganchar();
  if (esFinal) {
    $("#revelar-final").onclick = () => {
      anotar();
      juego.fase = "final-juicio";
      guardar();
      mostrar();
    };
  }
  precargar(clave, true);
}

function verOpciones() {
  if (!["pista", "final-pista"].includes(juego.fase) || juego.opciones || modoAlternativas(config) === "nunca") return;
  const caso = catalogo.get(juego.abierta).caso;
  const indices = caso.opciones.map((_, i) => i);
  juego.opciones = true;
  juego.orden = caso.barajar === false ? indices : barajar(indices);
  guardar();
  mostrar();
}

// Acertó: suma el valor (o la apuesta, en la casilla doble) y el equipo pasa a elegir. Falló: resta si así se
// armó el tablero (en la casilla doble, siempre) y otro equipo puede intentarlo; si fallan todos, se revela.
function marcar(i, acierto) {
  const clave = juego.abierta;
  if (juego.fase !== "pista" || i >= config.equipos.length || juego.fuera.includes(i)) return;
  const doble = esDoble(clave);
  if (doble && i !== juego.turno) return;
  const valor = doble ? juego.apuesta : posicion(clave).valor;
  anotar();
  if (acierto) {
    juego.puntos[i] += valor;
    juego.turno = i;
    juego.ganador = i;
    return cerrarCasilla();
  }
  if (config.restar || doble) juego.puntos[i] -= valor;
  juego.fuera.push(i);
  if (doble || juego.fuera.length >= config.equipos.length) return cerrarCasilla();
  guardar();
  mostrar();
}

function nadie() {
  if (juego.fase !== "pista") return;
  anotar();
  cerrarCasilla();
}

function cerrarCasilla() {
  juego.usadas[juego.abierta] = true;
  juego.fase = "diapos";
  juego.diapo = 0;
  guardar();
  mostrar();
}

// Las diapositivas de la casilla, sin los casos para comparar que ahora adelantarían otra casilla.
function mazoDe(clave) {
  const e = catalogo.get(clave);
  const reservas = reservasDe(config, juego.usadas, catalogo);
  const comparar = (config.comparar[clave] || []).map((k) => catalogo.get(k))
    .filter((otro) => otro && datosDeClave(otro.clave)
      && !figurasDe(otro).some((f) => reservas.figuras.has(f))
      && !reservas.respuestas.has(normal(respuestaDe(otro.caso))))
    .map((otro) => ({ caso: otro.caso, datos: datosDeClave(otro.clave) }));
  return diapositivas({ caso: e.caso, datos: datosDeClave(clave), comparar, reservas, completas: config.diapositivas });
}

function vistaDiapos() {
  const clave = juego.abierta;
  const e = catalogo.get(clave);
  if (!e) return salirDeDiapos();
  const mazo = mazoDe(clave);
  const i = Math.max(0, Math.min(juego.diapo, mazo.length - 1));
  const diapo = mazo[i];
  const pos = posicion(clave);
  const esFinal = clave === config.final;
  const doble = esDoble(clave);
  const ultima = i === mazo.length - 1;
  let resultado = "";   // en la final, cada equipo acierta o falla por su lado: no hay un resultado de la casilla
  if (!esFinal && juego.ganador !== null) {
    resultado = `<span class="chip tb-ok">Acertó ${esc(config.equipos[juego.ganador])} · +${doble ? juego.apuesta : pos.valor}</span>`;
  } else if (!esFinal && doble && juego.fuera.length) {
    resultado = `<span class="chip tb-mal">Falló ${esc(config.equipos[juego.turno])} · ${fmt(-juego.apuesta)}</span>`;
  } else if (!esFinal) {
    resultado = `<span class="chip">Nadie acertó</span>`;
  }
  app.innerHTML = `
    <div class="qhead"><span class="qnum">${esc(pos.columna)}</span>
      <span class="tb-valor">${esFinal ? "Ronda final" : doble ? `Doble · ${fmt(juego.apuesta)}` : pos.valor}</span>
      ${resultado}<span class="spacer"></span><span class="src">${esc(diapo.titulo)} · ${i + 1} / ${mazo.length}</span></div>
    <section class="diapo" aria-label="${esc(diapo.titulo)}">${diapo.html}</section>
    <p class="src diapo-pie">${diapo.pie}</p>
    <div class="ctrl">
      <button id="anterior" ${i === 0 ? "disabled" : ""}>Anterior</button>
      <button class="primary" id="siguiente">${ultima ? (esFinal ? "Ver el resultado" : "Volver al tablero") : "Siguiente"}</button>
      <button id="deshacer">Deshacer</button>
      <span class="spacer"></span>
      <span class="tb-mini">${config.equipos.map((n, k) => `<span>${esc(n)} <b>${fmt(juego.puntos[k])}</b></span>`).join("")}</span>
      <button id="reportar" class="reportar">Reportar un error</button>
    </div>`;
  enganchar();
  $("#anterior").onclick = () => avanzar(-1);
  $("#siguiente").onclick = () => avanzar(1);
  const boton = $("#reportar");
  boton.onclick = () => reportar(e.ruta, e.caso.id, boton);
}

function avanzar(paso) {
  const siguiente = juego.diapo + paso;
  if (siguiente < 0) return;
  if (siguiente >= mazoDe(juego.abierta).length) return salirDeDiapos();
  juego.diapo = siguiente;
  guardar();
  mostrar();
}

function salirDeDiapos() {
  juego.fase = juego.abierta && juego.abierta === config.final ? "resultado" : "tablero";
  juego.abierta = null;
  juego.diapo = 0;
  guardar();
  mostrar();
}

// ------------------------------------------------------------------ ronda final
function irAFinal() {
  if (quedanCasillas() && !confirm("Todavía quedan casillas sin jugar. ¿Pasar igual a la ronda final?")) return;
  anotar();
  Object.assign(juego, { abierta: config.final, fase: "final-intro", fuera: [], ganador: null, apuesta: null, opciones: false, orden: null });
  guardar();
  mostrar();
}

function vistaFinalIntro() {
  app.innerHTML = `<section class="stack tb-anuncio">
    <p class="eyebrow">Ronda final</p>
    <h1>${esc(config.finalNombre)}</h1>
    <p class="lead">Cada equipo escribe en un papel cuánto apuesta, de 0 hasta sus puntos. Después se muestra el caso y
      escriben su respuesta.</p>
    ${marcador()}
    <div class="row"><button class="primary lg" id="ver-final">Mostrar el caso</button><button id="deshacer">Deshacer</button></div>
  </section>`;
  enganchar();
  $("#ver-final").onclick = () => {
    juego.fase = "final-pista";
    guardar();
    mostrar();
  };
}

// Las apuestas se escriben en papel (en la pantalla las verían todos) y se cargan aquí al revelar.
function vistaFinalJuicio() {
  const e = catalogo.get(config.final);
  app.innerHTML = `
    <div class="qhead"><span class="qnum">Ronda final</span><span class="tema">${esc(config.finalNombre)}</span></div>
    <div class="exp"><div class="ans">Respuesta: ${esc(respuestaDe(e.caso))}</div></div>
    <p class="muted">Anota lo que apostó cada equipo y marca si acertó. Con 0 puntos o menos, la apuesta es 0.</p>
    <div class="tb-final">${config.equipos.map((nombre, i) => {
      const max = maxApuestaFinal(juego.puntos[i]);
      return `<div class="tb-equipo"><div class="tb-nombre"><span>${esc(nombre)}</span></div>
        <span class="tb-puntos ${juego.puntos[i] < 0 ? "negativo" : ""}">${fmt(juego.puntos[i])}</span>
        <label class="grid-label">Apuesta, de 0 a ${max}
          <input type="number" id="apuesta-${i}" min="0" max="${max}" step="1" inputmode="numeric" value="0" ${max ? "" : "disabled"}></label>
        <div class="row">
          <label class="row"><input type="radio" name="final-${i}" value="1"> Acertó</label>
          <label class="row"><input type="radio" name="final-${i}" value="0"> Falló</label>
        </div></div>`;
    }).join("")}</div>
    <p class="nota" id="error-final" hidden></p>
    <div class="ctrl"><button class="primary lg" id="aplicar">Sumar y ver la enseñanza</button><button id="deshacer">Deshacer</button></div>`;
  enganchar();
  $("#aplicar").onclick = () => {
    const error = (texto) => { $("#error-final").textContent = texto; $("#error-final").hidden = false; };
    const cambios = [];
    for (let i = 0; i < config.equipos.length; i++) {
      const max = maxApuestaFinal(juego.puntos[i]);
      const apuesta = Number($(`#apuesta-${i}`).value || 0);
      const marcado = app.querySelector(`input[name="final-${i}"]:checked`);
      if (!Number.isInteger(apuesta) || apuesta < 0 || apuesta > max) return error(`La apuesta de ${config.equipos[i]} va de 0 a ${max}.`);
      if (apuesta > 0 && !marcado) return error(`Marca si ${config.equipos[i]} acertó o falló.`);
      cambios.push(apuesta && marcado ? (marcado.value === "1" ? apuesta : -apuesta) : 0);
    }
    anotar();
    cambios.forEach((delta, i) => { juego.puntos[i] += delta; });
    Object.assign(juego, { fase: "diapos", diapo: 0, ganador: null });
    juego.usadas[config.final] = true;
    guardar();
    mostrar();
  };
}

function vistaResultado() {
  const filas = config.equipos.map((nombre, i) => ({ nombre, puntos: juego.puntos[i] })).sort((a, b) => b.puntos - a.puntos);
  app.innerHTML = `<section class="stack angosto">
    <p class="eyebrow">${esc(config.titulo)}</p>
    <h1>Resultado final</h1>
    <div class="rank">${filas.map((f) => `<div class="rk"><span class="pos">${1 + filas.filter((x) => x.puntos > f.puntos).length}</span>
      <span>${esc(f.nombre)}</span><span class="pts">${fmt(f.puntos)}</span></div>`).join("")}</div>
    <div class="ctrl"><button id="deshacer">Deshacer</button><span class="spacer"></span><button class="primary" id="nueva">Nueva partida</button></div>
  </section>`;
  enganchar();
}

function nuevaPartida() {
  if (juego && juego.fase !== "resultado" && !confirm("¿Terminar esta partida y armar otra? Se borran los puntajes.")) return;
  const previo = config && {
    temas: config.temas, sinVerificar: config.sinVerificar, columnas: config.columnas.length, filas: config.filas,
    equipos: config.equipos, doble: config.dobles.length > 0, conFinal: Boolean(config.final), restar: config.restar,
    diapositivas: config.diapositivas, alternativas: modoAlternativas(config),
  };
  borrarGuardado();
  pantallaArmado(previo);
}

// ------------------------------------------------------------------ corregir un puntaje
function ajustar(i) {
  const dialogo = $("#dialogo");
  dialogo.innerHTML = `<form class="panel dialogo" id="form-ajuste" novalidate>
    <h3>Corregir el puntaje de ${esc(config.equipos[i])}</h3>
    <label class="grid-label">Puntaje <input type="number" id="nuevo-puntaje" step="1" inputmode="numeric" value="${juego.puntos[i]}"></label>
    <div class="row"><button class="primary" type="submit">Guardar</button><button type="button" id="cancelar-ajuste">Cancelar</button></div>
  </form>`;
  dialogo.hidden = false;
  const campo = $("#nuevo-puntaje");
  campo.focus();
  campo.select();
  $("#form-ajuste").onsubmit = (e) => {
    e.preventDefault();
    const n = Number(campo.value);
    if (campo.value.trim() === "" || !Number.isInteger(n)) return campo.focus();
    anotar();
    juego.puntos[i] = n;
    guardar();
    mostrar();
  };
  $("#cancelar-ajuste").onclick = cerrarDialogo;
}

function cerrarDialogo() {
  const dialogo = $("#dialogo");
  dialogo.hidden = true;
  dialogo.innerHTML = "";
}

// ------------------------------------------------------------------ imágenes
// Las figuras de las pistas se bajan al mostrar el tablero, y las de la enseñanza al abrir la casilla: con la red
// lenta del hospital, así no aparecen tarde.
function precargar(clave, conEnsenanza) {
  const e = catalogo.get(clave);
  const datos = datosDeClave(clave);
  if (!e || !datos) return;
  const refs = e.caso.imagenes.filter((r) => conEnsenanza || r.mostrar_en === "pregunta").map((r) => [datos, r.ref]);
  if (conEnsenanza) {
    for (const k of config.comparar[clave] || []) {
      const otro = catalogo.get(k);
      if (otro) otro.caso.imagenes.forEach((r) => refs.push([datosDeClave(k), r.ref]));
    }
  }
  for (const [d, ref] of refs) {
    const src = d && d.imagen(ref);
    if (src && !precargadas.has(src)) {
      precargadas.add(src);
      new Image().src = src;
    }
  }
}

document.addEventListener("click", (e) => {
  const imagen = e.target.closest("[data-zoom]");
  if (imagen) {
    $("#zoomImg").src = imagen.src;
    $("#zoomImg").alt = imagen.alt;
    $("#zoom").hidden = false;
  }
});
$("#zoom").onclick = () => { $("#zoom").hidden = true; };
$("#dialogo").onclick = (e) => { if (e.target.id === "dialogo") cerrarDialogo(); };

// ------------------------------------------------------------------ teclado
// 1–6 acertó ese equipo, Mayús + número falló, R nadie acertó, O mostrar opciones, Z deshacer. En las
// diapositivas, → o Avanzar página (lo que manda un control remoto de presentaciones), ← o Retroceder, Esc vuelve.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#zoom").hidden) { $("#zoom").hidden = true; return; }
  if (e.key === "Escape" && !$("#dialogo").hidden) { cerrarDialogo(); return; }
  if (!config || !juego || !$("#dialogo").hidden || e.ctrlKey || e.metaKey || e.altKey) return;
  const destino = e.target instanceof Element ? e.target : document.body;
  if (destino.closest("input, select, textarea")) return;
  if ((e.key === " " || e.key === "Enter") && destino.closest("button, a")) return;   // el botón enfocado ya responde
  const fase = juego.fase;
  const numero = /^(?:Digit|Numpad)([1-6])$/.exec(e.code);
  const tecla = e.key.toLowerCase();
  if (fase === "pista" && numero) {
    e.preventDefault();
    marcar(Number(numero[1]) - 1, !e.shiftKey);
  } else if (fase === "pista" && tecla === "r") {
    nadie();
  } else if ((fase === "pista" || fase === "final-pista") && tecla === "o") {
    verOpciones();
  } else if (tecla === "z") {
    deshacer();
  } else if (fase === "diapos" && ["ArrowRight", "PageDown", " "].includes(e.key)) {
    e.preventDefault();
    avanzar(1);
  } else if (fase === "diapos" && ["ArrowLeft", "PageUp"].includes(e.key)) {
    e.preventDefault();
    avanzar(-1);
  } else if (fase === "diapos" && e.key === "Escape") {
    salirDeDiapos();
  }
});

// ------------------------------------------------------------------ arranque
async function seguir(guardado) {
  app.innerHTML = `<p class="muted">Cargando los casos…</p>`;
  config = guardado.config;
  juego = { ...guardado.juego, historial: Array.isArray(guardado.juego.historial) ? guardado.juego.historial : [] };
  await cargarTemas(config.temas);
  armarCatalogo(config.temas, config.sinVerificar);
  if (juego.abierta && !catalogo.has(juego.abierta)) Object.assign(juego, { abierta: null, fase: "tablero" });
  mostrar();
}

function iniciar() {
  const guardado = leerGuardado();
  if (!guardado) return pantallaArmado();
  const jugadas = Object.keys(guardado.juego.usadas || {}).length;
  const total = guardado.config.columnas.reduce((n, col) => n + col.casos.filter(Boolean).length, 0) + (guardado.config.final ? 1 : 0);
  app.innerHTML = `<section class="panel stack angosto">
    <p class="eyebrow">Tablero por equipos</p>
    <h2>Hay una partida guardada en este navegador</h2>
    <p class="muted">${esc(guardado.config.titulo)} · ${jugadas} de ${total} casillas jugadas · ${esc(guardado.config.equipos.join(", "))}</p>
    <div class="row"><button class="primary lg" id="seguir">Seguir la partida</button><button class="lg" id="otra">Armar otra</button></div>
    <p class="src">«Armar otra» borra esta partida.</p>
  </section>`;
  $("#seguir").onclick = () => seguir(guardado);
  $("#otra").onclick = () => {
    borrarGuardado();
    pantallaArmado();
  };
}

iniciar();
