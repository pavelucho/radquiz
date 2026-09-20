// RadQuiz — estudio: crear temas, revisarlos y publicarlos desde la web, sin programas ni Git.
// El contenido en preparación vive en Firebase. Al publicar se escribe «publicacion», que la web lee
// al instante, y «indice_publicado», la lista corta que la portada consulta de una sola vez.
// El repositorio se pone al día después, por su cuenta: nadie espera a que lo haga.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInAnonymously, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getDatabase, ref, get, set, update, remove, onValue, push, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";
import { $, esc, md, SEGMENTOS, credito } from "./comun.js";
import {
  LICENCIAS, MODALIDADES, lista, slug, idImagen, validarTema, validarCaso, casosOrdenados,
  imagenesOrdenadas, estadoVerificacion, aPaquete,
} from "./validacion.js";
import { instruccionesIA, instruccionesCorreccion, instruccionesPaquete, leerRespuestaIA } from "./instrucciones-ia.js";
import { crearZip, descargarArchivo, bytesDeDataURL } from "./zip.js";
import { comprimir, abrirZip } from "./importar.js";

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

const hoy = () => new Date().toISOString().slice(0, 10);
const esCoord = () => perfil?.rol === "coordinador";
const esRevisor = () => perfil?.rol === "revisor" || esCoord();
const soyAutor = (t) => t?.meta?.autor_uid === usuario?.uid;
const puedeEditar = (t) => t && (esCoord() || soyAutor(t));
const vercaso = (temaId, casoId) => (verificaciones[temaId] || {})[casoId];
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
  t.revision = t.revision || {};
  for (const c of Object.values(t.casos)) {
    c.opciones = lista(c.opciones);
    c.imagenes = lista(c.imagenes);
    c.evidencia = lista(c.evidencia);
    c.etiquetas = lista(c.etiquetas);
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
  app.innerHTML = `<section class="panel" style="display:grid;gap:14px;max-width:640px">
    <h1>Estudio de RadQuiz</h1>
    <p>Aquí se preparan los cuestionarios: el autor arma el tema con la ayuda de la IA que prefiera, un radiólogo lo
      revisa y el coordinador lo publica. Todo desde el navegador.</p>
    <div class="row"><button class="primary" id="google">Entrar con Google</button>
      <a class="boton" href="manual.html#autores">Cómo funciona</a></div>
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
function cuentas(t) {
  const casos = casosOrdenados(t);
  let verificados = 0, problemas = 0, reportados = 0;
  for (const c of casos) {
    const estado = estadoVerificacion(c, vercaso(t.id, c.id));
    if (estado === "verificado") verificados += 1;
    if (estado === "problema") problemas += 1;
    if (reportesDe(t.id, c.id).length) reportados += 1;
  }
  return { casos: casos.length, verificados, problemas, reportados };
}

function tarjetaTema(t) {
  const n = cuentas(t);
  const mio = soyAutor(t);
  const puedeVerificar = esRevisor() && !mio && t.meta.estado === "publicado";
  return `<article class="panel tema-card">
    <div class="row" style="justify-content:space-between"><h3>${esc(t.meta.titulo || t.id)}</h3>${chipEstado(t.meta.estado)}</div>
    <p class="meta">${esc(SEGMENTOS[t.meta.segmento] || t.meta.segmento || "")} · ${n.casos} casos · ${esc(t.meta.autor_nombre || "")}${mio ? " (tú)" : ""}</p>
    <p class="meta">${n.verificados} ${n.verificados === 1 ? "verificado" : "verificados"}${n.problemas ? ` · ${n.problemas} con problema` : ""}${n.reportados ? ` · ${n.reportados} reportados` : ""}${sinPublicar(t) ? " · cambios sin publicar" : ""}</p>
    <div class="row"><a class="boton" href="#/tema/${esc(t.id)}">${puedeEditar(t) ? "Abrir" : puedeVerificar ? "Verificar" : "Ver"}</a>
      ${puedeEditar(t) ? `<button class="peligrosa" data-borrar-tema="${esc(t.id)}">Borrar</button>` : ""}</div>
  </article>`;
}

function inicio() {
  const todos = Object.entries(temas).map(([id, t]) => normalizarTema(id, t));
  const mios = todos.filter((t) => soyAutor(t));
  const porVerificar = esRevisor()
    ? todos.filter((t) => t.meta.estado === "publicado" && !soyAutor(t))
        .map((t) => ({ t, n: cuentas(t) }))
        .filter(({ n }) => n.reportados || n.verificados < n.casos)
        .sort((a, b) => (b.n.reportados - a.n.reportados) || ((b.n.casos - b.n.verificados) - (a.n.casos - a.n.verificados)))
        .map(({ t }) => t)
    : [];
  const otros = todos.filter((t) => !mios.includes(t) && !porVerificar.includes(t));
  const pendientes = Object.keys(solicitudes).length;
  const bloque = (titulo, lista_, vacio) => `<section class="segmento">
    <h2>${titulo}</h2>
    ${lista_.length ? `<div class="temas">${lista_.map(tarjetaTema).join("")}</div>` : `<p class="muted">${vacio}</p>`}</section>`;

  app.innerHTML = `<div style="display:grid;gap:22px">
    ${esCoord() && pendientes ? `<p class="caja">Hay ${pendientes} pedido(s) para verificar casos. <a href="#/equipo">Ver</a></p>` : ""}
    ${esRevisor() ? bloque("Para verificar", porVerificar,
        "Todo verificado. Los temas con casos reportados o sin verificar aparecen aquí primero.") : ""}
    <section class="segmento">
      <div class="row" style="justify-content:space-between"><h2>Mis temas</h2>
        <span class="row"><a class="boton primary" href="#/nuevo">Nuevo cuestionario</a>
          <button id="copiar-ia-zip" title="El texto para que tu IA saque las figuras del PDF y te devuelva el cuestionario entero en un .zip">Instrucciones para la IA</button>
          <button id="subir-zip" title="Sube el .zip que te devolvió tu IA: aquí lo revisas antes de crear nada">Subir un .zip</button>
          <input type="file" id="archivo-zip" accept=".zip,application/zip" hidden></span></div>
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
      importado = await abrirZip(archivo);
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
  app.innerHTML = `<div style="display:grid;gap:20px">
    <div class="row"><a class="boton" href="#/">Volver</a></div>
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
  return { id: slug(d.meta.id || d.meta.titulo), meta: d.meta, fuente: d.fuente, imagenes: d.imagenes, casos: d.casos };
}

function vistaImportar() {
  if (creando) return;
  if (!importado) { location.hash = "#/"; return; }
  const d = importado;
  const t = temaImportado();
  const v = validarTema(t);
  const imagenes = imagenesOrdenadas(t);
  const casos = casosOrdenados(t);
  app.innerHTML = `<div style="display:grid;gap:18px">
    <div><a class="src" href="#/">← Todos los temas</a><h1>${esc(d.meta.titulo)}</h1>
      <p class="muted">${esc(SEGMENTOS[d.meta.segmento] || d.meta.segmento || "sin segmento")} ·
        ${casos.length} casos · ${imagenes.length} imágenes · de ${esc(d.nombre)}</p></div>
    ${d.faltan.length ? `<p class="caja">El .zip no traía ${d.faltan.length} imagen(es): ${esc(d.faltan.slice(0, 6).join(", "))}${d.faltan.length > 6 ? "…" : ""}.
      Puedes crearlo igual y subirlas después en el paso 2.</p>` : ""}
    <section class="panel" style="display:grid;gap:12px">
      <h2>Mira las imágenes antes de crearlo</h2>
      <p class="muted">Cada una tiene que ser la figura <b>completa</b>, tal como salió publicada: con todos sus
        paneles y sin flechas ni recortes añadidos. Si una IA las sacó del PDF puede haber partido una figura en
        trozos, y casi ninguna de estas licencias lo permite.</p>
      <div class="galeria chica">${imagenes.map((img) => `<div class="panel" style="display:grid;gap:6px">
        ${d.datos[img.id]
          ? `<img class="miniatura chica" src="${d.datos[img.id]}" alt="${esc(img.figura)}" data-zoom>`
          : `<p class="src">sin archivo</p>`}
        <span class="src">${esc(img.figura || img.id)}</span></div>`).join("") || `<p class="muted">El .zip no traía imágenes.</p>`}</div>
    </section>
    <section class="panel" style="display:grid;gap:10px">
      <h2>Qué encontró el validador</h2>
      ${v.errores || v.avisos
        ? `<p class="${v.errores ? "caja" : "muted"}">${v.errores} error(es) y ${v.avisos} aviso(s).
            Se crea igual, en preparación: los corriges en los pasos 1 a 3 antes de publicar.</p>`
        : `<p class="muted">Sin errores ni avisos: se puede publicar tal cual.</p>`}
      ${problemasHTML(v.fuente)}
      ${problemasHTML(casos.flatMap((c) => v.casos[c.id].map((p) => ({ ...p, texto: `${c.tema || c.id}: ${p.texto}` }))).slice(0, 12))}
    </section>
    <div class="row">
      <button class="primary" id="crear-importado">Crear el cuestionario</button>
      <button id="cancelar-importado">Cancelar</button>
    </div>
    <p class="src">Se crea a tu nombre y <b>en preparación</b>: nada sale a la web hasta que tú lo publiques.</p>
  </div>`;
  $("#cancelar-importado").onclick = () => { importado = null; location.hash = "#/"; };
  $("#crear-importado").onclick = () => crearImportado();
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
      casos: Object.fromEntries(Object.entries(d.casos).map(([k, c]) => [k, { ...c, actualizado: serverTimestamp() }])),
    });
    let n = 0;
    for (const [imgId, url] of Object.entries(d.datos)) {
      await set(ref(db, `estudio_img/${id}/${imgId}`), url);
      n += 1;
      boton.textContent = `Subiendo imágenes… ${n} de ${Object.keys(d.datos).length}`;
    }
  } catch (e) {
    creando = false;
    boton.disabled = false;
    boton.textContent = "Crear el cuestionario";
    return aviso("No se pudo crear: " + (e.code || e.message), true);
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
  const cabecera = `<div class="row" style="justify-content:space-between;align-items:baseline">
      <div><a class="src" href="#/">← Todos los temas</a><h1>${esc(t.meta.titulo)}</h1>
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
    <p class="src">${n.casos} casos · ${n.verificados} verificados</p>
  </section>`;
}

// ---------- editor del autor
function pasos(t, v) {
  const marca = (ok) => (ok ? "✓" : "•");
  const items = [
    ["fuente", `${marca(!v.fuente.some((p) => p.tipo === "error"))} 1. Fuente`],
    ["imagenes", `${marca(imagenesOrdenadas(t).length && !Object.values(v.imagenes).flat().some((p) => p.tipo === "error"))} 2. Imágenes`],
    ["casos", `${marca(casosOrdenados(t).length && !Object.values(v.casos).flat().some((p) => p.tipo === "error"))} 3. Casos`],
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
    ? `<p class="caja">Hay ${n.problemas ? `${n.problemas} caso(s) marcados con problema por un radiólogo` : ""}${n.problemas && n.reportados ? " y " : ""}${n.reportados ? `${n.reportados} con reportes de usuarios` : ""}. Están marcados en el paso 3.</p>`
    : "";
  return pasos(t, v) + aviso_ + cuerpo;
}

function pasoFuente(t, v) {
  const f = t.fuente || {};
  return `<section class="panel" style="display:grid;gap:12px">
    <h2>1. De dónde salen las imágenes</h2>
    <p class="muted">Solo se pueden usar artículos de acceso abierto o bancos públicos con licencia que permita uso educativo.</p>
    <div class="row" style="align-items:end">
      <label class="grid-label" style="flex:1">DOI del artículo
        <input type="text" id="doi" value="${esc(f.doi || "")}" placeholder="10.24875/AJI.23000069"></label>
      <button id="buscar">Completar con el DOI</button>
    </div>
    <label class="grid-label">Cita completa<textarea id="cita" rows="3">${esc(f.cita || "")}</textarea></label>
    <div class="row">
      <label class="grid-label" style="flex:1">Crédito corto (aparece bajo la imagen)
        <input type="text" id="credito" maxlength="80" value="${esc(f.credito || "")}" placeholder="López-Ramírez M, et al. Austral J Imaging. 2024"></label>
      <label class="grid-label" style="flex:1">Enlace a la fuente
        <input type="text" id="url" value="${esc(f.url || "")}" placeholder="https://…"></label>
    </div>
    <label class="grid-label">Titular de los derechos (lo que dice «©» en la fuente)
      <input type="text" id="titular" value="${esc(f.titular || "")}" placeholder="© 2024 Sociedad Chilena de Radiología"></label>
    <label class="grid-label">Licencia
      <select id="licencia"><option value="">Elige…</option>
        ${LICENCIAS.map((l) => `<option value="${l.valor}" ${f.licencia === l.valor ? "selected" : ""}>${l.valor}${l.nd ? " (no se puede recortar ni marcar)" : ""}</option>`).join("")}
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
      <img src="${imagenesTema[img.id] || ""}" alt="${esc(img.figura)}" class="miniatura" data-zoom>
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
      <span class="tema">${esc(caso.tema || "sin subtema")}</span>
      <span class="src">${caso.tipo === "concepto" ? "concepto" : "imagen"} · ${selloCaso(t.id, caso)}</span>
    </div>
    ${estado === "problema" && ver.comentario ? `<p class="caja">${esc(ver.nombre)}: «${esc(ver.comentario)}»</p>` : ""}
    ${reportados.map((r) => `<p class="caja">Reporte de un usuario: «${esc(r.texto)}»</p>`).join("")}
    <div class="md">${md(caso.enunciado || "")}</div>
    ${orden.length ? `<div class="row">${orden.map((r) => `<img class="miniatura chica" src="${imagenesTema[r.ref] || ""}" alt="" data-zoom>`).join("")}</div>` : ""}
    <ol class="opciones-lista">${lista(caso.opciones).map((o, i) => `<li class="${i === caso.correcta ? "correcta" : ""}">${esc(o)}</li>`).join("")}</ol>
    ${problemasHTML(v.casos[caso.id])}
    <div class="row"><button data-editar="${esc(caso.id)}">Editar</button>
      <button data-subir="${esc(caso.id)}">↑</button><button data-bajar="${esc(caso.id)}">↓</button>
      <button data-borrar-caso="${esc(caso.id)}">Borrar</button></div>
  </div>`;
}

function pasoCasos(t, v) {
  if (editando) return formularioCaso(t, editando);
  const casos = casosOrdenados(t);
  const sinImagenes = !imagenesOrdenadas(t).length;
  return `<section class="panel" style="display:grid;gap:12px">
    <h2>3. Casos</h2>
    ${sinImagenes ? `<p class="caja">Primero sube las imágenes: así tu IA sabrá qué figuras puede usar.</p>` : ""}
    <div class="ia">
      <h3>Escribirlos con tu IA</h3>
      <p class="muted">Funciona con la que prefieras: ChatGPT, Gemini, Copilot, Claude, DeepSeek…</p>
      <ol class="pasos-ia">
        <li><button class="primary" id="copiar-ia">Copiar instrucciones</button></li>
        <li>Abre tu IA, <b>adjunta el PDF</b> de la fuente y pega las instrucciones.</li>
        <li>Copia su respuesta y pégala aquí abajo.</li>
      </ol>
      <textarea id="respuesta-ia" rows="4" placeholder="Pega aquí la respuesta de tu IA (el JSON)"></textarea>
      <div class="row"><button id="cargar-ia">Cargar respuesta</button>
        <label class="row" style="gap:6px"><input type="checkbox" id="reemplazar"> Reemplazar los casos actuales</label>
        ${v.errores ? `<button id="copiar-correccion">Pedir a la IA que corrija</button>` : ""}
      </div>
      <details><summary>Ver las instrucciones</summary><pre class="instrucciones">${esc(instruccionesIA(t))}</pre></details>
    </div>
    <div class="row" style="justify-content:space-between"><h3>${casos.length} casos</h3>
      <button id="nuevo-caso">Agregar caso a mano</button></div>
    <div class="casos">${casos.map((c) => tarjetaCaso(t, c, v)).join("") || `<p class="muted">Todavía no hay casos.</p>`}</div>
    <div class="row"><button id="ir-publicar">Siguiente: publicar</button></div>
  </section>`;
}

function formularioCaso(t, id) {
  const caso = t.casos[id] || {};
  const imagenes = imagenesOrdenadas(t);
  const evidencia = lista(caso.evidencia);
  return `<section class="panel" style="display:grid;gap:12px">
    <h2>Caso</h2>
    <div class="row">
      <label class="grid-label" style="flex:1">Subtema<input type="text" id="c-tema" maxlength="80" value="${esc(caso.tema || "")}" placeholder="Desplazamiento discal"></label>
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
          <img class="miniatura chica" src="${imagenesTema[img.id] || ""}" alt="">
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
    <label class="grid-label">Etiquetas (separadas por comas)<input type="text" id="c-etiquetas" value="${esc(lista(caso.etiquetas).join(", "))}"></label>
    <div class="row"><button class="primary" id="guardar-caso">Guardar caso</button><button id="cancelar-caso">Cancelar</button></div>
  </section>`;
}

function pasoPublicar(t, v) {
  const casos = casosOrdenados(t);
  const conError = casos.filter((c) => v.casos[c.id].some((p) => p.tipo === "error")).length;
  const n = cuentas(t);
  const publicado = t.meta.estado === "publicado";
  return `<section class="panel" style="display:grid;gap:12px">
    <h2>4. Publicar</h2>
    <div class="tabla"><table><tbody>
      <tr><td>Fuente y licencia</td><td>${v.fuente.some((p) => p.tipo === "error") ? "Falta completar" : "Lista"}</td></tr>
      <tr><td>Imágenes</td><td>${imagenesOrdenadas(t).length}</td></tr>
      <tr><td>Casos</td><td>${casos.length}${conError ? ` · ${conError} con problemas` : ""}</td></tr>
      <tr><td>Avisos</td><td>${v.avisos}</td></tr>
      ${publicado ? `<tr><td>Verificados</td><td>${n.verificados} de ${n.casos}</td></tr>` : ""}
    </tbody></table></div>
    ${v.errores
      ? `<p class="caja">Faltan ${v.errores} cosas por corregir. Revisa los pasos marcados con •.</p>`
      : `<p class="caja">Al publicar, los casos quedan disponibles en la web como <b>sin verificar</b>. Cualquier radiólogo
          del equipo puede ponerles el sello de verificado; mientras tanto, las salas en vivo no los usan salvo que el
          presentador lo pida.</p>`}
    <div class="row">
      <button class="primary" id="publicar" ${v.errores ? "disabled" : ""}>
        ${publicado ? (sinPublicar(t) ? "Publicar cambios" : "Volver a publicar") : "Publicar"}</button>
      <button id="descargar-zip">Descargar .zip</button>
      ${publicado && esCoord() ? `<button id="despublicar">Quitar de la web</button>` : ""}
      <button class="peligrosa" id="borrar-tema">Borrar este cuestionario</button>
    </div>
    <p class="src">El .zip lleva lo mismo que se publica —paquete.json, fuentes.json e img/— y se puede volver a
      subir aquí o mandar al repositorio. Descarga uno antes de borrar si quieres conservarlo.</p>
    ${publicado ? `<p class="src">Publicado el ${new Date(t.meta.publicado_en || Date.now()).toLocaleDateString("es-PE")}. Ya se puede practicar en la web.</p>` : ""}
  </section>`;
}

// ---------- revisión
function panelVerificacion(t) {
  const casos = casosOrdenados(t);
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
    <p class="caja">Verifica lo que puedas: cada caso que apruebes queda con tu nombre y se marca como verificado en la
      web. Arriba aparecen primero los casos reportados y los que nadie ha mirado.${soyAutor(t)
        ? " Este tema es tuyo: el sello dirá que lo verificaste tú, así que conviene que otro radiólogo lo mire también." : ""}</p>
    <div class="row"><span class="chip">${n.verificados} ${n.verificados === 1 ? "verificado" : "verificados"} de ${n.casos}</span>
      ${n.reportados ? `<span class="chip">${n.reportados} con reportes</span>` : ""}
      <button id="verificar-todo">Verificar todos los que faltan</button></div>
    ${conPrioridad.map(({ c }) => casoVerificable(t, c)).join("")}
  </section>`;
}

function casoVerificable(t, caso) {
  const ver = vercaso(t.id, caso.id);
  const estado = estadoVerificacion(caso, ver);
  const refs = lista(caso.imagenes);
  const v = validarCaso(caso, t.imagenes);
  const reportados = reportesDe(t.id, caso.id);
  return `<section class="panel caso-revision ${estado === "verificado" ? "aprobado" : estado === "problema" ? "cambios" : estado === "cambiado" ? "cambiado" : ""}" style="display:grid;gap:10px">
    <div class="row" style="justify-content:space-between"><span class="tema">${esc(caso.tema || "")}</span>
      <span class="src">${selloCaso(t.id, caso)}</span></div>
    ${reportados.map((r) => `<p class="caja">Reporte de un usuario: «${esc(r.texto)}»</p>`).join("")}
    <div class="stage ${refs.length ? "" : "sin-imagen"}">
      ${refs.length ? `<div class="viewer">${refs.map((r) => `<figure><img src="${imagenesTema[r.ref] || ""}" alt="" data-zoom>
        <figcaption class="cap"><span>${esc((t.imagenes[r.ref] || {}).figura || "")} · ${r.mostrar_en === "respuesta" ? "solo en la respuesta" : "en la pregunta"}</span></figcaption></figure>`).join("")}</div>` : ""}
      <div style="display:grid;gap:10px">
        <div class="stem md">${md(caso.enunciado || "")}</div>
        <div class="opts">${lista(caso.opciones).map((o, i) => `<div class="opt ${i === caso.correcta ? "right" : ""}">
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

// ------------------------------------------------------------------ acciones del editor
function enlazarEditor(t) {
  const id = t.id;
  app.querySelectorAll("[data-paso]").forEach((b) => {
    b.onclick = () => { paso = b.dataset.paso; editando = null; dibujar(); };
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
  if (paso === "casos" && !editando) {
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
    $("#mas-evidencia").onclick = () => {
      const fila = document.createElement("div");
      fila.className = "row evidencia";
      fila.style.gap = "8px";
      fila.innerHTML = `<input type="text" class="ev-ubicacion" style="width:30%" placeholder="p. 5, Figura 2">
        <input type="text" class="ev-cita" style="flex:1" placeholder="Frase copiada de la fuente">`;
      $("#evidencias").append(fila);
    };
  }
  if (paso === "publicar") {
    $("#publicar").onclick = () => publicar(t);
    $("#descargar-zip").onclick = () => descargarZip(t);
    const quitar = $("#despublicar");
    if (quitar) quitar.onclick = async () => {
      if (!confirm("¿Quitar este tema de la web? Los casos siguen guardados en el estudio.")) return;
      await remove(ref(db, `publicacion/${id}`)).catch(() => {});
      await remove(ref(db, `publicacion_img/${id}`)).catch(() => {});
      const delIndice = await anotarEnIndice(id, {
        titulo: t.meta.titulo, segmento: t.meta.segmento, retirado: true,
      });
      await guardarMeta(id, { estado: "borrador" });
      aviso(delIndice ? "Quitado de la web." : "Quitado. Tarda unos minutos en desaparecer de la web.");
    };
    $("#borrar-tema").onclick = () => borrarTema(t);
  }
}

// Escribe la entrada del tema en «indice_publicado», la lista corta que lee la portada.
// Devuelve si lo consiguió: no es motivo para dar la publicación por fallida.
async function anotarEnIndice(id, entrada) {
  try {
    await set(ref(db, `indice_publicado/${id}`), { ...entrada, fecha: serverTimestamp() });
    return true;
  } catch {
    return false;
  }
}

async function publicar(t) {
  const partes = (t.meta.version || "0.1.0").split(".").map(Number);
  const version = t.meta.estado === "publicado" ? `${partes[0]}.${partes[1] + 1}.0` : t.meta.version || "0.1.0";
  const { paquete, fuentes, imagenesUsadas, actualizados } = aPaquete(t, version);
  const imagenes = {};
  for (const id of imagenesUsadas) imagenes[id] = imagenesTema[id];
  try {
    await update(ref(db), {
      [`publicacion/${t.id}`]: {
        paquete_json: JSON.stringify(paquete),
        fuentes_json: JSON.stringify(fuentes),
        actualizados,
        segmento: paquete.segmento,
        version,
        fecha: serverTimestamp(),
        por: perfil.nombre,
      },
      [`publicacion_img/${t.id}`]: imagenes,
      [`estudio/${t.id}/meta/estado`]: "publicado",
      [`estudio/${t.id}/meta/version`]: version,
      [`estudio/${t.id}/meta/publicado_en`]: serverTimestamp(),
    });
  } catch (e) {
    aviso("No se pudo publicar: " + (e.code || e.message), true);
    return;
  }
  // La lista de la portada va aparte: si fallara (reglas sin desplegar), el tema queda publicado
  // igual y aparece cuando el repositorio se ponga al día.
  const alIndice = await anotarEnIndice(t.id, {
    titulo: paquete.titulo,
    segmento: paquete.segmento,
    modalidades: paquete.modalidades || [],
    version,
    casos: paquete.casos.length,
    actualizados,
  });
  aviso(alIndice ? "Publicado. Ya está en la web." : "Publicado. Tarda unos minutos en aparecer en la web.");
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
  const plural = (cuantos, uno, muchos) => `${cuantos} ${cuantos === 1 ? uno : muchos}`;
  const ok = await confirmarPeligro({
    titulo: `Borrar «${t.meta.titulo}»`,
    cuerpo: `<p>Se va a borrar del estudio, con todo lo que tiene dentro:</p>
      <ul class="problemas">
        <li>${plural(n.casos, "caso", "casos")} y ${plural(imagenes, "imagen", "imágenes")}</li>
        ${n.verificados ? `<li>${plural(n.verificados, "sello de verificado", "sellos de verificado")} puestos por un radiólogo</li>` : ""}
        ${n.reportados ? `<li>${plural(n.reportados, "caso reportado", "casos reportados")} por gente que practicó</li>` : ""}
        ${publicado ? `<li class="error">Está publicado: desaparece de la web y nadie podrá practicarlo</li>` : ""}
      </ul>
      <p>No se puede deshacer y nadie del equipo lo puede recuperar.</p>`,
    boton: "Borrar para siempre",
  });
  if (!ok) return;
  try {
    if (publicado) await anotarEnIndice(id, { titulo: t.meta.titulo, segmento: t.meta.segmento, retirado: true });
    await remove(ref(db, `publicacion/${id}`));
    await remove(ref(db, `publicacion_img/${id}`));
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
  aviso(publicado ? "Borrado. Tarda unos minutos en desaparecer de la web." : "Borrado.");
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
    tipo: "articulo",
    cita,
    credito: $("#credito").value.trim(),
    doi: $("#doi").value.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//, ""),
    url: $("#url").value.trim(),
    titular: $("#titular").value.trim(),
    licencia,
    licencia_url: datos?.url || "",
    modificaciones_permitidas: !datos?.nd,
    verificacion: { fecha: hoy(), por: perfil.nombre, donde: $("#frase").value.trim() },
  };
  await set(ref(db, `estudio/${id}/fuente`), fuente);
  await guardarMeta(id, {});
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
  const usada = t ? casosOrdenados(t).filter((c) => lista(c.imagenes).some((r) => r.ref === imgId)).length : 0;
  const texto = usada
    ? `Esta imagen la usan ${usada} caso(s); se quedarán sin ella. ¿Quitarla igual?`
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

function mover(t, casoId, paso_) {
  const casos = casosOrdenados(t);
  const i = casos.findIndex((c) => c.id === casoId);
  const j = i + paso_;
  if (j < 0 || j >= casos.length) return;
  const cambios = {};
  cambios[`estudio/${t.id}/casos/${casos[i].id}/orden`] = j + 1;
  cambios[`estudio/${t.id}/casos/${casos[j].id}/orden`] = i + 1;
  update(ref(db), cambios);
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
    orden: anterior.orden || casosOrdenados(t).length + 1,
    actualizado: serverTimestamp(),
  };
  await set(ref(db, `estudio/${t.id}/casos/${casoId}`), caso);
  await guardarMeta(t.id, {});
  editando = null;
  dibujar();
  aviso("Caso guardado.");
}

async function cargarRespuesta(t) {
  const texto = $("#respuesta-ia").value;
  let datos;
  try {
    datos = leerRespuestaIA(texto, t);
  } catch (e) {
    return aviso(e.message, true);
  }
  const cambios = {};
  let fichas = 0;
  for (const img of datos.imagenes) {
    if (!img.ref) continue;
    fichas += 1;
    cambios[`estudio/${t.id}/imagenes/${img.ref}/leyenda_original`] = img.leyenda_original;
    if (img.modalidad) cambios[`estudio/${t.id}/imagenes/${img.ref}/modalidad`] = img.modalidad;
    if (img.paneles.length) cambios[`estudio/${t.id}/imagenes/${img.ref}/paneles`] = img.paneles;
    if (img.marcas.length) cambios[`estudio/${t.id}/imagenes/${img.ref}/marcas`] = img.marcas;
  }
  const reemplazar = $("#reemplazar").checked;
  if (reemplazar) cambios[`estudio/${t.id}/casos`] = null;
  let orden = reemplazar ? 0 : casosOrdenados(t).length;
  const existentes = reemplazar ? [] : casosOrdenados(t).map((c) => c.id);
  for (const caso of datos.casos) {
    orden += 1;
    let id = `caso-${String(orden).padStart(2, "0")}`;
    while (existentes.includes(id)) id = `${id}b`;
    existentes.push(id);
    cambios[`estudio/${t.id}/casos/${id}`] = {
      ...caso,
      imagenes: caso.imagenes.filter((r) => r.ref).map((r) => ({ ref: r.ref, mostrar_en: r.mostrar_en })),
      orden,
      actualizado: serverTimestamp(),
    };
  }
  try {
    await update(ref(db), cambios);
    await guardarMeta(t.id, {});
    $("#respuesta-ia").value = "";
    const perdidas = datos.casos.flatMap((c) => c.imagenes.filter((r) => !r.ref).map((r) => r.figura)).filter(Boolean);
    aviso(`Cargué ${datos.casos.length} casos y ${fichas} leyendas.` + (perdidas.length ? ` No reconocí: ${[...new Set(perdidas)].join(", ")}.` : ""));
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
      const comentario = prompt("¿Qué está mal en este caso?");
      if (comentario === null) return;
      verificar(t, b.dataset.problema, "problema", comentario.slice(0, 1000));
    };
  });
  const todo = $("#verificar-todo");
  if (todo) todo.onclick = async () => {
    const faltan = casosOrdenados(t).filter((c) => estadoVerificacion(c, vercaso(t.id, c.id)) !== "verificado");
    if (!faltan.length) return aviso("No queda ninguno por verificar.");
    if (!confirm(`¿Verificar ${faltan.length} casos de una vez? Quedarán con tu nombre.`)) return;
    for (const c of faltan) await verificar(t, c.id, "verificado", "", true);
    aviso(`${faltan.length} casos verificados.`);
  };
}

async function verificar(t, casoId, decision, comentario, callado = false) {
  const caso = t.casos[casoId] || {};
  try {
    await set(ref(db, `verificacion/${t.id}/${casoId}`), {
      decision, usuario: perfil.usuario, nombre: perfil.nombre, comentario,
      base: caso.actualizado || 0, fecha: serverTimestamp(),
    });
    if (!callado) aviso(decision === "verificado" ? "Caso verificado." : "Problema señalado; el autor lo verá.");
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
      cargarImagenes(ruta[1]);
    }
    return vistaTema();
  }
  temaAbierto = null;
  inicio();
}

document.addEventListener("click", (e) => {
  const img = e.target.closest("[data-zoom]");
  if (img && img.src) { $("#zoomImg").src = img.src; $("#zoom").hidden = false; }
});
$("#zoom").onclick = () => { $("#zoom").hidden = true; };
window.addEventListener("hashchange", () => dibujar());

function escuchar() {
  onValue(ref(db, "estudio"), (s) => { temas = s.val() || {}; if (!editando) dibujar(); });
  onValue(ref(db, "verificacion"), (s) => { verificaciones = s.val() || {}; if (!editando) dibujar(); });
  onValue(ref(db, "reportes"), (s) => { reportes = s.val() || {}; if (!editando) dibujar(); }, () => {});
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
