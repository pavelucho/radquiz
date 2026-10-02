// RadQuiz — sala en vivo. Presentador y jugadores usan esta misma página.
// Firebase guarda solo el estado de la sala (fase, respuestas, puntajes); las preguntas y las imágenes
// vienen del sitio. Las reglas de seguridad están en database.rules.json.
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getDatabase, ref, set, get, update, remove, onValue, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";
import { firebaseConfig, APP_ANONIMA } from "./firebase-config.js";
import { $, esc, md, cargarJSON, credito, barajar, sello, leerTanda, totalTanda, nivelDe } from "./comun.js";
import { cargarPaquete, indiceEnVivo, fusionarIndice } from "./publicado.js";
import { reportar } from "./reportar.js";
import { qrDataURI } from "./qr.js";
import {
  MODOS, modoDe, esSupervivencia, esRescate, armarSecuencia, vivos, puedeVolver, puedeResponder, habilitados,
  resolverRonda, decidida, siguiente, faltanParaRescate, numeroDe, clasificacion,
} from "./supervivencia.js";

const LETRAS = "ABCDE";
const LETRAS_CODIGO = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DURACIONES = [20, 30, 45, 60, 90];
const TOPE_CASOS = 200;      // las reglas piden estado/indice < 200
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
let eliminados = {};           // supervivencia: uid → caso en que cayó
let rescatados = {};           // supervivencia con rescate: uid → caso en que volvió
const marcandoTarde = new Set();  // presentador: quienes entraron con la partida empezada, mientras se escribe
let respuestasActual = {};     // solo el presentador: respuestas de la pregunta en curso
let paquete = null;
let fuentes = null;
let srcImagen = () => "";
let casoPorId = new Map();
let suscripciones = [];
let suscripcionRespuestas = null;
let vistaActual = "";
let reloj = null;
let revelando = false;
let jugadoresListos = false;   // hasta leer la lista no se sabe si este jugador sigue en la sala
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
  return `<section class="panel stack angosto">
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
    const src = srcImagen(r.ref);
    return `<figure><img src="${esc(src)}" alt="${esc(imagen.figura)}" data-zoom>
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
function sinSala() {
  $("#rol").textContent = "Sin sala";
  $("#rol").className = "chip";
  $("#conteo").hidden = true;
}

function pantallaInicio(codigoInicial = "", mensaje = "") {
  sinSala();
  const sesion = leerSesion();
  app.innerHTML = `
    ${mensaje ? `<p class="nota">${esc(mensaje)}</p>` : ""}
    <section class="lobby">
      <form class="panel" id="unirse">
        <p class="eyebrow">Residentes</p>
        <h1>Unirme</h1>
        <label class="grid-label">Código de la sala
          <input type="text" id="codigo" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${esc(codigoInicial)}" placeholder="ABCD" class="input-codigo"></label>
        <label class="grid-label">Tu nombre o apodo
          <input type="text" id="nombre" maxlength="24" autocomplete="nickname" value="${esc((sesion && sesion.nombre) || "")}"></label>
        <button class="primary lg" type="submit">Entrar</button>
        <p class="src">Tu nombre solo se usa en esta sala y se borra cuando el presentador la cierra.</p>
      </form>
      <div class="panel">
        <p class="eyebrow">Presentadores</p>
        <h2>Soy presentador</h2>
        <p class="muted">Crea una sala, proyecta esta pantalla y comparte el código.</p>
        <div class="row"><button class="lg" id="crear">Crear sala</button></div>
        <p class="src">¿Primera vez? <a href="manual.html#crear-sala">Cómo presentar</a> · <a href="manual.html#jugar">Cómo jugar</a></p>
        <p class="src">¿Sin celulares? Juega por equipos en el <a href="tablero.html">tablero</a>, al estilo Jeopardy.</p>
      </div>
    </section>`;
  $("#unirse").onsubmit = (e) => { e.preventDefault(); unirse($("#codigo").value, $("#nombre").value); };
  $("#crear").onclick = pantallaCrear;
  (codigoInicial ? $("#nombre") : $("#codigo")).focus();
}

async function pantallaCrear() {
  app.innerHTML = `<p class="muted">Cargando temas…</p>`;
  const [indice, vivo] = await Promise.all([
    cargarJSON("temas/indice.json").catch(() => null),
    indiceEnVivo(),
  ]);
  if (!indice && !vivo.length) {
    app.innerHTML = panel("No encontré la lista de temas",
      "No pude leer la lista del sitio ni la del estudio. Revisa la conexión y vuelve a intentarlo.");
    return;
  }
  const disponibles = fusionarIndice(indice?.paquetes || [], vivo).map((p) => ({
    ...p,
    publicados: p.casos.publicado || 0,
    verificados: p.casos.verificado || 0,
    sinPublicar: (p.casos.borrador || 0) + (p.casos.revisado || 0),
  }));
  const hayBorradores = disponibles.some((p) => p.sinPublicar);
  const porRuta = new Map(disponibles.map((p) => [p.ruta, p]));
  const opciones = disponibles
    .filter((p) => p.publicados || hayBorradores)
    .map((p) => `<option value="${esc(p.ruta)}">${esc(p.titulo)} · ${p.verificados} verificados de ${p.publicados}${p.sinPublicar ? ` · ${p.sinPublicar} sin publicar` : ""}</option>`)
    .join("");
  if (!opciones) {
    app.innerHTML = panel("Todavía no hay casos publicados",
      "La sala en vivo usa los casos publicados. Cuando se publique el primer tema, aparecerá aquí.",
      `<div class="row"><a class="boton" href="sala.html">Volver</a></div>`);
    return;
  }
  app.innerHTML = `<form class="panel stack angosto" id="config" novalidate>
    <p class="eyebrow">Presentador</p>
    <h2>Crear sala</h2>
    <label class="grid-label">Tema <select id="tema">${opciones}</select></label>
    <label class="grid-label">Modo <select id="modo">${Object.entries(MODOS).map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join("")}</select></label>
    <p class="src" id="nota-modo"></p>
    <div class="campos">
      <label class="grid-label">Tiempo por caso <select id="duracion">${DURACIONES.map((s) => `<option value="${s}" ${s === 45 ? "selected" : ""}>${s} s</option>`).join("")}</select></label>
      <label class="grid-label">Cuántos casos <input type="number" id="cuantos" min="1" step="1" inputmode="numeric"></label>
    </div>
    <p class="src" id="nota-tanda"></p>
    <div class="casillas">
      <label class="row"><input type="checkbox" id="sin-verificar"> Incluir casos sin verificar</label>
      <label class="row" id="fila-mezclar"><input type="checkbox" id="mezclar"> Mezclar el orden de los casos</label>
      ${hayBorradores ? `<label class="row"><input type="checkbox" id="borradores"> Incluir casos sin publicar (ensayo en esta computadora)</label>` : ""}
    </div>
    <div class="row"><button class="primary lg" type="submit">Crear sala</button><a class="boton lg" href="sala.html">Cancelar</a></div>
  </form>`;

  // Cuántos casos hay depende del tema y de los dos filtros, así que el campo se ajusta cuando cambian.
  // Solo se toca si cambió el total: si no, se perdería el número escrito.
  let totalPrevio = -1;
  const campo = $("#cuantos");
  function refrescar() {
    const tema = porRuta.get($("#tema").value);
    const borradores = Boolean($("#borradores") && $("#borradores").checked);
    const total = borradores
      ? tema.publicados + tema.sinPublicar
      : $("#sin-verificar").checked ? tema.publicados : tema.verificados;
    if (total !== totalPrevio) {
      totalPrevio = total;
      totalTanda(campo, Math.min(total, TOPE_CASOS));
      campo.disabled = !total;
    }
    const cuantos = leerTanda(campo) || Math.min(total, TOPE_CASOS);
    const modo = $("#modo").value;
    // En supervivencia el orden lo pone la dificultad (de fácil a difícil): «Mezclar» no se aplica.
    $("#fila-mezclar").hidden = modo !== "clasico";
    $("#nota-modo").textContent = {
      clasico: "Todos responden todos los casos y gana quien suma más puntos.",
      supervivencia: "Una vida: quien falla o no responde queda eliminado. Si fallan todos los que siguen, no cae nadie. Gana el último en pie; los casos van del más fácil al más difícil.",
      rescate: `Como Supervivencia, y cada 3 casos uno de rescate, más fácil: el eliminado que acierta vuelve (una vez por persona; en el último tercio ya no hay rescates).`,
    }[modo];
    $("#nota-tanda").textContent = !total
      ? "Ningún caso cumple el filtro: marca «Incluir casos sin verificar»."
      : modo !== "clasico"
        ? `${cuantos === total ? `Los ${total} casos` : `${cuantos} ${cuantos === 1 ? "caso" : "casos"} al azar entre los ${total}`}, del más fácil al más difícil${modo === "rescate" ? "; los de rescate salen de los que sobran o, si no sobran, de estos" : ""}.`
      : cuantos === total ? (total === 1 ? "La sesión usa el único caso." : `La sesión usa los ${total} casos.`)
      : $("#mezclar").checked ? `${cuantos} ${cuantos === 1 ? "caso" : "casos"} al azar entre los ${total}.`
      : cuantos === 1 ? `El primero de los ${total} casos del tema; con «Mezclar» sale uno al azar.`
      : `Los primeros ${cuantos} de los ${total} casos del tema; con «Mezclar» salen al azar.`;
  }
  ["#tema", "#modo", "#mezclar", "#sin-verificar", "#borradores"].forEach((sel) => {
    const control = $(sel);
    if (control) control.onchange = refrescar;
  });
  // La nota sigue lo que se escribe; al soltar el campo, lo que quedó fuera de rango se muestra como todos.
  campo.oninput = refrescar;
  campo.onchange = () => {
    campo.value = leerTanda(campo) || campo.max;
    refrescar();
  };
  // Enter confirma el número y no crea la sala: debajo quedan casillas por marcar.
  campo.onkeydown = (e) => {
    if (e.key === "Enter") { e.preventDefault(); campo.blur(); }
  };
  refrescar();

  $("#config").onsubmit = (e) => {
    e.preventDefault();
    crearSala({
      tema: $("#tema").value,
      duracion: Number($("#duracion").value),
      cuantos: leerTanda(campo),
      mezclar: $("#mezclar").checked,
      modo: $("#modo").value,
      sinVerificar: $("#sin-verificar").checked,
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

async function crearSala({ tema, duracion, cuantos, mezclar, modo, borradores, sinVerificar }) {
  const { paquete: pkg } = await cargarPaquete(tema);
  let casos = pkg.casos.filter((c) => c.estado === "publicado" || borradores);
  if (!sinVerificar && !borradores) casos = casos.filter((c) => c.revisor);
  let rescates = [];
  if (modo !== "clasico") {
    const secuencia = armarSecuencia(casos, { cuantos, rescate: modo === "rescate", nivelDe, barajar, tope: TOPE_CASOS });
    const porId = new Map(casos.map((c) => [c.id, c]));
    casos = secuencia.casos.map((id) => porId.get(id));
    rescates = secuencia.rescates;
  } else {
    if (mezclar) casos = barajar(casos);
    casos = casos.slice(0, cuantos || TOPE_CASOS);   // mezclados = al azar; sin mezclar = los primeros
  }
  if (!casos.length) {
    aviso("No hay casos que cumplan el filtro. Prueba marcando «Incluir casos sin verificar».", true);
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
        info: {
          host: uid, creada: serverTimestamp(), tema, titulo: pkg.titulo, duracion, casos: casos.map((c) => c.id), orden,
          ...(modo !== "clasico" ? { modo } : {}), ...(rescates.length ? { rescates } : {}),
        },
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
    ({ paquete, fuentes, imagen: srcImagen } = await cargarPaquete(info.tema));
  } catch {
    return salaSinTema(`La sala ${c} usa un tema que ya no está publicado (${info.tema}).`);
  }
  casoPorId = new Map(paquete.casos.map((caso) => [caso.id, caso]));
  if (info.casos.some((id) => !casoPorId.has(id))) {
    return salaSinTema(`La sala ${c} usa casos que el tema ya no tiene: se editó después de crearla.`);
  }
  suscribir();
}

// Una sala guardada en este navegador cuyo tema se retiró o cambió no se puede jugar. Antes la página
// se quedaba ahí cada vez que se abría, porque la sesión guardada volvía a entrar a la misma sala.
async function salaSinTema(mensaje) {
  if (soyHost) {
    await remove(ref(db, `indice_salas/${codigo}`)).catch(() => {});
    await remove(ref(db, `salas/${codigo}`)).catch(() => {});
  }
  borrarSesion();
  pantallaInicio("", `${mensaje} ${soyHost ? "La cerré; crea otra." : "Pídele al presentador el código de otra."}`);
}

function suscribir() {
  suscripciones.forEach((cancelar) => cancelar());
  jugadoresListos = false;
  suscripciones = [
    onValue(salaRef("estado"), (s) => {
      const anterior = estado;
      if (!s.exists()) return confirmarCierre();
      estado = s.val();
      if (soyHost && (!anterior || anterior.indice !== estado.indice || !suscripcionRespuestas)) escucharRespuestas();
      if (!soyHost && ["revelar", "ranking", "fin"].includes(estado.fase)) leerMiResultado(estado.indice);
      render();
    }, () => confirmarCierre()),
    onValue(salaRef("jugadores"), (s) => { jugadores = s.val() || {}; jugadoresListos = true; marcarTarde(); render(); }),
    onValue(salaRef("puntajes"), (s) => { puntajes = s.val() || {}; render(); }),
  ];
  if (esSupervivencia(info)) {
    suscripciones.push(
      onValue(salaRef("eliminados"), (s) => { eliminados = s.val() || {}; render(true); }),
      onValue(salaRef("rescatados"), (s) => { rescatados = s.val() || {}; render(true); }),
    );
  }
}

// Supervivencia: quien entra con la partida empezada no esquivó los casos anteriores, así que entra eliminado
// (con rescate, puede volver como los demás). Lo marca el presentador, que es quien escribe en la sala.
function marcarTarde() {
  if (!soyHost || !esSupervivencia(info) || typeof info.empezo !== "number" || !estado || estado.fase === "lobby") return;
  const cambios = {};
  for (const [id, j] of Object.entries(jugadores)) {
    if (j.unido > info.empezo && !(id in eliminados) && !marcandoTarde.has(id)) {
      marcandoTarde.add(id);
      cambios[`eliminados/${id}`] = estado.indice;
    }
  }
  if (Object.keys(cambios).length) update(salaRef(), cambios).catch(() => {}).finally(() => marcandoTarde.clear());
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

// No se dibuja nada hasta tener la lista de jugadores. El estado suele llegar antes: quien entra o recarga a
// mitad de una pregunta se veía fuera de la sala («Saliste de la sala») y, como la pregunta no se vuelve a
// dibujar, quedaba así hasta que se revelaba la respuesta.
function render(forzar = false) {
  if (!estado || !info || !jugadoresListos) return;
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

// El QR lleva al enlace con el código puesto: quien lo escanea solo escribe su nombre.
// Se dibuja aquí mismo (app/qr.js) para no depender de un servicio externo en la red del hospital.
function bloqueQR(enlace) {
  if (!/^https?:$/.test(location.protocol)) return "";  // desde file:// el enlace no le sirve a nadie
  let fuente;
  try {
    fuente = qrDataURI(enlace);
  } catch {
    return "";  // un enlace larguísimo: mejor sin QR que con uno ilegible
  }
  return `<figure class="qr">
    <img src="${fuente}" alt="Código QR con el enlace a la sala ${esc(codigo)}" data-zoom>
    <figcaption>Escanea con la cámara<br>y entras directo · Toca para ampliar</figcaption>
  </figure>`;
}

// La inicial de cada jugador, para el círculo de color de la lista.
const inicial = (nombre) => ([...String(nombre || "?").trim()][0] || "?").toUpperCase();

function hostLobby() {
  const enlace = `${location.origin}${location.pathname}?c=${codigo}`;
  const nombres = Object.values(jugadores)
    .map((j) => `<span class="pl" data-inicial="${esc(inicial(j.nombre))}">${esc(j.nombre)}</span>`).join("");
  app.innerHTML = `<section class="lobby">
    <div class="panel">
      <p class="tema">Código de la sala</p>
      <div class="entrada">
        <div>
          <div class="codigo">${esc(codigo)}</div>
          <div class="como-entrar"><p class="muted">Entren a</p>
            <p class="direccion">${esc(location.host + location.pathname)}</p>
            <p class="muted">y escriban el código.</p></div>
        </div>
        ${bloqueQR(enlace)}
      </div>
      <p class="src">Enlace directo: ${esc(enlace)}</p>
      <p class="muted">${esc(info.titulo)} · ${esSupervivencia(info) ? `${esc(MODOS[modoDe(info)])} · ${numeroDe(0, info).total} casos${info.rescates?.length ? ` y ${info.rescates.length} de rescate` : ""}`
        : `${info.casos.length} casos`} · ${info.duracion} s por caso</p>
      <div class="row"><button class="primary lg" id="empezar">Empezar</button><button class="lg" id="cerrar">Cerrar sala</button></div>
    </div>
    <div class="panel">
      <h2>En la sala: <span class="cuenta">${Object.keys(jugadores).length}</span></h2>
      <div class="players">${nombres || `<p class="esperando"><i><b></b></i>Esperando residentes…</p>`}</div>
      <p class="src">Sin celulares o sin red, se puede empezar igual y responder a mano alzada.</p>
    </div>
  </section>`;
  $("#empezar").onclick = () => irA(0);
  $("#cerrar").onclick = cerrarSala;
}

function irA(indice) {
  const nuevo = { fase: "pregunta", indice, inicio: serverTimestamp(), ...(esRescate(info, indice) ? { rescate: true } : {}) };
  // Al empezar una supervivencia se anota cuándo: quien entre después, entra eliminado.
  const empieza = esSupervivencia(info) && estado.fase === "lobby" && typeof info.empezo !== "number";
  if (empieza) info.empezo = ahora();
  return (empieza ? update(salaRef(), { estado: nuevo, "info/empezo": serverTimestamp() }) : set(salaRef("estado"), nuevo))
    .catch((e) => aviso("No se pudo avanzar: " + e.message));
}

// El caso que sigue, o null si no queda ninguno. En supervivencia se saltan los rescates sin nadie que pueda volver.
function proximo() {
  if (esSupervivencia(info)) return siguiente(estado.indice, info, { jugadores, eliminados, rescatados });
  return estado.indice + 1 < info.casos.length ? estado.indice + 1 : null;
}
const terminada = () => esSupervivencia(info) && decidida(jugadores, eliminados, { info, indice: estado.indice, rescatados });

// «7 / 20», sin contar los casos de rescate, y el aviso de la ronda de rescate.
function cabezaCaso(revelado, caso) {
  const { numero, total, rescate } = numeroDe(estado.indice, info);
  const enPie = esSupervivencia(info) ? vivos(jugadores, eliminados).length : 0;
  return `<div class="qhead">${rescate ? `<span class="sv-rescate">Ronda de rescate</span>`
      : `<span class="qnum">${numero}<small> / ${total}</small></span>`}
    ${esSupervivencia(info) ? `<span class="chip sv-quedan">${enPie} de ${Object.keys(jugadores).length} en pie</span>` : ""}
    ${revelado ? `<span class="tema">${esc(caso.tema)}</span>` : ""}</div>`;
}

// Lo que pasó en la ronda, para el proyector y para cada celular.
function resultadoRonda() {
  const i = estado.indice;
  const nombres = (ids) => ids.map((id) => esc(jugadores[id]?.nombre || "?")).join(", ");
  // Quien entró durante este caso también queda marcado con él, pero no «cayó»: se reconoce porque entró después.
  const caen = Object.keys(eliminados).filter((id) => eliminados[id] === i && jugadores[id]
    && !(jugadores[id].unido > (typeof estado.inicio === "number" ? estado.inicio : Infinity)));
  const vuelven = Object.keys(rescatados).filter((id) => rescatados[id] === i && jugadores[id]);
  return { caen, vuelven, salvados: Boolean(estado.salvados), nombres };
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
  const sigue = proximo();
  const fin = sigue === null || terminada();
  const opciones = orden.map((original, pos) => `<div class="opt ${revelado ? (original === caso.correcta ? "right" : "wrong") : ""}" data-k="${pos}">
      <span class="fill" style="width:${revelado && total ? Math.round((100 * conteo[original]) / total) : 0}%"></span>
      <span class="k">${LETRAS[pos]}</span><span>${esc(caso.opciones[original])}</span><span class="n">${revelado ? conteo[original] : ""}</span></div>`).join("");
  const letra = LETRAS[orden.indexOf(caso.correcta)];
  const imagenes = visor(caso, revelado);
  app.innerHTML = `
    ${cabezaCaso(revelado, caso)}
    ${!revelado && estado.rescate ? `<p class="sv-aviso">Responden todos. Los que siguen en pie no arriesgan nada; el eliminado que acierta, vuelve.</p>` : ""}
    ${revelado && esSupervivencia(info) ? avisoRonda() : ""}
    <section class="stage ${imagenes ? "" : "sin-imagen"}">
      ${imagenes}
      <div class="pregunta">
        <div class="stem md">${md(caso.enunciado)}</div>
        ${revelado ? "" : `<div class="reloj" id="reloj"><div class="row"><span class="clock" id="clock">${info.duracion}</span>
          <span class="chip" id="respondieron">${total}/${cuantosResponden()} respondieron</span></div><div class="timer"><i id="bar"></i></div></div>`}
        <div class="opts">${opciones}</div>
        ${revelado ? `<div class="exp md"><div class="ans">Respuesta: ${letra}. ${esc(caso.opciones[caso.correcta])}</div>${md(caso.explicacion)}</div>
          ${caso.perla ? `<div class="pearl md"><b>Perla:</b> ${md(caso.perla)}</div>` : ""}
          <div class="row">${sello(caso, paquete.personas)}<span class="spacer"></span>
            <button id="reportar" class="reportar">Reportar un error</button></div>` : ""}
      </div>
    </section>
    <div class="ctrl">
      ${revelado
        ? `<button id="ranking">${esSupervivencia(info) ? "Ver quién sigue" : "Ver ranking"}</button>${fin
          ? `<button class="primary" id="fin">${terminada() ? "Ver al ganador" : "Terminar"}</button>`
          : `<button class="primary" id="siguiente">Siguiente caso</button>`}`
        : `<button class="primary" id="revelar">Revelar respuesta</button>`}
      <span class="spacer"></span><button id="cerrar">Cerrar sala</button>
    </div>`;
  if (!revelado) {
    $("#revelar").onclick = revelar;
    iniciarReloj();
  } else {
    $("#ranking").onclick = () => set(salaRef("estado/fase"), "ranking");
    if (fin) $("#fin").onclick = () => set(salaRef("estado/fase"), "fin");
    else $("#siguiente").onclick = () => irA(sigue);
  }
  $("#cerrar").onclick = cerrarSala;
  const botonReporte = $("#reportar");
  if (botonReporte) botonReporte.onclick = () => reportar(info.tema, caso.id, botonReporte);
}

// Cuántos pueden responder este caso: en la sala clásica y en un rescate, todos; si no, los que siguen en pie.
const cuantosResponden = () => (esSupervivencia(info)
  ? habilitados(jugadores, eliminados, Boolean(estado.rescate)).length : Object.keys(jugadores).length);

// En el proyector, después de revelar: quiénes cayeron o volvieron.
function avisoRonda() {
  const { caen, vuelven, salvados, nombres } = resultadoRonda();
  if (estado.rescate) {
    return vuelven.length ? `<p class="sv-aviso ok">Vuelven al juego: ${nombres(vuelven)}</p>`
      : `<p class="sv-aviso">Nadie vuelve en este rescate.</p>`;
  }
  if (salvados) return `<p class="sv-aviso ok">Fallaron todos los que seguían en pie: ¡se salvan todos!</p>`;
  return caen.length ? `<p class="sv-aviso mal">${caen.length === 1 ? "Cae" : `Caen ${caen.length}`}: ${nombres(caen)}</p>`
    : `<p class="sv-aviso ok">Nadie cae en este caso.</p>`;
}

function actualizarPregunta() {
  if (!soyHost) return;
  const total = Object.keys(respuestasActual).length;
  const n = cuantosResponden();
  const chip = $("#respondieron");
  if (chip) chip.textContent = `${total}/${n} respondieron`;
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
    // Los últimos segundos (10, o la cuarta parte si el tiempo es corto) el reloj se pone rojo.
    const caja = $("#reloj") || (bar && bar.parentElement);
    if (caja) caja.classList.toggle("poco", restante <= Math.min(10, info.duracion / 4));
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
  if (esSupervivencia(info)) {
    const { caen, vuelven, salvados } = resolverRonda({
      jugadores, eliminados, rescatados, rescate: Boolean(estado.rescate),
      acerto: (id) => respuestas[id]?.opcion === caso.correcta,
    });
    caen.forEach((id) => { cambios[`eliminados/${id}`] = estado.indice; });
    vuelven.forEach((id) => {
      cambios[`eliminados/${id}`] = null;
      cambios[`rescatados/${id}`] = estado.indice;
    });
    if (salvados) cambios["estado/salvados"] = true;
  }
  await update(salaRef(), cambios).catch((e) => { revelando = false; aviso("No se pudo revelar: " + e.message); });
}

function hostRanking(final) {
  const sigue = proximo();
  const fin = sigue === null || terminada();
  app.innerHTML = `<section class="stack ${esSupervivencia(info) ? "" : "angosto"}">
    <p class="eyebrow">${esc(info.titulo)}</p>
    ${esSupervivencia(info) ? sobrevivientes(final) : `<h1>${final ? "Resultado final" : "Ranking"}</h1>${listaRanking(final ? 10 : 5)}`}
    <div class="ctrl">
      ${final ? `<button class="primary" id="cerrar">Cerrar sala</button>`
        : fin ? `<button class="primary" id="fin">${terminada() ? "Ver al ganador" : "Terminar"}</button>`
          : `<button class="primary" id="siguiente">Siguiente caso</button>`}
      <span class="spacer"></span>${final ? "" : `<button id="cerrar">Cerrar sala</button>`}
    </div></section>`;
  if (!final) {
    if (fin) $("#fin").onclick = () => set(salaRef("estado/fase"), "fin");
    else $("#siguiente").onclick = () => irA(sigue);
  }
  $("#cerrar").onclick = cerrarSala;
}

// Supervivencia: los que siguen en pie, grandes, y debajo los eliminados con el caso en que cayeron. Al final, el
// ganador (o los que llegaron en pie al último caso).
function sobrevivientes(final) {
  const lista = clasificacion(jugadores, eliminados, puntajes);
  const enPie = lista.filter((r) => r.cayo === null);
  const caidos = lista.filter((r) => r.cayo !== null);
  const titulo = !final ? `Siguen en pie: ${enPie.length} de ${lista.length}`
    : enPie.length === 1 ? `Gana ${esc(enPie[0].nombre)}`
      : enPie.length ? `Llegaron al final: ${enPie.length}` : "Resultado final";
  const tarjeta = (r, clase) => `<span class="pl ${clase} ${r.id === uid ? "yo" : ""}" data-inicial="${esc(inicial(r.nombre))}">${esc(r.nombre)}
    <small>${r.cayo === null ? `${r.pts} pts` : `cayó en el caso ${numeroDe(r.cayo, info).numero}`}</small></span>`;
  return `<h1 class="${final && enPie.length === 1 ? "sv-ganador" : ""}">${titulo}</h1>
    ${enPie.length ? `<div class="players sv-en-pie">${enPie.map((r) => tarjeta(r, "")).join("")}</div>` : ""}
    ${caidos.length ? `<h3>Eliminados</h3><div class="players">${caidos.map((r) => tarjeta(r, "caido")).join("")}</div>` : ""}`;
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
    app.innerHTML = `<section class="panel stack angosto">
      <span class="tema">Conectado como</span><div class="big nombre">${esc(yo.nombre)}</div>
      <p class="esperando"><i><b></b></i>Listo. La partida empieza cuando el presentador pulse Empezar.</p>
      ${esSupervivencia(info) ? `<p class="sv-aviso"><b>${esc(MODOS[modoDe(info)])}.</b> Una vida: si fallas o no respondes,
        quedas eliminado.${info.rescates?.length ? " Cada tanto hay una ronda de rescate: si aciertas, vuelves (una vez)." : ""}</p>` : ""}
      <div class="row"><button id="salir">Salir de la sala</button></div></section>`;
    $("#salir").onclick = salir;
    return;
  }
  if (fase === "pregunta" || fase === "revelar") return jugadorCaso();
  if (esSupervivencia(info)) {
    app.innerHTML = `<section class="stack">${miEstado(false)}${sobrevivientes(fase === "fin")}</section>`;
    return;
  }
  const lista = ranking();
  const posicion = lista.findIndex((r) => r.id === uid) + 1;
  app.innerHTML = `<section class="stack angosto">
    <span class="tema">${fase === "fin" ? "Resultado final" : "Ranking"}</span>
    <div class="big">${posicion ? `${posicion}.º` : "—"}</div>
    <p class="muted">${puntajes[uid] || 0} puntos · ${lista.length} ${lista.length === 1 ? "participante" : "participantes"}</p>
    ${listaRanking(fase === "fin" ? 10 : 5)}</section>`;
}

// Supervivencia: cómo está este jugador. Durante el caso, si puede responder y qué arriesga; al revelar, qué le pasó.
function miEstado(revelado) {
  if (!esSupervivencia(info)) return "";
  const i = estado.indice;
  const fuera = uid in eliminados;
  const tarde = (jugadores[uid]?.unido || 0) > (info.empezo ?? Infinity);
  const caja = (clase, texto) => `<p class="sv-estado ${clase}">${texto}</p>`;
  if (estado.fase === "ranking" || estado.fase === "fin") {
    const solo = vivos(jugadores, eliminados).length === 1;
    if (!fuera) return caja("vivo", estado.fase !== "fin" ? "Sigues en pie" : solo ? "¡Ganaste!" : "Llegaste en pie hasta el final");
    const faltan = estado.fase === "ranking" && puedeVolver(uid, eliminados, rescatados) ? faltanParaRescate(i, info) : null;
    return caja("caido", `Estás eliminado.${faltan ? ` Rescate dentro de ${faltan === 1 ? "1 caso" : `${faltan} casos`}.` : ""}`);
  }
  if (revelado) {
    if (rescatados[uid] === i) return caja("vuelve", "¡Vuelves al juego!");
    if (fuera && eliminados[uid] === i && !((jugadores[uid]?.unido || 0) > (estado.inicio ?? Infinity))) return caja("caido", "Caíste");
    if (!fuera && estado.salvados) return caja("vivo", "Fallaron todos: ¡se salvan todos!");
    if (!fuera) return caja("vivo", "Sigues en pie");
    if (estado.rescate) {
      const otro = puedeVolver(uid, eliminados, rescatados) ? faltanParaRescate(i, info) : null;
      return caja("caido", `Esta vez no: sigues eliminado.${otro ? ` Otro rescate dentro de ${otro === 1 ? "1 caso" : `${otro} casos`}.` : ""}`);
    }
  }
  if (!fuera) return estado.rescate ? caja("vivo", "Ronda de rescate: tú sigues en pie y respondes sin riesgo") : caja("vivo", "Sigues en pie");
  if (estado.rescate) {
    return puedeVolver(uid, eliminados, rescatados) ? caja("vuelve", "¡Ronda de rescate! Si aciertas, vuelves al juego")
      : caja("caido", "Ya usaste tu rescate: respondes solo por los puntos");
  }
  const faltan = puedeVolver(uid, eliminados, rescatados) ? faltanParaRescate(i, info) : null;
  const motivo = tarde && !(uid in rescatados)
    ? "Entraste con la partida empezada: miras como espectador" : `Eliminado en el caso ${numeroDe(eliminados[uid], info).numero}`;
  return caja("caido", `${motivo}.${faltan ? ` Rescate dentro de ${faltan === 1 ? "1 caso" : `${faltan} casos`}.` : ""}`);
}

function jugadorCaso() {
  const indice = estado.indice;
  const caso = casoEn(indice);
  const orden = ordenEn(indice);
  const revelado = estado.fase === "revelar";
  const bloqueado = esSupervivencia(info) && !puedeResponder(uid, eliminados, Boolean(estado.rescate));
  const elegida = miRespuesta.has(indice) ? miRespuesta.get(indice) : miResultado.get(indice)?.opcion;
  let arriba = "";
  if (revelado && bloqueado) {
    arriba = "";
  } else if (revelado) {
    const resultado = miResultado.get(indice);
    const acierto = elegida === caso.correcta;
    arriba = elegida === undefined
      ? `<div class="verdict no">Sin respuesta</div>`
      : `<div class="verdict ${acierto ? "ok" : "no"}">${acierto ? `Correcto${resultado ? ` · +${puntos(resultado, caso)}` : ""}` : "Incorrecto"}</div>`;
  } else if (elegida !== undefined) {
    arriba = `<div class="chip live enviada">Respuesta enviada: ${LETRAS[orden.indexOf(elegida)]}</div>`;
  }
  const opciones = orden.map((original, pos) => {
    let clase = "";
    if (revelado) clase = original === caso.correcta ? "right" : "wrong";
    if (original === elegida) clase += " mine";
    return `<button class="opt ${clase}" data-k="${pos}" data-original="${original}" ${revelado || bloqueado || elegida !== undefined ? "disabled" : ""}>
      <span class="k">${LETRAS[pos]}</span><span>${esc(caso.opciones[original])}</span></button>`;
  }).join("");
  const imagenes = visor(caso, revelado);
  app.innerHTML = `
    ${cabezaCaso(revelado, caso)}
    <section class="stage ${imagenes ? "" : "sin-imagen"}">
      ${imagenes}
      <div class="pregunta">
        ${miEstado(revelado)}
        ${arriba}
        <div class="stem md">${md(caso.enunciado)}</div>
        ${revelado ? "" : `<div class="timer"><i id="bar"></i></div>`}
        <div class="opts">${opciones}</div>
        ${revelado ? `<div class="exp md"><div class="ans">Respuesta: ${LETRAS[orden.indexOf(caso.correcta)]}. ${esc(caso.opciones[caso.correcta])}</div>${md(caso.explicacion)}</div>
          <div class="row">${sello(caso, paquete.personas)}</div>` : ""}
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
  if (esSupervivencia(info) && !puedeResponder(uid, eliminados, Boolean(estado.rescate))) return;
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
  // Instancia propia, con su propia sesión anónima. Si fuera la de por defecto, entrar a la sala cerraría
  // la sesión de Google del estudio en este navegador, y entrar al estudio le cambiaría el usuario a la
  // sala: el presentador perdería el control en plena sesión.
  const fb = getApps().find((a) => a.name === APP_ANONIMA) || initializeApp(firebaseConfig, APP_ANONIMA);
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
  if (params.has("crear") && !pedido) {   // «Presentar una sesión», en la portada
    sinSala();
    return pantallaCrear();
  }
  pantallaInicio(pedido);
}

iniciar();
