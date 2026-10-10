// RadQuiz — sesión de lectura con celulares. El presentador proyecta el caso entero (página 1: encabezado, figuras
// limpias y todas las preguntas); cada residente escribe sus respuestas en el celular. Al pasar la página, el
// proyector muestra las figuras anotadas y, pregunta por pregunta cuando el presentador quiere, la respuesta de la
// fuente junto a lo que escribió la sala, agrupado y anónimo («7 dijeron Maisonneuve, 3 Weber C…»). El presentador
// marca qué grupos valen; lo que coincide con una respuesta aceptada sale sugerido. No hay puntaje ni ranking: lo
// que importa es comprometerse con una respuesta y discutirla.
//
// Firebase guarda solo el estado de la sesión, en «lecturas_vivo/<código>» (reglas en database.rules.json); las
// lecturas y sus figuras vienen del sitio o del estudio, como en la sala. Usa la misma instancia anónima que la sala
// (APP_ANONIMA), para no pisar la sesión de Google del estudio.
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getDatabase, ref, set, get, update, remove, onValue, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";
import { firebaseConfig, APP_ANONIMA } from "./firebase-config.js";
import { $, esc, barajar, nivelDe, origenPublico } from "./comun.js";
import { cargarPaquete } from "./publicado.js";
import { activarAmpliacion } from "./ampliar.js";
import { qrDataURI } from "./qr.js";
import { apodoAleatorio } from "./avatares.js";
import { huella } from "./avance.js";
import { figuras, listaPreguntas, cierre, respuestaFuente, tipoDe, coincidencia, agrupar, normal } from "./lectura-vista.js";

const LETRAS_CODIGO = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const UN_DIA = 24 * 60 * 60 * 1000;
const TOPE = 60;                 // lecturas por sesión: una clase no da para más
const LARGO = 200;               // caracteres por respuesta escrita
const GRUPOS_VISIBLES = 8;
const app = $("#app");
const params = new URLSearchParams(location.search);

let db, uid;
let codigo = null;
let soyHost = false;
let info = null;
let estado = null;
let jugadores = {};
let valen = {};                  // índice → pregunta → huella del grupo → true/false (lo decide el presentador)
let respuestasCaso = {};         // presentador: uid → { r: [...] } del caso en curso
let origen = null;               // { ruta, paquete, fuentes, imagen }
let porId = new Map();
let suscripciones = [];
let suscripcionRespuestas = null;
const vistas = new Map();        // presentador: índice → Set de preguntas con la respuesta a la vista
let esperaEnvio = 0;
let enviado = "";                // jugador: estado del último envío, para el aviso bajo las casillas

const vivoRef = (ruta = "") => ref(db, `lecturas_vivo/${codigo}${ruta ? `/${ruta}` : ""}`);
const lecturaEn = (i) => porId.get(info?.lecturas?.[i]);
const clave = (texto) => huella(normal(texto));

// ------------------------------------------------------------------ sesión local
const CLAVE_SESION = "radquiz.lectura-vivo";
function leerSesion() {
  try { return JSON.parse(localStorage.getItem(CLAVE_SESION) || "null"); } catch { return null; }
}
function guardarSesion(datos) {
  try { localStorage.setItem(CLAVE_SESION, JSON.stringify(datos)); } catch { /* sin almacenamiento */ }
}
function borrarSesion() {
  try { localStorage.removeItem(CLAVE_SESION); } catch { /* idem */ }
}
// Lo que escribió el residente en cada caso, para que una recarga no lo borre.
function misRespuestas(i) {
  try { return JSON.parse(sessionStorage.getItem(`radquiz.lv.${codigo}.${i}`) || "[]"); } catch { return []; }
}
function guardarMisRespuestas(i, lista) {
  try { sessionStorage.setItem(`radquiz.lv.${codigo}.${i}`, JSON.stringify(lista)); } catch { /* idem */ }
}

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

function encabezado() {
  $("#subtitulo").textContent = info ? info.titulo : "Lectura en vivo";
  const rol = $("#rol");
  rol.textContent = soyHost ? `Presentador · ${codigo}` : `${jugadores[uid]?.nombre || "Residente"} · ${codigo}`;
  rol.className = "chip live";
  $("#conteo").hidden = false;
  $("#conteo").textContent = `${Object.keys(jugadores).length} en la sesión`;
  qrCabecera();
}

// ------------------------------------------------------------------ entrar como residente
function pantallaUnirse(codigoInicial = "", mensaje = "") {
  $("#rol").textContent = "Sin sesión";
  $("#rol").className = "chip";
  $("#conteo").hidden = true;
  const sesion = leerSesion();
  let nombre = sesion?.nombre || "";
  try { nombre = sessionStorage.getItem("radquiz.lectura-vivo.nombre") || nombre; } catch { /* idem */ }
  app.innerHTML = `${mensaje ? `<p class="nota">${esc(mensaje)}</p>` : ""}
    <form class="panel stack angosto" id="unirse">
      <p class="eyebrow">Residentes</p>
      <h1>Entrar a la lectura</h1>
      <label class="grid-label">Código <input type="text" id="codigo" maxlength="4" autocomplete="off" autocapitalize="characters"
        spellcheck="false" value="${esc(codigoInicial)}" placeholder="ABCD" class="input-codigo"></label>
      <label class="grid-label">Tu nombre o apodo <input type="text" id="nombre" maxlength="24" autocomplete="nickname"
        placeholder="Vacío = un apodo al azar" value="${esc(nombre)}"></label>
      <button class="primary lg" type="submit">Entrar</button>
      <p class="src">Escribirás tus respuestas desde aquí. El proyector las muestra agrupadas y sin nombres. Todo se borra cuando el presentador cierra la sesión.</p>
    </form>`;
  $("#unirse").onsubmit = (e) => { e.preventDefault(); unirse($("#codigo").value, $("#nombre").value); };
  (codigoInicial ? $("#nombre") : $("#codigo")).focus();
}

async function unirse(codigoEscrito, nombreEscrito) {
  const c = codigoEscrito.trim().toUpperCase();
  let nombre = nombreEscrito.trim().replace(/\s+/g, " ");
  if (!/^[A-Z]{4}$/.test(c)) return aviso("El código tiene 4 letras.");
  const existe = await get(ref(db, `lecturas_vivo/${c}/info`)).catch(() => null);
  if (!existe || !existe.exists()) {
    // Puede ser el código de una sala de preguntas: allá se entra igual.
    const sala = await get(ref(db, `salas/${c}/info`)).catch(() => null);
    if (sala?.exists()) { location.href = `sala.html?c=${c}`; return; }
    return aviso("No hay una sesión con ese código.");
  }
  const otros = (await get(ref(db, `lecturas_vivo/${c}/jugadores`)).catch(() => null))?.val() || {};
  const previo = otros[uid] || {};
  delete otros[uid];
  if (!nombre) nombre = previo.nombre || apodoAleatorio(Object.values(otros).map((j) => j.nombre || ""));
  try {
    await set(ref(db, `lecturas_vivo/${c}/jugadores/${uid}`), { nombre, unido: serverTimestamp() });
  } catch (e) {
    return aviso("No se pudo entrar: " + e.message);
  }
  guardarSesion({ codigo: c, rol: "jugador", nombre });
  entrar(c, "jugador");
}

// ------------------------------------------------------------------ crear (presentador)
async function pantallaCrear() {
  const ruta = params.get("tema") || "";
  if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(ruta)) {
    app.innerHTML = panel("Falta el tema", "Abre la sesión desde una lectura proyectada («Abrir a los celulares»).",
      `<div class="row"><a class="boton" href="lectura.html?proyectar=1">Elegir un tema</a></div>`);
    return;
  }
  app.innerHTML = `<p class="muted">Cargando el tema…</p>`;
  let datos;
  try {
    datos = await cargarPaquete(ruta, { ocultos: true });
  } catch (e) {
    app.innerHTML = panel("No se pudo cargar el tema", e.message);
    return;
  }
  const publicadas = (datos.paquete.lecturas || []).filter((l) => l.estado === "publicado");
  let tanda = null;
  try { tanda = JSON.parse(sessionStorage.getItem("radquiz.lectura.tanda") || "null"); } catch { /* idem */ }
  const desdeProyector = tanda && tanda.ruta === ruta && Array.isArray(tanda.ids)
    ? tanda.ids.slice(Number(tanda.i) || 0).filter((id) => publicadas.some((l) => l.id === id)) : [];
  app.innerHTML = `<form class="panel stack angosto" id="config" novalidate>
    <p class="eyebrow">Presentador</p>
    <h2>Abrir la lectura a los celulares</h2>
    <p class="muted">${esc(datos.paquete.titulo)}</p>
    ${desdeProyector.length ? `<label class="row"><input type="checkbox" id="seguir" checked> Seguir con lo que estabas proyectando
      (${desdeProyector.length} ${desdeProyector.length === 1 ? "caso" : "casos"})</label>` : ""}
    <div class="campos" id="fila-nuevos">
      <label class="grid-label">Cuántos casos <input type="number" id="cuantos" min="1" max="${Math.min(TOPE, publicadas.length)}"
        value="${Math.min(5, publicadas.length)}" inputmode="numeric"></label>
      <label class="grid-label">Orden <select id="orden"><option value="libro">Como el libro</option>
        <option value="nivel">De lo básico a lo avanzado</option><option value="azar">Al azar</option></select></label>
    </div>
    <label class="row" id="fila-verificadas"><input type="checkbox" id="sin-verificar"> Incluir lecturas sin verificar</label>
    <p class="src">Cada residente escribe desde su celular; nadie ve lo de los demás con su nombre.</p>
    <div class="row"><button class="primary lg" type="submit">Abrir la sesión</button>
      <a class="boton lg" href="lectura.html?tema=${esc(ruta)}&amp;proyectar=1">Cancelar</a></div>
  </form>`;
  const refrescar = () => {
    const seguir = $("#seguir")?.checked;
    $("#fila-nuevos").hidden = Boolean(seguir);
    $("#fila-verificadas").hidden = Boolean(seguir);
  };
  if ($("#seguir")) $("#seguir").onchange = refrescar;
  refrescar();
  $("#config").onsubmit = (e) => {
    e.preventDefault();
    let ids;
    if ($("#seguir")?.checked) {
      ids = desdeProyector.slice(0, TOPE);
    } else {
      let lista = publicadas.filter((l) => $("#sin-verificar").checked || l.revisor);
      if (!lista.length) return aviso("Ninguna lectura verificada: marca «Incluir lecturas sin verificar».");
      const cuantos = Math.max(1, Math.min(Number($("#cuantos").value) || 5, TOPE, lista.length));
      const orden = $("#orden").value;
      if (orden === "azar") lista = barajar(lista).slice(0, cuantos);
      else {
        if (orden === "nivel") lista = lista.map((l, i) => [l, i]).sort((a, b) => nivelDe(a[0]) - nivelDe(b[0]) || a[1] - b[1]).map(([l]) => l);
        lista = lista.slice(0, cuantos);
      }
      ids = lista.map((l) => l.id);
    }
    crear(ruta, datos.paquete.titulo, ids).catch((err) => aviso("No se pudo abrir la sesión: " + err.message));
  };
}

function codigoAleatorio() {
  const numeros = crypto.getRandomValues(new Uint32Array(4));
  return [...numeros].map((n) => LETRAS_CODIGO[n % LETRAS_CODIGO.length]).join("");
}

async function limpiarViejas() {
  try {
    const lista = (await get(ref(db, "indice_lecturas_vivo"))).val() || {};
    for (const [viejo, creada] of Object.entries(lista)) {
      if (creada < Date.now() - UN_DIA) {
        await remove(ref(db, `lecturas_vivo/${viejo}`)).catch(() => {});
        await remove(ref(db, `indice_lecturas_vivo/${viejo}`)).catch(() => {});
      }
    }
  } catch { /* la limpieza es un extra */ }
}

async function crear(ruta, titulo, ids) {
  if (!ids.length) return aviso("No hay lecturas para la sesión.");
  await limpiarViejas();
  for (let intento = 0; intento < 8; intento++) {
    const nuevo = codigoAleatorio();
    // El código tampoco puede ser el de una sala de preguntas: la portada lleva a las dos con la misma casilla.
    const sala = await get(ref(db, `salas/${nuevo}/info`)).catch(() => null);
    if (sala?.exists()) continue;
    try {
      await set(ref(db, `lecturas_vivo/${nuevo}`), {
        info: { host: uid, creada: serverTimestamp(), tema: ruta, titulo: titulo.slice(0, 120), lecturas: ids },
        estado: { fase: "lobby", indice: 0 },
      });
    } catch {
      continue;   // código ocupado: otro
    }
    await set(ref(db, `indice_lecturas_vivo/${nuevo}`), serverTimestamp()).catch(() => {});
    guardarSesion({ codigo: nuevo, rol: "host" });
    history.replaceState(null, "", "lectura-vivo.html");
    return entrar(nuevo, "host");
  }
  throw new Error("no encontré un código libre; intenta de nuevo");
}

// ------------------------------------------------------------------ dentro
async function entrar(c, rol) {
  codigo = c;
  const snap = await get(vivoRef("info")).catch(() => null);
  if (!snap || !snap.exists()) {
    borrarSesion();
    return pantallaUnirse("", "Esa sesión ya no existe.");
  }
  info = snap.val();
  soyHost = rol === "host" && info.host === uid;
  if (!soyHost) {
    const yo = await get(vivoRef(`jugadores/${uid}`)).catch(() => null);
    if (!yo || !yo.exists()) return pantallaUnirse(c);
  }
  try {
    origen = { ruta: info.tema, ...(await cargarPaquete(info.tema, { ocultos: true })) };
  } catch {
    return (app.innerHTML = panel("El tema ya no está", `La sesión ${c} usa un tema que ya no está publicado.`));
  }
  porId = new Map((origen.paquete.lecturas || []).map((l) => [l.id, l]));
  suscripciones.forEach((u) => u());
  suscripciones = [
    onValue(vivoRef("estado"), (s) => {
      const previo = estado;
      estado = s.val();
      if (!estado) return cerrada();
      if (soyHost && (!previo || previo.indice !== estado.indice || previo.fase !== estado.fase)) escucharRespuestas();
      if (!soyHost && previo && previo.fase === "leer" && estado.fase !== "leer") {
        clearTimeout(esperaEnvio);
        enviar(previo.indice, true);
      }
      // El aviso de envío es del caso en que se escribió: en el siguiente decía «Enviado» sin haber escrito nada.
      if (!previo || previo.indice !== estado.indice) enviado = "";
      dibujar();
    }),
    onValue(vivoRef("jugadores"), (s) => { jugadores = s.val() || {}; dibujar(); }),
    onValue(vivoRef("valen"), (s) => { valen = s.val() || {}; dibujar(); }),
  ];
}

function escucharRespuestas() {
  if (suscripcionRespuestas) suscripcionRespuestas();
  suscripcionRespuestas = null;
  respuestasCaso = {};
  if (!estado || !["leer", "pagina"].includes(estado.fase)) return;
  suscripcionRespuestas = onValue(vivoRef(`respuestas/${estado.indice}`), (s) => { respuestasCaso = s.val() || {}; dibujar(); });
}

function cerrada() {
  suscripciones.forEach((u) => u());
  suscripciones = [];
  borrarSesion();
  app.innerHTML = panel("La sesión terminó", "El presentador la cerró.",
    `<div class="row"><a class="boton primary" href="lectura.html?tema=${esc(info?.tema || "")}">Leer el tema a mi ritmo</a><a class="boton" href="./">Inicio</a></div>`);
}

// Redibuja sin perder lo que se está escribiendo ni el lugar en la página.
let vistaActual = "";
function dibujar() {
  if (!info || !estado) return;
  encabezado();
  const firma = `${estado.fase}:${estado.indice}`;
  if (!soyHost && firma === vistaActual && estado.fase === "leer") return pintarEnvio();
  const y = firma === vistaActual ? scrollY : 0;
  vistaActual = firma;
  if (soyHost) dibujarHost(); else dibujarJugador();
  window.scrollTo({ top: y });
}

// ------------------------------------------------------------------ proyector
function enlaceSesion() {
  const base = `${origenPublico()}/lectura-vivo.html`;
  return { base, enlace: `${base}?c=${codigo}` };
}

let qrHecho = { enlace: null, fuente: null };
function fuenteQR() {
  if (!/^https?:$/.test(location.protocol)) return null;
  const { enlace } = enlaceSesion();
  if (qrHecho.enlace !== enlace) {
    let fuente = null;
    try { fuente = qrDataURI(enlace); } catch { /* sin QR */ }
    qrHecho = { enlace, fuente };
  }
  return qrHecho.fuente;
}

function qrCabecera() {
  const boton = $("#qrMini");
  const fuente = soyHost && estado && !["lobby", "fin"].includes(estado.fase) ? fuenteQR() : null;
  boton.hidden = !fuente;
  if (fuente && boton.dataset.codigo !== codigo) {
    boton.dataset.codigo = codigo;
    boton.title = "Ampliar el QR para entrar";
    boton.innerHTML = `<img src="${fuente}" alt=""><span>Entrar<b>${esc(codigo)}</b></span>`;
  }
}

function ampliarQR() {
  const fuente = fuenteQR();
  if (!fuente) return;
  const { base } = enlaceSesion();
  const capa = $("#zoomQR");
  capa.innerHTML = `<figure class="qr-grande"><img src="${fuente}" alt="Código QR con el enlace a la sesión ${esc(codigo)}">
    <figcaption><p class="tema">Código</p><div class="codigo">${esc(codigo)}</div>
      <p class="muted">Escanea con la cámara, o entra a</p><p class="direccion">${esc(base.replace(/^https?:\/\//, ""))}</p>
      <p class="muted">y escribe el código.</p><p class="src">Toca en cualquier parte o pulsa Esc para volver.</p></figcaption></figure>`;
  capa.hidden = false;
}

function dibujarHost() {
  if (estado.fase === "lobby") return hostLobby();
  if (estado.fase === "fin") return hostFin();
  const lectura = lecturaEn(estado.indice);
  if (!lectura) return (app.innerHTML = panel("Falta la lectura", "Esta lectura ya no está publicada. Pasa a la siguiente."));
  if (estado.fase === "leer") return hostLeer(lectura);
  return hostPagina(lectura);
}

function hostLobby() {
  const { base, enlace } = enlaceSesion();
  const ids = Object.keys(jugadores);
  const fuente = fuenteQR();
  app.innerHTML = `<section class="lobby">
    <div class="panel">
      <p class="tema">Código de la lectura</p>
      <div class="entrada">
        <div>
          <div class="codigo">${esc(codigo)}</div>
          <div class="como-entrar"><p class="muted">Entren a</p><p class="direccion">${esc(base.replace(/^https?:\/\//, ""))}</p>
            <p class="muted">y escriban el código.</p></div>
        </div>
        ${fuente ? `<figure class="qr"><img src="${fuente}" alt="Código QR con el enlace a la sesión ${esc(codigo)}" data-qr>
          <figcaption>Escanea con la cámara<br>y entras directo · Toca para ampliar</figcaption></figure>` : ""}
      </div>
      <p class="src">Enlace directo: ${esc(enlace)}</p>
      <p class="muted">${esc(info.titulo)} · ${info.lecturas.length} ${info.lecturas.length === 1 ? "caso" : "casos"} para leer</p>
      <div class="row"><button class="primary lg" id="empezar">Empezar</button><button class="lg" id="cerrar">Cerrar la sesión</button></div>
    </div>
    <div class="panel">
      <h2>Conectados: <span class="cuenta">${ids.length}</span></h2>
      ${ids.length ? `<div class="players">${ids.map((id) => `<span class="pl">${esc(jugadores[id].nombre || "?")}</span>`).join("")}</div>`
        : `<p class="esperando"><i><b></b></i>Esperando residentes…</p>`}
      <p class="src">Sin celulares o sin red, se puede empezar igual y responder en voz alta.</p>
    </div>
  </section>`;
  $("#empezar").onclick = () => irA({ fase: "leer", indice: 0 });
  $("#cerrar").onclick = cerrarSesion;
  app.querySelector("[data-qr]")?.addEventListener("click", ampliarQR);
}

function cuantosRespondieron() {
  return Object.values(respuestasCaso).filter((r) => Object.values(r?.r || {}).some((x) => String(x).trim())).length;
}

function hostLeer(lectura) {
  const total = Object.keys(jugadores).length;
  app.innerHTML = `<div class="qhead"><span class="qnum">${estado.indice + 1}<small> / ${info.lecturas.length}</small></span>
      <span class="lec-paso">Página 1 · El caso</span><span class="spacer"></span>
      <span class="lv-respondieron">${cuantosRespondieron()} de ${total} escribieron</span></div>
    <article class="lec-hoja lec-p1">
      <header class="lec-cabeza"><p class="eyebrow">Caso ${estado.indice + 1}</p><h2 class="lec-presentacion">${esc(lectura.presentacion)}</h2></header>
      <div class="lec-cuerpo">
        ${figuras(lectura, origen, "pregunta", { clase: "lec-limpias" })}
        <div class="lec-lado">${listaPreguntas(lectura)}
          <div class="row"><button class="primary lg" id="pasar">Pasar la página</button></div></div>
      </div>
    </article>
    <div class="ctrl"><span class="spacer"></span><span class="src teclas"><kbd>→</kbd> pasar la página</span></div>`;
  $("#pasar").onclick = () => irA({ fase: "pagina", indice: estado.indice, pasada: serverTimestamp() });
}

// Para cada grupo: vale si el presentador lo marcó; si no lo tocó, sale sugerido cuando coincide con una aceptada.
function validez(i, q, grupo) {
  const marca = valen?.[i]?.[q]?.[huella(grupo.clave)];
  if (marca === true) return "vale";
  if (marca === false) return "no";
  return grupo.coincide ? "sugerido" : "";
}

function gruposDe(lectura, q) {
  const lista = Object.entries(respuestasCaso).map(([id, r]) => [id, String(r?.r?.[q] ?? "")]).filter(([, x]) => x.trim());
  return agrupar(lista, lectura.preguntas[q].aceptadas || []);
}

function bloqueGrupos(lectura, q) {
  const grupos = gruposDe(lectura, q);
  const total = grupos.reduce((n, g) => n + g.n, 0);
  if (!total) return `<p class="lv-resumen-q">Nadie escribió esta.</p>`;
  const buenas = grupos.filter((g) => ["vale", "sugerido"].includes(validez(estado.indice, q, g))).reduce((n, g) => n + g.n, 0);
  const visibles = grupos.slice(0, GRUPOS_VISIBLES);
  const resto = grupos.slice(GRUPOS_VISIBLES).reduce((n, g) => n + g.n, 0);
  return `<p class="lv-resumen-q">${total} ${total === 1 ? "respuesta" : "respuestas"}${buenas ? ` · ${buenas} dan en el blanco` : ""}</p>
    <ul class="lv-grupos">${visibles.map((g) => {
      const v = validez(estado.indice, q, g);
      return `<li class="lv-grupo ${v}">
        <span class="lv-texto">${esc(g.texto)}</span><span class="n">${g.n}</span>
        <button type="button" data-q="${q}" data-k="${esc(huella(g.clave))}" data-v="${v === "vale" || v === "sugerido" ? "no" : "vale"}">
          ${v === "vale" || v === "sugerido" ? "No vale" : "Vale"}</button>
        <span class="lv-barra"><i style="width:${Math.round((100 * g.n) / total)}%"></i></span>
      </li>`;
    }).join("")}</ul>
    ${resto ? `<p class="lv-resumen-q">y ${resto} más, cada una distinta</p>` : ""}`;
}

function hostPagina(lectura) {
  const abiertas = vistas.get(estado.indice) || new Set();
  const anotadas = figuras(lectura, origen, "respuesta", { clase: "lec-anotadas" });
  const ultima = estado.indice >= info.lecturas.length - 1;
  app.innerHTML = `<div class="qhead"><span class="qnum">${estado.indice + 1}<small> / ${info.lecturas.length}</small></span>
      <span class="lec-paso dos">Página 2 · Respuestas</span><span class="spacer"></span>
      <span class="lv-respondieron">${cuantosRespondieron()} escribieron</span></div>
    <article class="lec-hoja lec-p2">
      <header class="lec-cabeza"><p class="eyebrow">Caso ${estado.indice + 1} · ${esc(lectura.presentacion)}</p>
        <h2 class="lec-diagnostico">${esc(lectura.tema)}</h2></header>
      ${anotadas || figuras(lectura, origen, "pregunta", { clase: "lec-anotadas" })}
      <div class="row"><button type="button" id="mostrar-todas">Mostrar todas las respuestas <kbd>A</kbd></button></div>
      <ol class="lec-respuestas">${lectura.preguntas.map((p, q) => `<li class="lec-r" data-i="${q}">
        <p class="lec-tipo">${esc(tipoDe(p))}</p><p class="lec-enunciado">${esc(p.pregunta)}</p>
        ${abiertas.has(q) ? `${respuestaFuente(p)}${p.puntos_clave?.length ? `<ul class="lec-puntos-lista">${p.puntos_clave.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
          <div class="lv-sala"><span class="lec-rotulo">Lo que dijo la sala</span>${bloqueGrupos(lectura, q)}</div>`
          : `<button type="button" class="lec-mostrar" data-mostrar="${q}">Mostrar la respuesta y lo que dijo la sala <kbd>${q + 1}</kbd></button>`}
      </li>`).join("")}</ol>
      ${cierre(lectura)}
    </article>
    <div class="ctrl">
      <button id="anterior" ${estado.indice === 0 ? "disabled" : ""}>Caso anterior</button>
      <button class="primary" id="siguiente">${ultima ? "Terminar" : "Siguiente caso"}</button>
      <span class="spacer"></span><span class="src teclas"><kbd>1</kbd>–<kbd>8</kbd> respuesta · <kbd>A</kbd> todas · <kbd>→</kbd> siguiente</span>
    </div>`;
  app.querySelectorAll("[data-mostrar]").forEach((b) => { b.onclick = () => mostrar(Number(b.dataset.mostrar)); });
  $("#mostrar-todas").onclick = () => lectura.preguntas.forEach((_, q) => mostrar(q));
  app.querySelectorAll(".lv-grupo button").forEach((b) => {
    b.onclick = () => set(vivoRef(`valen/${estado.indice}/${b.dataset.q}/${b.dataset.k}`), b.dataset.v === "vale")
      .catch((e) => aviso("No se pudo marcar: " + e.message));
  });
  $("#anterior").onclick = () => irA({ fase: "pagina", indice: estado.indice - 1 });
  $("#siguiente").onclick = () => irA(ultima ? { fase: "fin", indice: estado.indice } : { fase: "leer", indice: estado.indice + 1 });
}

function mostrar(q) {
  if (!vistas.has(estado.indice)) vistas.set(estado.indice, new Set());
  vistas.get(estado.indice).add(q);
  vistaActual = "";   // redibuja conservando el lugar
  const y = scrollY;
  dibujarHost();
  vistaActual = `${estado.fase}:${estado.indice}`;
  window.scrollTo({ top: y });
}

function hostFin() {
  app.innerHTML = panel("Fin de la lectura", `Se leyeron ${info.lecturas.length} ${info.lecturas.length === 1 ? "caso" : "casos"}. Cierra la sesión para borrar las respuestas.`,
    `<div class="row"><button class="primary lg" id="cerrar">Cerrar la sesión</button>
      <button class="lg" id="volver">Volver al último caso</button></div>`);
  $("#cerrar").onclick = cerrarSesion;
  $("#volver").onclick = () => irA({ fase: "pagina", indice: estado.indice });
}

function irA(nuevo) {
  return set(vivoRef("estado"), nuevo).catch((e) => aviso("No se pudo avanzar: " + e.message));
}

async function cerrarSesion() {
  if (!confirm("¿Cerrar la sesión? Se borran las respuestas de todos.")) return;
  const c = codigo;
  suscripciones.forEach((u) => u());
  suscripciones = [];
  if (suscripcionRespuestas) suscripcionRespuestas();
  await remove(vivoRef()).catch(() => {});
  await remove(ref(db, `indice_lecturas_vivo/${c}`)).catch(() => {});
  borrarSesion();
  location.href = `lectura.html?tema=${encodeURIComponent(info.tema).replace("%2F", "/")}&proyectar=1`;
}

// ------------------------------------------------------------------ celular
function dibujarJugador() {
  const nombre = jugadores[uid]?.nombre || "";
  if (estado.fase === "lobby") {
    app.innerHTML = panel(`Estás dentro${nombre ? `, ${nombre}` : ""}`, "Espera a que el presentador empiece. Vas a ver el caso y escribir tus respuestas aquí.");
    return;
  }
  if (estado.fase === "fin") {
    app.innerHTML = panel("Terminó la lectura", "Gracias por participar.",
      `<div class="row"><a class="boton primary" href="lectura.html?tema=${esc(info.tema)}">Leer el tema a mi ritmo</a></div>`);
    return;
  }
  const lectura = lecturaEn(estado.indice);
  if (!lectura) return (app.innerHTML = panel("Un momento", "Esta lectura no está disponible."));
  if (estado.fase === "leer") return jugadorLeer(lectura);
  return jugadorPagina(lectura);
}

function jugadorLeer(lectura) {
  const indice = estado.indice;
  const mias = misRespuestas(indice);
  app.innerHTML = `<div class="qhead"><span class="qnum">${estado.indice + 1}<small> / ${info.lecturas.length}</small></span>
      <span class="lec-paso">Página 1 · El caso</span></div>
    <article class="lec-hoja lec-p1">
      <header class="lec-cabeza"><h2 class="lec-presentacion">${esc(lectura.presentacion)}</h2></header>
      ${figuras(lectura, origen, "pregunta", { clase: "lec-limpias" })}
      ${listaPreguntas(lectura, (q) => `<label class="visualmente-oculto" for="r${q}">Tu respuesta a la pregunta ${q + 1}</label>
        <textarea id="r${q}" class="lec-campo" data-q="${q}" rows="2" maxlength="${LARGO}" placeholder="Tu respuesta">${esc(mias[q] || "")}</textarea>`)}
      <p class="src" id="envio" aria-live="polite"></p>
    </article>`;
  app.querySelectorAll(".lec-campo").forEach((campo) => {
    campo.oninput = () => {
      const lista = misRespuestas(indice);
      lista[Number(campo.dataset.q)] = campo.value;
      guardarMisRespuestas(indice, lista);
      enviado = "escribiendo";
      pintarEnvio();
      clearTimeout(esperaEnvio);
      esperaEnvio = setTimeout(() => enviar(indice), 900);
    };
    campo.onblur = () => { clearTimeout(esperaEnvio); enviar(indice); };
  });
  pintarEnvio();
}

function pintarEnvio() {
  const nodo = $("#envio");
  if (!nodo) return;
  nodo.textContent = enviado === "ok" ? "✓ Enviado. Puedes corregir hasta que el presentador pase la página."
    : enviado === "escribiendo" ? "Escribiendo…"
    : enviado === "error" ? "No se pudo enviar: revisa la conexión. Lo escrito sigue aquí."
    : "Lo que escribas se envía solo. Nadie lo ve con tu nombre.";
}

// El último envío sale cuando el presentador ya pasó la página: las reglas lo admiten unos segundos después
// (estado.pasada), para no perder lo escrito en el último segundo.
async function enviar(indice, ultima = false) {
  const lista = misRespuestas(indice).map((x) => String(x ?? "").slice(0, LARGO));
  if (!lista.some((x) => x.trim())) return;
  let ok = true;
  try {
    await set(vivoRef(`respuestas/${indice}/${uid}`), { r: lista.map((x) => x || ""), t: serverTimestamp() });
  } catch {
    ok = false;
  }
  // Solo avisa en el caso que se está escribiendo; fuera de tiempo no es un error que mostrar.
  if (ultima || estado?.indice !== indice || estado?.fase !== "leer") return;
  enviado = ok ? "ok" : "error";
  pintarEnvio();
}

function jugadorPagina(lectura) {
  const mias = misRespuestas(estado.indice);
  const anotadas = figuras(lectura, origen, "respuesta", { clase: "lec-anotadas" });
  app.innerHTML = `<div class="qhead"><span class="qnum">${estado.indice + 1}<small> / ${info.lecturas.length}</small></span>
      <span class="lec-paso dos">Página 2 · Respuestas</span></div>
    <article class="lec-hoja lec-p2">
      <header class="lec-cabeza"><h2 class="lec-diagnostico">${esc(lectura.tema)}</h2></header>
      ${anotadas || figuras(lectura, origen, "pregunta", { clase: "lec-anotadas" })}
      <ol class="lec-respuestas">${lectura.preguntas.map((p, q) => {
        const mia = String(mias[q] || "").trim();
        const marca = mia ? valen?.[estado.indice]?.[q]?.[clave(mia)] : undefined;
        const coincide = mia && p.aceptadas?.length ? coincidencia(mia, p.aceptadas) : null;
        const estadoMio = marca === true || (marca === undefined && coincide) ? "vale" : marca === false ? "no" : "";
        return `<li class="lec-r ${estadoMio === "vale" ? "nota-completa" : ""}">
          <p class="lec-tipo">${esc(tipoDe(p))}</p><p class="lec-enunciado">${esc(p.pregunta)}</p>
          <div class="lec-par">
            <div class="lec-mia ${mia ? "" : "vacia"}"><span class="lec-rotulo">Tu respuesta</span><p>${mia ? esc(mia) : "No la escribiste."}</p>
              ${estadoMio === "vale" ? `<p class="lv-mi-nota vale">${marca === true ? "El presentador la da por buena" : `Coincide con «${esc(coincide)}»`}</p>`
                : estadoMio === "no" ? `<p class="lv-mi-nota no">El presentador no la dio por buena</p>` : ""}</div>
            ${respuestaFuente(p)}
          </div>
          ${p.puntos_clave?.length ? `<ul class="lec-puntos-lista">${p.puntos_clave.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
        </li>`;
      }).join("")}</ol>
      ${cierre(lectura)}
    </article>`;
}

// ------------------------------------------------------------------ inicio
async function iniciar() {
  activarAmpliacion();
  if (!firebaseConfig) {
    app.innerHTML = panel("Sin configurar", "Falta la configuración de Firebase en app/firebase-config.js.");
    return;
  }
  const fb = getApps().find((a) => a.name === APP_ANONIMA) || initializeApp(firebaseConfig, APP_ANONIMA);
  db = getDatabase(fb);
  const auth = getAuth(fb);
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
  if (params.has("crear") && !pedido) return pantallaCrear();
  pantallaUnirse(pedido);
}

$("#qrMini").onclick = ampliarQR;
$("#zoomQR").onclick = () => { $("#zoomQR").hidden = true; };
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") $("#zoomQR").hidden = true;
  if (!soyHost || !estado || e.ctrlKey || e.metaKey || e.altKey) return;
  const destino = e.target instanceof Element ? e.target : document.body;
  if (destino.closest("input, textarea, select")) return;
  if (e.key === "ArrowRight") {
    if (estado.fase === "leer") $("#pasar")?.click();
    else $("#siguiente")?.click();
  } else if (e.key === "ArrowLeft" && estado.fase === "pagina") {
    $("#anterior")?.click();
  } else if (estado.fase === "pagina" && /^[1-8]$/.test(e.key)) {
    const q = Number(e.key) - 1;
    if (q < (lecturaEn(estado.indice)?.preguntas.length || 0)) mostrar(q);
  } else if (estado.fase === "pagina" && e.key.toLowerCase() === "a") {
    $("#mostrar-todas")?.click();
  }
});

iniciar();
