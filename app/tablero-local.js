// RadQuiz — tablero por equipos en el proyector, al estilo Jeopardy, sin celulares ni sala en vivo.
//
// El presentador arma el tablero con casos publicados; los equipos eligen casilla y responden en voz alta, y él
// marca quién acertó: la app suma o resta, pasa el turno y proyecta la enseñanza del caso (app/diapositivas.js).
// La partida (nombres de los equipos y puntajes) se guarda solo en este navegador, para aguantar una recarga.
// De Firebase solo lee lo publicado (app/publicado.js), así que funciona aunque la sala en vivo no conecte.
import { $, esc, md, credito, barajar, NIVELES, nivelDe, SEGMENTOS, origenPublico } from "./comun.js";
import { firebaseConfig } from "./firebase-config.js";
import { AREAS } from "./areas.js";
import { reportar } from "./reportar.js";
import { activarAmpliacion } from "./ampliar.js";
import { cargarIndice as leerIndice, cargarTemas as leerTemas, armarCatalogo as catalogoDe } from "./catalogo.js";
import {
  MAX_COLUMNAS, MAX_COMPARAR, valores, respuestaDe, normal, figurasDe, proponerGrupos,
  armarColumnas, enTablero, sortearDobles, proponerFinal, proponerSimilares, reservasDe, maxApuestaDoble,
  maxApuestaFinal, minutos,
} from "./tablero.js";
import { diapositivas } from "./diapositivas.js";
import { indicesDeCasos } from "./publicado.js";
import {
  deBorrador, temasDe, normalizar, codificar, decodificar, lineaCandidato, instruccionesIA, leerRespuesta,
} from "./plantilla-tablero.js";
import {
  criterioDe, hayCriterio, nombreCriterio, nombreArea, coincide, resumenCaso, indicePorRuta, temasPara,
} from "./cuestionario.js";

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
  if (!indice.length) indice = await leerIndice();
}

const cargarTemas = (rutas) => leerTemas(rutas, datosDe);
// Con un criterio (segmento, área o búsqueda: app/cuestionario.js), solo entran los casos que lo cumplen.
function armarCatalogo(rutas, sinVerificar, criterio = null) {
  catalogo = catalogoDe(rutas, datosDe, sinVerificar);
  if (!hayCriterio(criterio)) return;
  for (const [clave, e] of catalogo) {
    const paquete = datosDe.get(e.ruta).paquete;
    if (!coincide(resumenCaso(e.caso, paquete.segmento), criterio, paquete.titulo)) catalogo.delete(clave);
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
const tituloDe = (rutas, criterio) => (hayCriterio(criterio) ? nombreCriterio(criterio)
  : rutas.length === 1 ? datosDe.get(rutas[0])?.paquete.titulo || "Tablero" : `${rutas.length} temas`);
const SIN_CRITERIO = { segmento: "", area: "", q: "" };

// ------------------------------------------------------------------ armado, paso 1: temas, tamaño y equipos
const PREDETERMINADO = {
  temas: [], sinVerificar: false, columnas: 4, filas: 4, equipos: ["Equipo 1", "Equipo 2", "Equipo 3"],
  doble: true, conFinal: true, restar: true, diapositivas: true, alternativas: "pedido", criterio: SIN_CRITERIO,
};

async function pantallaArmado(previo = null) {
  app.classList.remove("con-editor");
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
  // Desde la portada llega un cuestionario armado (?segmento=…&area=…&q=…): se marcan los temas que tienen
  // casos que lo cumplen, según el índice de casos.
  const pedido = criterioDe(new URLSearchParams(location.search));
  if (!previo && hayCriterio(pedido)) {
    b.criterio = pedido;
    const indices = await indicesDeCasos();
    b.temas = temasPara(indice, indicePorRuta(indice, indices.vivo, indices.estatico), pedido);
  }
  if (!b.temas.length) b.temas = [(indice.find((p) => p.casos.verificado) || indice[0]).ruta];
  const c = b.criterio || SIN_CRITERIO;
  const numeros = (desde, hasta, elegido, texto = (n) => n) => Array.from({ length: hasta - desde + 1 }, (_, i) => desde + i)
    .map((n) => `<option value="${n}" ${n === elegido ? "selected" : ""}>${texto(n)}</option>`).join("");
  app.innerHTML = `<section class="panel stack angosto tb-lista-guardados" id="guardados" hidden></section>
  <form class="panel stack angosto" id="armado" novalidate>
    <p class="eyebrow">Presentador</p>
    <h2>Armar un tablero</h2>
    <p class="muted">Un juego por categorías, al estilo Jeopardy, para proyectar en clase. Los equipos responden en voz
      alta y tú marcas quién acertó: la app lleva la cuenta. No hacen falta celulares.</p>
    <div class="grid-label" role="group" aria-labelledby="titulo-temas"><span id="titulo-temas">Temas</span>
      <div class="casillas">${indice.map((p) => `<label class="row tb-opcion"><input type="checkbox" name="tema" value="${esc(p.ruta)}"
        ${b.temas.includes(p.ruta) ? "checked" : ""}> <span>${esc(p.titulo)}
        <span class="src">· ${p.casos.verificado || 0} verificados de ${p.casos.publicado}</span></span></label>`).join("")}</div>
    </div>
    <div class="grid-label" role="group" aria-labelledby="titulo-filtro"><span id="titulo-filtro">Solo casos de <span class="src">(opcional)</span></span>
      <div class="campos">
        <label class="grid-label">Segmento <select id="f-segmento"><option value="">Cualquiera</option>${Object.entries(SEGMENTOS).map(([v, t]) =>
          `<option value="${v}" ${v === c.segmento ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
        <label class="grid-label">Área <select id="f-area"></select></label>
        <label class="grid-label">Buscar <input type="search" id="f-q" maxlength="80" value="${esc(c.q)}" placeholder="Diagnóstico o signo"
          autocomplete="off" spellcheck="false"></label>
      </div>
      <p class="src">Con un filtro, cada tema marcado aporta solo los casos que lo cumplen.</p>
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
    <div class="row"><button class="primary lg" type="submit">Armar el tablero</button>
      <button type="button" class="lg" id="con-ia" title="Describe el tablero y lo arma la IA que uses">Armar con IA</button>
      <a class="boton lg" href="./">Cancelar</a></div>
  </form>`;
  pintarGuardados();

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
  const pintarAreas = (previa) => {
    const segmento = $("#f-segmento").value;
    const areas = Object.keys(AREAS[segmento] || {});
    $("#f-area").innerHTML = `<option value="">Todas</option>${areas.map((a) =>
      `<option value="${a}" ${a === previa ? "selected" : ""}>${esc(nombreArea(segmento, a))}</option>`).join("")}`;
    $("#f-area").disabled = !areas.length;
  };
  pintarAreas(c.area);
  $("#f-segmento").onchange = () => pintarAreas("");
  $("#f-q").onkeydown = (e) => { if (e.key === "Enter") e.preventDefault(); };
  pintarNombres(b.equipos);
  duracion();
  $("#n-equipos").onchange = () => pintarNombres(nombres());
  ["#columnas", "#filas", "#con-final", "#diapositivas"].forEach((sel) => { $(sel).onchange = duracion; });
  const leer = () => ({
      ...b,
      temas: [...app.querySelectorAll('input[name="tema"]:checked')].map((input) => input.value),
      criterio: {
        segmento: $("#f-segmento").value, area: $("#f-segmento").value ? $("#f-area").value : "",
        q: $("#f-q").value.trim().replace(/\s+/g, " ").slice(0, 80),
      },
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
  $("#armado").onsubmit = (e) => {
    e.preventDefault();
    const elegido = leer();
    if (!elegido.temas.length) return aviso("Elige al menos un tema.");
    armar({ ...elegido, nombre: "", idLocal: null, idGrupo: null });
  };
  $("#con-ia").onclick = () => {
    const elegido = leer();
    if (!elegido.temas.length) return aviso("Elige al menos un tema.");
    pantallaIA({ ...elegido, nombre: "", idLocal: null, idGrupo: null });
  };
}

async function armar(b) {
  app.innerHTML = `<p class="muted">Cargando los casos…</p>`;
  await cargarTemas(b.temas);
  const rutas = b.temas.filter((ruta) => datosDe.has(ruta));
  armarCatalogo(rutas, b.sinVerificar, b.criterio);
  const volver = `<div class="row"><button id="volver">Volver</button></div>`;
  if (!rutas.length || !catalogo.size) {
    app.innerHTML = !rutas.length
      ? panel("No se pudieron cargar los temas", "Revisa la conexión y vuelve a intentarlo.", volver)
      : panel("Ningún caso cumple el filtro", hayCriterio(b.criterio)
        ? `Ningún caso verificado de los temas elegidos es de «${esc(nombreCriterio(b.criterio))}». Marca otros temas, cambia el filtro o incluye los casos sin verificar.`
        : "Los temas elegidos no tienen casos verificados. Vuelve y marca «Incluir casos sin verificar».", volver);
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
  if (!figurasDe(e).length) return `<span class="src">El caso no tiene figura: no hay con qué compararlo.</span>`;
  const elegidas = borrador.comparar[clave] || [];
  const mostrar = [...new Set([...(borrador.propuestas[clave] || []).slice(0, 4).map((p) => p.clave), ...elegidas])];
  if (!mostrar.length) return `<span class="src">Ningún caso parecido fuera del tablero para comparar.</span>`;
  return `<div class="tb-comparar">${mostrar.map((k) => {
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

// La revisión es el tablero tal como se proyectará, pero con lo que el presentador necesita: cada casilla dice de
// qué trata y su nivel. Se toca una casilla y se abre un panel a la derecha (desde abajo, en una pantalla angosta)
// con su caso y todo lo que se puede hacer con ella; se cierra con su ✕, con Esc o tocando otra vez la casilla. Sin
// casilla elegida no hay panel y el tablero ocupa todo el ancho. Una casilla se arrastra sobre otra para
// intercambiarlas.
let seleccion = null;   // { c, r } una casilla · { final: true } la ronda final · null nada

const claveSeleccionada = () => (!seleccion ? null : seleccion.final ? borrador.final : borrador.tablero[seleccion.c]?.casos[seleccion.r] || null);

function casillaRevision(clave, c, r) {
  const valor = (r + 1) * 100;
  const activa = seleccion && !seleccion.final && seleccion.c === c && seleccion.r === r;
  if (!clave) {
    return `<button type="button" class="tb-casilla vacia ${activa ? "activa" : ""}" data-c="${c}" data-r="${r}">
      <span class="tb-valor">${valor}</span><span class="tb-sub">+ Elegir un caso</span></button>`;
  }
  const e = catalogo.get(clave);
  const doble = borrador.dobles.includes(clave);
  const n = nivelDe(e.caso);
  return `<button type="button" class="tb-casilla ${doble ? "doble" : ""} ${activa ? "activa" : ""}" data-c="${c}" data-r="${r}" draggable="true"
    title="${esc(e.caso.tema || "")}">
    <span class="tb-valor">${valor}</span>${doble ? `<span class="tb-x2" title="Casilla doble">×2</span>` : ""}
    <span class="tb-sub">${esc(respuestaDe(e.caso))}</span>${e.caso.tema ? `<span class="tb-tema">${esc(e.caso.tema)}</span>` : ""}
    <span class="tb-punto n${n}" title="Nivel ${n}">${n}</span></button>`;
}

// Los casos que pueden ir en la casilla elegida: los que no están en el tablero, primero los del grupo de la
// columna, y filtrados por lo que se escriba.
function opcionesDeCaso(filtro = "") {
  const b = borrador;
  const ocupados = enTablero(b.tablero, b.final);
  const grupo = seleccion && !seleccion.final ? b.grupos.find((g) => g.id === b.tablero[seleccion.c]?.grupo) : null;
  const delGrupo = new Set(grupo?.claves || []);
  const buscadas = normal(filtro).split(" ").filter(Boolean);
  const lista = [...catalogo.values()]
    .filter((e) => !ocupados.has(e.clave))
    .filter((e) => !buscadas.length || buscadas.every((p) => normal(`${e.caso.tema} ${respuestaDe(e.caso)} ${(e.caso.etiquetas || []).join(" ")} ${datosDe.get(e.ruta)?.paquete.titulo}`).includes(p)))
    .sort((x, y) => Number(delGrupo.has(y.clave)) - Number(delGrupo.has(x.clave)) || nivelDe(x.caso) - nivelDe(y.caso));
  if (!lista.length) return `<p class="src">Ningún caso libre coincide.</p>`;
  return lista.slice(0, 40).map((e) => `<button type="button" class="tb-candidato" data-elegir="${esc(e.clave)}">
    <b>${esc(e.caso.tema || respuestaDe(e.caso))}</b>
    <span class="src">${esc(respuestaDe(e.caso))} · nivel ${nivelDe(e.caso)}${e.caso.revisor ? "" : " · sin verificar"}${delGrupo.has(e.clave) ? "" : ` · ${esc(datosDe.get(e.ruta)?.paquete.titulo || "")}`}</span></button>`).join("")
    + (lista.length > 40 ? `<p class="src">Y ${lista.length - 40} más: escribe para afinar.</p>` : "");
}

function miniatura(clave) {
  const e = catalogo.get(clave);
  const datos = datosDeClave(clave);
  const ref = (e?.caso.imagenes.find((r) => r.mostrar_en === "pregunta") || e?.caso.imagenes[0])?.ref;
  const src = ref && datos ? datos.imagen(ref) : "";
  return src ? `<img class="tb-mini-figura" src="${esc(src)}" alt="" data-zoom>` : "";
}

function editorHTML() {
  return `<button type="button" class="tb-cerrar" id="cerrar-editor" aria-label="Cerrar el panel" title="Cerrar (Esc)">✕</button>${contenidoEditor()}`;
}

function cerrarEditor() {
  seleccion = null;
  pantallaRevision();
}

function contenidoEditor() {
  const b = borrador;
  const clave = claveSeleccionada();
  const e = clave && catalogo.get(clave);
  const cambiar = `<details class="tb-cambiar" ${clave ? "" : "open"}><summary>${clave ? "Cambiar por otro caso" : "Elegir un caso"}</summary>
    <input type="search" id="buscar-caso" placeholder="Busca por tema o respuesta" autocomplete="off" spellcheck="false">
    <div class="tb-candidatos" id="candidatos">${opcionesDeCaso()}</div></details>`;
  const caso = e ? `<h3>${esc(e.caso.tema || "Caso")}</h3>
    ${miniatura(clave)}
    <p><span class="src">Respuesta</span><br><b>${esc(respuestaDe(e.caso))}</b></p>
    <div class="row">${chipNivel(e.caso)}${e.caso.revisor ? "" : `<span class="chip">Sin verificar</span>`}
      ${modoAlternativas(b) === "nunca" && e.caso.requiere_opciones ? `<span class="src">Necesita las opciones: saldrán a la vista.</span>` : ""}</div>
    <p class="src">${esc(datosDe.get(e.ruta)?.paquete.titulo || "")}</p>` : "";
  if (seleccion.final) {
    return `<p class="eyebrow">Ronda final</p>
      ${b.final ? `${caso}
        <label class="grid-label">Categoría que se anuncia <input type="text" id="final-nombre" maxlength="60" value="${esc(b.finalNombre)}"></label>
        ${cambiar}
        <details><summary>Casos para comparar</summary>${comparacion(b.final)}</details>
        <button type="button" class="peligrosa" id="quitar-final">Sin ronda final</button>`
      : `<p class="muted">Elige el caso de la final: uno que no esté en el tablero, de los difíciles.</p>${cambiar}`}`;
  }
  const col = b.tablero[seleccion.c];
  const filas = col.casos.length;
  return `<p class="eyebrow">${esc(col.nombre)} · ${(seleccion.r + 1) * 100}</p>
    ${clave ? `${caso}
      <div class="row tb-acciones">
        <button type="button" data-mover="-1" ${seleccion.r === 0 ? "disabled" : ""}>↑ Menos puntos</button>
        <button type="button" data-mover="1" ${seleccion.r === filas - 1 ? "disabled" : ""}>↓ Más puntos</button>
      </div>
      <label class="row tb-opcion"><input type="checkbox" id="es-doble" ${b.dobles.includes(clave) ? "checked" : ""}>
        <span>Casilla doble <span class="src">· el equipo apuesta antes de ver la pista</span></span></label>
      ${cambiar}
      <details><summary>Casos para comparar</summary>${comparacion(clave)}</details>
      <button type="button" class="peligrosa" id="vaciar">Dejar la casilla vacía</button>`
    : `<p class="muted">Casilla vacía.</p>${cambiar}`}`;
}

function pantallaRevision() {
  const b = borrador;
  marcarPanel(Boolean(seleccion));
  const casillas = b.tablero.reduce((n, col) => n + col.casos.filter(Boolean).length, 0);
  const usados = new Set(b.tablero.map((col) => col.grupo).filter(Boolean));
  const libres = b.grupos.filter((g) => !usados.has(g.id));
  const filas = b.filas;
  const celdas = Array.from({ length: filas }, (_, r) => b.tablero.map((col, c) => casillaRevision(col.casos[r], c, r)).join("")).join("");
  const notas = b.notas?.length ? `<div class="caja"><b>Revisa:</b><ul>${b.notas.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>` : "";
  b.notas = [];
  app.innerHTML = `
    <section class="panel tb-armar-cabeza">
      <div class="crece">
        <h2>${esc(b.nombre || "Revisar el tablero")}</h2>
        <p class="src">${plural(casillas, "casilla", "casillas")}${b.final ? " y la ronda final" : ""} · unos ${minutos(casillas, Boolean(b.final), b.diapositivas)} minutos ·
          <span class="nota">no lo proyectes todavía: aquí se ven las respuestas</span></p>
      </div>
      <div class="row">
        <button type="button" id="volver">Volver</button>
        <button type="button" id="sortear" title="Vuelve a elegir los casos de las mismas columnas">Otro sorteo</button>
        <button type="button" id="guardar-tablero">Guardar</button>
        <button type="button" class="primary lg" id="empezar">Empezar la partida</button>
      </div>
    </section>
    ${notas}
    <div class="tb-edicion">
      <div class="stack">
        ${b.tablero.length ? `<div class="tb-previo" style="--cols:${b.tablero.length}">
          ${b.tablero.map((col, c) => `<div class="tb-cab-edit">
            <input type="text" value="${esc(col.nombre)}" data-nombre-col="${c}" maxlength="60" aria-label="Nombre de la columna ${c + 1}">
            <button type="button" class="tb-quitar" data-quitar-col="${c}" title="Quitar esta columna" aria-label="Quitar la columna ${esc(col.nombre)}">✕</button>
          </div>`).join("")}
          ${celdas}
        </div>` : `<p class="nota">El tablero no tiene columnas: agrega una.</p>`}
        <div class="row tb-bajo">
          ${b.tablero.length < MAX_COLUMNAS ? `<label class="row">Agregar columna <select id="agregar-col">
            <option value="">Elige un grupo…</option>
            ${libres.map((g) => `<option value="${esc(g.id)}">${esc(g.nombre)} (${g.claves.length})</option>`).join("")}
            <option value="+vacia">Columna vacía, para llenarla a mano</option></select></label>` : ""}
          <span class="spacer"></span>
          <button type="button" class="tb-final-boton ${seleccion?.final ? "activa" : ""}" id="ver-final">${b.final
            ? `Ronda final · <b>${esc(b.finalNombre || "sin categoría")}</b>` : "+ Ronda final"}</button>
        </div>
        <p class="src tb-ayuda">Toca una casilla para ver su caso. Arrastra una casilla sobre otra para intercambiarlas. El
          nombre de cada columna se cambia ahí mismo.</p>
        <section class="panel stack tb-partida">
          <h3>Equipos</h3>
          <div class="campos">${b.equipos.map((n, i) => `<label class="grid-label">Equipo ${i + 1}
            <input type="text" data-equipo="${i}" maxlength="24" value="${esc(n)}"></label>`).join("")}</div>
          <div class="row">
            ${b.equipos.length < MAX_EQUIPOS ? `<button type="button" id="mas-equipo">+ Equipo</button>` : ""}
            ${b.equipos.length > 2 ? `<button type="button" id="menos-equipo">− Equipo</button>` : ""}
            <span class="spacer"></span>
            <label class="row">Empieza eligiendo <select id="empieza">${b.equipos.map((n, i) =>
              `<option value="${i}" ${i === b.empieza ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></label>
          </div>
        </section>
      </div>
      ${seleccion ? `<aside class="panel stack tb-editor" id="editor" aria-label="Casilla elegida">${editorHTML()}</aside>` : ""}
    </div>`;
  enlazarRevision();
}

// Con el panel abierto, la página le deja sitio (a la derecha, o abajo en una pantalla angosta). Cualquier otra
// pantalla lo quita al dibujarse.
const marcarPanel = (abierto) => app.classList.toggle("con-editor", abierto);

function enlazarRevision() {
  const b = borrador;
  const redibujar = ({ derivados = false } = {}) => {
    if (derivados) rehacerDerivados();
    pantallaRevision();
  };
  app.querySelectorAll(".tb-casilla").forEach((boton) => {
    const c = Number(boton.dataset.c);
    const r = Number(boton.dataset.r);
    // Tocar otra vez la casilla elegida cierra el panel.
    boton.onclick = () => {
      seleccion = seleccion && !seleccion.final && seleccion.c === c && seleccion.r === r ? null : { c, r };
      redibujar();
    };
    boton.ondragstart = (e) => { e.dataTransfer.setData("text/plain", `${c}:${r}`); e.dataTransfer.effectAllowed = "move"; };
    boton.ondragover = (e) => { e.preventDefault(); boton.classList.add("encima"); };
    boton.ondragleave = () => boton.classList.remove("encima");
    boton.ondrop = (e) => {
      e.preventDefault();
      const [c0, r0] = e.dataTransfer.getData("text/plain").split(":").map(Number);
      if (!Number.isInteger(c0) || (c0 === c && r0 === r)) return;
      const a = b.tablero[c0].casos[r0];
      b.tablero[c0].casos[r0] = b.tablero[c].casos[r];
      b.tablero[c].casos[r] = a;
      seleccion = { c, r };
      redibujar();
    };
  });
  app.querySelectorAll("[data-nombre-col]").forEach((input) => {
    input.onchange = () => {
      const col = b.tablero[Number(input.dataset.nombreCol)];
      col.nombre = input.value.trim().replace(/\s+/g, " ") || col.nombre;
      const g = b.grupos.find((x) => x.id === col.grupo);
      if (g) g.nombre = col.nombre;
      redibujar();
    };
  });
  app.querySelectorAll("[data-quitar-col]").forEach((boton) => {
    boton.onclick = () => {
      const c = Number(boton.dataset.quitarCol);
      const g = b.grupos.find((x) => x.id === b.tablero[c].grupo);
      if (g) g.usar = false;
      b.tablero.splice(c, 1);
      seleccion = null;
      redibujar({ derivados: true });
    };
  });
  const agregar = $("#agregar-col");
  if (agregar) agregar.onchange = () => {
    if (!agregar.value) return;
    if (agregar.value === "+vacia") {
      b.tablero.push({ grupo: null, nombre: `Columna ${b.tablero.length + 1}`, casos: Array(b.filas).fill(null) });
    } else {
      const g = b.grupos.find((x) => x.id === agregar.value);
      g.usar = true;
      const ocupados = enTablero(b.tablero, b.final);
      b.tablero.push(...armarColumnas([{ ...g, claves: g.claves.filter((k) => !ocupados.has(k)) }], b.filas, [], nivelClave, evitarDe(b)));
    }
    seleccion = { c: b.tablero.length - 1, r: 0 };
    redibujar({ derivados: true });
  };
  $("#ver-final").onclick = () => { seleccion = seleccion?.final ? null : { final: true }; redibujar(); };
  if ($("#cerrar-editor")) $("#cerrar-editor").onclick = cerrarEditor;
  app.querySelectorAll("[data-equipo]").forEach((input) => {
    input.onchange = () => { b.equipos[Number(input.dataset.equipo)] = input.value.trim().replace(/\s+/g, " ") || `Equipo ${Number(input.dataset.equipo) + 1}`; redibujar(); };
  });
  if ($("#mas-equipo")) $("#mas-equipo").onclick = () => { b.equipos.push(`Equipo ${b.equipos.length + 1}`); redibujar(); };
  if ($("#menos-equipo")) $("#menos-equipo").onclick = () => { b.equipos.pop(); b.empieza = Math.min(b.empieza, b.equipos.length - 1); redibujar(); };
  $("#empieza").onchange = () => { b.empieza = Number($("#empieza").value); };
  $("#volver").onclick = () => pantallaArmado(b);
  $("#sortear").onclick = () => {
    if (!b.grupos.some((g) => g.usar)) return aviso("Este tablero no salió de un sorteo: cambia las casillas a mano.");
    if (!confirm("¿Volver a sortear? Se eligen otros casos para las columnas que vienen de un grupo.")) return;
    const manuales = b.tablero.filter((col) => !col.grupo);
    rehacerColumnas({ sortear: true });
    b.tablero.push(...manuales);
    rehacerDerivados({ sortear: true });
    seleccion = null;
    pantallaRevision();
  };
  $("#guardar-tablero").onclick = dialogoGuardar;
  $("#empezar").onclick = empezarPartida;
  enlazarEditor(redibujar);
}

function enlazarEditor(redibujar) {
  const b = borrador;
  const clave = claveSeleccionada();
  const buscar = $("#buscar-caso");
  if (buscar) buscar.oninput = () => { $("#candidatos").innerHTML = opcionesDeCaso(buscar.value); enlazarCandidatos(redibujar); };
  enlazarCandidatos(redibujar);
  app.querySelectorAll("[data-mover]").forEach((boton) => {
    boton.onclick = () => {
      const paso = Number(boton.dataset.mover);
      const casos = b.tablero[seleccion.c].casos;
      [casos[seleccion.r], casos[seleccion.r + paso]] = [casos[seleccion.r + paso], casos[seleccion.r]];
      seleccion = { c: seleccion.c, r: seleccion.r + paso };
      redibujar();
    };
  });
  const doble = $("#es-doble");
  if (doble) doble.onchange = () => {
    if (doble.checked && b.dobles.length >= MAX_DOBLES) {
      doble.checked = false;
      return aviso(`Caben hasta ${MAX_DOBLES} casillas dobles.`);
    }
    b.dobles = doble.checked ? [...b.dobles, clave] : b.dobles.filter((k) => k !== clave);
    b.doble = b.dobles.length > 0;
    redibujar();
  };
  if ($("#vaciar")) $("#vaciar").onclick = () => {
    b.tablero[seleccion.c].casos[seleccion.r] = null;
    b.dobles = b.dobles.filter((k) => k !== clave);
    redibujar({ derivados: true });
  };
  if ($("#quitar-final")) $("#quitar-final").onclick = () => {
    b.final = null;
    b.conFinal = false;
    b.finalNombre = "";
    redibujar({ derivados: true });
  };
  if ($("#final-nombre")) $("#final-nombre").onchange = () => { b.finalNombre = $("#final-nombre").value.trim() || b.finalNombre; redibujar(); };
  app.querySelectorAll("[data-comparar]").forEach((input) => {
    input.onchange = () => {
      const k = input.dataset.comparar;
      const elegidas = b.comparar[k] || [];
      if (input.checked && elegidas.length >= MAX_COMPARAR) {
        input.checked = false;
        return aviso(`Caben hasta ${MAX_COMPARAR} casos para comparar por casilla.`);
      }
      b.comparar[k] = input.checked ? [...elegidas, input.value] : elegidas.filter((x) => x !== input.value);
      b.tocado[k] = true;
    };
  });
}

function enlazarCandidatos(redibujar) {
  const b = borrador;
  app.querySelectorAll("[data-elegir]").forEach((boton) => {
    boton.onclick = () => {
      const nueva = boton.dataset.elegir;
      if (seleccion.final) {
        b.final = nueva;
        b.conFinal = true;
        if (!b.finalNombre) b.finalNombre = catalogo.get(nueva).grupo || "Ronda final";
      } else {
        const anterior = b.tablero[seleccion.c].casos[seleccion.r];
        b.tablero[seleccion.c].casos[seleccion.r] = nueva;
        b.dobles = b.dobles.map((k) => (k === anterior ? nueva : k));   // la casilla doble sigue en su lugar
      }
      redibujar({ derivados: true });
    };
  });
}

// ------------------------------------------------------------------ tableros guardados
// En este navegador (localStorage) y, para el grupo, en la base («tableros/», lectura pública; escriben quienes
// tienen papel en el estudio, desde aquí con su sesión de Google o desde el servidor MCP). Un tablero viaja
// también entero en un enlace (#t=…), para armarlo en una computadora y jugarlo en otra.
const GUARDADOS = "radquiz.tableros.v1";

function leerGuardados() {
  try {
    const lista = JSON.parse(localStorage.getItem(GUARDADOS) || "[]");
    return Array.isArray(lista) ? lista.filter((t) => t && t.id && t.plantilla) : [];
  } catch {
    return [];
  }
}

function escribirGuardados(lista) {
  try {
    localStorage.setItem(GUARDADOS, JSON.stringify(lista));
    return true;
  } catch {
    return false;
  }
}

async function tablerosDelGrupo() {
  try {
    const r = await fetch(`${firebaseConfig.databaseURL}/tableros.json`, { cache: "no-store" });
    const datos = r.ok ? await r.json() : null;
    return Object.entries(datos || {}).map(([id, t]) => {
      try {
        return { id, nombre: t.nombre, autor: t.autor_nombre, autor_uid: t.autor_uid, t: t.fecha, plantilla: JSON.parse(t.plantilla_json) };
      } catch {
        return null;
      }
    }).filter(Boolean).sort((a, b) => (b.t || 0) - (a.t || 0));
  } catch {
    return [];
  }
}

const idNuevo = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const resumenPlantilla = (p) => {
  const casillas = (p.columnas || []).reduce((n, col) => n + (col.casos || []).filter(Boolean).length, 0);
  return `${plural(casillas, "casilla", "casillas")}${p.final ? " y final" : ""} · ${plural((p.columnas || []).length, "columna", "columnas")}`;
};

async function enlaceDe(plantilla) {
  return `${origenPublico()}/tablero.html#t=${await codificar(plantilla)}`;
}

async function copiar(textoACopiar, mensaje) {
  try {
    await navigator.clipboard.writeText(textoACopiar);
    aviso(mensaje);
  } catch {
    prompt("Copia el enlace:", textoACopiar);
  }
}

// La sesión de Google del estudio, si este navegador la tiene: con ella se guarda (y se borra) para el grupo.
// El SDK de Firebase se carga solo aquí: el tablero funciona sin él.
let sesionGrupo = null;
async function sesionDeGoogle() {
  if (sesionGrupo) return sesionGrupo;
  const [{ initializeApp, getApps }, { getAuth, onAuthStateChanged }, { getDatabase, ref, get, set, remove, serverTimestamp }] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js"),
  ]);
  const appFb = getApps().find((a) => a.name === "[DEFAULT]") || initializeApp(firebaseConfig);
  const auth = getAuth(appFb);
  const usuario = await new Promise((ok) => { const fin = onAuthStateChanged(auth, (u) => { fin(); ok(u); }); });
  if (!usuario || usuario.isAnonymous) return null;
  const db = getDatabase(appFb);
  const perfil = (await get(ref(db, `usuarios/${usuario.uid}`)).catch(() => null))?.val();
  if (!perfil?.rol) return null;
  sesionGrupo = { uid: usuario.uid, perfil, db, ref, set, remove, serverTimestamp };
  return sesionGrupo;
}

function dialogoGuardar() {
  const b = borrador;
  const dialogo = $("#dialogo");
  const nombre = b.nombre || tituloDe(b.temas, b.criterio);
  dialogo.innerHTML = `<form class="panel dialogo stack" id="form-guardar" novalidate>
    <h2>Guardar el tablero</h2>
    <label class="grid-label">Nombre <input type="text" id="nombre-tablero" maxlength="80" value="${esc(nombre)}" required></label>
    <p class="src">Guárdalo en este navegador, para el grupo (lo ven todos en la lista de tableros, desde cualquier
      computadora; hace falta haber entrado al estudio con tu cuenta en este navegador) o copia un enlace que lo lleva
      entero.</p>
    <div class="row">
      <button type="submit" class="primary" id="en-navegador">En este navegador</button>
      <button type="button" id="para-grupo">Para el grupo</button>
      <button type="button" id="copiar-enlace">Copiar enlace</button>
      <span class="spacer"></span><button type="button" id="cancelar-guardar">Cancelar</button>
    </div>
  </form>`;
  dialogo.hidden = false;
  $("#nombre-tablero").select();
  const plantilla = () => {
    b.nombre = $("#nombre-tablero").value.trim().replace(/\s+/g, " ") || nombre;
    return deBorrador(b, b.nombre);
  };
  $("#form-guardar").onsubmit = (e) => {
    e.preventDefault();
    const p = plantilla();
    const lista = leerGuardados().filter((t) => t.id !== b.idLocal);
    b.idLocal = b.idLocal || idNuevo();
    lista.unshift({ id: b.idLocal, nombre: p.nombre, t: Date.now(), plantilla: p });
    cerrarDialogo();
    aviso(escribirGuardados(lista) ? `Guardado en este navegador: «${p.nombre}».` : "Este navegador no deja guardar (ventana privada o datos bloqueados): copia el enlace.");
    pantallaRevision();
  };
  $("#para-grupo").onclick = async () => {
    const p = plantilla();
    const boton = $("#para-grupo");
    boton.disabled = true;
    boton.textContent = "Guardando…";
    try {
      const s = await sesionDeGoogle();
      if (!s) throw new Error("Entra al estudio con tu cuenta en este navegador y vuelve a intentarlo (o guárdalo aquí y copia el enlace).");
      const escribir = (id) => s.set(s.ref(s.db, `tableros/${id}`), {
        nombre: p.nombre, autor_uid: s.uid, autor_nombre: s.perfil.nombre || "", fecha: s.serverTimestamp(),
        plantilla_json: JSON.stringify(p),
      });
      // Si vino de un tablero del grupo, se guarda encima; si ese tablero es de otra persona, queda uno nuevo.
      try {
        b.idGrupo = b.idGrupo || idNuevo();
        await escribir(b.idGrupo);
      } catch (err) {
        if (!/permission/i.test(err.message || err.code || "")) throw err;
        b.idGrupo = idNuevo();
        await escribir(b.idGrupo);
      }
      cerrarDialogo();
      aviso(`Guardado para el grupo: «${p.nombre}».`);
      pantallaRevision();
    } catch (err) {
      boton.disabled = false;
      boton.textContent = "Para el grupo";
      aviso(err.message || "No se pudo guardar para el grupo.");
    }
  };
  $("#copiar-enlace").onclick = async () => copiar(await enlaceDe(plantilla()), "Enlace copiado: ábrelo en la computadora que proyecta.");
  $("#cancelar-guardar").onclick = cerrarDialogo;
}

function filaGuardado(t, tipo) {
  return `<li class="tb-guardado">
    <div class="crece"><b>${esc(t.nombre)}</b>
      <span class="src">${esc(resumenPlantilla(t.plantilla))}${t.autor ? ` · ${esc(t.autor)}` : ""}${t.t ? ` · ${new Date(t.t).toLocaleDateString("es")}` : ""}</span></div>
    <div class="row">
      <button type="button" class="primary" data-abrir="${tipo}:${esc(t.id)}">Abrir</button>
      <button type="button" data-enlace="${tipo}:${esc(t.id)}">Copiar enlace</button>
      <button type="button" class="peligrosa" data-borrar="${tipo}:${esc(t.id)}">Borrar</button>
    </div></li>`;
}

// La lista de tableros guardados, arriba del armado. Los del grupo llegan después (vienen de la base).
async function pintarGuardados() {
  const caja = $("#guardados");
  if (!caja) return;
  const locales = leerGuardados();
  const pintar = (grupo) => {
    if (!locales.length && !grupo.length) { caja.hidden = true; return; }
    caja.hidden = false;
    caja.innerHTML = `<h2>Tableros guardados</h2>
      ${locales.length ? `<p class="eyebrow">En este navegador</p><ul class="tb-guardados">${locales.map((t) => filaGuardado(t, "local")).join("")}</ul>` : ""}
      ${grupo.length ? `<p class="eyebrow">Del grupo</p><ul class="tb-guardados">${grupo.map((t) => filaGuardado(t, "grupo")).join("")}</ul>` : ""}`;
    const buscar = (valor) => {
      const [tipo, id] = valor.split(":");
      return (tipo === "local" ? locales : grupo).find((t) => t.id === id) && { tipo, t: (tipo === "local" ? locales : grupo).find((t) => t.id === id) };
    };
    caja.querySelectorAll("[data-abrir]").forEach((boton) => {
      boton.onclick = () => {
        const { tipo, t } = buscar(boton.dataset.abrir);
        abrirPlantilla(t.plantilla, tipo === "local" ? { idLocal: t.id } : { idGrupo: t.id });
      };
    });
    caja.querySelectorAll("[data-enlace]").forEach((boton) => {
      boton.onclick = async () => copiar(await enlaceDe(buscar(boton.dataset.enlace).t.plantilla), "Enlace copiado.");
    });
    caja.querySelectorAll("[data-borrar]").forEach((boton) => {
      boton.onclick = async () => {
        const { tipo, t } = buscar(boton.dataset.borrar);
        if (!confirm(`¿Borrar «${t.nombre}»${tipo === "grupo" ? " para todo el grupo" : " de este navegador"}?`)) return;
        if (tipo === "local") {
          escribirGuardados(leerGuardados().filter((x) => x.id !== t.id));
          return pintarGuardados();
        }
        try {
          const s = await sesionDeGoogle();
          if (!s) throw new Error("Para borrar un tablero del grupo, entra al estudio con tu cuenta en este navegador.");
          await s.remove(s.ref(s.db, `tableros/${t.id}`));
          pintarGuardados();
        } catch (err) {
          aviso(/permission/i.test(err.message) ? "Solo su autor o un coordinador pueden borrarlo." : err.message);
        }
      };
    });
  };
  pintar([]);
  pintar(await tablerosDelGrupo());
}

// Abre una plantilla (guardada, de un enlace o de la IA): carga sus temas y deja el tablero en la revisión.
async function abrirPlantilla(bruta, { idLocal = null, idGrupo = null, notas = [], opciones = null } = {}) {
  app.classList.remove("con-editor");
  config = juego = null;
  cabecera();
  app.innerHTML = `<p class="muted">Cargando el tablero…</p>`;
  await cargarIndice();
  const rutas = temasDe(bruta, indice);
  await cargarTemas(rutas);
  const cargadas = rutas.filter((ruta) => datosDe.has(ruta));
  // Una plantilla nombra sus casos uno por uno: valen también los que no tienen el sello.
  armarCatalogo(cargadas, true);
  const { plantilla: p, problemas, errores } = normalizar({ ...bruta, ...(opciones || {}) }, catalogo);
  if (errores) {
    app.innerHTML = panel("Este tablero no tiene casos publicados",
      "Ninguna casilla corresponde a un caso publicado hoy: puede que sus temas se hayan retirado.",
      `<div class="row"><button id="volver">Volver</button></div>`);
    $("#volver").onclick = () => pantallaArmado();
    return;
  }
  const temas = cargadas.map((ruta) => ({
    ruta, titulo: datosDe.get(ruta).paquete.titulo, entradas: [...catalogo.values()].filter((e) => e.ruta === ruta),
  }));
  const grupos = proponerGrupos(temas, p.filas).map((g) => ({ ...g, usar: false }));
  const grupoDe = (col) => {
    const contados = new Map();
    for (const k of col.casos.filter(Boolean)) {
      const g = grupos.find((x) => x.claves.includes(k));
      if (g) contados.set(g.id, (contados.get(g.id) || 0) + 1);
    }
    const [id] = [...contados].sort((a, b) => b[1] - a[1])[0] || [];
    return id || null;
  };
  const tablero = p.columnas.map((col) => ({ grupo: grupoDe(col), nombre: col.nombre, casos: [...col.casos] }));
  tablero.forEach((col) => { const g = grupos.find((x) => x.id === col.grupo); if (g) { g.usar = true; g.nombre = col.nombre; } });
  borrador = {
    ...PREDETERMINADO, nombre: p.nombre, temas: cargadas, criterio: p.criterio || SIN_CRITERIO, sinVerificar: true,
    columnas: tablero.length, filas: p.filas, equipos: p.equipos, doble: p.dobles.length > 0, conFinal: Boolean(p.final),
    restar: p.restar, diapositivas: p.diapositivas, alternativas: p.alternativas, grupos, tablero, dobles: p.dobles,
    final: p.final, finalNombre: p.categoria_final, comparar: p.comparar, propuestas: {},
    // Lo que trae la plantilla vale tal cual: no se agregan casos para comparar que nadie eligió.
    tocado: Object.fromEntries([...enTablero(tablero, p.final)].map((k) => [k, true])),
    empieza: p.empieza, idLocal, idGrupo, notas: [...notas, ...problemas],
  };
  rehacerDerivados();
  seleccion = null;
  pantallaRevision();
}

// ------------------------------------------------------------------ armado con IA
// Funciona con cualquier IA: la página arma el texto con los casos disponibles y lee el JSON que responda.
// Desde Claude Code, el servidor MCP hace lo mismo sin copiar y pegar (tablero_casos y tablero_guardar).
async function pantallaIA(b) {
  app.classList.remove("con-editor");
  app.innerHTML = `<p class="muted">Cargando los casos…</p>`;
  await cargarTemas(b.temas);
  const rutas = b.temas.filter((ruta) => datosDe.has(ruta));
  armarCatalogo(rutas, b.sinVerificar, b.criterio);
  if (!catalogo.size) {
    app.innerHTML = panel("Ningún caso cumple el filtro", "Marca otros temas, cambia el filtro o incluye los casos sin verificar.",
      `<div class="row"><button id="volver">Volver</button></div>`);
    $("#volver").onclick = () => pantallaArmado(b);
    return;
  }
  const lineas = [...catalogo.values()].map((e) => lineaCandidato(e, ({ segmento, area }) => area ? `${SEGMENTOS[segmento]} · ${nombreArea(segmento, area)}` : SEGMENTOS[segmento] || segmento));
  app.innerHTML = `<section class="panel stack angosto">
    <p class="eyebrow">Presentador</p>
    <h2>Armar el tablero con IA</h2>
    <p class="muted">Funciona con cualquier IA (ChatGPT, Gemini, Claude…): describe el tablero, copia las instrucciones,
      pégalas en la IA y pega aquí lo que responda. Después lo revisas como cualquier tablero.</p>
    <p class="src">${plural(catalogo.size, "caso disponible", "casos disponibles")} de ${plural(rutas.length, "tema", "temas")}${
      catalogo.size > 400 ? " · son muchos: si la IA se corta, filtra por segmento o marca menos temas" : ""}.</p>
    <label class="grid-label">¿Qué tablero quieres?
      <textarea id="pedido" rows="4" maxlength="2000" placeholder="Ej.: para R2; columnas por tipo de lesión; que la final sea un signo clásico; nada de física">${esc(b.pedido || "")}</textarea></label>
    <div class="row"><button type="button" class="primary" id="copiar-ia">Copiar las instrucciones</button>
      <span class="src">${b.columnas} columnas × ${b.filas} filas, como en el paso anterior.</span></div>
    <label class="grid-label">Pega aquí la respuesta de la IA
      <textarea id="respuesta-ia" rows="8" spellcheck="false" placeholder='{ "nombre": …, "columnas": [ … ] }'></textarea></label>
    <div class="row"><button type="button" class="primary lg" id="cargar-ia">Ver el tablero</button>
      <button type="button" class="lg" id="volver">Volver</button></div>
    <p class="src">Con Claude Code y el servidor MCP de RadQuiz no hace falta copiar: pide «arma un tablero de…» y lo
      guarda para el grupo.</p>
  </section>`;
  const instrucciones = () => instruccionesIA({ pedido: $("#pedido").value, lineas, filas: b.filas, columnas: b.columnas });
  $("#pedido").oninput = () => { b.pedido = $("#pedido").value; };
  $("#copiar-ia").onclick = () => copiar(instrucciones(), "Instrucciones copiadas: pégalas en la IA.");
  $("#volver").onclick = () => pantallaArmado(b);
  $("#cargar-ia").onclick = () => {
    let bruta;
    try {
      bruta = leerRespuesta($("#respuesta-ia").value);
    } catch (err) {
      return aviso(err.message);
    }
    // Lo de la partida lo pone el presentador, no la IA.
    abrirPlantilla(bruta, {
      opciones: { equipos: b.equipos, restar: b.restar, diapositivas: b.diapositivas, alternativas: b.alternativas, criterio: b.criterio },
    });
  };
}

function empezarPartida() {
  const b = borrador;
  const columnas = b.tablero.filter((col) => col.casos.some(Boolean));
  if (!columnas.length) return aviso("Marca al menos una columna con casos.");
  // Al entrar se avisa de la partida guardada, pero un enlace o un tablero del grupo llegan aquí sin pasar por ese
  // aviso, y empezar la borraba.
  const previa = leerGuardado();
  if (previa && Object.keys(previa.juego.usadas || {}).length && previa.juego.fase !== "resultado"
    && !confirm(`Hay una partida a medias guardada en este navegador («${previa.config.titulo}»). Si empiezas esta, se borra. ¿Empezar igual?`)) return;
  const enJuego = enTablero(columnas);
  config = {
    v: 1,
    titulo: b.nombre || tituloDe(b.temas, b.criterio),
    temas: b.temas,
    ...(hayCriterio(b.criterio) ? { criterio: b.criterio } : {}),
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
  app.classList.remove("con-editor");
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
    temas: config.temas, criterio: config.criterio || SIN_CRITERIO, sinVerificar: config.sinVerificar, columnas: config.columnas.length, filas: config.filas,
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

activarAmpliacion();
$("#dialogo").onclick = (e) => { if (e.target.id === "dialogo") cerrarDialogo(); };

// ------------------------------------------------------------------ teclado
// 1–6 acertó ese equipo, Mayús + número falló, R nadie acertó, O mostrar opciones, Z deshacer. En las
// diapositivas, → o Avanzar página (lo que manda un control remoto de presentaciones), ← o Retroceder, Esc vuelve.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#dialogo").hidden) { cerrarDialogo(); return; }
  if (e.key === "Escape" && borrador && seleccion && $("#editor") && !document.querySelector(".ampliar:not([hidden])")) {
    cerrarEditor();
    return;
  }
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
  armarCatalogo(config.temas, config.sinVerificar, config.criterio);
  if (juego.abierta && !catalogo.has(juego.abierta)) Object.assign(juego, { abierta: null, fase: "tablero" });
  mostrar();
}

// Un enlace de tablero (#t=…) abre ese tablero en la revisión, listo para jugar o guardar.
async function abrirEnlace() {
  const codigo = location.hash.slice(3);
  history.replaceState(null, "", location.pathname + location.search);
  try {
    const plantilla = await decodificar(codigo);
    await abrirPlantilla(plantilla, { notas: ["Abriste un tablero desde un enlace: guárdalo si lo vas a usar otra vez."] });
  } catch {
    app.innerHTML = panel("El enlace no se puede leer", "Puede que se haya cortado al copiarlo. Pide que te lo copien otra vez.",
      `<div class="row"><button id="volver">Armar un tablero</button></div>`);
    $("#volver").onclick = () => pantallaArmado();
  }
}

function iniciar() {
  if (location.hash.startsWith("#t=")) return abrirEnlace();
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
