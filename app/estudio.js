// RadQuiz — estudio: crear temas, revisarlos y publicarlos desde la web, sin programas ni Git.
// El contenido en preparación vive en Firebase. Al publicar se escribe «publicacion», que la web lee
// al instante, y «indice_publicado», la lista corta que la portada consulta de una sola vez.
// El repositorio se pone al día después, por su cuenta: nadie espera a que lo haga.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, reauthenticateWithPopup, signInAnonymously, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getDatabase, ref, get, set, update, remove, onValue, push, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";
import { $, esc, md, SEGMENTOS, credito, NIVELES } from "./comun.js";
import { AREAS } from "./areas.js";
import {
  LICENCIAS, TIPOS_FUENTE, MODALIDADES, lista, slug, idImagen, validarTema, validarCaso, validarLectura, casosOrdenados,
  lecturasOrdenadas, imagenesOrdenadas, estadoVerificacion, aPaquete, entradaIndice, clasificacionDe, nombreClasificacion,
  normalizarClasificacion, normalizarDificultad, pareceRequerirOpciones, TIPOS_PREGUNTA,
} from "./validacion.js";
import {
  instruccionesIA, instruccionesCorreccion, instruccionesPaquete, instruccionesContinuar, leerRespuestaIA, planDeCarga,
  instruccionesLecturas, instruccionesCorreccionLecturas,
} from "./instrucciones-ia.js";
import { crearZip, descargarArchivo, bytesDeDataURL } from "./zip.js";
import { indiceDePaquete } from "./cuestionario.js";
import { activarAmpliacion } from "./ampliar.js";
import { comprimir, abrirZip } from "./importar.js";
import {
  ALCANCE_DRIVE, ID_DRIVE, enlaceCarpeta, existeEnDrive, carpetaDelTema, archivosDeCarpeta, subirFigura,
  aLaPapelera, huella, comprobarLectura,
} from "./drive.js";

const LETRAS = "ABCDE";
const ESTADOS = {
  borrador: { texto: "En preparación", clase: "borrador" },
  publicado: { texto: "Publicado", clase: "publicado" },
};
const app = $("#app");
// La sala en vivo deja una sesión anónima en el navegador; en el estudio siempre se entra con Google.
const modoPrueba = ["localhost", "127.0.0.1"].includes(location.hostname) && new URLSearchParams(location.search).has("prueba");

let db, auth, usuario = null, perfil = null;
let temas = {}, solicitudes = {}, miembros = {}, verificaciones = {}, reportes = {};
let imagenesTema = {};      // dataURL por id de imagen del tema abierto
let temaAbierto = null;
let paso = "fuente";
let editando = null;        // id del caso que se está editando (bloquea el redibujado)
let cargandoImagenes = false;
let ordenVerificacion = null;   // el orden se fija al abrir el tema para que no salte al decidir
let modoVerificar = false;      // un revisor puede sellar también sus propios temas
let importado = null;           // el .zip ya leído, esperando que el autor confirme que lo crea
let creando = false;            // mientras suben las imágenes del .zip no se redibuja: se perdería el avance
let publicando = null;          // texto del avance mientras se publica; impide publicar dos veces a la vez
let marcados = new Set();       // casos marcados en el paso 3 para clasificarlos en bloque
let bloque = { segmento: "", area: "" };   // lo último elegido para clasificar en bloque: sobrevive al redibujado
let bloqueNivel = "";                       // ídem, para la dificultad
let seguir = null;              // la respuesta de la IA llegó cortada: { mensaje, texto, de } para pedirle el resto
let editandoLectura = null;     // id de la lectura que se está editando (bloquea el redibujado, como «editando»)
let vista3 = null;              // en el paso 3: "casos" o "lecturas"; null = la que tenga el tema
let verTodasImportadas = false; // un libro trae cientos de figuras: al importar se enseñan las primeras

const hoy = () => new Date().toISOString().slice(0, 10);
const esCoord = () => perfil?.rol === "coordinador";
const esRevisor = () => perfil?.rol === "revisor" || esCoord();
const soyAutor = (t) => t?.meta?.autor_uid === usuario?.uid;
const puedeEditar = (t) => t && (esCoord() || soyAutor(t));
// Casos y lecturas comparten «verificacion/<tema>/<id>» y «reportes/<tema>/<id>»: los ids no se repiten entre ellos.
const vercaso = (temaId, casoId) => (verificaciones[temaId] || {})[casoId];
const elemento = (t, id) => t.casos[id] || t.lecturas[id];
const enEdicion = () => Boolean(editando || editandoLectura);
const reportesDe = (temaId, casoId) => Object.values((reportes[temaId] || {})[casoId] || {});
const sinPublicar = (t) => t.meta.estado === "publicado" && (t.meta.actualizado || 0) > (t.meta.publicado_en || 0);

// ------------------------------------------------------------------ utilidades
function aviso(texto, malo = false) {
  const nodo = document.createElement("div");
  nodo.className = "chip toast" + (malo ? " malo" : "");
  nodo.textContent = texto;
  document.body.append(nodo);
  setTimeout(() => nodo.remove(), 5000);
}

async function copiar(texto, mensaje = "Copiado. Pégalo en tu IA.") {
  try {
    await navigator.clipboard.writeText(texto);
    return aviso(mensaje);
  } catch { /* sin permiso del navegador: se intenta a la antigua */ }
  const caja = document.createElement("textarea");
  caja.value = texto;
  caja.style.cssText = "position:fixed;opacity:0";
  document.body.append(caja);
  caja.select();
  let copiado = false;
  try { copiado = document.execCommand("copy"); } catch { copiado = false; }
  caja.remove();
  if (copiado) return aviso(mensaje);
  mostrarParaCopiar(texto);
}

// Último recurso: se muestra el texto ya seleccionado para copiarlo a mano.
function mostrarParaCopiar(texto) {
  const fondo = document.createElement("div");
  fondo.className = "zoom";
  fondo.innerHTML = `<div class="panel" style="display:grid;gap:10px;max-width:760px;width:100%" onclick="event.stopPropagation()">
    <h3>Copia este texto y pégalo en tu IA</h3>
    <textarea rows="12" readonly></textarea>
    <div class="row"><button class="primary">Cerrar</button></div></div>`;
  fondo.querySelector("textarea").value = texto;
  fondo.onclick = () => fondo.remove();
  document.body.append(fondo);
  const caja = fondo.querySelector("textarea");
  caja.focus();
  caja.select();
}

// Última oportunidad para lo que no se puede deshacer: además de decir qué desaparece, hay que
// escribir la palabra. Un «¿estás seguro?» a secas se acepta sin leerlo.
function confirmarPeligro({ titulo, cuerpo, palabra = "BORRAR", boton = "Borrar" }) {
  return new Promise((resolver) => {
    const fondo = document.createElement("div");
    fondo.className = "zoom";
    fondo.innerHTML = `<div class="panel peligro" role="alertdialog" aria-modal="true" aria-labelledby="p-titulo">
      <h3 id="p-titulo"></h3>
      ${cuerpo}
      <label class="grid-label"><span>Escribe <b>${esc(palabra)}</b> para confirmar</span>
        <input type="text" id="p-palabra" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
      <div class="row"><button id="p-no">Cancelar</button>
        <button class="peligrosa" id="p-si" disabled>${esc(boton)}</button></div>
    </div>`;
    fondo.querySelector("#p-titulo").textContent = titulo;
    const caja = fondo.querySelector("#p-palabra");
    const si = fondo.querySelector("#p-si");
    const tecla = (e) => { if (e.key === "Escape") cerrar(false); };
    const cerrar = (valor) => {
      document.removeEventListener("keydown", tecla);
      fondo.remove();
      resolver(valor);
    };
    caja.oninput = () => { si.disabled = caja.value.trim().toUpperCase() !== palabra; };
    caja.onkeydown = (e) => { if (e.key === "Enter" && !si.disabled) { e.preventDefault(); cerrar(true); } };
    fondo.querySelector("#p-no").onclick = () => cerrar(false);
    si.onclick = () => cerrar(true);
    fondo.onclick = (e) => { if (e.target === fondo) cerrar(false); };
    document.addEventListener("keydown", tecla);
    document.body.append(fondo);
    caja.focus();
  });
}

function chipEstado(estado) {
  const e = ESTADOS[estado] || ESTADOS.borrador;
  return `<span class="badge ${e.clase}">${e.texto}</span>`;
}

function problemasHTML(problemas) {
  if (!problemas?.length) return "";
  return `<ul class="problemas">${problemas.map((p) => `<li class="${p.tipo}">${esc(p.texto)}</li>`).join("")}</ul>`;
}

function normalizarTema(id, bruto) {
  const t = JSON.parse(JSON.stringify(bruto || {}));
  t.id = id;
  t.meta = t.meta || {};
  t.fuente = t.fuente || {};
  t.imagenes = t.imagenes || {};
  t.casos = t.casos || {};
  t.lecturas = t.lecturas || {};
  t.revision = t.revision || {};
  for (const c of Object.values(t.casos)) {
    c.opciones = lista(c.opciones);
    c.imagenes = lista(c.imagenes);
    c.evidencia = lista(c.evidencia);
    c.etiquetas = lista(c.etiquetas);
    c.clasificacion = lista(c.clasificacion);
  }
  for (const l of Object.values(t.lecturas)) {
    l.imagenes = lista(l.imagenes);
    l.preguntas = lista(l.preguntas).map((q) => ({ ...q, puntos_clave: lista(q.puntos_clave), aceptadas: lista(q.aceptadas) }));
    l.perlas = lista(l.perlas);
    l.evidencia = lista(l.evidencia);
    l.etiquetas = lista(l.etiquetas);
    l.clasificacion = lista(l.clasificacion);
  }
  for (const i of Object.values(t.imagenes)) {
    i.paneles = lista(i.paneles);
    i.marcas = lista(i.marcas);
    i.modificaciones = lista(i.modificaciones);
  }
  return t;
}

function temaActual() {
  return temaAbierto && temas[temaAbierto] ? normalizarTema(temaAbierto, temas[temaAbierto]) : null;
}

async function guardarMeta(id, cambios) {
  await update(ref(db, `estudio/${id}/meta`), { ...cambios, actualizado: serverTimestamp() });
}

// ------------------------------------------------------------------ Google Drive del autor
// Las figuras publicadas se alojan en el Drive de quien publica (app/drive.js). El permiso se pide al
// publicar, no al entrar: quien solo revisa no lo necesita. Google lo da por una hora.
let permisoDrive = null;   // { token, vence }

function mensajeDePermiso(e) {
  const codigo = e?.code || "";
  if (codigo === "auth/user-mismatch") return "En la ventana de Google elige la misma cuenta con la que entraste al estudio.";
  if (codigo === "auth/popup-blocked") return "El navegador bloqueó la ventana de Google: permite las ventanas emergentes de este sitio.";
  if (codigo === "auth/popup-closed-by-user" || codigo === "auth/cancelled-popup-request") {
    return "Se cerró la ventana de Google sin dar permiso para tu Drive.";
  }
  return `No se pudo pedir permiso para tu Drive (${codigo || e?.message || "error desconocido"}).`;
}

async function tokenDrive() {
  if (permisoDrive && permisoDrive.vence > Date.now()) return permisoDrive.token;
  const proveedor = new GoogleAuthProvider();
  proveedor.addScope(ALCANCE_DRIVE);
  if (usuario?.email) proveedor.setCustomParameters({ login_hint: usuario.email });
  let resultado;
  try {
    resultado = await reauthenticateWithPopup(auth.currentUser, proveedor);
  } catch (e) {
    throw new Error(mensajeDePermiso(e));
  }
  const token = GoogleAuthProvider.credentialFromResult(resultado)?.accessToken;
  if (!token) throw new Error("Google no entregó el permiso para tu Drive. Vuelve a intentarlo.");
  permisoDrive = { token, vence: Date.now() + 50 * 60 * 1000 };
  return token;
}

// ¿La carpeta de Drive del tema es de quien está usando el estudio? Es de quien publicó por última vez:
// normalmente el autor, o el coordinador si publicó él.
const driveEsMio = (t) => ID_DRIVE.test(t?.meta?.drive_carpeta || "") && t.meta.drive_uid === usuario?.uid;

// Sube al Drive de quien publica las figuras que usa el tema. Una figura que ya subió antes y no cambió se
// reutiliza, así que volver a publicar no llena el Drive de copias; lo que el tema ya no usa va a la papelera.
// Cada paso se anota en cuanto ocurre: si algo falla a mitad, volver a publicar retoma lo ya subido.
async function subirAlDrive(t, ids, token, avance) {
  const anterior = driveEsMio(t) ? t.meta.drive_carpeta : "";
  const carpeta = await carpetaDelTema(token, { anterior, nombre: `RadQuiz · ${t.meta.titulo}` });
  if (carpeta !== anterior) {
    await update(ref(db, `estudio/${t.id}/meta`), { drive_carpeta: carpeta, drive_uid: usuario.uid, drive_nombre: perfil.nombre });
  }
  const drive = {};
  let n = 0;
  for (const id of ids) {
    avance(`Subiendo a tu Drive… ${++n} de ${ids.length}`);
    const bytes = bytesDeDataURL(imagenesTema[id]);
    const firma = await huella(bytes);
    const previo = t.imagenes[id]?.drive;
    if (previo?.carpeta === carpeta && previo.huella === firma && (await existeEnDrive(token, previo.id))) {
      drive[id] = previo.id;
      continue;
    }
    const ficha = t.imagenes[id] || {};
    drive[id] = await subirFigura(token, {
      carpeta, nombre: `${id}.jpg`, bytes, descripcion: `${ficha.figura || id} · ${t.meta.titulo}`,
    });
    await set(ref(db, `estudio/${t.id}/imagenes/${id}/drive`), { id: drive[id], huella: firma, carpeta });
  }
  const sobrantes = {};
  for (const [id, ficha] of Object.entries(t.imagenes)) {
    if (ficha.drive && !drive[id]) sobrantes[`estudio/${t.id}/imagenes/${id}/drive`] = null;
  }
  const vigentes = new Set(Object.values(drive));
  for (const archivo of await archivosDeCarpeta(token, carpeta)) {
    if (!vigentes.has(archivo.id)) await aLaPapelera(token, archivo.id).catch(() => {});
  }
  // Antes de tocar la publicación: que la web pueda leer las figuras como las leerá cualquiera.
  avance("Comprobando que la web ve las figuras…");
  await comprobarLectura(Object.values(drive)[0]);
  return { drive, cambios: sobrantes };
}

// Lo que el autor declara al publicar. Se guarda con la publicación, junto con su cuenta y la fecha.
// Si el texto cambia, cambia también la versión.
const DECLARACION = {
  version: "2026-09-23",
  texto: "Declaro que tengo derecho a compartir estas figuras —por su licencia o por permiso de su titular—, "
    + "que no contienen datos de pacientes y que respondo por ellas. Sé que quedan alojadas en mi cuenta de Google "
    + "y que un reclamo de derechos puede afectarla. Si alguien reclama, el tema se retira de RadQuiz y yo borro "
    + "las figuras de mi Drive.",
};

// Antes de publicar: qué pasa con las figuras y la declaración. El botón se habilita al marcarla.
function confirmarPublicacion(t, figuras) {
  return new Promise((resolver) => {
    const fondo = document.createElement("div");
    fondo.className = "zoom";
    fondo.innerHTML = `<div class="panel dialogo" role="dialog" aria-modal="true" aria-labelledby="d-titulo">
      <h3 id="d-titulo"></h3>
      ${figuras
        ? `<p>Las figuras (${figuras}) se suben a <b>tu Google Drive</b>, a la carpeta <b id="d-carpeta"></b>, compartidas
            con cualquiera que tenga el enlace. RadQuiz guarda solo ese enlace: las figuras las alojas tú, y las retiras
            borrándolas de tu Drive.</p>
          <p class="src">Google te pedirá permiso para que RadQuiz cree archivos en tu Drive. Solo verá los que cree él,
            nunca el resto.</p>`
        : `<p>Este tema no tiene figuras: se publica solo el texto.</p>`}
      <label class="declaro"><input type="checkbox" id="d-declaro"><span id="d-texto"></span></label>
      <div class="row"><button id="d-no">Cancelar</button>
        <button class="primary" id="d-si" disabled>Publicar</button></div>
    </div>`;
    const n = cuentas(t);
    fondo.querySelector("#d-titulo").textContent = `Publicar «${t.meta.titulo}» (${textoCuentas(n)})`;
    const carpeta = fondo.querySelector("#d-carpeta");
    if (carpeta) carpeta.textContent = `«RadQuiz · ${t.meta.titulo}»`;
    fondo.querySelector("#d-texto").textContent = DECLARACION.texto;
    const marca = fondo.querySelector("#d-declaro");
    const si = fondo.querySelector("#d-si");
    const tecla = (e) => { if (e.key === "Escape") cerrar(false); };
    const cerrar = (valor) => {
      document.removeEventListener("keydown", tecla);
      fondo.remove();
      resolver(valor);
    };
    marca.onchange = () => { si.disabled = !marca.checked; };
    fondo.querySelector("#d-no").onclick = () => cerrar(false);
    si.onclick = () => cerrar(true);
    fondo.onclick = (e) => { if (e.target === fondo) cerrar(false); };
    document.addEventListener("keydown", tecla);
    document.body.append(fondo);
    marca.focus();
  });
}

// ------------------------------------------------------------------ imágenes
async function cargarImagenes(id) {
  cargandoImagenes = true;
  const snap = await get(ref(db, `estudio_img/${id}`)).catch(() => null);
  imagenesTema = (snap && snap.val()) || {};
  cargandoImagenes = false;
  dibujar();
}

// ------------------------------------------------------------------ arranque y sesión
function entrar() {
  app.innerHTML = `<section class="panel entrar">
    <p class="eyebrow">Estudio de RadQuiz</p>
    <h1>Prepara y publica tus cuestionarios</h1>
    <p class="lead">Armas el tema con la IA que prefieras y lo publicas tú; después un radiólogo le pone el sello de
      verificado, caso por caso. Todo desde el navegador.</p>
    <div class="row"><button class="primary lg" id="google">Entrar con Google</button>
      <a class="boton lg" href="manual.html#autores">Cómo funciona</a></div>
    <p class="src">Se usa tu cuenta de Google solo para saber quién escribe y quién revisa cada caso.</p>
  </section>`;
  $("#google").onclick = async () => {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (e) {
      aviso("No se pudo entrar: " + (e.code || e.message), true);
    }
  };
  if (modoPrueba) {
    const b = document.createElement("button");
    b.textContent = "Entrar en modo prueba";
    b.onclick = () => signInAnonymously(auth);
    $("#google").after(b);
  }
}

async function altaAutomatica() {
  const correo = usuario.email || "";
  const base = slug(correo.split("@")[0]).replace(/-/g, "") || "autor";
  const nombre = usuario.displayName || correo.split("@")[0] || "Autor";
  try {
    await set(ref(db, `usuarios/${usuario.uid}`), {
      nombre, usuario: `${base}-${usuario.uid.slice(0, 4).toLowerCase()}`, email: correo, rol: "autor", alta: serverTimestamp(),
    });
  } catch (e) {
    app.innerHTML = panel("No se pudo crear tu acceso", e.code || e.message);
  }
}

async function pedirSerRevisor() {
  const mensaje = prompt("¿Quién eres? (se lo mostramos al coordinador)", perfil.nombre) || "";
  try {
    await set(ref(db, `solicitudes/${usuario.uid}`), {
      nombre: perfil.nombre, email: usuario.email, rol: "revisor", mensaje: mensaje.slice(0, 200), fecha: serverTimestamp(),
    });
    aviso("Pedido enviado al coordinador.");
  } catch (e) {
    aviso("No se pudo enviar: " + (e.code || e.message), true);
  }
}

// ------------------------------------------------------------------ inicio
// Los sellos cuentan casos y lecturas juntos: «total» es lo que hay que verificar.
function cuentas(t) {
  const casos = casosOrdenados(t);
  const lecturas = lecturasOrdenadas(t);
  let verificados = 0, problemas = 0, reportados = 0;
  for (const c of [...casos, ...lecturas]) {
    const estado = estadoVerificacion(c, vercaso(t.id, c.id));
    if (estado === "verificado") verificados += 1;
    if (estado === "problema") problemas += 1;
    if (reportesDe(t.id, c.id).length) reportados += 1;
  }
  return { casos: casos.length, lecturas: lecturas.length, total: casos.length + lecturas.length, verificados, problemas, reportados };
}

const plural = (cuantos, uno, muchos) => `${cuantos} ${cuantos === 1 ? uno : muchos}`;

// «12 casos», «19 lecturas» o «12 casos y 19 lecturas»: un tema solo de lecturas no dice «0 casos».
function textoCuentas(n) {
  const partes = [];
  if (n.casos || !n.lecturas) partes.push(plural(n.casos, "caso", "casos"));
  if (n.lecturas) partes.push(plural(n.lecturas, "lectura", "lecturas"));
  return partes.join(" y ");
}

function tarjetaTema(t) {
  const n = cuentas(t);
  const mio = soyAutor(t);
  const puedeVerificar = esRevisor() && !mio && t.meta.estado === "publicado";
  return `<article class="panel tema-card">
    <div class="etiquetas">${chipEstado(t.meta.estado)}</div>
    <h3>${esc(t.meta.titulo || t.id)}</h3>
    <p class="meta">${esc(SEGMENTOS[t.meta.segmento] || t.meta.segmento || "")} · ${textoCuentas(n)} · ${esc(t.meta.autor_nombre || "")}${mio ? " (tú)" : ""}</p>
    <p class="meta">${n.verificados} ${n.verificados === 1 ? "verificado" : "verificados"}${n.problemas ? ` · ${n.problemas} con problema` : ""}${n.reportados ? ` · ${n.reportados} reportados` : ""}${sinPublicar(t) ? " · cambios sin publicar" : ""}</p>
    <div class="row acciones"><a class="boton" href="#/tema/${esc(t.id)}">${puedeEditar(t) ? "Abrir" : puedeVerificar ? "Verificar" : "Ver"}</a>
      ${puedeEditar(t) ? `<button class="peligrosa" data-borrar-tema="${esc(t.id)}">Borrar</button>` : ""}</div>
  </article>`;
}

function inicio() {
  const todos = Object.entries(temas).map(([id, t]) => normalizarTema(id, t));
  const mios = todos.filter((t) => soyAutor(t));
  const porVerificar = esRevisor()
    ? todos.filter((t) => t.meta.estado === "publicado" && !soyAutor(t))
        .map((t) => ({ t, n: cuentas(t) }))
        .filter(({ n }) => n.reportados || n.verificados < n.total)
        .sort((a, b) => (b.n.reportados - a.n.reportados) || ((b.n.total - b.n.verificados) - (a.n.total - a.n.verificados)))
        .map(({ t }) => t)
    : [];
  const otros = todos.filter((t) => !mios.includes(t) && !porVerificar.includes(t));
  const pendientes = Object.keys(solicitudes).length;
  const bloque = (titulo, lista_, vacio) => `<section class="segmento">
    <h2>${titulo}</h2>
    ${lista_.length ? `<div class="temas">${lista_.map(tarjetaTema).join("")}</div>` : `<p class="muted">${vacio}</p>`}</section>`;

  app.innerHTML = `<div class="stack segmentos">
    <div class="seccion-cabeza">
      <div class="stack" style="gap:4px"><p class="eyebrow">Estudio</p><h1>Cuestionarios</h1></div>
      <span class="row"><a class="boton primary" href="#/nuevo">Nuevo cuestionario</a>
        <button id="copiar-ia-zip" title="El texto para que tu IA saque las figuras del PDF y te devuelva el cuestionario entero en un .zip">Instrucciones para la IA</button>
        <button id="subir-zip" title="Sube el .zip que te devolvió tu IA: aquí lo revisas antes de crear nada">Subir un .zip</button>
        <input type="file" id="archivo-zip" accept=".zip,application/zip" hidden></span>
    </div>
    ${esCoord() && pendientes ? `<p class="caja">Hay ${pendientes} pedido(s) para verificar casos. <a href="#/equipo">Ver</a></p>` : ""}
    ${esRevisor() ? bloque("Para verificar", porVerificar,
        "Todo verificado. Los temas con casos o lecturas reportados o sin verificar aparecen aquí primero.") : ""}
    <section class="segmento">
      <h2>Mis temas</h2>
      ${mios.length ? `<div class="temas">${mios.map(tarjetaTema).join("")}</div>` : `<p class="muted">Todavía no creaste ninguno. Cualquiera puede publicar; los radiólogos ponen el sello de verificado.</p>`}
    </section>
    ${otros.length ? bloque("Otros temas", otros, "") : ""}
    ${perfil.rol === "autor" ? `<p class="src">¿Eres radiólogo y quieres verificar casos? <button id="pedir-revisor">Pídelo al coordinador</button></p>` : ""}
  </div>`;
  const boton = $("#pedir-revisor");
  if (boton) boton.onclick = pedirSerRevisor;
  const entrada = $("#archivo-zip");
  $("#copiar-ia-zip").onclick = () => copiar(instruccionesPaquete(), "Copiado. Pégalo en tu IA junto al PDF.");
  $("#subir-zip").onclick = () => entrada.click();
  entrada.onchange = async () => {
    const archivo = entrada.files[0];
    entrada.value = "";
    if (!archivo) return;
    $("#subir-zip").disabled = true;
    $("#subir-zip").textContent = "Leyendo…";
    try {
      importado = await abrirZip(archivo, (n, total) => {
        if (n % 10 === 0 || n === total) $("#subir-zip").textContent = `Leyendo figuras… ${n} de ${total}`;
      });
      verTodasImportadas = false;
    } catch (e) {
      $("#subir-zip").disabled = false;
      $("#subir-zip").textContent = "Subir un .zip";
      return aviso(e.message, true);
    }
    location.hash = "#/importar";
  };
  app.querySelectorAll("[data-borrar-tema]").forEach((b) => {
    b.onclick = () => {
      const t = temas[b.dataset.borrarTema];
      if (t) borrarTema(normalizarTema(b.dataset.borrarTema, t));
    };
  });
}

// ------------------------------------------------------------------ equipo (coordinador)
function equipo() {
  const pedidos = Object.entries(solicitudes);
  const gente = Object.entries(miembros);
  app.innerHTML = `<div class="stack segmentos">
    <div class="stack" style="gap:6px"><a class="volver" href="#/">← Todos los temas</a><h1>Equipo</h1></div>
    <section class="segmento"><h2>Pedidos para verificar casos</h2>
      ${pedidos.length ? pedidos.map(([uid, s]) => `<div class="panel" style="display:grid;gap:8px">
        <b>${esc(s.nombre)}</b><p class="src">${esc(s.email)} · pide ser ${esc(s.rol)}${s.mensaje ? ` · «${esc(s.mensaje)}»` : ""}</p>
        <div class="row">
          <button class="primary" data-alta="${esc(uid)}" data-rol="revisor">Aceptar como revisor</button>
          <button data-alta="${esc(uid)}" data-rol="coordinador">Hacer coordinador</button>
          <button data-rechazar="${esc(uid)}">Rechazar</button>
        </div></div>`).join("") : `<p class="muted">No hay pedidos.</p>`}
    </section>
    <section class="segmento"><h2>Equipo</h2>
      ${gente.length ? `<div class="tabla"><table><thead><tr><th>Nombre</th><th>Usuario</th><th>Papel</th><th></th></tr></thead><tbody>
        ${gente.map(([uid, m]) => `<tr><td>${esc(m.nombre)}</td><td><code>${esc(m.usuario)}</code></td>
          <td><select data-rol-de="${esc(uid)}">${["autor", "revisor", "coordinador"].map((r) => `<option ${r === m.rol ? "selected" : ""}>${r}</option>`).join("")}</select></td>
          <td><button data-quitar="${esc(uid)}">Quitar</button></td></tr>`).join("")}
      </tbody></table></div>` : `<p class="muted">Todavía no hay miembros.</p>`}
    </section></div>`;

  app.querySelectorAll("[data-alta]").forEach((b) => {
    b.onclick = () => aceptar(b.dataset.alta, b.dataset.rol);
  });
  app.querySelectorAll("[data-rechazar]").forEach((b) => {
    b.onclick = () => remove(ref(db, `solicitudes/${b.dataset.rechazar}`));
  });
  app.querySelectorAll("[data-rol-de]").forEach((s) => {
    s.onchange = () => update(ref(db, `usuarios/${s.dataset.rolDe}`), { rol: s.value });
  });
  app.querySelectorAll("[data-quitar]").forEach((b) => {
    b.onclick = () => confirm("¿Quitar a esta persona del equipo?") && remove(ref(db, `usuarios/${b.dataset.quitar}`));
  });
}

async function aceptar(uid, rol) {
  const s = solicitudes[uid];
  if (!s) return;
  const actual = miembros[uid];
  const usuarioSlug = actual?.usuario || `${slug(s.email.split("@")[0]).replace(/-/g, "")}-${uid.slice(0, 4).toLowerCase()}`;
  await set(ref(db, `usuarios/${uid}`), { nombre: s.nombre, usuario: usuarioSlug, email: s.email, rol, alta: actual?.alta || serverTimestamp() });
  await remove(ref(db, `solicitudes/${uid}`));
  aviso(`${s.nombre} ahora es ${rol}.`);
}

// ------------------------------------------------------------------ tema nuevo
function temaNuevo() {
  app.innerHTML = `<form class="panel" id="nuevo" style="display:grid;gap:12px;max-width:680px">
    <h2>Nuevo cuestionario</h2>
    <label class="grid-label">Título<input type="text" id="titulo" maxlength="120" placeholder="Nódulos pulmonares en TC" required></label>
    <label class="grid-label">Segmento
      <select id="segmento">${Object.entries(SEGMENTOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
    <label class="grid-label">Modalidades
      <span class="row">${MODALIDADES.map((m) => `<label class="row" style="gap:4px"><input type="checkbox" value="${m}" class="mod" ${m === "RM" ? "" : ""}> ${m}</label>`).join("")}</span></label>
    <label class="grid-label">Descripción corta (opcional)<input type="text" id="descripcion" maxlength="200"></label>
    <div class="row"><button class="primary" type="submit">Crear</button><a class="boton" href="#/">Cancelar</a></div>
  </form>
  <div class="ia" style="max-width:680px;margin-top:18px">
    <h3>O que tu IA lo arme entero</h3>
    <p class="muted">Si tu IA sabe ejecutar código (ChatGPT con análisis de datos, Claude, Gemini…), puede sacar las
      figuras del PDF y devolverte el cuestionario completo en un solo <b>.zip</b>. Lo subes con
      <b>Subir un .zip</b> y aquí lo revisas antes de crear nada.</p>
    <div class="row"><button id="copiar-zip">Instrucciones para la IA</button>
      <span class="src">También están en la portada, junto a «Subir un .zip».</span></div>
  </div>`;
  $("#copiar-zip").onclick = () => copiar(instruccionesPaquete(), "Copiado. Pégalo en tu IA junto al PDF.");
  $("#nuevo").onsubmit = async (e) => {
    e.preventDefault();
    const titulo = $("#titulo").value.trim();
    const modalidades = [...app.querySelectorAll(".mod:checked")].map((c) => c.value);
    let id = slug(titulo);
    if (!id) return aviso("Escribe un título.", true);
    while (temas[id]) id = `${id}-2`;
    try {
      await set(ref(db, `estudio/${id}`), {
        meta: {
          id, titulo, segmento: $("#segmento").value, descripcion: $("#descripcion").value.trim(),
          modalidades: modalidades.length ? modalidades : ["RM"],
          autor_uid: usuario.uid, autor_nombre: perfil.nombre, autor_usuario: perfil.usuario,
          estado: "borrador", version: "0.1.0", creado: serverTimestamp(), actualizado: serverTimestamp(),
        },
      });
      location.hash = `#/tema/${id}`;
    } catch (err) {
      aviso("No se pudo crear: " + (err.code || err.message), true);
    }
  };
}

// ------------------------------------------------------------------ cuestionario entero en un .zip
// Leerlo y escribirlo está en app/importar.js y app/zip.js; aquí solo la pantalla.

// El tema tal como quedaría, para validarlo y enseñarlo antes de crear nada.
function temaImportado() {
  const d = importado;
  return {
    id: slug(d.meta.id || d.meta.titulo), meta: d.meta, fuente: d.fuente, imagenes: d.imagenes, casos: d.casos, lecturas: d.lecturas || {},
  };
}

// Las primeras figuras que se enseñan al importar: un libro de casos trae cientos y la página se haría pesada.
const FIGURAS_A_LA_VISTA = 120;

function vistaImportar() {
  if (creando) return;
  if (!importado) { location.hash = "#/"; return; }
  const d = importado;
  const t = temaImportado();
  const v = validarTema(t);
  const imagenes = imagenesOrdenadas(t);
  const casos = casosOrdenados(t);
  const lecturas = lecturasOrdenadas(t);
  const aLaVista = verTodasImportadas ? imagenes : imagenes.slice(0, FIGURAS_A_LA_VISTA);
  const problemasLecturas = lecturas.flatMap((l) => v.lecturas[l.id].map((p) => ({ ...p, texto: `${l.id} · ${l.tema || "sin tema"}: ${p.texto}` })));
  app.innerHTML = `<div class="stack stack-lg">
    <div class="stack" style="gap:6px"><a class="volver" href="#/">← Todos los temas</a><h1>${esc(d.meta.titulo)}</h1>
      <p class="muted">${esc(SEGMENTOS[d.meta.segmento] || d.meta.segmento || "sin segmento")} ·
        ${textoCuentas({ casos: casos.length, lecturas: lecturas.length })} · ${plural(imagenes.length, "imagen", "imágenes")} · de ${esc(d.nombre)}</p></div>
    ${d.faltan.length ? `<p class="caja">El .zip no traía ${d.faltan.length} imagen(es): ${esc(d.faltan.slice(0, 6).join(", "))}${d.faltan.length > 6 ? "…" : ""}.
      Puedes crearlo igual y subirlas después en el paso 2.</p>` : ""}
    <section class="panel" style="display:grid;gap:12px">
      <h2>Mira las imágenes antes de crearlo</h2>
      <p class="muted">Cada una tiene que ser la figura <b>completa</b>, tal como salió publicada: con todos sus
        paneles y sin flechas ni recortes añadidos. Si una IA las sacó del PDF puede haber partido una figura en
        trozos, y casi ninguna de estas licencias lo permite.</p>
      <div class="galeria chica">${aLaVista.map((img) => `<div class="panel" style="display:grid;gap:6px">
        ${d.datos[img.id]
          ? `<img class="miniatura chica" src="${esc(d.datos[img.id])}" alt="${esc(img.figura)}" loading="lazy" data-zoom>`
          : `<p class="src">sin archivo</p>`}
        <span class="src">${esc(img.figura || img.id)}</span></div>`).join("") || `<p class="muted">El .zip no traía imágenes.</p>`}</div>
      ${aLaVista.length < imagenes.length ? `<div class="row"><span class="src">Se ven ${aLaVista.length} de ${imagenes.length}.</span>
        <button id="ver-todas-importadas">Ver todas</button></div>` : ""}
    </section>
    <section class="panel" style="display:grid;gap:10px">
      <h2>Clasificación</h2>
      <div class="row" style="gap:6px">${resumenClasificacion([...casos, ...lecturas], t.meta.segmento)}</div>
      ${d.desconocidas.length ? `<p class="caja">Estas clasificaciones no están en la lista de áreas y quedaron fuera:
        ${esc(d.desconocidas.join(", "))}. Esos casos conservan el resto de su clasificación, o el segmento del tema si
        no tenían otra; lo corriges en el paso 3.</p>` : ""}
    </section>
    <section class="panel" style="display:grid;gap:10px">
      <h2>Qué encontró el validador</h2>
      ${v.errores || v.avisos
        ? `<p class="${v.errores ? "caja" : "muted"}">${v.errores} error(es) y ${v.avisos} aviso(s).
            Se crea igual, en preparación: los corriges en los pasos 1 a 3 antes de publicar.</p>`
        : `<p class="muted">Sin errores ni avisos: se puede publicar tal cual.</p>`}
      ${problemasHTML(v.fuente)}
      ${problemasHTML(v.tema)}
      ${problemasHTML(casos.flatMap((c) => v.casos[c.id].map((p) => ({ ...p, texto: `${c.tema || c.id}: ${p.texto}` }))).slice(0, 12))}
      ${problemasHTML(problemasLecturas.slice(0, 12))}
      ${problemasLecturas.length > 12 ? `<p class="src">… y ${problemasLecturas.length - 12} más en las lecturas: se ven en el paso 3.</p>` : ""}
    </section>
    <div class="row">
      <button class="primary" id="crear-importado">Crear el cuestionario</button>
      <button id="cancelar-importado">Cancelar</button>
    </div>
    <p class="src">Se crea a tu nombre y <b>en preparación</b>: nada sale a la web hasta que tú lo publiques.</p>
  </div>`;
  $("#cancelar-importado").onclick = () => { importado = null; location.hash = "#/"; };
  $("#crear-importado").onclick = () => crearImportado();
  const todas = $("#ver-todas-importadas");
  if (todas) todas.onclick = () => { verTodasImportadas = true; vistaImportar(); };
}

// Escribe muchas rutas en varios update() de no más de «tope» caracteres cada uno: un libro de casos trae cientos
// de lecturas y más de mil figuras, y una sola escritura de 20 MB tarda, puede cortarse y pasa del límite del SDK.
// Las reglas se comprueban ruta por ruta, así que trocear no cambia los permisos.
async function escribirPorPartes(rutas, tope, avance = () => {}) {
  const entradas = Object.entries(rutas);
  let parte = {}, tamano = 0, hechas = 0;
  const enviar = async () => {
    if (!tamano) return;
    await update(ref(db), parte);
    hechas += Object.keys(parte).length;
    avance(hechas, entradas.length);
    parte = {};
    tamano = 0;
  };
  for (const [ruta, valor] of entradas) {
    const largo = JSON.stringify(valor ?? null).length + ruta.length;
    if (tamano && tamano + largo > tope) await enviar();
    parte[ruta] = valor;
    tamano += largo;
  }
  await enviar();
}

async function crearImportado() {
  const d = importado;
  const boton = $("#crear-importado");
  boton.disabled = true;
  creando = true;
  let id = slug(d.meta.id || d.meta.titulo) || "cuestionario";
  while (temas[id]) id = `${id}-2`;
  try {
    // De una sola vez: las reglas dan permiso para crear el tema mirando meta/autor_uid, y solo
    // conocen el tema después de escribirlo. Por eso las imágenes van detrás, una por una.
    await set(ref(db, `estudio/${id}`), {
      meta: {
        id, titulo: d.meta.titulo, segmento: d.meta.segmento, descripcion: d.meta.descripcion,
        modalidades: d.meta.modalidades.length ? d.meta.modalidades : ["RM"],
        autor_uid: usuario.uid, autor_nombre: perfil.nombre, autor_usuario: perfil.usuario,
        estado: "borrador", version: d.meta.version,
        creado: serverTimestamp(), actualizado: serverTimestamp(),
      },
      fuente: d.fuente,
      imagenes: d.imagenes,
    });
    // Los casos y las lecturas, detrás y por partes: ya existe el tema, así que las reglas los dejan escribir.
    const textos = {};
    for (const [k, c] of Object.entries(d.casos)) textos[`estudio/${id}/casos/${k}`] = { ...c, actualizado: serverTimestamp() };
    for (const [k, l] of Object.entries(d.lecturas || {})) textos[`estudio/${id}/lecturas/${k}`] = { ...l, actualizado: serverTimestamp() };
    await escribirPorPartes(textos, 1500000, (n, total) => { boton.textContent = `Guardando casos y lecturas… ${n} de ${total}`; });
    const figuras = Object.fromEntries(Object.entries(d.datos).map(([imgId, url]) => [`estudio_img/${id}/${imgId}`, url]));
    await escribirPorPartes(figuras, 4000000, (n, total) => { boton.textContent = `Subiendo imágenes… ${n} de ${total}`; });
  } catch (e) {
    creando = false;
    boton.disabled = false;
    boton.textContent = "Crear el cuestionario";
    // Si el tema ya se creó, queda a medias en el estudio: mejor decirlo que dejar creer que no se creó nada.
    const amedias = temas[id] ? ` Quedó creado a medias como «${id}»: bórralo desde la portada y vuelve a subir el .zip.` : "";
    return aviso("No se pudo crear: " + (e.code || e.message) + amedias, true);
  }
  creando = false;
  importado = null;
  location.hash = `#/tema/${id}`;
  aviso("Listo. Revisa los pasos 1 a 3 y publícalo cuando esté.");
}

// Lo contrario: el tema tal como se publica, en un .zip que se puede volver a subir aquí o a Git.
function descargarZip(t) {
  const { paquete, fuentes, imagenesUsadas } = aPaquete(t, t.meta.version || "0.1.0");
  const archivos = [
    { nombre: "paquete.json", datos: JSON.stringify(paquete, null, 2) + "\n" },
    { nombre: "fuentes.json", datos: JSON.stringify(fuentes, null, 2) + "\n" },
  ];
  let faltan = 0;
  for (const id of imagenesUsadas) {
    if (!imagenesTema[id]) { faltan += 1; continue; }
    archivos.push({ nombre: `img/${paquete.imagenes[id].archivo}`, datos: bytesDeDataURL(imagenesTema[id]) });
  }
  descargarArchivo(crearZip(archivos), `${t.id}.zip`);
  aviso(faltan ? `Descargado, pero faltaron ${faltan} imagen(es) sin cargar.` : "Descargado.", faltan > 0);
}

// ------------------------------------------------------------------ vista de un tema
function vistaTema() {
  const t = temaActual();
  if (!t) return (app.innerHTML = `<p class="muted">Cargando…</p>`);
  const publicado = t.meta.estado === "publicado";
  const revisando = esRevisor() && publicado && (modoVerificar || !puedeEditar(t));
  const alternar = esRevisor() && publicado && puedeEditar(t)
    ? `<button id="alternar">${modoVerificar ? "Volver a editar" : "Verificar casos"}</button>` : "";
  const cabecera = `<div class="seccion-cabeza tema-cabeza">
      <div class="stack" style="gap:6px"><a class="volver" href="#/">← Todos los temas</a><h1>${esc(t.meta.titulo)}</h1>
        <p class="muted">${esc(SEGMENTOS[t.meta.segmento] || "")} · ${esc(t.meta.autor_nombre || "")} · ${chipEstado(t.meta.estado)}</p></div>
      ${alternar}
    </div>`;
  if (revisando) {
    app.innerHTML = cabecera + panelVerificacion(t);
    enlazarVerificacion(t);
    return enlazarAlternar();
  }
  if (!puedeEditar(t)) return (app.innerHTML = cabecera + panelSoloLectura(t)), null;
  app.innerHTML = cabecera + editor(t);
  enlazarEditor(t);
  enlazarAlternar();
}

function enlazarAlternar() {
  const boton = $("#alternar");
  if (boton) boton.onclick = () => { modoVerificar = !modoVerificar; ordenVerificacion = null; dibujar(); };
}

function panelSoloLectura(t) {
  const n = cuentas(t);
  return `<section class="panel" style="display:grid;gap:10px">
    <h2>${ESTADOS[t.meta.estado].texto}</h2>
    <p class="muted">Solo su autor o el coordinador pueden editarlo.</p>
    <p class="src">${textoCuentas(n)} · ${n.verificados} verificados</p>
  </section>`;
}

// ---------- editor del autor
function pasos(t, v) {
  const marca = (ok) => (ok ? `<span class="paso-marca">✓</span>` : `<span class="paso-marca falta" title="Falta corregir algo">•</span>`);
  const items = [
    ["fuente", `${marca(!v.fuente.some((p) => p.tipo === "error"))} 1. Fuente`],
    ["imagenes", `${marca(imagenesOrdenadas(t).length && !Object.values(v.imagenes).flat().some((p) => p.tipo === "error"))} 2. Imágenes`],
    ["casos", `${marca((casosOrdenados(t).length || lecturasOrdenadas(t).length)
      && ![...Object.values(v.casos), ...Object.values(v.lecturas)].flat().some((p) => p.tipo === "error"))} 3. ${lecturasOrdenadas(t).length ? "Casos y lecturas" : "Casos"}`],
    ["publicar", `${marca(v.errores === 0)} 4. Publicar`],
  ];
  return `<nav class="pasos-nav">${items.map(([id, texto]) =>
    `<button class="paso ${paso === id ? "activo" : ""}" data-paso="${id}">${texto}</button>`).join("")}</nav>`;
}

function editor(t) {
  const v = validarTema(t);
  const cuerpo = { fuente: pasoFuente, imagenes: pasoImagenes, casos: pasoCasos, publicar: pasoPublicar }[paso](t, v);
  const n = cuentas(t);
  const aviso_ = t.meta.estado === "publicado" && (n.problemas || n.reportados)
    ? `<p class="caja">Hay ${n.problemas ? `${n.problemas} caso(s) o lectura(s) marcados con problema por un radiólogo` : ""}${n.problemas && n.reportados ? " y " : ""}${n.reportados ? `${n.reportados} con reportes de usuarios` : ""}. Están marcados en el paso 3.</p>`
    : "";
  return pasos(t, v) + aviso_ + cuerpo;
}

function pasoFuente(t, v) {
  const f = t.fuente || {};
  return `<section class="panel" style="display:grid;gap:12px">
    <h2>1. Título y fuente</h2>
    <label class="grid-label">Título del cuestionario (así sale en la web)
      <input type="text" id="titulo-tema" maxlength="120" value="${esc(t.meta.titulo || "")}"></label>
    ${t.meta.estado === "publicado" ? `<p class="src">Si cambias el título, sale en la web al volver a publicar (paso 4).</p>` : ""}
    <h3>De dónde salen las imágenes</h3>
    <p class="muted">Solo se pueden usar artículos de acceso abierto o bancos públicos con licencia que permita uso educativo.</p>
    <label class="grid-label">Tipo de fuente
      <select id="tipo-fuente">
        ${TIPOS_FUENTE.map((x) => `<option value="${x.valor}" ${(f.tipo || "articulo") === x.valor ? "selected" : ""}>${esc(x.etiqueta)}</option>`).join("")}
      </select></label>
    <div class="row" style="align-items:end">
      <label class="grid-label crece">DOI, si tiene (déjalo vacío si la fuente no tiene)
        <input type="text" id="doi" value="${esc(f.doi || "")}" placeholder="10.24875/AJI.23000069"></label>
      <button id="buscar">Completar con el DOI</button>
    </div>
    <label class="grid-label">Cita completa<textarea id="cita" rows="3">${esc(f.cita || "")}</textarea></label>
    <div class="row">
      <label class="grid-label crece">Crédito corto (aparece bajo la imagen)
        <input type="text" id="credito" maxlength="80" value="${esc(f.credito || "")}" placeholder="López-Ramírez M, et al. Austral J Imaging. 2024"></label>
      <label class="grid-label crece">Enlace a la fuente
        <input type="text" id="url" value="${esc(f.url || "")}" placeholder="https://…"></label>
    </div>
    <label class="grid-label">Titular de los derechos (lo que dice «©» en la fuente)
      <input type="text" id="titular" value="${esc(f.titular || "")}" placeholder="© 2024 Sociedad Chilena de Radiología"></label>
    <label class="grid-label">Licencia
      <select id="licencia"><option value="">Elige…</option>
        ${LICENCIAS.map((l) => `<option value="${l.valor}" ${f.licencia === l.valor ? "selected" : ""}>${l.etiqueta || l.valor}${l.nd && !l.etiqueta ? " (no se puede recortar ni marcar)" : ""}</option>`).join("")}
      </select></label>
    <label class="grid-label">Frase de la fuente donde dice la licencia
      <textarea id="frase" rows="2" placeholder="p. 136: «Este es un artículo open access bajo la licencia CC BY-NC-ND…»">${esc(f.verificacion?.donde || "")}</textarea></label>
    ${problemasHTML(v.fuente)}
    <div class="row"><button class="primary" id="guardar-fuente">Guardar</button>
      <button id="ir-imagenes">Siguiente: imágenes</button></div>
  </section>`;
}

function pasoImagenes(t, v) {
  const imagenes = imagenesOrdenadas(t);
  return `<section class="panel" style="display:grid;gap:14px">
    <h2>2. Imágenes</h2>
    <p class="muted">Sube las figuras completas, tal como salen en la fuente: no las recortes ni les dibujes flechas.
      Se comprimen solas para que carguen rápido en el celular.</p>
    <label class="soltar" id="soltar">
      <input type="file" id="archivos" accept="image/*" multiple hidden>
      <b>Arrastra aquí las figuras</b><span class="src">o toca para elegirlas (JPG o PNG)</span>
    </label>
    ${cargandoImagenes ? `<p class="muted">Cargando imágenes…</p>` : ""}
    <div class="galeria">${imagenes.map((img) => `<div class="panel" style="display:grid;gap:8px">
      <img src="${esc(imagenesTema[img.id])}" alt="${esc(img.figura)}" class="miniatura" data-zoom>
      <label class="grid-label">Nombre en la fuente
        <input type="text" data-figura="${esc(img.id)}" value="${esc(img.figura || "")}" placeholder="Figura 2"></label>
      <label class="grid-label">Leyenda original (la puede completar tu IA)
        <textarea rows="3" data-leyenda="${esc(img.id)}">${esc(img.leyenda_original || "")}</textarea></label>
      <details><summary>Ficha técnica</summary>
        <label class="grid-label">Paneles: uno por línea, con <code>letra | plano | secuencia | condición</code>
          <textarea rows="3" data-paneles="${esc(img.id)}">${esc(lista(img.paneles).map((p) => [p.id, p.plano, p.secuencia, p.condicion].map((x) => x || "").join(" | ")).join("\n"))}</textarea></label>
        <label class="grid-label">Marcas: una por línea, con <code>marca | panel | qué señala</code>
          <textarea rows="3" data-marcas="${esc(img.id)}">${esc(lista(img.marcas).map((m) => [m.marca, m.panel, m.senala].map((x) => x || "").join(" | ")).join("\n"))}</textarea></label>
      </details>
      ${problemasHTML(v.imagenes[img.id])}
      <div class="row"><button data-guardar-img="${esc(img.id)}">Guardar</button>
        <button data-borrar-img="${esc(img.id)}">Quitar</button></div>
    </div>`).join("") || `<p class="muted">Todavía no subiste ninguna.</p>`}</div>
    <div class="row"><button id="ir-casos">Siguiente: casos</button></div>
  </section>`;
}

// ---------- clasificación: cada caso en uno o más segmentos, cada uno con su área (app/areas.js)
function chipsClasificacion(t, caso) {
  return clasificacionDe(caso, t.meta.segmento)
    .map((par) => `<span class="chip clasif">${esc(nombreClasificacion(par))}</span>`).join("");
}

// Cuántos casos hay en cada segmento → área: de un vistazo se ve cómo quedó una carga grande.
function resumenClasificacion(casos, segmentoTema) {
  const cuenta = new Map();
  for (const c of casos) {
    for (const par of clasificacionDe(c, segmentoTema)) {
      const tieneAreas = Object.keys(AREAS[par.segmento] || {}).length;
      const nombre = par.area || !tieneAreas ? nombreClasificacion(par) : `${SEGMENTOS[par.segmento] || par.segmento} · sin área`;
      cuenta.set(nombre, (cuenta.get(nombre) || 0) + 1);
    }
  }
  return [...cuenta].sort((a, b) => b[1] - a[1])
    .map(([nombre, n]) => `<span class="chip clasif">${esc(nombre)} · ${n}</span>`).join("");
}

function opcionesSegmento(elegido) {
  return Object.entries(SEGMENTOS)
    .map(([id, nombre]) => `<option value="${id}" ${id === elegido ? "selected" : ""}>${esc(nombre)}</option>`).join("");
}

function opcionesArea(segmento, elegida) {
  const areas = Object.entries(AREAS[segmento] || {});
  return `<option value="">${areas.length ? "Sin área" : "Este segmento no tiene áreas"}</option>`
    + areas.map(([id, nombre]) => `<option value="${id}" ${id === elegida ? "selected" : ""}>${esc(nombre)}</option>`).join("");
}

function filaClasificacion({ segmento, area } = {}) {
  return `<div class="row clasif-fila" style="gap:8px">
    <select class="c-segmento" aria-label="Segmento">${opcionesSegmento(segmento)}</select>
    <select class="c-area" aria-label="Área">${opcionesArea(segmento, area)}</select>
    <button type="button" class="quitar-clasif">Quitar</button>
  </div>`;
}

const textoMarcados = () => `${marcados.size} ${marcados.size === 1 ? "marcado" : "marcados"}`;

function panelClasificar(t, casos) {
  const segmento = bloque.segmento || t.meta.segmento;
  return `<div class="panel" style="display:grid;gap:10px">
    <h3>Clasificación</h3>
    <div class="row" style="gap:6px">${resumenClasificacion(casos, t.meta.segmento)}</div>
    <p class="src">Marca ${vistaPaso3(t) === "lecturas" ? "lecturas" : "casos"} y agrégales o quítales un segmento con su área. Cada uno puede estar en varios segmentos;
      el primero es el principal. Quitar con «Sin área» saca el segmento entero. Cambiar la clasificación no quita el
      sello de verificado.</p>
    <div class="row">
      <button id="marcar-todos">Marcar todos</button>
      <button id="marcar-sin-area">Marcar los que no tienen área</button>
      <button id="marcar-ninguno">Ninguno</button>
      <span class="src n-marcados">${textoMarcados()}</span>
    </div>
    <div class="row">
      <select id="bloque-segmento" aria-label="Segmento">${opcionesSegmento(segmento)}</select>
      <select id="bloque-area" aria-label="Área">${opcionesArea(segmento, bloque.area)}</select>
      <button id="bloque-agregar">Agregar a los marcados</button>
      <button id="bloque-quitar">Quitar de los marcados</button>
    </div>
  </div>`;
}

// Con área: si el caso ya estaba en ese segmento sin área, la pareja se completa en su mismo lugar; si no, va al final.
function conPareja(pares, segmento, area) {
  if (pares.some((p) => p.segmento === segmento && (p.area || "") === area)) return pares;
  if (!area) return pares.some((p) => p.segmento === segmento) ? pares : [...pares, { segmento }];
  const i = pares.findIndex((p) => p.segmento === segmento && !p.area);
  return i === -1 ? [...pares, { segmento, area }] : pares.map((p, j) => (j === i ? { segmento, area } : p));
}

// Sin área, sale el segmento entero. Con área, sale esa área, y el caso sigue en el segmento aunque sin área.
function sinPareja(pares, segmento, area) {
  if (!area) return pares.filter((p) => p.segmento !== segmento);
  const quedan = pares.filter((p) => !(p.segmento === segmento && p.area === area));
  if (quedan.length < pares.length && !quedan.some((p) => p.segmento === segmento)) {
    quedan.splice(pares.findIndex((p) => p.segmento === segmento), 0, { segmento });
  }
  return quedan;
}

// En qué lista del tema vive un id: los marcados pueden ser casos o lecturas.
const coleccionDe = (t, id) => (t.casos[id] ? "casos" : t.lecturas[id] ? "lecturas" : "");
const palabrasVista = (t) => (vistaPaso3(t) === "lecturas" ? ["lectura", "lecturas", "alguna"] : ["caso", "casos", "algún"]);

// No toca «actualizado» de los casos ni de las lecturas: el sello de verificado cubre lo que el radiólogo revisó,
// y la clasificación no lo cambia.
async function clasificarMarcados(t, agregar) {
  const segmento = $("#bloque-segmento").value;
  const area = $("#bloque-area").value;
  const [uno, varios, alguno] = palabrasVista(t);
  const cambios = {};
  let cambiados = 0;
  let sinSegmento = 0;
  for (const id of marcados) {
    const coleccion = coleccionDe(t, id);
    if (!coleccion) continue;
    const antes = clasificacionDe(t[coleccion][id], t.meta.segmento);
    const despues = agregar ? conPareja(antes, segmento, area) : sinPareja(antes, segmento, area);
    if (!despues.length) { sinSegmento += 1; continue; }
    if (JSON.stringify(despues) === JSON.stringify(antes)) continue;
    cambios[`estudio/${t.id}/${coleccion}/${id}/clasificacion`] = despues;
    cambiados += 1;
  }
  if (!cambiados) {
    return aviso(!marcados.size ? `Marca primero ${alguno} ${uno}.`
      : sinSegmento ? `No cambió nada: cada ${uno} necesita al menos un segmento.` : `Los marcados ya estaban así.`, true);
  }
  try {
    await update(ref(db), cambios);
    await guardarMeta(t.id, {});
  } catch (e) {
    return aviso("No se pudo guardar: " + (e.code || e.message), true);
  }
  const igual = sinSegmento === 1 ? " Uno quedó igual" : ` ${sinSegmento} quedaron igual`;
  aviso(`Clasificación cambiada en ${plural(cambiados, uno, varios)}.`
    + (sinSegmento ? `${igual}: cada ${uno} necesita al menos un segmento.` : ""));
}

// ---------- dificultad (cuatro niveles, por el contenido y la bibliografía) y modo sin alternativas
function chipDificultad(caso) {
  const n = caso.dificultad?.nivel;
  if (!NIVELES[n]) return `<span class="chip" title="El tablero lo toma como nivel 2">Sin dificultad</span>`;
  const titulo = [NIVELES[n].referente, caso.dificultad.motivo, caso.dificultad.por && `asignada por: ${caso.dificultad.por}`]
    .filter(Boolean).join(" · ");
  return `<span class="chip nivel n${n}" title="${esc(titulo)}">${n} · ${esc(NIVELES[n].nombre)}</span>`;
}

function opcionesNivel(elegido, vacio) {
  return `<option value="">${vacio}</option>` + Object.entries(NIVELES).map(([n, v]) =>
    `<option value="${n}" ${String(elegido) === n ? "selected" : ""}>${n} · ${esc(v.nombre)} (${esc(v.referente)})</option>`).join("");
}

// Con «deLecturas», sin lo de las opciones: las lecturas no tienen alternativas.
function panelDificultad(casos, deLecturas = false) {
  const cuenta = (n) => casos.filter((c) => (c.dificultad?.nivel || 0) === n).length;
  const reparto = [1, 2, 3, 4].map((n) => `<span class="chip nivel n${n}">${n} · ${esc(NIVELES[n].nombre)} · ${cuenta(n)}</span>`).join("")
    + (cuenta(0) ? `<span class="chip">Sin dificultad · ${cuenta(0)}</span>` : "");
  if (deLecturas) {
    return `<div class="panel" style="display:grid;gap:10px">
    <h3>Dificultad</h3>
    <div class="row" style="gap:6px">${reparto}</div>
    <p class="src">No la ve el residente. Se asigna por el contenido y la bibliografía, con el currículo europeo de la
      ESR como referencia; tu IA la propone con su motivo. Cambiarla no quita el sello de verificado.</p>
    <div class="row">
      <button id="marcar-sin-nivel">Marcar las que no tienen dificultad</button>
      <span class="src n-marcados">${textoMarcados()}</span>
    </div>
    <div class="row">
      <select id="bloque-nivel" aria-label="Dificultad">${opcionesNivel(bloqueNivel, "Sin dificultad")}</select>
      <button id="nivel-marcados">Poner a las marcadas</button>
    </div>
  </div>`;
  }
  const conOpciones = casos.filter((c) => c.requiere_opciones).length;
  return `<div class="panel" style="display:grid;gap:10px">
    <h3>Dificultad y modo sin alternativas</h3>
    <div class="row" style="gap:6px">${reparto}</div>
    <p class="src">La dificultad no la ve el residente: el tablero ordena con ella las filas (100 = nivel 1). Se asigna
      por el contenido y la bibliografía, con el currículo europeo de la ESR como referencia; tu IA la propone con su
      motivo. ${conOpciones} ${conOpciones === 1 ? "caso necesita" : "casos necesitan"} las opciones a la vista: en el
      modo sin alternativas se muestran con ellas. Nada de esto quita el sello de verificado.</p>
    <div class="row">
      <button id="marcar-sin-nivel">Marcar los que no tienen dificultad</button>
      <button id="marcar-parecen">Marcar los que parecen necesitar las opciones</button>
      <span class="src n-marcados">${textoMarcados()}</span>
    </div>
    <div class="row">
      <select id="bloque-nivel" aria-label="Dificultad">${opcionesNivel(bloqueNivel, "Sin dificultad")}</select>
      <button id="nivel-marcados">Poner a los marcados</button>
      <button id="con-opciones">Necesitan las opciones</button>
      <button id="sin-opciones">Se contestan sin opciones</button>
    </div>
  </div>`;
}

// Como la clasificación, no toca «actualizado»: no es lo que el radiólogo verificó. «requiere_opciones» es solo de
// los casos: las lecturas no tienen alternativas.
async function cambiarMarcados(t, campo, valor) {
  const [uno, varios, alguno] = palabrasVista(t);
  const cambios = {};
  for (const id of marcados) {
    const coleccion = coleccionDe(t, id);
    if (!coleccion || (coleccion === "lecturas" && campo === "requiere_opciones")) continue;
    if (JSON.stringify(t[coleccion][id][campo] ?? null) === JSON.stringify(valor)) continue;
    cambios[`estudio/${t.id}/${coleccion}/${id}/${campo}`] = valor;
  }
  const n = Object.keys(cambios).length;
  if (!n) return aviso(!marcados.size ? `Marca primero ${alguno} ${uno}.` : "Los marcados ya estaban así.", true);
  try {
    await update(ref(db), cambios);
    await guardarMeta(t.id, {});
  } catch (e) {
    return aviso("No se pudo guardar: " + (e.code || e.message), true);
  }
  aviso(`Cambiado en ${plural(n, uno, varios)}.`);
}

function selloCaso(temaId, caso) {
  const ver = vercaso(temaId, caso.id);
  const estado = estadoVerificacion(caso, ver);
  if (estado === "verificado") return `<span class="sello">✓ Verificado por ${esc(ver.nombre)}</span>`;
  if (estado === "problema") return `<span class="sello malo">Problema señalado por ${esc(ver.nombre)}</span>`;
  if (estado === "cambiado") return `<span class="sello">Cambió tras la verificación</span>`;
  return `<span class="sello sin">Sin verificar</span>`;
}

function tarjetaCaso(t, caso, v) {
  const orden = lista(caso.imagenes).filter((r) => r.mostrar_en === "pregunta");
  const ver = vercaso(t.id, caso.id);
  const estado = estadoVerificacion(caso, ver);
  const reportados = reportesDe(t.id, caso.id);
  return `<div class="panel caso-card ${estado === "problema" || reportados.length ? "con-cambios" : ""}" style="display:grid;gap:8px">
    <div class="row" style="justify-content:space-between">
      <label class="row" style="gap:8px"><input type="checkbox" data-marcar="${esc(caso.id)}" ${marcados.has(caso.id) ? "checked" : ""}>
        <span class="tema">${esc(caso.tema || "sin subtema")}</span></label>
      <span class="src">${caso.tipo === "concepto" ? "concepto" : "imagen"} · ${selloCaso(t.id, caso)}</span>
    </div>
    <div class="row" style="gap:6px">${chipsClasificacion(t, caso)}${chipDificultad(caso)}
      ${caso.requiere_opciones ? `<span class="chip" title="En el modo sin alternativas se muestra con sus opciones">Necesita las opciones</span>` : ""}</div>
    ${estado === "problema" && ver.comentario ? `<p class="caja">${esc(ver.nombre)}: «${esc(ver.comentario)}»</p>` : ""}
    ${reportados.map((r) => `<p class="caja">Reporte de un usuario: «${esc(r.texto)}»</p>`).join("")}
    <div class="md">${md(caso.enunciado || "")}</div>
    ${orden.length ? `<div class="row">${orden.map((r) => `<img class="miniatura chica" src="${esc(imagenesTema[r.ref])}" alt="" data-zoom>`).join("")}</div>` : ""}
    <ol class="opciones-lista">${lista(caso.opciones).map((o, i) => `<li class="${i === caso.correcta ? "correcta" : ""}">${esc(o)}</li>`).join("")}</ol>
    ${problemasHTML(v.casos[caso.id])}
    <div class="row"><button data-editar="${esc(caso.id)}">Editar</button>
      <button data-subir="${esc(caso.id)}">↑</button><button data-bajar="${esc(caso.id)}">↓</button>
      <button data-borrar-caso="${esc(caso.id)}">Borrar</button></div>
  </div>`;
}

// El paso 3 tiene dos listas: los casos de opción múltiple y las lecturas (casos enteros para leer, sin
// alternativas). Se ve una a la vez; sin elegir, la que tenga el tema.
function vistaPaso3(t) {
  if (vista3) return vista3;
  return !casosOrdenados(t).length && lecturasOrdenadas(t).length ? "lecturas" : "casos";
}

function pasoCasos(t, v) {
  if (editando) return formularioCaso(t, editando);
  if (editandoLectura) return formularioLectura(t, editandoLectura, v);
  const casos = casosOrdenados(t);
  const lecturas = lecturasOrdenadas(t);
  for (const id of marcados) if (!elemento(t, id)) marcados.delete(id);   // borrados mientras tanto
  const vista = vistaPaso3(t);
  const pestana = (id, texto, n) => `<button role="tab" class="paso ${vista === id ? "activo" : ""}" data-vista3="${id}"
    aria-selected="${vista === id}">${texto} · ${n}</button>`;
  return `<section class="panel" style="display:grid;gap:12px">
    <h2>3. ${lecturas.length ? "Casos y lecturas" : "Casos"}</h2>
    <nav class="pasos-nav estudio-pestanas" role="tablist" aria-label="Qué lista ver">
      ${pestana("casos", "Casos de opción múltiple", casos.length)}${pestana("lecturas", "Lecturas", lecturas.length)}</nav>
    ${vista === "lecturas" ? seccionLecturas(t, v, lecturas) : seccionCasos(t, v, casos)}
    <div class="row"><button id="ir-publicar">Siguiente: publicar</button></div>
  </section>`;
}

function seccionCasos(t, v, casos) {
  const sinImagenes = !imagenesOrdenadas(t).length;
  const conErrores = casos.some((c) => v.casos[c.id].some((p) => p.tipo === "error"));
  return `${sinImagenes ? `<p class="caja">Primero sube las imágenes: así tu IA sabrá qué figuras puede usar.</p>` : ""}
    <div class="ia">
      <h3>Escribirlos con tu IA</h3>
      <p class="muted">Funciona con la que prefieras: ChatGPT, Gemini, Copilot, Claude, DeepSeek…</p>
      <ol class="pasos-ia">
        <li><button class="primary" id="copiar-ia">Copiar instrucciones</button></li>
        <li>Abre tu IA, <b>adjunta el PDF</b> de la fuente y pega las instrucciones.</li>
        <li>Copia su respuesta y pégala aquí abajo.</li>
      </ol>
      ${seguir && seguir.de !== "lecturas" ? `<div class="caja" style="display:grid;gap:8px"><p>${esc(seguir.mensaje)}</p>
        <div class="row"><button class="primary" id="copiar-seguir">Copiar el pedido para que siga</button></div></div>` : ""}
      <textarea id="respuesta-ia" rows="4" placeholder="Pega aquí la respuesta de tu IA (el JSON)"></textarea>
      <div class="row"><button id="cargar-ia">Cargar respuesta</button>
        <label class="row" style="gap:6px"><input type="checkbox" id="reemplazar"> Reemplazar los casos actuales</label>
        ${conErrores ? `<button id="copiar-correccion">Pedir a la IA que corrija</button>` : ""}
      </div>
      <details><summary>Ver las instrucciones</summary><pre class="instrucciones">${esc(instruccionesIA(t))}</pre></details>
    </div>
    <div class="row" style="justify-content:space-between"><h3>${plural(casos.length, "caso", "casos")}</h3>
      <button id="nuevo-caso">Agregar caso a mano</button></div>
    ${casos.length ? panelClasificar(t, casos) : ""}
    ${casos.length ? panelDificultad(casos) : ""}
    <div class="casos">${casos.map((c) => tarjetaCaso(t, c, v)).join("") || `<p class="muted">Todavía no hay casos.</p>`}</div>`;
}

// ---------- lecturas: un caso entero, como en los libros de casos (schema/lectura.schema.json)
let lecturasAbiertas = new Set();   // las que se ven enteras en el paso 3: sobreviven al redibujado

function seccionLecturas(t, v, lecturas) {
  const sinImagenes = !imagenesOrdenadas(t).length;
  const conErrores = lecturas.some((l) => v.lecturas[l.id].some((p) => p.tipo === "error"));
  return `<p class="muted">Una lectura es un caso entero, como en los libros de casos: en la página 1, el encabezado
      clínico, las figuras limpias y de 1 a 8 preguntas abiertas a la vista; al pasar la página, las respuestas, las
      figuras anotadas con su leyenda, la discusión y las perlas. No lleva alternativas.</p>
    ${sinImagenes ? `<p class="caja">Primero sube las figuras (paso 2): cada lectura parte de una imagen y tu IA las cita por su id.</p>` : ""}
    <div class="ia">
      <h3>Escribirlas con tu IA</h3>
      <ol class="pasos-ia">
        <li><button class="primary" id="copiar-ia-lecturas">Copiar instrucciones</button></li>
        <li>Abre tu IA, <b>adjunta el PDF</b> de la fuente y pega las instrucciones.</li>
        <li>Copia su respuesta y pégala aquí abajo.</li>
      </ol>
      ${seguir && seguir.de === "lecturas" ? `<div class="caja" style="display:grid;gap:8px"><p>${esc(seguir.mensaje)}</p>
        <div class="row"><button class="primary" id="copiar-seguir">Copiar el pedido para que siga</button></div></div>` : ""}
      <textarea id="respuesta-ia" rows="4" placeholder="Pega aquí la respuesta de tu IA (el JSON con «lecturas»)"></textarea>
      <div class="row"><button id="cargar-ia-lecturas">Cargar respuesta</button>
        <label class="row" style="gap:6px"><input type="checkbox" id="reemplazar-lecturas"> Reemplazar las lecturas actuales</label>
        ${conErrores ? `<button id="copiar-correccion-lecturas">Pedir a la IA que corrija</button>` : ""}
      </div>
      <details><summary>Ver las instrucciones</summary><pre class="instrucciones">${esc(instruccionesLecturas(t))}</pre></details>
    </div>
    <div class="row" style="justify-content:space-between"><h3>${plural(lecturas.length, "lectura", "lecturas")}</h3>
      <button id="nueva-lectura">Agregar lectura a mano</button></div>
    ${lecturas.length ? panelClasificar(t, lecturas) : ""}
    ${lecturas.length ? panelDificultad(lecturas, true) : ""}
    <div class="casos">${lecturas.map((l) => tarjetaLectura(t, l, v)).join("") || `<p class="muted">Todavía no hay lecturas.</p>`}</div>`;
}

function tarjetaLectura(t, l, v) {
  const ver = vercaso(t.id, l.id);
  const estado = estadoVerificacion(l, ver);
  const reportados = reportesDe(t.id, l.id);
  const limpias = lista(l.imagenes).filter((r) => r.mostrar_en !== "respuesta");
  const anotadas = lista(l.imagenes).length - limpias.length;
  const abierta = lecturasAbiertas.has(l.id);
  return `<div class="panel caso-card est-lec-card ${estado === "problema" || reportados.length ? "con-cambios" : ""}">
    <div class="row" style="justify-content:space-between">
      <label class="row" style="gap:8px"><input type="checkbox" data-marcar="${esc(l.id)}" ${marcados.has(l.id) ? "checked" : ""}>
        <span class="tema">${esc(l.tema || "sin diagnóstico")}</span></label>
      <span class="src"><code>${esc(l.id)}</code> · ${plural(lista(l.preguntas).length, "pregunta", "preguntas")} · ${selloCaso(t.id, l)}</span>
    </div>
    <div class="row" style="gap:6px">${chipsClasificacion(t, l)}${chipDificultad(l)}</div>
    ${estado === "problema" && ver.comentario ? `<p class="caja">${esc(ver.nombre)}: «${esc(ver.comentario)}»</p>` : ""}
    ${reportados.map((r) => `<p class="caja">Reporte de un usuario: «${esc(r.texto)}»</p>`).join("")}
    <p class="est-lec-presentacion">${esc(l.presentacion || "sin encabezado")}</p>
    ${limpias.length ? `<div class="row">${limpias.map((r) => `<img class="miniatura chica" src="${esc(imagenesTema[r.ref] || "")}" alt="" loading="lazy" data-zoom>`).join("")}
      ${anotadas ? `<span class="src">+ ${plural(anotadas, "anotada", "anotadas")} en la página 2</span>` : ""}</div>` : ""}
    ${problemasHTML(v.lecturas[l.id])}
    ${abierta ? vistaLectura(t, l) : ""}
    <div class="row"><button data-editar-lectura="${esc(l.id)}">Editar</button>
      <button data-ver-lectura="${esc(l.id)}" aria-expanded="${abierta}">${abierta ? "Ocultar" : "Ver entera"}</button>
      <button data-subir-lectura="${esc(l.id)}">↑</button><button data-bajar-lectura="${esc(l.id)}">↓</button>
      <button data-borrar-lectura="${esc(l.id)}">Borrar</button></div>
  </div>`;
}

// La lectura entera, como la verá quien lee: la página 1 y, debajo, lo que aparece al pasar la página. La usan la
// tarjeta del paso 3 («Ver entera») y la verificación.
function vistaLectura(t, l) {
  const refs = lista(l.imagenes);
  const nombre = (r) => (t.imagenes[r.ref] || {}).figura || r.ref;
  const figura = (r, conLeyenda) => `<figure class="est-lec-fig">
      ${imagenesTema[r.ref] ? `<img src="${esc(imagenesTema[r.ref])}" alt="${esc(nombre(r))}" loading="lazy" data-zoom>` : `<p class="src">sin archivo</p>`}
      <figcaption class="src">${esc(nombre(r))}${conLeyenda ? (r.leyenda ? ` · ${esc(r.leyenda)}` : " · sin leyenda") : ""}</figcaption></figure>`;
  const limpias = refs.filter((r) => r.mostrar_en !== "respuesta");
  const anotadas = refs.filter((r) => r.mostrar_en === "respuesta");
  const preguntas = lista(l.preguntas);
  const perlas = lista(l.perlas);
  return `<div class="est-lec-paginas">
    <div class="est-lec-pagina">
      <p class="eyebrow">Página 1</p>
      <p class="est-lec-presentacion">${esc(l.presentacion || "")}</p>
      ${limpias.length ? `<div class="est-lec-figs">${limpias.map((r) => figura(r, false)).join("")}</div>` : `<p class="src">Sin figuras en la página 1.</p>`}
      <ol class="est-lec-preguntas">${preguntas.map((q) => `<li><span class="chip">${esc(TIPOS_PREGUNTA[q.tipo] || q.tipo || "sin tipo")}</span>
        ${esc(q.pregunta || "")}</li>`).join("")}</ol>
    </div>
    <div class="est-lec-pagina">
      <p class="eyebrow">Página 2</p>
      <h4 class="est-lec-tema">${esc(l.tema || "")}</h4>
      <ol class="est-lec-respuestas">${preguntas.map((q) => `<li><b>${esc(q.pregunta || "")}</b>
        <div class="md">${md(q.respuesta || "")}</div>
        ${lista(q.puntos_clave).length ? `<p class="src">Puntos clave</p><ul class="est-lec-puntos">${lista(q.puntos_clave).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
        ${lista(q.aceptadas).length ? `<p class="src">Valen: ${lista(q.aceptadas).map(esc).join(" · ")}</p>` : ""}</li>`).join("")}</ol>
      ${anotadas.length ? `<div class="est-lec-figs">${anotadas.map((r) => figura(r, true)).join("")}</div>` : ""}
      ${l.explicacion ? `<div class="exp md">${md(l.explicacion)}</div>` : ""}
      ${perlas.length ? `<div class="pearl"><b>Perlas</b><ul>${perlas.map((x) => `<li>${md(x)}</li>`).join("")}</ul></div>` : ""}
    </div>
  </div>`;
}

function formularioCaso(t, id) {
  const caso = t.casos[id] || {};
  const imagenes = imagenesOrdenadas(t);
  const evidencia = lista(caso.evidencia);
  return `<section class="panel" style="display:grid;gap:12px">
    <h2>Caso</h2>
    <div class="row">
      <label class="grid-label crece">Subtema<input type="text" id="c-tema" maxlength="80" value="${esc(caso.tema || "")}" placeholder="Desplazamiento discal"></label>
      <label class="grid-label">Tipo<select id="c-tipo">
        <option value="imagen" ${caso.tipo !== "concepto" ? "selected" : ""}>Se responde mirando la imagen</option>
        <option value="concepto" ${caso.tipo === "concepto" ? "selected" : ""}>Se responde sin imagen</option>
      </select></label>
    </div>
    <label class="grid-label">Pregunta<textarea id="c-enunciado" rows="3">${esc(caso.enunciado || "")}</textarea></label>
    <div class="grid-label">Imágenes
      <div class="galeria chica">${imagenes.map((img) => {
        const usada = lista(caso.imagenes).find((r) => r.ref === img.id);
        return `<label class="panel" style="display:grid;gap:6px">
          <img class="miniatura chica" src="${esc(imagenesTema[img.id])}" alt="">
          <span class="src">${esc(img.figura || img.id)}</span>
          <select data-img="${esc(img.id)}">
            <option value="">No usar</option>
            <option value="pregunta" ${usada?.mostrar_en === "pregunta" ? "selected" : ""}>En la pregunta</option>
            <option value="respuesta" ${usada?.mostrar_en === "respuesta" ? "selected" : ""}>Solo en la respuesta</option>
          </select></label>`;
      }).join("") || `<p class="muted">Sin imágenes cargadas.</p>`}</div></div>
    <div class="grid-label">Opciones (marca la correcta)
      ${[0, 1, 2, 3, 4].map((i) => `<div class="row" style="gap:8px">
        <input type="radio" name="correcta" value="${i}" ${caso.correcta === i ? "checked" : ""}>
        <span class="k chica">${LETRAS[i]}</span>
        <input type="text" class="opcion" data-i="${i}" maxlength="160" style="flex:1" value="${esc(lista(caso.opciones)[i] || "")}">
      </div>`).join("")}</div>
    <label class="grid-label">Explicación (una idea por línea, empezando con «- »)
      <textarea id="c-explicacion" rows="4">${esc(caso.explicacion || "")}</textarea></label>
    <label class="grid-label">Perla (opcional)<input type="text" id="c-perla" maxlength="200" value="${esc(caso.perla || "")}"></label>
    <div class="grid-label">Evidencia: dónde lo dice la fuente y la frase textual
      <div id="evidencias">${(evidencia.length ? evidencia : [{ ubicacion: "", cita: "" }]).map((e, i) => `
        <div class="row evidencia" style="gap:8px">
          <input type="text" class="ev-ubicacion" style="width:30%" placeholder="p. 5, Figura 2" value="${esc(e.ubicacion || "")}">
          <input type="text" class="ev-cita" style="flex:1" placeholder="Frase copiada de la fuente" value="${esc(e.cita || "")}">
        </div>`).join("")}</div>
      <button id="mas-evidencia" type="button">Agregar otra frase</button></div>
    <div class="grid-label">Clasificación: segmento y área (el primero es el principal)
      <div id="clasificacion" style="display:grid;gap:8px">${clasificacionDe(caso, t.meta.segmento).map(filaClasificacion).join("")}</div>
      <button type="button" id="mas-clasificacion">Agregar otro segmento</button></div>
    <label class="grid-label">Etiquetas (separadas por comas)<input type="text" id="c-etiquetas" value="${esc(lista(caso.etiquetas).join(", "))}"></label>
    <div class="row">
      <label class="grid-label">Dificultad (no la ve el residente)<select id="c-nivel">${opcionesNivel(caso.dificultad?.nivel || "", "Sin asignar")}</select></label>
      <label class="grid-label crece">Motivo: ETC I/II/III, frecuencia, lo que dice la fuente
        <input type="text" id="c-motivo" maxlength="300" value="${esc(caso.dificultad?.motivo || "")}"></label>
    </div>
    <label class="row" style="gap:8px"><input type="checkbox" id="c-requiere" ${caso.requiere_opciones ? "checked" : ""}>
      Necesita ver las opciones para contestarse (en el modo sin alternativas se muestra con ellas)</label>
    ${pareceRequerirOpciones(caso.enunciado) && !caso.requiere_opciones
      ? `<p class="src">La pregunta parece remitir a las opciones. Prueba a taparlas: si igual se contesta, deja la casilla sin marcar.</p>` : ""}
    <div class="row"><button class="primary" id="guardar-caso">Guardar caso</button><button id="cancelar-caso">Cancelar</button></div>
  </section>`;
}

// ---------- formulario de una lectura. Las preguntas y las figuras se agregan, quitan y ordenan en la página, sin
// redibujar: el formulario se lee entero al guardar.
function opcionesTipo(elegido) {
  return Object.entries(TIPOS_PREGUNTA)
    .map(([id, nombre]) => `<option value="${id}" ${id === elegido ? "selected" : ""}>${esc(nombre)}</option>`).join("");
}

function bloquePregunta(q = {}) {
  return `<fieldset class="est-lec-pregunta">
    <legend>Pregunta <span class="lp-n"></span></legend>
    <div class="row" style="justify-content:space-between;align-items:end">
      <label class="grid-label">Tipo<select class="lp-tipo">${opcionesTipo(q.tipo || "otra")}</select></label>
      <span class="row" style="gap:6px"><button type="button" class="lp-subir" aria-label="Subir">↑</button>
        <button type="button" class="lp-bajar" aria-label="Bajar">↓</button><button type="button" class="lp-quitar">Quitar</button></span>
    </div>
    <label class="grid-label">Pregunta (sin la respuesta: se ve en la página 1 con las demás)
      <textarea class="lp-pregunta" rows="2" maxlength="300">${esc(q.pregunta || "")}</textarea></label>
    <label class="grid-label">Respuesta (de la fuente, con palabras propias)
      <textarea class="lp-respuesta" rows="3" maxlength="1500">${esc(q.respuesta || "")}</textarea></label>
    <div class="row">
      <label class="grid-label crece">Puntos clave, uno por línea (obligatorios en «Hallazgos»)
        <textarea class="lp-puntos" rows="3">${esc(lista(q.puntos_clave).join("\n"))}</textarea></label>
      <label class="grid-label crece">Respuestas aceptadas, una por línea (obligatorias en «Diagnóstico»)
        <textarea class="lp-aceptadas" rows="3">${esc(lista(q.aceptadas).join("\n"))}</textarea></label>
    </div>
  </fieldset>`;
}

function filaFiguraLectura(t, r) {
  const ficha = t.imagenes[r.ref] || {};
  return `<div class="est-lec-fila-fig" data-ref="${esc(r.ref)}">
    ${imagenesTema[r.ref] ? `<img class="miniatura chica" src="${esc(imagenesTema[r.ref])}" alt="" data-zoom>` : `<span class="src">sin archivo</span>`}
    <div class="est-lec-fila-datos">
      <span class="src">${esc(ficha.figura || r.ref)} · <code>${esc(r.ref)}</code>${t.imagenes[r.ref] ? "" : " · no está en el catálogo"}</span>
      <select class="lf-donde" aria-label="Dónde se ve">
        <option value="pregunta" ${r.mostrar_en !== "respuesta" ? "selected" : ""}>Página 1: limpia</option>
        <option value="respuesta" ${r.mostrar_en === "respuesta" ? "selected" : ""}>Página 2: anotada</option>
      </select>
      <textarea class="lf-leyenda" rows="2" maxlength="600" aria-label="Leyenda en español"
        placeholder="Leyenda en español, con palabras propias: qué muestra y qué señala cada marca (se ve en la página 2)">${esc(r.leyenda || "")}</textarea>
    </div>
    <span class="row" style="gap:6px"><button type="button" class="lf-subir" aria-label="Subir">↑</button>
      <button type="button" class="lf-bajar" aria-label="Bajar">↓</button><button type="button" class="lf-quitar">Quitar</button></span>
  </div>`;
}

// Las figuras del catálogo que se pueden agregar. Sin búsqueda, las que no usa ningún caso ni lectura: al armar
// una lectura nueva son casi siempre las suyas. Como mucho 40, para que un libro de mil figuras no pese.
function catalogoLectura(t, idLectura, filtro, enFormulario) {
  const usadas = new Set([...casosOrdenados(t), ...lecturasOrdenadas(t).filter((l) => l.id !== idLectura)]
    .flatMap((x) => lista(x.imagenes).map((r) => r.ref)));
  const buscado = slug(filtro);
  const candidatas = imagenesOrdenadas(t).filter((img) => !enFormulario.has(img.id)
    && (buscado ? slug(`${img.id} ${img.figura} ${img.leyenda_original}`).includes(buscado) : !usadas.has(img.id)));
  if (!candidatas.length) {
    return `<p class="muted">${buscado ? "Ninguna figura coincide." : "Todas las figuras ya las usa algún caso o lectura: búscalas por nombre o id."}</p>`;
  }
  return candidatas.slice(0, 40).map((img) => `<div class="panel" style="display:grid;gap:6px">
      ${imagenesTema[img.id] ? `<img class="miniatura chica" src="${esc(imagenesTema[img.id])}" alt="" loading="lazy" data-zoom>` : ""}
      <span class="src">${esc(img.figura || img.id)} · <code>${esc(img.id)}</code></span>
      <span class="row" style="gap:6px"><button type="button" data-agregar-fig="${esc(img.id)}" data-donde="pregunta">A la página 1</button>
        <button type="button" data-agregar-fig="${esc(img.id)}" data-donde="respuesta">A la página 2</button></span>
    </div>`).join("") + (candidatas.length > 40 ? `<p class="src">Hay ${candidatas.length}: escribe para acotar.</p>` : "");
}

function formularioLectura(t, id, v) {
  const l = t.lecturas[id] || {};
  const nueva = !t.lecturas[id];
  const preguntas = lista(l.preguntas).length ? lista(l.preguntas)
    : [{ tipo: "hallazgos" }, { tipo: "diagnostico" }];
  const evidencia = lista(l.evidencia);
  return `<section class="panel" style="display:grid;gap:12px">
    <h2>${nueva ? "Lectura nueva" : "Lectura"} <code>${esc(id)}</code></h2>
    ${nueva ? "" : problemasHTML(v.lecturas[id])}
    <label class="grid-label">Diagnóstico o tema (solo se ve al pasar la página)
      <input type="text" id="l-tema" maxlength="120" value="${esc(l.tema || "")}" placeholder="Fractura de Maisonneuve"></label>
    <label class="grid-label">Encabezado clínico de una línea (página 1: ni hallazgos ni diagnóstico)
      <input type="text" id="l-presentacion" maxlength="200" value="${esc(l.presentacion || "")}" placeholder="Dolor de tobillo tras una caída."></label>
    <div class="grid-label">Figuras
      <p class="src">Página 1: las limpias, en el orden en que se miran. Página 2: las anotadas, cada una con su leyenda en
        español. Una figura con flechas o rótulos que delatan la respuesta va en la página 2.</p>
      <div id="l-figuras" class="est-lec-figuras">${lista(l.imagenes).map((r) => filaFiguraLectura(t, r)).join("")}</div>
      <details id="l-catalogo-caja" ${lista(l.imagenes).length ? "" : "open"}><summary>Agregar figuras del catálogo</summary>
        <div style="display:grid;gap:10px;margin-top:10px">
          <input type="search" id="l-buscar-figura" placeholder="Busca por nombre, id o leyenda (vacío: las que no usa nadie)">
          <div id="l-catalogo" class="galeria chica"></div>
        </div></details>
    </div>
    <div class="grid-label">Preguntas (de 1 a 8, en el orden del razonamiento; todas se ven a la vez en la página 1)
      <div id="l-preguntas" class="est-lec-preguntas-form">${preguntas.map(bloquePregunta).join("")}</div>
      <button type="button" id="l-mas-pregunta">Agregar pregunta</button></div>
    <label class="grid-label">Discusión (una idea por línea, empezando con «- »)
      <textarea id="l-explicacion" rows="5">${esc(l.explicacion || "")}</textarea></label>
    <label class="grid-label">Perlas (una por línea)
      <textarea id="l-perlas" rows="3">${esc(lista(l.perlas).join("\n"))}</textarea></label>
    <div class="grid-label">Evidencia: dónde lo dice la fuente y la frase textual
      <div id="evidencias">${(evidencia.length ? evidencia : [{ ubicacion: "", cita: "" }]).map((e) => `
        <div class="row evidencia" style="gap:8px">
          <input type="text" class="ev-ubicacion" style="width:30%" placeholder="p. 5, caso 12" value="${esc(e.ubicacion || "")}">
          <input type="text" class="ev-cita" style="flex:1" placeholder="Frase copiada de la fuente" value="${esc(e.cita || "")}">
        </div>`).join("")}</div>
      <button id="mas-evidencia" type="button">Agregar otra frase</button></div>
    <div class="grid-label">Clasificación: segmento y área (el primero es el principal)
      <div id="clasificacion" style="display:grid;gap:8px">${clasificacionDe(l, t.meta.segmento).map(filaClasificacion).join("")}</div>
      <button type="button" id="mas-clasificacion">Agregar otro segmento</button></div>
    <label class="grid-label">Etiquetas (separadas por comas)<input type="text" id="l-etiquetas" value="${esc(lista(l.etiquetas).join(", "))}"></label>
    <div class="row">
      <label class="grid-label">Dificultad (no la ve el residente)<select id="l-nivel">${opcionesNivel(l.dificultad?.nivel || "", "Sin asignar")}</select></label>
      <label class="grid-label crece">Motivo: ETC I/II/III, frecuencia, lo que dice la fuente
        <input type="text" id="l-motivo" maxlength="300" value="${esc(l.dificultad?.motivo || "")}"></label>
    </div>
    <div class="row"><button class="primary" id="guardar-lectura">Guardar lectura</button><button id="cancelar-lectura">Cancelar</button></div>
  </section>`;
}

function pasoPublicar(t, v) {
  const casos = casosOrdenados(t);
  const lecturas = lecturasOrdenadas(t);
  const conError = casos.filter((c) => v.casos[c.id].some((p) => p.tipo === "error")).length;
  const lecturasConError = lecturas.filter((l) => v.lecturas[l.id].some((p) => p.tipo === "error")).length;
  const n = cuentas(t);
  const publicado = t.meta.estado === "publicado";
  return `<section class="panel" style="display:grid;gap:12px">
    <h2>4. Publicar</h2>
    <div class="tabla"><table><tbody>
      <tr><td>Fuente y licencia</td><td>${v.fuente.some((p) => p.tipo === "error") ? "Falta completar" : "Lista"}</td></tr>
      <tr><td>Imágenes</td><td>${imagenesOrdenadas(t).length}</td></tr>
      <tr><td>Casos</td><td>${casos.length}${conError ? ` · ${conError} con problemas` : ""}</td></tr>
      ${lecturas.length ? `<tr><td>Lecturas</td><td>${lecturas.length}${lecturasConError ? ` · ${lecturasConError} con problemas` : ""}</td></tr>` : ""}
      <tr><td>Avisos</td><td>${v.avisos}</td></tr>
      ${publicado ? `<tr><td>Verificados</td><td>${n.verificados} de ${n.total}</td></tr>` : ""}
    </tbody></table></div>
    ${problemasHTML(v.tema)}
    ${v.errores
      ? `<p class="caja">Faltan ${v.errores} cosas por corregir. Revisa los pasos marcados con •.</p>`
      : `<p class="caja">Al publicar, ${lecturas.length ? (casos.length ? "los casos y las lecturas" : "las lecturas") : "los casos"} quedan disponibles en la web como <b>sin verificar</b>. Cualquier radiólogo
          del equipo puede ponerles el sello de verificado; mientras tanto, las salas en vivo no los usan salvo que el
          presentador lo pida. Las figuras se alojan en <b>tu Google Drive</b>, compartidas por enlace: RadQuiz solo
          guarda ese enlace.</p>`}
    <div class="row">
      <button class="primary" id="publicar" ${v.errores || publicando ? "disabled" : ""}>
        ${publicando ? esc(publicando) : publicado ? (sinPublicar(t) ? "Publicar cambios" : "Volver a publicar") : "Publicar"}</button>
      <button id="descargar-zip">Descargar .zip</button>
      ${publicado && (soyAutor(t) || esCoord()) ? `<button id="ocultar">${t.meta.oculto ? "Mostrar en la web" : "Ocultar de la web"}</button>` : ""}
      ${publicado && esCoord() ? `<button id="despublicar">Quitar de la web</button>` : ""}
      <button class="peligrosa" id="borrar-tema">Borrar este cuestionario</button>
    </div>
    ${publicado && t.meta.oculto
      ? `<p class="caja"><b>Oculto.</b> No sale en la portada, ni en la práctica, el tablero o el Tabú: solo se juega en
          una sala que abras desde aquí, y quien entra con el código lo ve en su celular.
          <a class="boton" href="${esc(enlaceSala(t))}" target="_blank" rel="noopener">Presentar en una sala</a>
          Cuando termines, pulsa «Mostrar en la web» y queda libre para todos.</p>` : ""}
    <p class="src">El .zip lleva lo mismo que se publica —paquete.json, fuentes.json e img/— y se puede volver a
      subir aquí o mandar al repositorio. Descarga uno antes de borrar si quieres conservarlo.</p>
    ${publicado ? `<p class="src">Publicado el ${new Date(t.meta.publicado_en || Date.now()).toLocaleDateString("es-PE")}.${t.meta.oculto ? "" : " Ya se puede practicar en la web."}</p>` : ""}
    ${publicado && lecturas.length ? `<div class="row est-lec-enlaces"><span class="src">Las lecturas:</span>
      <a class="boton" href="${esc(enlaceLectura(t))}" target="_blank" rel="noopener">Leer</a>
      <a class="boton" href="${esc(enlaceLectura(t, true))}" target="_blank" rel="noopener">Proyectar</a></div>` : ""}
    ${!publicado ? `<label class="row"><input type="checkbox" id="publicar-oculto" ${t.meta.oculto ? "checked" : ""}> Publicar oculto: solo para
      presentarlo en una sala; después lo muestras en la web</label>` : ""}
    ${driveEsMio(t)
      ? `<p class="src">Las figuras publicadas están en tu Google Drive: <a href="${esc(enlaceCarpeta(t.meta.drive_carpeta))}" target="_blank" rel="noopener">abrir la carpeta</a>.
          Si las borras de ahí, el tema se queda sin imágenes.</p>`
      : t.meta.drive_nombre ? `<p class="src">Las figuras publicadas están en el Google Drive de ${esc(t.meta.drive_nombre)}.</p>` : ""}
  </section>`;
}

// ---------- revisión
function panelVerificacion(t) {
  const casos = [...casosOrdenados(t), ...lecturasOrdenadas(t)];
  if (!ordenVerificacion) {
    const peso = { problema: 0, "sin verificar": 1, cambiado: 2, verificado: 3 };
    ordenVerificacion = casos
      .map((c) => ({ id: c.id, estado: estadoVerificacion(c, vercaso(t.id, c.id)), reportes: reportesDe(t.id, c.id).length }))
      .sort((a, b) => (b.reportes - a.reportes) || (peso[a.estado] - peso[b.estado]))
      .map((x) => x.id);
  }
  const porId = new Map(casos.map((c) => [c.id, c]));
  const conPrioridad = ordenVerificacion.filter((id) => porId.has(id)).map((id) => ({ c: porId.get(id) }));
  const n = cuentas(t);
  return `<section style="display:grid;gap:14px">
    <p class="caja">Verifica lo que puedas: cada caso o lectura que apruebes queda con tu nombre y se marca como
      verificado en la web. Arriba aparecen primero los reportados y los que nadie ha mirado.${soyAutor(t)
        ? " Este tema es tuyo: el sello dirá que lo verificaste tú, así que conviene que otro radiólogo lo mire también." : ""}</p>
    <div class="row"><span class="chip">${n.verificados} ${n.verificados === 1 ? "verificado" : "verificados"} de ${n.total}</span>
      ${n.reportados ? `<span class="chip">${n.reportados} con reportes</span>` : ""}
      <button id="verificar-todo">Verificar todos los que faltan</button></div>
    ${conPrioridad.map(({ c }) => (t.lecturas[c.id] ? lecturaVerificable(t, c) : casoVerificable(t, c))).join("")}
  </section>`;
}

function casoVerificable(t, caso) {
  const ver = vercaso(t.id, caso.id);
  const estado = estadoVerificacion(caso, ver);
  const refs = lista(caso.imagenes);
  const v = validarCaso(caso, t.imagenes, t.meta.segmento);
  const reportados = reportesDe(t.id, caso.id);
  return `<section class="panel caso-revision ${estado === "verificado" ? "aprobado" : estado === "problema" ? "cambios" : estado === "cambiado" ? "cambiado" : ""}" style="display:grid;gap:10px">
    <div class="row" style="justify-content:space-between"><span class="tema">${esc(caso.tema || "")}</span>
      <span class="src">${selloCaso(t.id, caso)}</span></div>
    <div class="row" style="gap:6px">${chipsClasificacion(t, caso)}</div>
    ${reportados.map((r) => `<p class="caja">Reporte de un usuario: «${esc(r.texto)}»</p>`).join("")}
    <div class="stage ${refs.length ? "" : "sin-imagen"}">
      ${refs.length ? `<div class="viewer">${refs.map((r) => `<figure><img src="${esc(imagenesTema[r.ref])}" alt="" data-zoom>
        <figcaption class="cap"><span>${esc((t.imagenes[r.ref] || {}).figura || "")} · ${r.mostrar_en === "respuesta" ? "solo en la respuesta" : "en la pregunta"}</span></figcaption></figure>`).join("")}</div>` : ""}
      <div style="display:grid;gap:10px">
        <div class="stem md">${md(caso.enunciado || "")}</div>
        <div class="opts">${lista(caso.opciones).map((o, i) => `<div class="opt ${i === caso.correcta ? "right" : ""}" data-k="${i}">
          <span class="k">${LETRAS[i]}</span><span>${esc(o)}</span><span class="n"></span></div>`).join("")}</div>
        <div class="exp md">${md(caso.explicacion || "")}</div>
        ${caso.perla ? `<div class="pearl md">${md(caso.perla)}</div>` : ""}
      </div>
    </div>
    <details><summary>Evidencia y ficha</summary>
      ${lista(caso.evidencia).map((e) => `<p class="ubic">${esc(e.ubicacion)}</p><blockquote>${esc(e.cita)}</blockquote>`).join("")}
      ${refs.map((r) => `<p class="src">${esc((t.imagenes[r.ref] || {}).figura || "")}: ${esc((t.imagenes[r.ref] || {}).leyenda_original || "sin leyenda")}</p>`).join("")}
    </details>
    ${problemasHTML(v)}
    ${ver?.comentario ? `<p class="src">Comentario: «${esc(ver.comentario)}»</p>` : ""}
    <div class="row">
      <button class="primary" data-verificar="${esc(caso.id)}">Verificar</button>
      <button data-problema="${esc(caso.id)}">Señalar problema</button>
    </div>
  </section>`;
}

// La lectura entera, con las dos páginas a la vista: lo que verifica el radiólogo es todo lo que verá quien lee.
function lecturaVerificable(t, l) {
  const ver = vercaso(t.id, l.id);
  const estado = estadoVerificacion(l, ver);
  const v = validarLectura(l, t.imagenes, t.meta.segmento);
  const reportados = reportesDe(t.id, l.id);
  return `<section class="panel caso-revision est-lec-revision ${estado === "verificado" ? "aprobado" : estado === "problema" ? "cambios" : estado === "cambiado" ? "cambiado" : ""}" style="display:grid;gap:10px">
    <div class="row" style="justify-content:space-between"><span class="tema">Lectura <code>${esc(l.id)}</code> · ${esc(l.tema || "")}</span>
      <span class="src">${selloCaso(t.id, l)}</span></div>
    <div class="row" style="gap:6px">${chipsClasificacion(t, l)}${chipDificultad(l)}</div>
    ${reportados.map((r) => `<p class="caja">Reporte de un usuario: «${esc(r.texto)}»</p>`).join("")}
    ${vistaLectura(t, l)}
    <details><summary>Evidencia y fichas</summary>
      ${lista(l.evidencia).map((e) => `<p class="ubic">${esc(e.ubicacion)}</p><blockquote>${esc(e.cita)}</blockquote>`).join("")}
      ${lista(l.imagenes).map((r) => `<p class="src">${esc((t.imagenes[r.ref] || {}).figura || r.ref)}: ${esc((t.imagenes[r.ref] || {}).leyenda_original || "sin leyenda")}</p>`).join("")}
    </details>
    ${problemasHTML(v)}
    ${ver?.comentario ? `<p class="src">Comentario: «${esc(ver.comentario)}»</p>` : ""}
    <div class="row">
      <button class="primary" data-verificar="${esc(l.id)}">Verificar</button>
      <button data-problema="${esc(l.id)}">Señalar problema</button>
    </div>
  </section>`;
}

// ------------------------------------------------------------------ acciones del editor
function enlazarEditor(t) {
  const id = t.id;
  app.querySelectorAll("[data-paso]").forEach((b) => {
    b.onclick = () => { paso = b.dataset.paso; editando = null; editandoLectura = null; dibujar(); };
  });
  $("#ir-imagenes") && ($("#ir-imagenes").onclick = () => { paso = "imagenes"; dibujar(); });
  $("#ir-casos") && ($("#ir-casos").onclick = () => { paso = "casos"; dibujar(); });
  $("#ir-publicar") && ($("#ir-publicar").onclick = () => { paso = "publicar"; dibujar(); });

  if (paso === "fuente") {
    $("#buscar").onclick = () => buscarDoi(id);
    $("#guardar-fuente").onclick = () => guardarFuente(id);
  }
  if (paso === "imagenes") {
    const entrada = $("#archivos");
    $("#soltar").onclick = () => entrada.click();
    entrada.onchange = () => subirImagenes(id, entrada.files);
    $("#soltar").ondragover = (e) => { e.preventDefault(); $("#soltar").classList.add("encima"); };
    $("#soltar").ondragleave = () => $("#soltar").classList.remove("encima");
    $("#soltar").ondrop = (e) => { e.preventDefault(); $("#soltar").classList.remove("encima"); subirImagenes(id, e.dataTransfer.files); };
    app.querySelectorAll("[data-guardar-img]").forEach((b) => { b.onclick = () => guardarImagen(id, b.dataset.guardarImg); });
    app.querySelectorAll("[data-borrar-img]").forEach((b) => { b.onclick = () => borrarImagen(id, b.dataset.borrarImg); });
  }
  if (paso === "casos" && !editando && !editandoLectura) {
    app.querySelectorAll("[data-vista3]").forEach((b) => {
      b.onclick = () => { vista3 = b.dataset.vista3; marcados = new Set(); dibujar(); };
    });
    const pedirResto = $("#copiar-seguir");
    if (pedirResto) pedirResto.onclick = () => copiar(seguir.texto, "Copiado. Pégalo en la misma conversación con tu IA.");
    enlazarClasificar(t);
    if (vistaPaso3(t) === "lecturas") enlazarLecturas(t);
  }
  if (paso === "casos" && editandoLectura) enlazarFormularioLectura(t, editandoLectura);
  if (paso === "casos" && !editando && !editandoLectura && vistaPaso3(t) === "casos") {
    $("#copiar-ia").onclick = () => copiar(instruccionesIA(t));
    $("#cargar-ia").onclick = () => cargarRespuesta(t);
    $("#nuevo-caso").onclick = () => { editando = `caso-${String(casosOrdenados(t).length + 1).padStart(2, "0")}`; dibujar(); };
    const corregir = $("#copiar-correccion");
    if (corregir) corregir.onclick = () => {
      const v = validarTema(t);
      const problemas = casosOrdenados(t)
        .filter((c) => v.casos[c.id].length)
        .map((c) => ({ caso: c.tema || c.id, textos: v.casos[c.id].map((p) => p.texto) }));
      copiar(instruccionesCorreccion(t, problemas), "Copiado. Pégalo en tu IA junto al PDF.");
    };
    app.querySelectorAll("[data-editar]").forEach((b) => { b.onclick = () => { editando = b.dataset.editar; dibujar(); }; });
    app.querySelectorAll("[data-borrar-caso]").forEach((b) => {
      b.onclick = () => {
        const caso = t.casos[b.dataset.borrarCaso] || {};
        const nombre = caso.tema || caso.enunciado || b.dataset.borrarCaso;
        if (!confirm(`¿Borrar el caso «${nombre.slice(0, 80)}»? No se puede deshacer.`)) return;
        remove(ref(db, `estudio/${id}/casos/${b.dataset.borrarCaso}`)).catch((e) => aviso("No se pudo borrar: " + (e.code || e.message), true));
      };
    });
    app.querySelectorAll("[data-subir]").forEach((b) => { b.onclick = () => mover(t, b.dataset.subir, -1); });
    app.querySelectorAll("[data-bajar]").forEach((b) => { b.onclick = () => mover(t, b.dataset.bajar, 1); });
  }
  if (paso === "casos" && editando) {
    $("#guardar-caso").onclick = () => guardarCaso(t, editando);
    $("#cancelar-caso").onclick = () => { editando = null; dibujar(); };
    enlazarClasifEvidencia(t);
  }
  if (paso === "publicar") {
    $("#publicar").onclick = () => publicar(t);
    $("#descargar-zip").onclick = () => descargarZip(t);
    const casillaOculto = $("#publicar-oculto");
    if (casillaOculto) casillaOculto.onchange = () => guardarMeta(id, { oculto: casillaOculto.checked || null });
    const ocultar = $("#ocultar");
    if (ocultar) ocultar.onclick = () => cambiarOculto(t, !t.meta.oculto);
    const quitar = $("#despublicar");
    if (quitar) quitar.onclick = async () => {
      if (!confirm("¿Quitar este tema de la web? Los casos siguen guardados en el estudio.")) return;
      await remove(ref(db, `publicacion/${id}`)).catch(() => {});
      await remove(ref(db, `publicacion_img/${id}`)).catch(() => {});
      await remove(ref(db, `indice_casos/${id}`)).catch(() => {});
      const delIndice = await anotarEnIndice(id, {
        titulo: t.meta.titulo, segmento: t.meta.segmento, retirado: true,
      });
      await guardarMeta(id, { estado: "borrador" });
      // Las figuras están en el Drive del autor: RadQuiz ya no las muestra, pero siguen compartidas por
      // enlace hasta que él las borre.
      const enDrive = ID_DRIVE.test(t.meta.drive_carpeta || "")
        ? driveEsMio(t)
          ? " Las figuras siguen en tu Drive: si también quieres retirarlas, borra la carpeta (enlace en el paso 4)."
          : ` Las figuras siguen en el Drive de ${t.meta.drive_nombre || "quien lo publicó"}: pídele que las borre si hace falta.`
        : "";
      aviso((delIndice ? "Quitado de la web." : "Quitado. Tarda unos minutos en desaparecer de la web.") + enDrive);
    };
    $("#borrar-tema").onclick = () => borrarTema(t);
  }
}

// La lista de lecturas del paso 3.
function enlazarLecturas(t) {
  const id = t.id;
  $("#copiar-ia-lecturas").onclick = () => copiar(instruccionesLecturas(t));
  $("#cargar-ia-lecturas").onclick = () => cargarRespuesta(t, "lecturas");
  $("#nueva-lectura").onclick = () => {
    const usados = new Set([...Object.keys(t.casos), ...Object.keys(t.lecturas)]);
    let n = lecturasOrdenadas(t).length + 1;
    while (usados.has(`lectura-${String(n).padStart(2, "0")}`)) n += 1;
    editandoLectura = `lectura-${String(n).padStart(2, "0")}`;
    dibujar();
  };
  const corregir = $("#copiar-correccion-lecturas");
  if (corregir) corregir.onclick = () => {
    const v = validarTema(t);
    const problemas = lecturasOrdenadas(t)
      .filter((l) => v.lecturas[l.id].length)
      .map((l) => ({ id: l.id, tema: l.tema || "sin diagnóstico", textos: v.lecturas[l.id].map((p) => p.texto) }));
    copiar(instruccionesCorreccionLecturas(t, problemas), "Copiado. Pégalo en tu IA junto al PDF.");
  };
  app.querySelectorAll("[data-editar-lectura]").forEach((b) => { b.onclick = () => { editandoLectura = b.dataset.editarLectura; dibujar(); }; });
  app.querySelectorAll("[data-ver-lectura]").forEach((b) => {
    b.onclick = () => {
      const lid = b.dataset.verLectura;
      if (lecturasAbiertas.has(lid)) lecturasAbiertas.delete(lid);
      else lecturasAbiertas.add(lid);
      dibujar();
    };
  });
  app.querySelectorAll("[data-borrar-lectura]").forEach((b) => {
    b.onclick = () => {
      const l = t.lecturas[b.dataset.borrarLectura] || {};
      const nombre = l.tema || l.presentacion || b.dataset.borrarLectura;
      if (!confirm(`¿Borrar la lectura «${nombre.slice(0, 80)}»? No se puede deshacer.`)) return;
      remove(ref(db, `estudio/${id}/lecturas/${b.dataset.borrarLectura}`))
        .then(() => guardarMeta(id, {}))
        .catch((e) => aviso("No se pudo borrar: " + (e.code || e.message), true));
    };
  });
  app.querySelectorAll("[data-subir-lectura]").forEach((b) => { b.onclick = () => mover(t, b.dataset.subirLectura, -1, "lecturas"); });
  app.querySelectorAll("[data-bajar-lectura]").forEach((b) => { b.onclick = () => mover(t, b.dataset.bajarLectura, 1, "lecturas"); });
}

// El formulario de una lectura: preguntas y figuras se mueven en la página; nada se guarda hasta «Guardar».
function enlazarFormularioLectura(t, idLectura) {
  $("#guardar-lectura").onclick = () => guardarLectura(t, idLectura);
  $("#cancelar-lectura").onclick = () => { editandoLectura = null; dibujar(); };
  enlazarClasifEvidencia(t);
  // Subir, bajar o quitar un bloque dentro de su contenedor.
  const mover_ = (nodo, accion) => {
    if (accion === "subir" && nodo.previousElementSibling) nodo.previousElementSibling.before(nodo);
    if (accion === "bajar" && nodo.nextElementSibling) nodo.nextElementSibling.after(nodo);
    if (accion === "quitar") nodo.remove();
  };
  const preguntas = $("#l-preguntas");
  preguntas.onclick = (e) => {
    const boton = e.target.closest("button");
    const bloque_ = e.target.closest(".est-lec-pregunta");
    if (!boton || !bloque_) return;
    const accion = boton.className.replace("lp-", "");
    if (accion === "quitar" && preguntas.children.length === 1) return aviso("Hace falta al menos una pregunta.", true);
    mover_(bloque_, accion);
  };
  $("#l-mas-pregunta").onclick = () => {
    if (preguntas.children.length >= 8) return aviso("Caben 8 preguntas como mucho.", true);
    preguntas.insertAdjacentHTML("beforeend", bloquePregunta({ tipo: "otra" }));
    preguntas.lastElementChild.querySelector(".lp-pregunta").focus();
  };
  const figuras = $("#l-figuras");
  const enFormulario = () => new Set([...figuras.querySelectorAll(".est-lec-fila-fig")].map((f) => f.dataset.ref));
  const catalogo = $("#l-catalogo");
  const buscar = $("#l-buscar-figura");
  const pintarCatalogo = () => { catalogo.innerHTML = catalogoLectura(t, idLectura, buscar.value, enFormulario()); };
  figuras.onclick = (e) => {
    const boton = e.target.closest("button");
    const fila = e.target.closest(".est-lec-fila-fig");
    if (!boton || !fila) return;
    mover_(fila, boton.className.replace("lf-", ""));
    if ($("#l-catalogo-caja").open) pintarCatalogo();
  };
  catalogo.onclick = (e) => {
    const boton = e.target.closest("[data-agregar-fig]");
    if (!boton) return;
    figuras.insertAdjacentHTML("beforeend", filaFiguraLectura(t, { ref: boton.dataset.agregarFig, mostrar_en: boton.dataset.donde }));
    pintarCatalogo();
  };
  buscar.oninput = pintarCatalogo;
  $("#l-catalogo-caja").ontoggle = () => { if ($("#l-catalogo-caja").open) pintarCatalogo(); };
  if ($("#l-catalogo-caja").open) pintarCatalogo();
}

// La clasificación y la evidencia se editan igual en el formulario del caso y en el de la lectura.
function enlazarClasifEvidencia(t) {
  const clasif = $("#clasificacion");
  clasif.onchange = (e) => {
    if (e.target.matches(".c-segmento")) e.target.closest(".clasif-fila").querySelector(".c-area").innerHTML = opcionesArea(e.target.value, "");
  };
  clasif.onclick = (e) => {
    if (!e.target.matches(".quitar-clasif")) return;
    if (clasif.querySelectorAll(".clasif-fila").length > 1) e.target.closest(".clasif-fila").remove();
    else aviso("Hace falta al menos un segmento.", true);
  };
  $("#mas-clasificacion").onclick = () => {
    const usados = new Set([...clasif.querySelectorAll(".c-segmento")].map((s) => s.value));
    const libre = Object.keys(SEGMENTOS).find((s) => !usados.has(s)) || t.meta.segmento;
    clasif.insertAdjacentHTML("beforeend", filaClasificacion({ segmento: libre }));
  };
  $("#mas-evidencia").onclick = () => {
    const fila = document.createElement("div");
    fila.className = "row evidencia";
    fila.style.gap = "8px";
    fila.innerHTML = `<input type="text" class="ev-ubicacion" style="width:30%" placeholder="p. 5, Figura 2">
      <input type="text" class="ev-cita" style="flex:1" placeholder="Frase copiada de la fuente">`;
    $("#evidencias").append(fila);
  };
}

// Los casos marcados sobreviven al redibujado: el panel se rehace con cada cambio en la base.
function enlazarClasificar(t) {
  const contar = () => app.querySelectorAll(".n-marcados").forEach((n) => { n.textContent = textoMarcados(); });
  app.querySelectorAll("[data-marcar]").forEach((c) => {
    c.onchange = () => {
      if (c.checked) marcados.add(c.dataset.marcar);
      else marcados.delete(c.dataset.marcar);
      contar();
    };
  });
  if (!$("#bloque-segmento")) return;
  const marcar = (ids) => {
    marcados = new Set(ids);
    app.querySelectorAll("[data-marcar]").forEach((c) => { c.checked = marcados.has(c.dataset.marcar); });
    contar();
  };
  const casos = vistaPaso3(t) === "lecturas" ? lecturasOrdenadas(t) : casosOrdenados(t);
  const sinArea = (c) => clasificacionDe(c, t.meta.segmento).some((p) => !p.area && Object.keys(AREAS[p.segmento] || {}).length);
  $("#marcar-todos").onclick = () => marcar(casos.map((c) => c.id));
  $("#marcar-sin-area").onclick = () => marcar(casos.filter(sinArea).map((c) => c.id));
  $("#marcar-ninguno").onclick = () => marcar([]);
  $("#bloque-segmento").onchange = () => {
    bloque = { segmento: $("#bloque-segmento").value, area: "" };
    $("#bloque-area").innerHTML = opcionesArea(bloque.segmento, "");
  };
  $("#bloque-area").onchange = () => { bloque = { segmento: $("#bloque-segmento").value, area: $("#bloque-area").value }; };
  $("#bloque-agregar").onclick = () => clasificarMarcados(t, true);
  $("#bloque-quitar").onclick = () => clasificarMarcados(t, false);
  $("#marcar-sin-nivel").onclick = () => marcar(casos.filter((c) => !c.dificultad?.nivel).map((c) => c.id));
  $("#bloque-nivel").onchange = () => { bloqueNivel = $("#bloque-nivel").value; };
  $("#nivel-marcados").onclick = () => cambiarMarcados(t, "dificultad", bloqueNivel ? { nivel: Number(bloqueNivel), por: "autor" } : null);
  if (!$("#marcar-parecen")) return;   // las lecturas no tienen opciones
  $("#marcar-parecen").onclick = () => marcar(casos.filter((c) => pareceRequerirOpciones(c.enunciado)).map((c) => c.id));
  $("#con-opciones").onclick = () => cambiarMarcados(t, "requiere_opciones", true);
  $("#sin-opciones").onclick = () => cambiarMarcados(t, "requiere_opciones", null);
}

// Escribe la entrada del tema en «indice_publicado», la lista corta que lee la portada. Al publicar se escribe
// también «indice_casos», el índice para buscar casos.
// Devuelve si lo consiguió: no es motivo para dar la publicación por fallida.
async function anotarEnIndice(id, entrada) {
  try {
    await set(ref(db, `indice_publicado/${id}`), { ...entrada, fecha: serverTimestamp() });
    return true;
  } catch {
    return false;
  }
}

// La sala que presenta un tema oculto: sala.html lo muestra elegido aunque no esté en la lista.
const enlaceSala = (t) => `sala.html?crear=1&tema=${t.meta.segmento}/${t.id}`;
// Las lecturas publicadas de un tema, para leerlas solo o proyectarlas en clase (lectura.html).
const enlaceLectura = (t, proyectar = false) => `lectura.html?tema=${t.meta.segmento}/${t.id}${proyectar ? "&proyectar=1" : ""}`;

// Ocultar deja el tema publicado pero fuera de las listas de la web; la sala lo carga con el código.
// Va en una sola escritura, para que el estudio y la web no queden en desacuerdo.
async function cambiarOculto(t, oculto) {
  if (oculto && !confirm("¿Ocultar este tema? Deja de salir en la web hasta que pulses «Mostrar en la web»; solo se podrá jugar en una sala que abras desde aquí.")) return;
  try {
    await update(ref(db), {
      [`indice_publicado/${t.id}/oculto`]: oculto || null,
      [`estudio/${t.id}/meta/oculto`]: oculto || null,
    });
  } catch (e) {
    return aviso(`No se pudo cambiar: ${e.code || e.message}. Si dice «permission-denied», falta desplegar las reglas.`, true);
  }
  aviso(oculto ? "Oculto. Ya no sale en la web; preséntalo con «Presentar en una sala»." : "Listo: el tema ya sale en la web para todos.");
}

// Publicar: las figuras van al Drive del autor y a la base solo el texto, con el id de cada figura.
// «publicacion_img», donde antes iban las figuras en base64, se vacía.
async function publicar(t) {
  const partes = (t.meta.version || "0.1.0").split(".").map(Number);
  const version = t.meta.estado === "publicado" ? `${partes[0]}.${partes[1] + 1}.0` : t.meta.version || "0.1.0";
  const { imagenesUsadas } = aPaquete(t, version);
  if (cargandoImagenes) return aviso("Espera a que terminen de cargar las imágenes y vuelve a publicar.", true);
  const sinArchivo = imagenesUsadas.filter((id) => !imagenesTema[id]);
  if (sinArchivo.length) {
    return aviso(`Faltan los archivos de ${sinArchivo.length} imagen(es) (${sinArchivo.join(", ")}): súbelas en el paso 2.`, true);
  }
  if (publicando || !(await confirmarPublicacion(t, imagenesUsadas.length))) return;
  // Mientras se publica, el estudio puede redibujarse (cualquier cambio en la base lo hace): el botón sale
  // siempre deshabilitado y con el avance, para que nadie publique dos veces a la vez.
  const avance = (texto) => {
    publicando = texto;
    const boton = $("#publicar");
    if (boton) { boton.disabled = true; boton.textContent = texto; }
  };
  avance("Preparando…");
  let paquete, fuentes, actualizados, actualizadosLecturas;
  try {
    let drive = {};
    let cambiosDrive = {};
    if (imagenesUsadas.length) {
      avance("Pidiendo permiso a Google…");
      const token = await tokenDrive();
      ({ drive, cambios: cambiosDrive } = await subirAlDrive(t, imagenesUsadas, token, avance));
    }
    avance("Publicando…");
    ({ paquete, fuentes, actualizados, actualizadosLecturas } = aPaquete(t, version, { drive, publicador: { nombre: perfil.nombre, fecha: hoy() } }));
    await update(ref(db), {
      [`publicacion/${t.id}`]: {
        paquete_json: JSON.stringify(paquete),
        fuentes_json: JSON.stringify(fuentes),
        actualizados,
        segmento: paquete.segmento,
        version,
        fecha: serverTimestamp(),
        por: perfil.nombre,
        declaracion: { version: DECLARACION.version, uid: usuario.uid, fecha: serverTimestamp() },
      },
      [`publicacion_img/${t.id}`]: null,
      [`estudio/${t.id}/meta/estado`]: "publicado",
      [`estudio/${t.id}/meta/version`]: version,
      [`estudio/${t.id}/meta/publicado_en`]: serverTimestamp(),
      ...cambiosDrive,
    });
  } catch (e) {
    if (e.status === 401) permisoDrive = null;
    publicando = null;
    aviso("No se pudo publicar: " + (e.message || e.code), true);
    dibujar();
    return;
  }
  publicando = null;
  dibujar();
  // La lista de la portada va aparte: si fallara (reglas sin desplegar), el tema queda publicado
  // igual y aparece cuando el repositorio se ponga al día.
  // La misma entrada que escribe el servidor MCP: casos y lecturas contados aparte, cada uno con sus fechas.
  const alIndice = await anotarEnIndice(t.id, entradaIndice(paquete, version, actualizados, actualizadosLecturas, { oculto: Boolean(t.meta.oculto) }));
  // El índice de casos, para buscar y armar cuestionarios por segmento o área (app/cuestionario.js). Si falla,
  // el tema se busca igual: la web lo carga entero. Solo lleva casos: un tema sin casos (solo lecturas) no tiene,
  // y las reglas no admiten uno vacío.
  await (paquete.casos.length
    ? set(ref(db, `indice_casos/${t.id}`), indiceDePaquete({ ...paquete, version }))
    : remove(ref(db, `indice_casos/${t.id}`))).catch(() => {});
  if (t.meta.oculto) aviso(alIndice ? "Publicado y oculto: no sale en la web hasta que pulses «Mostrar en la web»." : "No se pudo marcar como oculto: revisa que las reglas estén desplegadas.", !alIndice);
  else aviso(alIndice ? "Publicado. Ya está en la web." : "Publicado. Tarda unos minutos en aparecer en la web.");
}

// Borrar no se puede deshacer, así que además de avisar qué desaparece hay que escribir «BORRAR».
// El orden importa: las reglas de la base dan permiso mirando «estudio/<tema>/meta/autor_uid», así
// que el tema se quita al final, cuando ya salió todo lo demás. Los sellos y los reportes solo se
// pueden limpiar después de quitar «publicacion», y eso es exactamente lo que pasa aquí.
async function borrarTema(t) {
  const id = t.id;
  const n = cuentas(t);
  const imagenes = imagenesOrdenadas(t).length;
  const publicado = t.meta.estado === "publicado";
  const carpetaDrive = ID_DRIVE.test(t.meta.drive_carpeta || "") ? t.meta.drive_carpeta : "";
  const driveMio = driveEsMio(t);
  const autor = t.meta.drive_nombre || "quien lo publicó";
  const ok = await confirmarPeligro({
    titulo: `Borrar «${t.meta.titulo}»`,
    cuerpo: `<p>Se va a borrar del estudio, con todo lo que tiene dentro:</p>
      <ul class="problemas">
        <li>${textoCuentas(n)} y ${plural(imagenes, "imagen", "imágenes")}</li>
        ${n.verificados ? `<li>${plural(n.verificados, "sello de verificado", "sellos de verificado")} puestos por un radiólogo</li>` : ""}
        ${n.reportados ? `<li>${plural(n.reportados, "caso reportado", "casos reportados")} por gente que practicó</li>` : ""}
        ${publicado ? `<li class="error">Está publicado: desaparece de la web y nadie podrá practicarlo</li>` : ""}
        ${driveMio ? `<li>Las figuras de tu Google Drive (carpeta «RadQuiz · ${esc(t.meta.titulo)}») van a su papelera</li>` : ""}
        ${carpetaDrive && !driveMio ? `<li>Las figuras siguen en el Google Drive de ${esc(autor)}: solo esa persona puede borrarlas</li>` : ""}
      </ul>
      <p>No se puede deshacer y nadie del equipo lo puede recuperar.</p>`,
    boton: "Borrar para siempre",
  });
  if (!ok) return;
  // El Drive va primero, mientras sigue fresco el clic que puede tener que abrir la ventana de Google.
  let notaDrive = carpetaDrive && !driveMio ? ` Las figuras siguen en el Drive de ${autor}.` : "";
  if (driveMio) {
    try {
      await aLaPapelera(await tokenDrive(), carpetaDrive);
      notaDrive = " Las figuras quedaron en la papelera de tu Drive.";
    } catch (e) {
      notaDrive = ` Las figuras siguen en tu Drive (${e.message}): borra tú la carpeta «RadQuiz · ${t.meta.titulo}».`;
    }
  }
  try {
    if (publicado) await anotarEnIndice(id, { titulo: t.meta.titulo, segmento: t.meta.segmento, retirado: true });
    await remove(ref(db, `publicacion/${id}`));
    await remove(ref(db, `publicacion_img/${id}`));
    await remove(ref(db, `indice_casos/${id}`)).catch(() => {});
    // Sellos y reportes: si las reglas todavía no están desplegadas no se dejan borrar, y eso no es
    // motivo para dejar el tema a medio borrar. Quedan huérfanos, sin efecto sobre ningún tema vivo.
    await remove(ref(db, `verificacion/${id}`)).catch(() => {});
    await remove(ref(db, `reportes/${id}`)).catch(() => {});
    await remove(ref(db, `estudio_img/${id}`));
    await remove(ref(db, `estudio/${id}`));
  } catch (e) {
    return aviso(`No se pudo borrar: ${e.code || e.message}. Si dice «permission-denied», falta desplegar las reglas.`, true);
  }
  if (location.hash.startsWith("#/tema/")) location.hash = "#/";
  else dibujar();
  aviso((publicado ? "Borrado. Tarda unos minutos en desaparecer de la web." : "Borrado.") + notaDrive, Boolean(notaDrive) && !driveMio);
}

async function buscarDoi(id) {
  const doi = $("#doi").value.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
  if (!doi) return aviso("Escribe el DOI.", true);
  try {
    const r = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
    if (!r.ok) throw new Error("no encontrado");
    const m = (await r.json()).message;
    const autores = (m.author || []).map((a) => `${a.family || ""} ${(a.given || "").split(/[\s-]/).map((g) => g[0] || "").join("")}`.trim());
    const muchos = autores.length > 6 ? autores.slice(0, 6).join(", ") + ", et al" : autores.join(", ");
    const anio = (m.issued?.["date-parts"]?.[0] || [])[0] || "";
    const revista = m["short-container-title"]?.[0] || m["container-title"]?.[0] || "";
    const paginas = m.page ? `:${m.page}` : "";
    $("#cita").value = `${muchos}. ${m.title?.[0] || ""}. ${revista}. ${anio};${m.volume || ""}${m.issue ? `(${m.issue})` : ""}${paginas}. doi:${m.DOI}`;
    $("#credito").value = `${autores[0] || ""}${autores.length > 1 ? ", et al" : ""}. ${revista}. ${anio}`;
    $("#url").value = `https://doi.org/${m.DOI}`;
    if (!$("#titular").value) $("#titular").value = `© ${anio} ${m.publisher || ""}`.trim();
    const licencia = (m.license || []).map((l) => l.URL).find((u) => /creativecommons/.test(u));
    if (licencia) {
      const coincide = LICENCIAS.find((l) => l.url && licencia.includes(l.url.replace("https://creativecommons.org", "")));
      if (coincide) $("#licencia").value = coincide.valor;
    }
    aviso("Datos traídos del DOI. Revisa la licencia en el PDF.");
  } catch {
    aviso("No encontré ese DOI. Puedes escribir la cita a mano.", true);
  }
}

async function guardarFuente(id) {
  const t = temaActual();
  const licencia = $("#licencia").value;
  const datos = LICENCIAS.find((l) => l.valor === licencia);
  const cita = $("#cita").value.trim();
  const apellido = slug(cita.split(/[,.\s]/)[0] || "fuente").replace(/-/g, "");
  const anio = (cita.match(/(19|20)\d{2}/) || [""])[0];
  const fuente = {
    clave: t.fuente?.clave || `${apellido}${anio}` || "fuente",
    tipo: $("#tipo-fuente").value || "articulo",
    cita,
    credito: $("#credito").value.trim(),
    doi: $("#doi").value.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//, ""),
    url: $("#url").value.trim(),
    titular: $("#titular").value.trim(),
    licencia,
    licencia_url: datos?.url || null,
    modificaciones_permitidas: !datos?.nd,
    verificacion: { fecha: hoy(), por: perfil.nombre, donde: $("#frase").value.trim() },
  };
  const titulo = $("#titulo-tema").value.replace(/\s+/g, " ").trim();
  if (!titulo) return aviso("Escribe un título.", true);
  await set(ref(db, `estudio/${id}/fuente`), fuente);
  await guardarMeta(id, titulo === t.meta.titulo ? {} : { titulo });
  aviso("Fuente guardada.");
}

async function subirImagenes(id, archivos) {
  const t = temaActual();
  let n = imagenesOrdenadas(t).length;
  for (const archivo of archivos) {
    try {
      const { datos, modificaciones } = await comprimir(archivo);
      n += 1;
      const numero = (archivo.name.match(/(\d+)/) || [])[1];
      const figura = numero ? `Figura ${Number(numero)}` : `Figura ${n}`;
      let imgId = idImagen(figura);
      while (t.imagenes[imgId] || imagenesTema[imgId]) imgId = `${imgId}b`;
      await set(ref(db, `estudio_img/${id}/${imgId}`), datos);
      await set(ref(db, `estudio/${id}/imagenes/${imgId}`), {
        archivo: `${imgId}.jpg`, figura, leyenda_original: "", modalidad: "",
        paneles: [{ id: "único", plano: "", secuencia: "", condicion: "" }], marcas: [],
        modificaciones, orden: n,
      });
      imagenesTema[imgId] = datos;
    } catch (e) {
      aviso(`No pude subir ${archivo.name}: ${e.message}`, true);
    }
  }
  await guardarMeta(id, {});
  dibujar();
}

function leerLineas(texto, campos) {
  return texto.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const partes = l.split("|").map((p) => p.trim());
    return Object.fromEntries(campos.map((c, i) => [c, partes[i] || ""]));
  });
}

async function guardarImagen(id, imgId) {
  const figura = app.querySelector(`[data-figura="${imgId}"]`).value.trim();
  const paneles = leerLineas(app.querySelector(`[data-paneles="${imgId}"]`).value, ["id", "plano", "secuencia", "condicion"]);
  const marcas = leerLineas(app.querySelector(`[data-marcas="${imgId}"]`).value, ["marca", "panel", "senala"]);
  await update(ref(db, `estudio/${id}/imagenes/${imgId}`), {
    figura,
    leyenda_original: app.querySelector(`[data-leyenda="${imgId}"]`).value.trim(),
    paneles: paneles.length ? paneles.map((p) => ({ ...p, id: p.id || "único" })) : [{ id: "único", plano: "", secuencia: "", condicion: "" }],
    marcas,
  });
  await guardarMeta(id, {});
  aviso("Imagen guardada.");
}

async function borrarImagen(id, imgId) {
  const t = temaActual();
  const usada = t ? [...casosOrdenados(t), ...lecturasOrdenadas(t)].filter((c) => lista(c.imagenes).some((r) => r.ref === imgId)).length : 0;
  const texto = usada
    ? `Esta imagen la usan ${usada} caso(s) o lectura(s); se quedarán sin ella. ¿Quitarla igual?`
    : "¿Quitar esta imagen?";
  if (!confirm(texto)) return;
  try {
    await remove(ref(db, `estudio/${id}/imagenes/${imgId}`));
    await remove(ref(db, `estudio_img/${id}/${imgId}`));
  } catch (e) {
    return aviso("No se pudo quitar: " + (e.code || e.message), true);
  }
  delete imagenesTema[imgId];
  dibujar();
}

function mover(t, casoId, paso_, coleccion = "casos") {
  const casos = coleccion === "lecturas" ? lecturasOrdenadas(t) : casosOrdenados(t);
  const i = casos.findIndex((c) => c.id === casoId);
  const j = i + paso_;
  if (j < 0 || j >= casos.length) return;
  const cambios = {};
  cambios[`estudio/${t.id}/${coleccion}/${casos[i].id}/orden`] = j + 1;
  cambios[`estudio/${t.id}/${coleccion}/${casos[j].id}/orden`] = i + 1;
  update(ref(db), cambios);
}

// Lo que el radiólogo revisa al verificar. La clasificación y el orden quedan fuera: cambiarlos no retira el sello.
function contenido(c) {
  return JSON.stringify([
    c.tema || "", c.tipo || "", c.enunciado || "", lista(c.opciones), c.correcta, c.explicacion || "", c.perla || "",
    lista(c.etiquetas), lista(c.imagenes).map((r) => `${r.ref}:${r.mostrar_en}`).sort(),
    lista(c.evidencia).map((e) => [e.ubicacion || "", e.cita || ""]),
  ]);
}

async function guardarCaso(t, casoId) {
  const opciones = [...app.querySelectorAll(".opcion")].map((i) => i.value.trim()).filter(Boolean);
  const marcada = app.querySelector("input[name=correcta]:checked");
  const imagenes = [...app.querySelectorAll("[data-img]")]
    .filter((s) => s.value)
    .map((s) => ({ ref: s.dataset.img, mostrar_en: s.value }));
  const evidencia = [...app.querySelectorAll(".evidencia")]
    .map((f) => ({ ubicacion: f.querySelector(".ev-ubicacion").value.trim(), cita: f.querySelector(".ev-cita").value.trim() }))
    .filter((e) => e.ubicacion || e.cita);
  const clasificacion = normalizarClasificacion([...app.querySelectorAll(".clasif-fila")].map((f) => ({
    segmento: f.querySelector(".c-segmento").value, area: f.querySelector(".c-area").value,
  })));
  const anterior = t.casos[casoId] || {};
  const caso = {
    tema: $("#c-tema").value.trim(),
    tipo: $("#c-tipo").value,
    enunciado: $("#c-enunciado").value.trim(),
    imagenes,
    opciones,
    correcta: marcada ? Number(marcada.value) : -1,
    explicacion: $("#c-explicacion").value.trim(),
    perla: $("#c-perla").value.trim(),
    evidencia,
    etiquetas: $("#c-etiquetas").value.split(",").map((x) => x.trim()).filter(Boolean),
    clasificacion,
    ...(anterior.barajar === false ? { barajar: false } : {}),   // el formulario no lo muestra: se conserva
    ...($("#c-requiere").checked ? { requiere_opciones: true } : {}),
    orden: anterior.orden || casosOrdenados(t).length + 1,
  };
  // Quien cambia el nivel pasa a ser quien lo asignó; si solo retoca el motivo, se queda el de antes.
  const nivel = $("#c-nivel").value;
  if (nivel) {
    const mismoNivel = String(anterior.dificultad?.nivel || "") === nivel;
    caso.dificultad = normalizarDificultad({
      nivel, motivo: $("#c-motivo").value, por: mismoNivel ? anterior.dificultad?.por || "autor" : "autor",
    });
  }
  // Si solo cambió la clasificación, la dificultad o si necesita las opciones, el caso sigue siendo el que el radiólogo verificó: se conserva la fecha, y
  // con ella el sello.
  caso.actualizado = anterior.actualizado && contenido(anterior) === contenido(caso) ? anterior.actualizado : serverTimestamp();
  await set(ref(db, `estudio/${t.id}/casos/${casoId}`), caso);
  await guardarMeta(t.id, {});
  editando = null;
  dibujar();
  aviso("Caso guardado.");
}

// Como contenido() con los casos: lo que el radiólogo revisa al verificar una lectura. La clasificación, la
// dificultad y el orden quedan fuera: cambiarlos no retira el sello. El orden de las figuras sí cuenta.
function contenidoLectura(l) {
  const limpio = (x) => String(x ?? "").trim();
  return JSON.stringify([
    limpio(l.tema), limpio(l.presentacion), lista(l.etiquetas).map(limpio),
    lista(l.imagenes).map((r) => [r.ref, r.mostrar_en === "respuesta" ? "respuesta" : "pregunta", limpio(r.leyenda)]),
    lista(l.preguntas).map((q) => [q.tipo || "", limpio(q.pregunta), limpio(q.respuesta), lista(q.puntos_clave).map(limpio), lista(q.aceptadas).map(limpio)]),
    limpio(l.explicacion), lista(l.perlas).map(limpio), lista(l.evidencia).map((e) => [limpio(e.ubicacion), limpio(e.cita)]),
  ]);
}

async function guardarLectura(t, idLectura) {
  const lineas = (texto) => texto.split("\n").map((x) => x.trim()).filter(Boolean);
  const imagenes = [...app.querySelectorAll(".est-lec-fila-fig")].map((f) => {
    const leyenda = f.querySelector(".lf-leyenda").value.trim();
    return { ref: f.dataset.ref, mostrar_en: f.querySelector(".lf-donde").value, ...(leyenda ? { leyenda } : {}) };
  });
  // Una pregunta del todo vacía (la que se agregó y no se usó) no se guarda.
  const preguntas = [...app.querySelectorAll(".est-lec-pregunta")].map((f) => ({
    tipo: f.querySelector(".lp-tipo").value,
    pregunta: f.querySelector(".lp-pregunta").value.trim(),
    respuesta: f.querySelector(".lp-respuesta").value.trim(),
    puntos_clave: lineas(f.querySelector(".lp-puntos").value),
    aceptadas: lineas(f.querySelector(".lp-aceptadas").value),
  })).filter((q) => q.pregunta || q.respuesta || q.puntos_clave.length || q.aceptadas.length);
  const evidencia = [...app.querySelectorAll(".evidencia")]
    .map((f) => ({ ubicacion: f.querySelector(".ev-ubicacion").value.trim(), cita: f.querySelector(".ev-cita").value.trim() }))
    .filter((e) => e.ubicacion || e.cita);
  const clasificacion = normalizarClasificacion([...app.querySelectorAll(".clasif-fila")].map((f) => ({
    segmento: f.querySelector(".c-segmento").value, area: f.querySelector(".c-area").value,
  })));
  const anterior = t.lecturas[idLectura] || {};
  const lectura = {
    tema: $("#l-tema").value.trim(),
    presentacion: $("#l-presentacion").value.trim(),
    clasificacion,
    etiquetas: $("#l-etiquetas").value.split(",").map((x) => x.trim()).filter(Boolean),
    imagenes,
    preguntas,
    explicacion: $("#l-explicacion").value.trim(),
    perlas: lineas($("#l-perlas").value),
    evidencia,
    orden: anterior.orden || lecturasOrdenadas(t).reduce((mayor, l) => Math.max(mayor, Number(l.orden) || 0), 0) + 1,
  };
  if (!lectura.tema && !lectura.presentacion && !preguntas.length) return aviso("La lectura está vacía.", true);
  // Quien cambia el nivel pasa a ser quien lo asignó; si solo retoca el motivo, se queda el de antes.
  const nivel = $("#l-nivel").value;
  if (nivel) {
    const mismoNivel = String(anterior.dificultad?.nivel || "") === nivel;
    lectura.dificultad = normalizarDificultad({
      nivel, motivo: $("#l-motivo").value, por: mismoNivel ? anterior.dificultad?.por || "autor" : "autor",
    });
  }
  lectura.actualizado = anterior.actualizado && contenidoLectura(anterior) === contenidoLectura(lectura) ? anterior.actualizado : serverTimestamp();
  try {
    await set(ref(db, `estudio/${t.id}/lecturas/${idLectura}`), lectura);
    await guardarMeta(t.id, {});
  } catch (e) {
    return aviso("No se pudo guardar: " + (e.code || e.message), true);
  }
  editandoLectura = null;
  dibujar();
  aviso("Lectura guardada.");
}

// «de»: la lista del paso 3 desde la que se pegó, casos o lecturas. La respuesta puede traer las dos cosas.
async function cargarRespuesta(t, de = "casos") {
  const texto = $("#respuesta-ia").value;
  let datos;
  try {
    datos = leerRespuestaIA(texto, t, { suelta: de });
  } catch (e) {
    return aviso(e.message, true);
  }
  // Normal: se agregan. Corrección: cada uno reemplaza al suyo. «Reemplazar»: la lista entera, de una vez.
  const plan = planDeCarga(t, datos, {
    reemplazar: de === "casos" && $("#reemplazar")?.checked,
    reemplazarLecturas: de === "lecturas" && $("#reemplazar-lecturas")?.checked,
    marca: serverTimestamp(),
  });
  if (!Object.keys(plan.cambios).length) return aviso(plan.resumen, true);
  try {
    await update(ref(db), plan.cambios);
    await guardarMeta(t.id, {});
    $("#respuesta-ia").value = "";
    // Una respuesta cortada no se pierde: se cargan los casos enteros y queda a mano el pedido para que siga.
    const deLecturas = datos.lecturas.length > 0 && !datos.casos.length;
    seguir = datos.cortada || datos.faltan
      ? {
        mensaje: `${datos.cortada ? "La respuesta llegó cortada" : `Tu IA avisa que le faltaron ${deLecturas ? "lecturas" : "casos"}`}: cargué `
          + `${deLecturas
            ? (datos.lecturas.length === 1 ? "la única que venía completa" : `las ${datos.lecturas.length} que venían completas`)
            : (datos.casos.length === 1 ? "el único que venía completo" : `los ${datos.casos.length} que venían completos`)}. Pídele que siga y pega aquí su respuesta: se suma a lo que ya hay.`,
        texto: instruccionesContinuar(datos),
        de: deLecturas ? "lecturas" : "casos",
      }
      : null;
    aviso(plan.resumen);
    dibujar();
  } catch (e) {
    aviso("No se pudo guardar: " + (e.code || e.message), true);
  }
}

// ------------------------------------------------------------------ acciones de revisión y publicación
function enlazarVerificacion(t) {
  app.querySelectorAll("[data-verificar]").forEach((b) => {
    b.onclick = () => verificar(t, b.dataset.verificar, "verificado", "");
  });
  app.querySelectorAll("[data-problema]").forEach((b) => {
    b.onclick = () => {
      const comentario = prompt(t.lecturas[b.dataset.problema] ? "¿Qué está mal en esta lectura?" : "¿Qué está mal en este caso?");
      if (comentario === null) return;
      verificar(t, b.dataset.problema, "problema", comentario.slice(0, 1000));
    };
  });
  const todo = $("#verificar-todo");
  if (todo) todo.onclick = async () => {
    const faltan = [...casosOrdenados(t), ...lecturasOrdenadas(t)]
      .filter((c) => estadoVerificacion(c, vercaso(t.id, c.id)) !== "verificado");
    if (!faltan.length) return aviso("No queda ninguno por verificar.");
    if (!confirm(`¿Verificar ${faltan.length} casos y lecturas de una vez? Quedarán con tu nombre.`)) return;
    for (const c of faltan) await verificar(t, c.id, "verificado", "", true);
    aviso(`${faltan.length} verificados.`);
  };
}

async function verificar(t, casoId, decision, comentario, callado = false) {
  const caso = elemento(t, casoId) || {};
  try {
    await set(ref(db, `verificacion/${t.id}/${casoId}`), {
      decision, usuario: perfil.usuario, nombre: perfil.nombre, comentario,
      base: caso.actualizado || 0, fecha: serverTimestamp(),
    });
    if (!callado) aviso(decision === "verificado" ? (t.lecturas[casoId] ? "Lectura verificada." : "Caso verificado.") : "Problema señalado; el autor lo verá.");
  } catch (e) {
    aviso("No se pudo guardar: " + (e.code || e.message), true);
  }
}

// ------------------------------------------------------------------ dibujo y rutas
function cabecera() {
  const chip = $("#quien");
  if (!usuario) { chip.textContent = "Sin entrar"; chip.className = "chip"; return; }
  chip.textContent = perfil ? `${perfil.nombre} · ${perfil.rol}` : usuario.email || "Sin permiso";
  chip.className = "chip live";
  $("#salir-top").hidden = false;
  $("#equipo-top").hidden = !esCoord();
}

function dibujar() {
  cabecera();
  if (!usuario) return entrar();
  if (!perfil) return (app.innerHTML = `<p class="muted">Preparando tu acceso…</p>`);
  const ruta = location.hash.replace(/^#\/?/, "").split("/");
  if (ruta[0] === "equipo" && esCoord()) return equipo();
  if (ruta[0] === "nuevo") return temaNuevo();
  if (ruta[0] === "importar") { temaAbierto = null; return vistaImportar(); }
  if (ruta[0] === "tema" && ruta[1]) {
    if (temaAbierto !== ruta[1]) {
      temaAbierto = ruta[1];
      ordenVerificacion = null;
      modoVerificar = false;
      paso = "fuente";
      editando = null;
      imagenesTema = {};
      marcados = new Set();
      bloque = { segmento: "", area: "" };
      seguir = null;
      editandoLectura = null;
      vista3 = null;
      lecturasAbiertas = new Set();
      cargarImagenes(ruta[1]);
    }
    return vistaTema();
  }
  temaAbierto = null;
  inicio();
}

activarAmpliacion();
window.addEventListener("hashchange", () => dibujar());

function escuchar() {
  onValue(ref(db, "estudio"), (s) => { temas = s.val() || {}; if (!enEdicion()) dibujar(); });
  onValue(ref(db, "verificacion"), (s) => { verificaciones = s.val() || {}; if (!enEdicion()) dibujar(); });
  onValue(ref(db, "reportes"), (s) => { reportes = s.val() || {}; if (!enEdicion()) dibujar(); }, () => {});
  onValue(ref(db, `usuarios/${usuario.uid}`), (s) => { perfil = s.val(); dibujar(); });
  onValue(ref(db, `usuarios/${usuario.uid}`), (s) => { if (s.exists()) perfil = s.val(); dibujar(); });
  if (esCoord()) {
    onValue(ref(db, "solicitudes"), (s) => { solicitudes = s.val() || {}; dibujar(); });
    onValue(ref(db, "usuarios"), (s) => { miembros = s.val() || {}; dibujar(); });
  }
}

async function iniciar() {
  if (!firebaseConfig) {
    app.innerHTML = `<section class="panel"><h2>Falta configurar Firebase</h2></section>`;
    return;
  }
  const fb = initializeApp(firebaseConfig);
  db = getDatabase(fb);
  auth = getAuth(fb);
  onAuthStateChanged(auth, async (u) => {
    usuario = u && (!u.isAnonymous || modoPrueba) ? u : null;
    u = usuario;
    perfil = null;
    temas = {};
    if (!u) return dibujar();
    let snap = await get(ref(db, `usuarios/${u.uid}`)).catch(() => null);
    if (!snap || !snap.exists()) {
      dibujar();
      await altaAutomatica();
      snap = await get(ref(db, `usuarios/${u.uid}`)).catch(() => null);
    }
    perfil = snap && snap.exists() ? snap.val() : null;
    if (!perfil) return dibujar();
    escuchar();
    dibujar();
  });
  $("#salir-top").onclick = () => signOut(auth);
}

iniciar();
