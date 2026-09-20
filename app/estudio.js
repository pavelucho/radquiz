// RadQuiz — estudio: crear temas, revisarlos y publicarlos desde la web, sin programas ni Git.
// El contenido en preparación vive en Firebase; al publicar pasa al repositorio y de ahí a la web.
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
  imagenesOrdenadas, estadoRevision, aPaquete,
} from "./validacion.js";
import { instruccionesIA, instruccionesCorreccion, leerRespuestaIA } from "./instrucciones-ia.js";

const LETRAS = "ABCDE";
const ESTADOS = {
  borrador: { texto: "En preparación", clase: "borrador" },
  en_revision: { texto: "En revisión", clase: "revision" },
  cambios: { texto: "Cambios pedidos", clase: "cambios" },
  aprobado: { texto: "Aprobado, falta publicar", clase: "aprobado" },
  publicado: { texto: "Publicado", clase: "publicado" },
};
const app = $("#app");
// La sala en vivo deja una sesión anónima en el navegador; en el estudio siempre se entra con Google.
const modoPrueba = location.hostname === "localhost" && new URLSearchParams(location.search).has("prueba");

let db, auth, usuario = null, perfil = null;
let temas = {}, solicitudes = {}, miembros = {};
let imagenesTema = {};      // dataURL por id de imagen del tema abierto
let temaAbierto = null;
let paso = "fuente";
let editando = null;        // id del caso que se está editando (bloquea el redibujado)
let cargandoImagenes = false;

const hoy = () => new Date().toISOString().slice(0, 10);
const esCoord = () => perfil?.rol === "coordinador";
const esRevisor = () => perfil?.rol === "revisor" || esCoord();
const soyAutor = (t) => t?.meta?.autor_uid === usuario?.uid;
const puedeEditar = (t) => t && (esCoord() || (soyAutor(t) && ["borrador", "cambios", "publicado"].includes(t.meta.estado)));

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
  const t = normalizarTema(id, temas[id]);
  const estado = t.meta.estado === "publicado" && !cambios.estado ? "borrador" : cambios.estado || t.meta.estado;
  await update(ref(db, `estudio/${id}/meta`), { ...cambios, estado, actualizado: serverTimestamp() });
}

// ------------------------------------------------------------------ imágenes
async function comprimir(archivo) {
  const bitmap = await createImageBitmap(archivo);
  let escala = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  let calidad = 0.88;
  for (let intento = 0; intento < 10; intento++) {
    const ancho = Math.round(bitmap.width * escala);
    const alto = Math.round(bitmap.height * escala);
    const lienzo = document.createElement("canvas");
    lienzo.width = ancho;
    lienzo.height = alto;
    const ctx = lienzo.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, ancho, alto);
    ctx.drawImage(bitmap, 0, 0, ancho, alto);
    const datos = lienzo.toDataURL("image/jpeg", calidad);
    if (datos.length < 330000) {
      return { datos, modificaciones: ["comprimida", ...(escala < 1 ? ["redimensionada"] : [])] };
    }
    if (calidad > 0.6) calidad -= 0.08;
    else escala *= 0.85;
  }
  throw new Error("No pude comprimir esta imagen por debajo de 250 KB.");
}

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

function solicitarAcceso() {
  const pedido = solicitudes[usuario.uid];
  if (pedido) {
    app.innerHTML = `<section class="panel" style="display:grid;gap:10px;max-width:620px">
      <h2>Solicitud enviada</h2>
      <p>Pediste acceso como <b>${esc(pedido.rol)}</b>. El coordinador la revisará. Vuelve a entrar más tarde.</p>
      <div class="row"><button id="salir">Salir</button></div></section>`;
    $("#salir").onclick = () => signOut(auth);
    return;
  }
  app.innerHTML = `<form class="panel" id="pedir" style="display:grid;gap:12px;max-width:620px">
    <h2>Pedir acceso</h2>
    <p class="muted">Entraste como ${esc(usuario.email || "")}. Dinos quién eres para darte acceso.</p>
    <label class="grid-label">Tu nombre completo<input type="text" id="nombre" maxlength="60" value="${esc(usuario.displayName || "")}" required></label>
    <label class="grid-label">¿Qué vas a hacer?
      <select id="rol">
        <option value="autor">Preparar cuestionarios (autor)</option>
        <option value="revisor">Revisar y aprobar casos (radiólogo revisor)</option>
      </select></label>
    <label class="grid-label">Mensaje para el coordinador (opcional)<input type="text" id="mensaje" maxlength="200" placeholder="R2 de radiología, HNERM"></label>
    <div class="row"><button class="primary" type="submit">Enviar solicitud</button><button type="button" id="salir">Salir</button></div>
  </form>`;
  $("#salir").onclick = () => signOut(auth);
  $("#pedir").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await set(ref(db, `solicitudes/${usuario.uid}`), {
        nombre: $("#nombre").value.trim(), email: usuario.email, rol: $("#rol").value,
        mensaje: $("#mensaje").value.trim(), fecha: serverTimestamp(),
      });
      aviso("Solicitud enviada.");
    } catch (err) {
      aviso("No se pudo enviar: " + (err.code || err.message), true);
    }
  };
}

// ------------------------------------------------------------------ inicio
function tarjetaTema(t) {
  const casos = casosOrdenados(t).length;
  const mio = soyAutor(t);
  return `<article class="panel tema-card">
    <div class="row" style="justify-content:space-between"><h3>${esc(t.meta.titulo || t.id)}</h3>${chipEstado(t.meta.estado)}</div>
    <p class="meta">${esc(SEGMENTOS[t.meta.segmento] || t.meta.segmento || "")} · ${casos} casos · ${esc(t.meta.autor_nombre || "")}${mio ? " (tú)" : ""}</p>
    <div class="row"><a class="boton" href="#/tema/${esc(t.id)}">${puedeEditar(t) ? "Abrir" : esRevisor() && t.meta.estado === "en_revision" && !mio ? "Revisar" : "Ver"}</a></div>
  </article>`;
}

function inicio() {
  const todos = Object.entries(temas).map(([id, t]) => normalizarTema(id, t));
  const mios = todos.filter((t) => soyAutor(t));
  const paraRevisar = todos.filter((t) => t.meta.estado === "en_revision" && !soyAutor(t) && esRevisor());
  const paraPublicar = todos.filter((t) => t.meta.estado === "aprobado" && esCoord());
  const otros = todos.filter((t) => !mios.includes(t) && !paraRevisar.includes(t) && !paraPublicar.includes(t));
  const pendientes = Object.keys(solicitudes).length;
  const bloque = (titulo, lista_, vacio) => `<section class="segmento">
    <h2>${titulo}</h2>
    ${lista_.length ? `<div class="temas">${lista_.map(tarjetaTema).join("")}</div>` : `<p class="muted">${vacio}</p>`}</section>`;

  app.innerHTML = `<div style="display:grid;gap:22px">
    ${esCoord() && pendientes ? `<p class="caja">Hay ${pendientes} solicitud(es) de acceso. <a href="#/equipo">Revisar</a></p>` : ""}
    ${esRevisor() ? bloque("Para revisar", paraRevisar, "Nada pendiente de revisión.") : ""}
    ${esCoord() ? bloque("Listos para publicar", paraPublicar, "Nada listo para publicar.") : ""}
    <section class="segmento">
      <div class="row" style="justify-content:space-between"><h2>Mis temas</h2>
        <a class="boton primary" href="#/nuevo">Nuevo cuestionario</a></div>
      ${mios.length ? `<div class="temas">${mios.map(tarjetaTema).join("")}</div>` : `<p class="muted">Todavía no creaste ninguno.</p>`}
    </section>
    ${otros.length ? bloque("Otros temas del equipo", otros, "") : ""}
  </div>`;
}

// ------------------------------------------------------------------ equipo (coordinador)
function equipo() {
  const pedidos = Object.entries(solicitudes);
  const gente = Object.entries(miembros);
  app.innerHTML = `<div style="display:grid;gap:20px">
    <div class="row"><a class="boton" href="#/">Volver</a></div>
    <section class="segmento"><h2>Solicitudes de acceso</h2>
      ${pedidos.length ? pedidos.map(([uid, s]) => `<div class="panel" style="display:grid;gap:8px">
        <b>${esc(s.nombre)}</b><p class="src">${esc(s.email)} · pide ser ${esc(s.rol)}${s.mensaje ? ` · «${esc(s.mensaje)}»` : ""}</p>
        <div class="row">
          <button class="primary" data-alta="${esc(uid)}" data-rol="autor">Aceptar como autor</button>
          <button data-alta="${esc(uid)}" data-rol="revisor">Aceptar como revisor</button>
          <button data-rechazar="${esc(uid)}">Rechazar</button>
        </div></div>`).join("") : `<p class="muted">No hay solicitudes.</p>`}
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
  let usuarioSlug = slug(s.email.split("@")[0]).replace(/-/g, "") || "usuario";
  const usados = new Set(Object.values(miembros).map((m) => m.usuario));
  let n = 2;
  while (usados.has(usuarioSlug)) usuarioSlug = `${usuarioSlug}${n++}`;
  await set(ref(db, `usuarios/${uid}`), { nombre: s.nombre, usuario: usuarioSlug, email: s.email, rol, alta: serverTimestamp() });
  await remove(ref(db, `solicitudes/${uid}`));
  aviso(`${s.nombre} entró como ${rol}.`);
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
  </form>`;
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

// ------------------------------------------------------------------ vista de un tema
function vistaTema() {
  const t = temaActual();
  if (!t) return (app.innerHTML = `<p class="muted">Cargando…</p>`);
  const revisando = esRevisor() && !soyAutor(t) && ["en_revision", "aprobado"].includes(t.meta.estado);
  const publicando = esCoord() && t.meta.estado === "aprobado";
  const cabecera = `<div class="row" style="justify-content:space-between;align-items:baseline">
      <div><a class="src" href="#/">← Todos los temas</a><h1>${esc(t.meta.titulo)}</h1>
        <p class="muted">${esc(SEGMENTOS[t.meta.segmento] || "")} · ${esc(t.meta.autor_nombre || "")} · ${chipEstado(t.meta.estado)}</p></div>
    </div>`;
  if (publicando) return (app.innerHTML = cabecera + panelPublicar(t)), enlazarPublicar(t);
  if (revisando) return (app.innerHTML = cabecera + panelRevision(t)), enlazarRevision(t);
  if (!puedeEditar(t)) return (app.innerHTML = cabecera + panelSoloLectura(t)), null;
  app.innerHTML = cabecera + editor(t);
  enlazarEditor(t);
}

function panelSoloLectura(t) {
  const v = validarTema(t);
  return `<section class="panel" style="display:grid;gap:10px">
    <h2>${ESTADOS[t.meta.estado].texto}</h2>
    <p class="muted">${t.meta.estado === "en_revision"
      ? "Un revisor lo está mirando. Puedes retirarlo para seguir editando."
      : "Solo el autor o el coordinador pueden editarlo."}</p>
    <p class="src">${casosOrdenados(t).length} casos · ${v.errores} errores · ${v.avisos} avisos</p>
    ${soyAutor(t) && t.meta.estado === "en_revision" ? `<div class="row"><button id="retirar">Retirar de revisión</button></div>` : ""}
    </section>` + (soyAutor(t) && t.meta.estado === "en_revision" ? "<script></script>" : "");
}

// ---------- editor del autor
function pasos(t, v) {
  const marca = (ok) => (ok ? "✓" : "•");
  const items = [
    ["fuente", `${marca(!v.fuente.some((p) => p.tipo === "error"))} 1. Fuente`],
    ["imagenes", `${marca(imagenesOrdenadas(t).length && !Object.values(v.imagenes).flat().some((p) => p.tipo === "error"))} 2. Imágenes`],
    ["casos", `${marca(casosOrdenados(t).length && !Object.values(v.casos).flat().some((p) => p.tipo === "error"))} 3. Casos`],
    ["enviar", `${marca(v.errores === 0)} 4. Enviar`],
  ];
  return `<nav class="pasos-nav">${items.map(([id, texto]) =>
    `<button class="paso ${paso === id ? "activo" : ""}" data-paso="${id}">${texto}</button>`).join("")}</nav>`;
}

function editor(t) {
  const v = validarTema(t);
  const cuerpo = { fuente: pasoFuente, imagenes: pasoImagenes, casos: pasoCasos, enviar: pasoEnviar }[paso](t, v);
  const comentarios = t.meta.estado === "cambios" ? `<p class="caja">El revisor pidió cambios. Cada caso con pedido aparece marcado en el paso 3.</p>` : "";
  return pasos(t, v) + comentarios + cuerpo;
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

function tarjetaCaso(t, caso, v) {
  const orden = lista(caso.imagenes).filter((r) => r.mostrar_en === "pregunta");
  const rev = t.revision[caso.id];
  const estado = estadoRevision(caso, rev);
  const pedido = rev && rev.decision === "cambios";
  return `<div class="panel caso-card ${pedido ? "con-cambios" : ""}" style="display:grid;gap:8px">
    <div class="row" style="justify-content:space-between">
      <span class="tema">${esc(caso.tema || "sin subtema")}</span>
      <span class="src">${caso.tipo === "concepto" ? "concepto" : "imagen"}${rev ? ` · ${estado === "aprobado" ? "aprobado" : estado === "cambiado" ? "cambió tras la revisión" : "cambios pedidos"}` : ""}</span>
    </div>
    ${pedido && rev.comentario ? `<p class="caja">Revisor: «${esc(rev.comentario)}»</p>` : ""}
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
    <div class="row"><button id="ir-enviar">Siguiente: enviar</button></div>
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

function pasoEnviar(t, v) {
  const casos = casosOrdenados(t);
  const conError = casos.filter((c) => v.casos[c.id].some((p) => p.tipo === "error")).length;
  return `<section class="panel" style="display:grid;gap:12px">
    <h2>4. Enviar a revisión</h2>
    <div class="tabla"><table><tbody>
      <tr><td>Fuente y licencia</td><td>${v.fuente.some((p) => p.tipo === "error") ? "Falta completar" : "Lista"}</td></tr>
      <tr><td>Imágenes</td><td>${imagenesOrdenadas(t).length}</td></tr>
      <tr><td>Casos</td><td>${casos.length}${conError ? ` · ${conError} con problemas` : ""}</td></tr>
      <tr><td>Avisos</td><td>${v.avisos}</td></tr>
    </tbody></table></div>
    ${v.errores ? `<p class="caja">Faltan ${v.errores} cosas por corregir. Revisa los pasos marcados con •.</p>`
      : `<p class="caja">Todo listo. Al enviarlo, un radiólogo revisará caso por caso.</p>`}
    <div class="row">
      <button class="primary" id="enviar" ${v.errores ? "disabled" : ""}>Enviar a revisión</button>
      <button id="borrar-tema">Borrar este tema</button>
    </div>
  </section>`;
}

// ---------- revisión
function panelRevision(t) {
  const casos = casosOrdenados(t);
  const cuenta = { aprobado: 0, cambios: 0, pendiente: 0, cambiado: 0 };
  casos.forEach((c) => { cuenta[estadoRevision(c, t.revision[c.id])] += 1; });
  return `<section style="display:grid;gap:14px">
    <p class="caja">Revisa cada caso como lo verá el residente. Aprueba los que estén bien y pide cambios en los demás.
      Solo se publican los aprobados.</p>
    <div class="row"><span class="chip">${cuenta.aprobado} aprobados</span><span class="chip">${cuenta.cambios} con cambios</span>
      <span class="chip">${cuenta.pendiente + cuenta.cambiado} sin revisar</span></div>
    ${casos.map((c) => casoRevisable(t, c)).join("")}
    <div class="ctrl">
      <button class="primary" id="aprobar-tema" ${cuenta.pendiente + cuenta.cambiado ? "disabled" : ""}>Terminar revisión</button>
      <button id="devolver">Devolver al autor</button>
    </div></section>`;
}

function casoRevisable(t, caso) {
  const rev = t.revision[caso.id];
  const estado = estadoRevision(caso, rev);
  const refs = lista(caso.imagenes);
  const v = validarCaso(caso, t.imagenes);
  return `<section class="panel caso-revision ${estado}" style="display:grid;gap:10px">
    <div class="row" style="justify-content:space-between"><span class="tema">${esc(caso.tema || "")}</span>
      <span class="src">${estado === "aprobado" ? "✓ aprobado" : estado === "cambios" ? "cambios pedidos" : estado === "cambiado" ? "cambió tras tu revisión" : "sin revisar"}</span></div>
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
    ${rev?.comentario ? `<p class="src">Tu comentario: «${esc(rev.comentario)}»</p>` : ""}
    <div class="row">
      <button class="primary" data-aprobar="${esc(caso.id)}">Aprobar</button>
      <button data-cambios="${esc(caso.id)}">Pedir cambio</button>
    </div>
  </section>`;
}

function panelPublicar(t) {
  const { paquete } = aPaquete(t, t.meta.version || "0.1.0");
  const casos = casosOrdenados(t);
  const aprobados = paquete.casos.length;
  return `<section class="panel" style="display:grid;gap:12px">
    <h2>Publicar</h2>
    <p>Se ${aprobados === 1 ? "publicará <b>1</b> caso aprobado" : `publicarán <b>${aprobados}</b> casos aprobados`} de ${casos.length}. Los demás quedan guardados sin publicar.</p>
    <p class="muted">La web se actualiza sola en unos 15 minutos.</p>
    <div class="row"><button class="primary" id="publicar" ${aprobados ? "" : "disabled"}>Publicar en la web</button>
      <button id="devolver-revision">Devolver a revisión</button></div>
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
  $("#ir-enviar") && ($("#ir-enviar").onclick = () => { paso = "enviar"; dibujar(); });

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
      b.onclick = () => confirm("¿Borrar este caso?") && remove(ref(db, `estudio/${id}/casos/${b.dataset.borrarCaso}`));
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
  if (paso === "enviar") {
    $("#enviar").onclick = async () => {
      await guardarMeta(id, { estado: "en_revision" });
      aviso("Enviado a revisión.");
    };
    $("#borrar-tema").onclick = async () => {
      if (!confirm("¿Borrar el tema completo? No se puede deshacer.")) return;
      await remove(ref(db, `estudio_img/${id}`)).catch(() => {});
      await remove(ref(db, `estudio/${id}`));
      location.hash = "#/";
    };
  }
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
  if (!confirm("¿Quitar esta imagen?")) return;
  await remove(ref(db, `estudio/${id}/imagenes/${imgId}`));
  await remove(ref(db, `estudio_img/${id}/${imgId}`));
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
function enlazarRevision(t) {
  app.querySelectorAll("[data-aprobar]").forEach((b) => {
    b.onclick = () => decidir(t, b.dataset.aprobar, "aprobado", "");
  });
  app.querySelectorAll("[data-cambios]").forEach((b) => {
    b.onclick = () => {
      const comentario = prompt("¿Qué hay que corregir?");
      if (comentario === null) return;
      decidir(t, b.dataset.cambios, "cambios", comentario.slice(0, 1000));
    };
  });
  $("#aprobar-tema") && ($("#aprobar-tema").onclick = async () => {
    await set(ref(db, `estudio/${t.id}/meta/estado`), "aprobado");
    aviso("Revisión terminada. El coordinador puede publicar.");
  });
  $("#devolver") && ($("#devolver").onclick = async () => {
    await set(ref(db, `estudio/${t.id}/meta/estado`), "cambios");
    aviso("Devuelto al autor.");
  });
}

async function decidir(t, casoId, decision, comentario) {
  try {
    await set(ref(db, `estudio/${t.id}/revision/${casoId}`), {
      decision, uid: usuario.uid, nombre: perfil.nombre, usuario: perfil.usuario,
      comentario, fecha: serverTimestamp(),
    });
  } catch (e) {
    aviso("No se pudo guardar la revisión: " + (e.code || e.message), true);
  }
}

function enlazarPublicar(t) {
  $("#devolver-revision") && ($("#devolver-revision").onclick = () => set(ref(db, `estudio/${t.id}/meta/estado`), "en_revision"));
  $("#publicar").onclick = async () => {
    const partes = (t.meta.version || "0.1.0").split(".").map(Number);
    const version = `${partes[0]}.${partes[1] + 1}.0`;
    const { paquete, fuentes, imagenesUsadas } = aPaquete(t, version);
    const imagenes = {};
    for (const id of imagenesUsadas) imagenes[id] = imagenesTema[id];
    try {
      await update(ref(db), {
        [`publicacion/${t.id}`]: {
          paquete_json: JSON.stringify(paquete),
          fuentes_json: JSON.stringify(fuentes),
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
      aviso("Publicado. La web se actualiza en unos 15 minutos.");
    } catch (e) {
      aviso("No se pudo publicar: " + (e.code || e.message), true);
    }
  };
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
  if (!perfil) return solicitarAcceso();
  const ruta = location.hash.replace(/^#\/?/, "").split("/");
  if (ruta[0] === "equipo" && esCoord()) return equipo();
  if (ruta[0] === "nuevo") return temaNuevo();
  if (ruta[0] === "tema" && ruta[1]) {
    if (temaAbierto !== ruta[1]) {
      temaAbierto = ruta[1];
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
  onValue(ref(db, `usuarios/${usuario.uid}`), (s) => { perfil = s.val(); dibujar(); });
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
    const snap = await get(ref(db, `usuarios/${u.uid}`)).catch(() => null);
    perfil = snap && snap.exists() ? snap.val() : null;
    if (!perfil) {
      const pedido = await get(ref(db, `solicitudes/${u.uid}`)).catch(() => null);
      solicitudes = pedido && pedido.exists() ? { [u.uid]: pedido.val() } : {};
      onValue(ref(db, `usuarios/${u.uid}`), (s) => { if (s.exists()) { perfil = s.val(); escuchar(); } dibujar(); });
      return dibujar();
    }
    escuchar();
    dibujar();
  });
  $("#salir-top").onclick = () => signOut(auth);
}

iniciar();
