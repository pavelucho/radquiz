// RadQuiz — sala en vivo. Presentador y jugadores usan esta misma página.
// Firebase guarda solo el estado de la sala (fase, respuestas, puntajes); las preguntas y las imágenes
// vienen del sitio. Las reglas de seguridad están en database.rules.json.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getDatabase, ref, set, get, update, remove, onValue, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";
import { $, esc, md, cargarJSON, credito, barajar } from "./comun.js";

const LETRAS = "ABCDE";
const LETRAS_CODIGO = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DURACIONES = [20, 30, 45, 60, 90];
const UN_DIA = 24 * 60 * 60 * 1000;
const app = $("#app");
const params = new URLSearchParams(location.search);

let db, uid;
let desfase = 0;               // hora del servidor − hora local
let codigo = null;
let soyHost = false;
let info = null;
let estado = null;
let jugadores = {};
let puntajes = {};
let respuestasActual = {};     // solo el presentador: respuestas de la pregunta en curso
let paquete = null;
let fuentes = null;
let casoPorId = new Map();
let suscripciones = [];
let suscripcionRespuestas = null;
let vistaActual = "";
let reloj = null;
let revelando = false;
const miRespuesta = new Map();  // jugador: índice de pregunta → opción original elegida
const miResultado = new Map();  // jugador: índice de pregunta → { opcion, t } leído al revelar

const ahora = () => Date.now() + desfase;
const salaRef = (ruta = "") => ref(db, `salas/${codigo}${ruta ? "/" + ruta : ""}`);

// ------------------------------------------------------------------ sesión local
const CLAVE_SESION = "radquiz.sala";
function leerSesion() {
  try { return JSON.parse(localStorage.getItem(CLAVE_SESION) || "null"); } catch { return null; }
}
function guardarSesion(datos) {
  try { localStorage.setItem(CLAVE_SESION, JSON.stringify(datos)); } catch { /* sin almacenamiento: no pasa nada */ }
}
function borrarSesion() {
  try { localStorage.removeItem(CLAVE_SESION); } catch { /* idem */ }
}

// ------------------------------------------------------------------ utilidades de vista
function aviso(texto) {
  const nodo = document.createElement("div");
  nodo.className = "chip toast";
  nodo.textContent = texto;
  document.body.append(nodo);
  setTimeout(() => nodo.remove(), 4000);
}

function panel(titulo, texto, extra = "") {
  return `<section class="panel" style="display:grid;gap:10px;max-width:680px">
    <h2>${esc(titulo)}</h2><p class="muted">${esc(texto)}</p>${extra}</section>`;
}

function casoEn(indice) {
  return casoPorId.get(info.casos[indice]);
}

function ordenEn(indice) {
  const caso = casoEn(indice);
  return (info.orden && info.orden[caso.id]) || caso.opciones.map((_, i) => i);
}

function visor(caso, conRespuesta) {
  const refs = caso.imagenes.filter((r) => r.mostrar_en === "pregunta" || conRespuesta);
  if (!refs.length) return "";
  return `<div class="viewer">${refs.map((r) => {
    const imagen = paquete.imagenes[r.ref];
    if (!imagen) return "";
    const src = `temas/${info.tema}/img/${encodeURIComponent(imagen.archivo)}`;
    return `<figure><img src="${src}" alt="${esc(imagen.figura)}" data-zoom>
      <figcaption class="cap"><span>${credito(imagen, fuentes[imagen.fuente])}</span><span>Toca para ampliar</span></figcaption></figure>`;
  }).join("")}</div>`;
}

function puntos(respuesta, caso) {
  if (!respuesta || respuesta.opcion !== caso.correcta || typeof estado.inicio !== "number") return 0;
  const segundos = Math.max(0, (respuesta.t - estado.inicio) / 1000);
  return Math.round(500 + 500 * Math.max(0, 1 - segundos / info.duracion));
}

function ranking() {
  return Object.entries(jugadores)
    .map(([id, j]) => ({ id, nombre: j.nombre, pts: puntajes[id] || 0 }))
    .sort((a, b) => b.pts - a.pts || a.nombre.localeCompare(b.nombre));
}

function listaRanking(maximo) {
  const filas = ranking().slice(0, maximo);
  if (!filas.length) return `<p class="muted">Nadie respondió.</p>`;
  return `<div class="rank">${filas.map((r, i) => `<div class="rk ${r.id === uid ? "me" : ""}">
    <span class="pos">${i + 1}</span><span>${esc(r.nombre)}</span><span class="pts">${r.pts}</span></div>`).join("")}</div>`;
}

function encabezado() {
  $("#subtitulo").textContent = info ? info.titulo : "Sala en vivo";
  const rol = $("#rol");
  rol.textContent = soyHost ? `Presentador · ${codigo}` : `${(jugadores[uid] || {}).nombre || "Jugador"} · ${codigo}`;
  rol.className = "chip live";
  const n = Object.keys(jugadores).length;
  $("#conteo").hidden = false;
  $("#conteo").textContent = `${n} en la sala`;
}

// ------------------------------------------------------------------ pantallas sin sala
function pantallaInicio(codigoInicial = "", mensaje = "") {
  $("#rol").textContent = "Sin sala";
  $("#rol").className = "chip";
  $("#conteo").hidden = true;
  const sesion = leerSesion();
  app.innerHTML = `
    ${mensaje ? `<p class="nota">${esc(mensaje)}</p>` : ""}
    <section class="lobby">
      <form class="panel" id="unirse" style="display:grid;gap:12px">
        <h1>Unirme</h1>
        <label class="grid-label">Código de la sala
          <input type="text" id="codigo" maxlength="4" autocomplete="off" autocapitalize="characters" value="${esc(codigoInicial)}" placeholder="ABCD" class="input-codigo"></label>
        <label class="grid-label">Tu nombre o apodo
          <input type="text" id="nombre" maxlength="24" autocomplete="nickname" value="${esc((sesion && sesion.nombre) || "")}"></label>
        <div class="row"><button class="primary" type="submit">Entrar</button></div>
        <p class="src">Tu nombre solo se usa en esta sala y se borra cuando el presentador la cierra.</p>
      </form>
      <div class="panel" style="display:grid;gap:12px;align-content:start">
        <h2>Soy presentador</h2>
        <p class="muted">Crea una sala, proyecta esta pantalla y comparte el código.</p>
        <div class="row"><button id="crear">Crear sala</button></div>
      </div>
    </section>`;
  $("#unirse").onsubmit = (e) => { e.preventDefault(); unirse($("#codigo").value, $("#nombre").value); };
  $("#crear").onclick = pantallaCrear;
  (codigoInicial ? $("#nombre") : $("#codigo")).focus();
}

async function pantallaCrear() {
  app.innerHTML = `<p class="muted">Cargando temas…</p>`;
  let indice;
  try {
    indice = await cargarJSON("temas/indice.json");
  } catch (e) {
    app.innerHTML = panel("No encontré la lista de temas", e.message);
    return;
  }
  const disponibles = (indice.paquetes || []).map((p) => ({
    ...p,
    publicados: p.casos.publicado || 0,
    sinPublicar: (p.casos.borrador || 0) + (p.casos.revisado || 0),
  }));
  const hayBorradores = disponibles.some((p) => p.sinPublicar);
  const opciones = disponibles
    .filter((p) => p.publicados || hayBorradores)
    .map((p) => `<option value="${esc(p.ruta)}">${esc(p.titulo)} · ${p.publicados} publicados${p.sinPublicar ? ` · ${p.sinPublicar} sin publicar` : ""}</option>`)
    .join("");
  if (!opciones) {
    app.innerHTML = panel("Todavía no hay casos publicados",
      "La sala en vivo usa solo casos revisados y publicados. Cuando un revisor apruebe el primer tema, aparecerá aquí.",
      `<div class="row"><a class="boton" href="sala.html">Volver</a></div>`);
    return;
  }
  app.innerHTML = `<form class="panel" id="config" style="display:grid;gap:14px;max-width:680px">
    <h2>Crear sala</h2>
    <label class="grid-label">Tema <select id="tema">${opciones}</select></label>
    <div class="row">
      <label class="row" style="gap:6px">Nivel <select id="nivel"><option value="">Todos</option><option>R1</option><option>R2</option><option>R3</option></select></label>
      <label class="row" style="gap:6px">Tiempo por caso <select id="duracion">${DURACIONES.map((s) => `<option value="${s}" ${s === 45 ? "selected" : ""}>${s} s</option>`).join("")}</select></label>
    </div>
    <label class="row" style="gap:8px"><input type="checkbox" id="mezclar"> Mezclar el orden de los casos</label>
    ${hayBorradores ? `<label class="row" style="gap:8px"><input type="checkbox" id="borradores"> Incluir casos sin publicar (ensayo en esta computadora)</label>` : ""}
    <div class="row"><button class="primary" type="submit">Crear sala</button><a class="boton" href="sala.html">Cancelar</a></div>
  </form>`;
  $("#config").onsubmit = (e) => {
    e.preventDefault();
    crearSala({
      tema: $("#tema").value,
      nivel: $("#nivel").value,
      duracion: Number($("#duracion").value),
      mezclar: $("#mezclar").checked,
      borradores: Boolean($("#borradores") && $("#borradores").checked),
    }).catch((err) => aviso("No se pudo crear la sala: " + err.message));
  };
}

function codigoAleatorio() {
  const numeros = crypto.getRandomValues(new Uint32Array(4));
  return [...numeros].map((n) => LETRAS_CODIGO[n % LETRAS_CODIGO.length]).join("");
}

async function limpiarSalasViejas() {
  try {
    const lista = (await get(ref(db, "indice_salas"))).val() || {};
    const limite = ahora() - UN_DIA;
    for (const [viejo, creada] of Object.entries(lista)) {
      if (creada < limite) {
        await remove(ref(db, `indice_salas/${viejo}`)).catch(() => {});
        await remove(ref(db, `salas/${viejo}`)).catch(() => {});
      }
    }
  } catch { /* la limpieza es un extra: si falla, se intenta en la próxima sala */ }
}

async function crearSala({ tema, nivel, duracion, mezclar, borradores }) {
  const pkg = await cargarJSON(`temas/${tema}/paquete.json`);
  let casos = pkg.casos.filter((c) => c.estado === "publicado" || borradores);
  if (nivel) casos = casos.filter((c) => c.nivel === nivel);
  if (mezclar) casos = barajar(casos);
  if (!casos.length) {
    aviso("No hay casos con esos filtros.");
    return;
  }
  const orden = {};
  for (const c of casos) {
    const indices = c.opciones.map((_, i) => i);
    orden[c.id] = c.barajar === false ? indices : barajar(indices);
  }
  await limpiarSalasViejas();
  for (let intento = 0; intento < 8; intento++) {
    const nuevo = codigoAleatorio();
    try {
      await set(ref(db, `salas/${nuevo}`), {
        info: { host: uid, creada: serverTimestamp(), tema, titulo: pkg.titulo, duracion, casos: casos.map((c) => c.id), orden },
        estado: { fase: "lobby", indice: 0 },
      });
    } catch (e) {
      continue;  // código ocupado: probar otro
    }
    await set(ref(db, `indice_salas/${nuevo}`), serverTimestamp()).catch(() => {});
    guardarSesion({ codigo: nuevo, rol: "host" });
    history.replaceState(null, "", "sala.html");
    return entrar(nuevo, "host");
  }
  throw new Error("no encontré un código libre; intenta de nuevo");
}

async function unirse(codigoEscrito, nombreEscrito) {
  const c = codigoEscrito.trim().toUpperCase();
  const nombre = nombreEscrito.trim().replace(/\s+/g, " ");
  if (!/^[A-Z]{4}$/.test(c)) return aviso("El código tiene 4 letras.");
  if (!nombre) return aviso("Escribe tu nombre o un apodo.");
  const existe = await get(ref(db, `salas/${c}/info`)).catch(() => null);
  if (!existe || !existe.exists()) return aviso("No hay una sala con ese código.");
  try {
    await set(ref(db, `salas/${c}/jugadores/${uid}`), { nombre, unido: serverTimestamp() });
  } catch (e) {
    return aviso("No se pudo entrar a la sala: " + e.message);
  }
  guardarSesion({ codigo: c, rol: "jugador", nombre });
  entrar(c, "jugador");
}

// ------------------------------------------------------------------ dentro de la sala
async function entrar(c, rol) {
  codigo = c;
  const snap = await get(ref(db, `salas/${c}/info`)).catch(() => null);
  if (!snap || !snap.exists()) {
    borrarSesion();
    return pantallaInicio("", "Esa sala ya no existe.");
  }
  info = snap.val();
  soyHost = rol === "host" && info.host === uid;
  if (!soyHost) {
    const yo = await get(ref(db, `salas/${c}/jugadores/${uid}`)).catch(() => null);
    if (!yo || !yo.exists()) return pantallaInicio(c);
  }
  try {
    [paquete, fuentes] = await Promise.all([
      cargarJSON(`temas/${info.tema}/paquete.json`),
      cargarJSON(`temas/${info.tema}/fuentes.json`),
    ]);
  } catch (e) {
    app.innerHTML = panel("No se pudo cargar el tema", e.message);
    return;
  }
  casoPorId = new Map(paquete.casos.map((caso) => [caso.id, caso]));
  if (info.casos.some((id) => !casoPorId.has(id))) {
    app.innerHTML = panel("Faltan casos en este sitio",
      "La sala usa casos que esta versión del sitio no tiene (por ejemplo, borradores de un ensayo local).");
    return;
  }
  suscribir();
}

function suscribir() {
  suscripciones.forEach((cancelar) => cancelar());
  suscripciones = [
    onValue(salaRef("estado"), (s) => {
      const anterior = estado;
      if (!s.exists()) return confirmarCierre();
      estado = s.val();
      if (soyHost && (!anterior || anterior.indice !== estado.indice || !suscripcionRespuestas)) escucharRespuestas();
      if (!soyHost && ["revelar", "ranking", "fin"].includes(estado.fase)) leerMiResultado(estado.indice);
      render();
    }, () => confirmarCierre()),
    onValue(salaRef("jugadores"), (s) => { jugadores = s.val() || {}; render(); }),
    onValue(salaRef("puntajes"), (s) => { puntajes = s.val() || {}; render(); }),
  ];
}

function escucharRespuestas() {
  if (suscripcionRespuestas) suscripcionRespuestas();
  respuestasActual = {};
  suscripcionRespuestas = onValue(salaRef(`respuestas/${estado.indice}`), (s) => {
    respuestasActual = s.val() || {};
    render();
  });
}

async function leerMiResultado(indice) {
  if (miResultado.has(indice)) return;
  miResultado.set(indice, null);
  const snap = await get(salaRef(`respuestas/${indice}/${uid}`)).catch(() => null);
  miResultado.set(indice, snap && snap.exists() ? snap.val() : null);
  render(true);
}

// Un estado vacío puede ser momentáneo (una escritura local rechazada por el servidor): se confirma antes de salir.
async function confirmarCierre() {
  await new Promise((listo) => setTimeout(listo, 1500));
  if (!codigo) return;
  const sigue = await get(salaRef("info")).catch(() => null);
  if (!sigue || !sigue.exists()) salaCerrada();
}

function salaCerrada() {
  suscripciones.forEach((cancelar) => cancelar());
  suscripciones = [];
  if (suscripcionRespuestas) suscripcionRespuestas();
  suscripcionRespuestas = null;
  clearInterval(reloj);
  borrarSesion();
  codigo = null;
  info = null;
  estado = null;
  vistaActual = "";
  pantallaInicio("", "La sala se cerró.");
}

function render(forzar = false) {
  if (!estado || !info) return;
  encabezado();
  const clave = `${estado.fase}:${estado.indice}`;
  const cambio = clave !== vistaActual;
  vistaActual = clave;
  if (!cambio && !forzar && estado.fase === "pregunta") return actualizarPregunta();
  if (cambio) revelando = false;
  clearInterval(reloj);
  if (soyHost) vistaHost(); else vistaJugador();
}

// ------------------------------------------------------------------ presentador
function vistaHost() {
  const { fase } = estado;
  if (fase === "lobby") return hostLobby();
  if (fase === "pregunta" || fase === "revelar") return hostCaso();
  return hostRanking(fase === "fin");
}

function hostLobby() {
  const enlace = `${location.origin}${location.pathname}?c=${codigo}`;
  const nombres = Object.values(jugadores).map((j) => `<span class="pl">${esc(j.nombre)}</span>`).join("");
  app.innerHTML = `<section class="lobby">
    <div class="panel" style="display:grid;gap:12px">
      <p class="tema">Código de la sala</p>
      <div class="codigo">${esc(codigo)}</div>
      <p>Entren a <b>${esc(location.host + location.pathname)}</b> y escriban el código.</p>
      <p class="src">Enlace directo: ${esc(enlace)}</p>
      <p class="muted">${esc(info.titulo)} · ${info.casos.length} casos · ${info.duracion} s por caso</p>
      <div class="row"><button class="primary" id="empezar">Empezar</button><button id="cerrar">Cerrar sala</button></div>
    </div>
    <div class="panel" style="display:grid;gap:10px;align-content:start">
      <h2>En la sala: ${Object.keys(jugadores).length}</h2>
      <div class="players">${nombres || `<span class="muted">Esperando residentes…</span>`}</div>
      <p class="src">Sin celulares o sin red, se puede empezar igual y responder a mano alzada.</p>
    </div>
  </section>`;
  $("#empezar").onclick = () => irA(0);
  $("#cerrar").onclick = cerrarSala;
}

function irA(indice) {
  return set(salaRef("estado"), { fase: "pregunta", indice, inicio: serverTimestamp() })
    .catch((e) => aviso("No se pudo avanzar: " + e.message));
}

function conteoPorOpcion() {
  const conteo = [0, 0, 0, 0, 0];
  Object.values(respuestasActual).forEach((r) => { conteo[r.opcion] += 1; });
  return conteo;
}

function hostCaso() {
  const caso = casoEn(estado.indice);
  const orden = ordenEn(estado.indice);
  const revelado = estado.fase === "revelar";
  const conteo = conteoPorOpcion();
  const total = Object.keys(respuestasActual).length;
  const ultimo = estado.indice === info.casos.length - 1;
  const opciones = orden.map((original, pos) => `<div class="opt ${revelado ? (original === caso.correcta ? "right" : "wrong") : ""}" data-k="${pos}">
      <span class="fill" style="width:${revelado && total ? Math.round((100 * conteo[original]) / total) : 0}%"></span>
      <span class="k">${LETRAS[pos]}</span><span>${esc(caso.opciones[original])}</span><span class="n">${revelado ? conteo[original] : ""}</span></div>`).join("");
  const letra = LETRAS[orden.indexOf(caso.correcta)];
  const imagenes = visor(caso, revelado);
  app.innerHTML = `
    <div class="qhead"><span class="qnum">${estado.indice + 1}/${info.casos.length}</span><span class="tema">${esc(caso.tema)}</span></div>
    <section class="stage ${imagenes ? "" : "sin-imagen"}">
      ${imagenes}
      <div style="display:grid;gap:12px">
        <div class="stem md">${md(caso.enunciado)}</div>
        ${revelado ? "" : `<div class="row" style="justify-content:space-between"><span class="clock" id="clock">${info.duracion}</span>
          <span class="chip" id="respondieron">${total}/${Object.keys(jugadores).length} respondieron</span></div><div class="timer"><i id="bar"></i></div>`}
        <div class="opts">${opciones}</div>
        ${revelado ? `<div class="exp md"><div class="ans">Respuesta: ${letra}. ${esc(caso.opciones[caso.correcta])}</div>${md(caso.explicacion)}</div>
          ${caso.perla ? `<div class="pearl md"><b>Perla:</b> ${md(caso.perla)}</div>` : ""}` : ""}
      </div>
    </section>
    <div class="ctrl">
      ${revelado
        ? `<button id="ranking">Ver ranking</button>${ultimo ? `<button class="primary" id="fin">Terminar</button>` : `<button class="primary" id="siguiente">Siguiente caso</button>`}`
        : `<button class="primary" id="revelar">Revelar respuesta</button>`}
      <span class="spacer"></span><button id="cerrar">Cerrar sala</button>
    </div>`;
  if (!revelado) {
    $("#revelar").onclick = revelar;
    iniciarReloj();
  } else {
    $("#ranking").onclick = () => set(salaRef("estado/fase"), "ranking");
    if (ultimo) $("#fin").onclick = () => set(salaRef("estado/fase"), "fin");
    else $("#siguiente").onclick = () => irA(estado.indice + 1);
  }
  $("#cerrar").onclick = cerrarSala;
}

function actualizarPregunta() {
  if (!soyHost) return;
  const total = Object.keys(respuestasActual).length;
  const chip = $("#respondieron");
  if (chip) chip.textContent = `${total}/${Object.keys(jugadores).length} respondieron`;
  const n = Object.keys(jugadores).length;
  if (n > 0 && total >= n) revelar();
}

function iniciarReloj() {
  clearInterval(reloj);
  const tic = () => {
    if (!estado || estado.fase !== "pregunta") return clearInterval(reloj);
    const inicio = typeof estado.inicio === "number" ? estado.inicio : ahora();
    const restante = Math.max(0, info.duracion - (ahora() - inicio) / 1000);
    const clock = $("#clock");
    const bar = $("#bar");
    if (clock) clock.textContent = Math.ceil(restante);
    if (bar) bar.style.width = `${(100 * restante) / info.duracion}%`;
    if (restante <= 0) {
      clearInterval(reloj);
      if (soyHost) revelar();
    }
  };
  tic();
  reloj = setInterval(tic, 250);
}

async function revelar() {
  if (!soyHost || revelando || estado.fase !== "pregunta") return;
  revelando = true;
  const caso = casoEn(estado.indice);
  const cambios = { "estado/fase": "revelar" };
  const respuestas = (await get(salaRef(`respuestas/${estado.indice}`)).catch(() => null))?.val() || {};
  for (const [jugador, respuesta] of Object.entries(respuestas)) {
    const ganados = puntos(respuesta, caso);
    if (ganados) cambios[`puntajes/${jugador}`] = (puntajes[jugador] || 0) + ganados;
  }
  await update(salaRef(), cambios).catch((e) => { revelando = false; aviso("No se pudo revelar: " + e.message); });
}

function hostRanking(final) {
  const ultimo = estado.indice === info.casos.length - 1;
  app.innerHTML = `<section style="display:grid;gap:14px;max-width:720px">
    <h1>${final ? "Resultado final" : "Ranking"}</h1>
    ${listaRanking(final ? 10 : 5)}
    <div class="ctrl">
      ${final ? `<button class="primary" id="cerrar">Cerrar sala</button>`
        : ultimo ? `<button class="primary" id="fin">Terminar</button>` : `<button class="primary" id="siguiente">Siguiente caso</button>`}
      <span class="spacer"></span>${final ? "" : `<button id="cerrar">Cerrar sala</button>`}
    </div></section>`;
  if (!final) {
    if (ultimo) $("#fin").onclick = () => set(salaRef("estado/fase"), "fin");
    else $("#siguiente").onclick = () => irA(estado.indice + 1);
  }
  $("#cerrar").onclick = cerrarSala;
}

async function cerrarSala() {
  if (!confirm("¿Cerrar la sala? Se borran los nombres y los puntajes.")) return;
  const c = codigo;
  await remove(ref(db, `indice_salas/${c}`)).catch(() => {});
  await remove(ref(db, `salas/${c}`)).catch((e) => aviso("No se pudo cerrar: " + e.message));
}

// ------------------------------------------------------------------ jugador
function vistaJugador() {
  const { fase } = estado;
  const yo = jugadores[uid];
  if (!yo) {
    app.innerHTML = panel("Saliste de la sala", "Vuelve a entrar con el código.", `<div class="row"><a class="boton" href="sala.html?c=${esc(codigo)}">Entrar de nuevo</a></div>`);
    return;
  }
  if (fase === "lobby") {
    app.innerHTML = `<section class="panel" style="display:grid;gap:10px;max-width:560px">
      <span class="tema">Conectado como</span><div class="big">${esc(yo.nombre)}</div>
      <p class="muted">Listo. La partida empieza cuando el presentador pulse Empezar.</p>
      <div class="row"><button id="salir">Salir de la sala</button></div></section>`;
    $("#salir").onclick = salir;
    return;
  }
  if (fase === "pregunta" || fase === "revelar") return jugadorCaso();
  const lista = ranking();
  const posicion = lista.findIndex((r) => r.id === uid) + 1;
  app.innerHTML = `<section style="display:grid;gap:14px;max-width:640px">
    <span class="tema">${fase === "fin" ? "Resultado final" : "Ranking"}</span>
    <div class="big">${posicion ? `${posicion}.º` : "—"}</div>
    <p class="muted">${puntajes[uid] || 0} puntos · ${lista.length} ${lista.length === 1 ? "participante" : "participantes"}</p>
    ${listaRanking(fase === "fin" ? 10 : 5)}</section>`;
}

function jugadorCaso() {
  const indice = estado.indice;
  const caso = casoEn(indice);
  const orden = ordenEn(indice);
  const revelado = estado.fase === "revelar";
  const elegida = miRespuesta.has(indice) ? miRespuesta.get(indice) : miResultado.get(indice)?.opcion;
  let arriba = "";
  if (revelado) {
    const resultado = miResultado.get(indice);
    const acierto = elegida === caso.correcta;
    arriba = elegida === undefined
      ? `<div class="verdict no">Sin respuesta</div>`
      : `<div class="verdict ${acierto ? "ok" : "no"}">${acierto ? `Correcto${resultado ? ` · +${puntos(resultado, caso)}` : ""}` : "Incorrecto"}</div>`;
  } else if (elegida !== undefined) {
    arriba = `<div class="chip live" style="justify-self:start">Respuesta enviada: ${LETRAS[orden.indexOf(elegida)]}</div>`;
  }
  const opciones = orden.map((original, pos) => {
    let clase = "";
    if (revelado) clase = original === caso.correcta ? "right" : "wrong";
    if (original === elegida) clase += " mine";
    return `<button class="opt ${clase}" data-k="${pos}" data-original="${original}" ${revelado || elegida !== undefined ? "disabled" : ""}>
      <span class="k">${LETRAS[pos]}</span><span>${esc(caso.opciones[original])}</span></button>`;
  }).join("");
  const imagenes = visor(caso, revelado);
  app.innerHTML = `
    <div class="qhead"><span class="qnum">${indice + 1}/${info.casos.length}</span><span class="tema">${esc(caso.tema)}</span></div>
    <section class="stage ${imagenes ? "" : "sin-imagen"}">
      ${imagenes}
      <div style="display:grid;gap:12px">
        ${arriba}
        <div class="stem md">${md(caso.enunciado)}</div>
        ${revelado ? "" : `<div class="timer"><i id="bar"></i></div>`}
        <div class="opts">${opciones}</div>
        ${revelado ? `<div class="exp md"><div class="ans">Respuesta: ${LETRAS[orden.indexOf(caso.correcta)]}. ${esc(caso.opciones[caso.correcta])}</div>${md(caso.explicacion)}</div>` : ""}
      </div>
    </section>`;
  app.querySelectorAll("button.opt").forEach((boton) => {
    boton.onclick = () => responder(Number(boton.dataset.original));
  });
  if (!revelado) iniciarReloj();
}

async function responder(original) {
  const indice = estado.indice;
  if (miRespuesta.has(indice) || estado.fase !== "pregunta") return;
  miRespuesta.set(indice, original);
  render(true);
  try {
    await set(salaRef(`respuestas/${indice}/${uid}`), { opcion: original, t: serverTimestamp() });
  } catch {
    miRespuesta.delete(indice);
    aviso("No se registró la respuesta: el tiempo terminó o ya habías respondido.");
    render(true);
  }
}

async function salir() {
  await remove(salaRef(`jugadores/${uid}`)).catch(() => {});
  borrarSesion();
  location.href = "sala.html";
}

// ------------------------------------------------------------------ arranque
document.addEventListener("click", (e) => {
  const imagen = e.target.closest("[data-zoom]");
  if (imagen) {
    $("#zoomImg").src = imagen.src;
    $("#zoom").hidden = false;
  }
});
$("#zoom").onclick = () => { $("#zoom").hidden = true; };
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("#zoom").hidden = true; });

async function iniciar() {
  if (!firebaseConfig) {
    $("#rol").textContent = "Sin configurar";
    app.innerHTML = panel("La sala en vivo aún no está configurada", "Falta la configuración de Firebase en app/firebase-config.js.");
    return;
  }
  const fb = initializeApp(firebaseConfig);
  db = getDatabase(fb);
  const auth = getAuth(fb);
  onValue(ref(db, ".info/serverTimeOffset"), (s) => { desfase = s.val() || 0; });
  try {
    await signInAnonymously(auth);
  } catch (e) {
    app.innerHTML = panel("No se pudo conectar", `El inicio de sesión anónimo falló (${e.code || e.message}).`);
    return;
  }
  uid = auth.currentUser.uid;
  const pedido = (params.get("c") || "").toUpperCase();
  const sesion = leerSesion();
  if (sesion && (!pedido || pedido === sesion.codigo)) return entrar(sesion.codigo, sesion.rol);
  pantallaInicio(pedido);
}

iniciar();
