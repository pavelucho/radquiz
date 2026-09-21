// RadQuiz — práctica individual. Con ?revision=1 muestra también los borradores y la información para el revisor
// (evidencia, ficha técnica, notas): es el previsualizador de la fase de revisión.
import { $, esc, md, credito, barajar, sello, TANDAS, opcionesTanda } from "./comun.js";
import { cargarPaquete } from "./publicado.js";
import { reportar } from "./reportar.js";

const LETRAS = "ABCDE";
const params = new URLSearchParams(location.search);
const tema = params.get("tema") || "";
const revision = params.get("revision") === "1";
const app = $("#app");

let paquete, fuentes, base;
let srcImagen = () => "";
let disponibles = [];   // los casos del tema que pasan el filtro «Solo verificados»
let casos = [];         // la tanda que se está practicando
let totalOpciones = -1;
let actual = 0;
const orden = new Map();       // id del caso → índices originales en el orden mostrado
const respuestas = new Map();  // id del caso → índice original elegido

function ordenDe(caso) {
  if (!orden.has(caso.id)) {
    const indices = caso.opciones.map((_, i) => i);
    orden.set(caso.id, caso.barajar === false ? indices : barajar(indices));
  }
  return orden.get(caso.id);
}

function visor(refs) {
  if (!refs.length) return "";
  return `<div class="viewer">${refs.map((ref) => {
    const imagen = paquete.imagenes[ref.ref];
    if (!imagen) return `<p class="cap">Falta la imagen ${esc(ref.ref)}</p>`;
    const src = srcImagen(ref.ref);
    return `<figure>
      <img src="${src}" alt="${esc(imagen.figura)}" data-zoom>
      <figcaption class="cap"><span>${credito(imagen, fuentes[imagen.fuente])}</span><span>Toca para ampliar</span></figcaption>
    </figure>`;
  }).join("")}</div>`;
}

function marcador() {
  const hechas = [...respuestas.entries()].filter(([id]) => casos.some((c) => c.id === id));
  const bien = hechas.filter(([id, elegida]) => casos.find((c) => c.id === id).correcta === elegida).length;
  const chip = $("#marcador");
  chip.hidden = !hechas.length;
  chip.textContent = `${bien}/${hechas.length} correctas`;
}

function fichaImagen(ref) {
  const imagen = paquete.imagenes[ref];
  if (!imagen) return "";
  const dato = (v, clave) => (clave ? (v === null ? `<span class="sin-dato">no consta</span>` : esc(v)) : `<span class="nota">pendiente</span>`);
  const filas = (imagen.paneles || []).map((p) => `<tr>
    <td>${esc(p.id)}</td><td>${p.lado ? esc(p.lado) : ""}</td>
    <td>${dato(p.plano, "plano" in p)}</td><td>${dato(p.secuencia, "secuencia" in p)}</td><td>${dato(p.condicion, "condicion" in p)}</td>
  </tr>`).join("");
  const marcas = (imagen.marcas || []).map((m) => `<li><b>${esc(m.marca)}</b>${m.panel ? ` (${esc(m.panel)})` : ""}: ${esc(m.senala)}</li>`).join("");
  return `<div>
    <p><b>${esc(imagen.figura)}</b> · <span class="muted">${esc(imagen.archivo)} · ${esc(imagen.modalidad ?? "sin modalidad")}</span></p>
    <table class="ficha"><thead><tr><th>Panel</th><th>Lado</th><th>Plano</th><th>Secuencia</th><th>Condición</th></tr></thead><tbody>${filas}</tbody></table>
    ${marcas ? `<ul>${marcas}</ul>` : ""}
    ${imagen.notas ? `<p class="nota">Nota: ${esc(imagen.notas)}</p>` : ""}
  </div>`;
}

function panelRevision(caso) {
  const evidencia = (caso.evidencia || []).map((e) => `<div>
    <p class="ubic">${esc(e.ubicacion)} · ${esc(e.fuente)}</p><blockquote>${esc(e.cita)}</blockquote></div>`).join("")
    || `<p class="nota">Sin evidencia.</p>`;
  const enPantalla = LETRAS[ordenDe(caso).indexOf(caso.correcta)];
  const clave = `${enPantalla} en pantalla (${LETRAS[caso.correcta]} en el archivo)`;
  return `<section class="revision">
    <h3>Para el revisor</h3>
    <p class="src">${esc(tema)}/${esc(caso.id)} · estado ${esc(caso.estado)} ·
      tipo ${esc(caso.tipo)} · clave ${clave} · autor ${esc(caso.autor)}${caso.revisor ? ` · revisor ${esc(caso.revisor)}` : ""}</p>
    ${caso.notas_revision ? `<p class="nota">Nota: ${esc(caso.notas_revision)}</p>` : ""}
    <details open><summary>Evidencia (${(caso.evidencia || []).length})</summary><div style="display:grid;gap:8px">${evidencia}</div></details>
    ${caso.imagenes.length ? `<details><summary>Ficha técnica</summary><div style="display:grid;gap:14px">${caso.imagenes.map((r) => fichaImagen(r.ref)).join("")}</div></details>` : ""}
  </section>`;
}

function vistaCaso() {
  const caso = casos[actual];
  const elegida = respuestas.get(caso.id);
  const respondido = elegida !== undefined;
  const indices = ordenDe(caso);
  const refs = caso.imagenes.filter((r) => r.mostrar_en === "pregunta" || respondido);

  const opciones = indices.map((original, pos) => {
    let clase = "";
    if (respondido) clase = original === caso.correcta ? "right" : "wrong";
    if (respondido && original === elegida) clase += " mine";
    return `<button class="opt ${clase}" data-k="${pos}" data-original="${original}" ${respondido ? "disabled" : ""}>
      <span class="k">${LETRAS[pos]}</span><span>${esc(caso.opciones[original])}</span></button>`;
  }).join("");

  let despues = "";
  if (respondido) {
    const acierto = elegida === caso.correcta;
    const letra = LETRAS[indices.indexOf(caso.correcta)];
    const leyendas = caso.imagenes.map((r) => paquete.imagenes[r.ref]).filter((i) => i && i.leyenda_original);
    despues = `
      <div class="verdict ${acierto ? "ok" : "no"}">${acierto ? "Correcto" : "Incorrecto"}</div>
      <div class="exp md"><div class="ans">Respuesta: ${letra}. ${esc(caso.opciones[caso.correcta])}</div>${md(caso.explicacion)}</div>
      ${caso.perla ? `<div class="pearl md"><b>Perla:</b> ${md(caso.perla)}</div>` : ""}
      ${leyendas.map((i) => `<details><summary>Leyenda original · ${esc(i.figura)}</summary><p>${esc(i.leyenda_original)}</p></details>`).join("")}
      <div class="row"><button id="reportar" class="reportar">Reportar un error en este caso</button></div>`;
  }

  const ultima = actual === casos.length - 1;
  app.innerHTML = `
    <div class="qhead">
      <span class="qnum">${actual + 1}/${casos.length}</span>
      ${respondido ? `<span class="tema">${esc(caso.tema)}</span>` : ""}
      ${caso.estado !== "publicado" ? `<span class="badge borrador">${esc(caso.estado)}</span>` : sello(caso, paquete.personas)}
    </div>
    <section class="stage ${refs.length ? "" : "sin-imagen"}">
      ${visor(refs)}
      <div style="display:grid;gap:12px">
        <div class="stem md">${md(caso.enunciado)}</div>
        <div class="opts">${opciones}</div>
        ${despues}
      </div>
    </section>
    ${revision ? panelRevision(caso) : ""}
    <div class="ctrl">
      <button id="anterior" ${actual === 0 ? "disabled" : ""}>Anterior</button>
      <button class="primary" id="siguiente">${ultima ? "Ver resultado" : "Siguiente caso"}</button>
      <span class="spacer"></span>
      <span class="src">Teclas: A–E responde · → siguiente</span>
    </div>`;

  app.querySelectorAll("button.opt").forEach((boton) => {
    boton.onclick = () => responder(Number(boton.dataset.original));
  });
  const botonReporte = $("#reportar");
  if (botonReporte) botonReporte.onclick = () => reportar(tema, caso.id, botonReporte);
  $("#anterior").onclick = () => ir(actual - 1);
  $("#siguiente").onclick = () => (ultima ? resultado() : ir(actual + 1));
  marcador();
  precargar(casos[actual + 1]);
}

// Descarga de antemano las imágenes del caso siguiente, para que la red lenta no frene la clase.
function precargar(caso) {
  for (const ref of caso?.imagenes || []) {
    const src = srcImagen(ref.ref);
    if (src) new Image().src = src;
  }
}

function responder(original) {
  const caso = casos[actual];
  if (respuestas.has(caso.id)) return;
  respuestas.set(caso.id, original);
  vistaCaso();
}

function ir(indice) {
  actual = Math.max(0, Math.min(casos.length - 1, indice));
  vistaCaso();
  window.scrollTo({ top: 0 });
}

function resultado() {
  const hechas = casos.filter((c) => respuestas.has(c.id));
  const falladas = hechas.filter((c) => respuestas.get(c.id) !== c.correcta);
  app.innerHTML = `<section class="panel" style="display:grid;gap:14px;max-width:640px">
    <span class="tema">${esc(paquete.titulo)}</span>
    <div class="big">${hechas.length - falladas.length}/${hechas.length}</div>
    <p class="muted">correctas de ${hechas.length} respondidas (${casos.length} en esta tanda).</p>
    ${casos.length < disponibles.length
      ? `<p class="src">El tema tiene ${disponibles.length} casos. «Empezar de nuevo» arma otra tanda al azar.</p>` : ""}
    <div class="row">
      <button class="primary" id="repetir">Empezar de nuevo</button>
      ${falladas.length ? `<button id="falladas">Repasar las ${falladas.length} falladas</button>` : ""}
    </div>
  </section>`;
  $("#repetir").onclick = reiniciar;
  const boton = $("#falladas");
  if (boton) boton.onclick = () => {
    casos = falladas;
    falladas.forEach((c) => { respuestas.delete(c.id); orden.delete(c.id); });
    actual = 0;
    vistaCaso();
  };
}

// Elige «cuantos» casos al azar, pero los deja en el orden del tema.
function tanda(lista, cuantos) {
  if (!cuantos || cuantos >= lista.length) return lista;
  const elegidos = new Set(barajar(lista.map((_, i) => i)).slice(0, cuantos));
  return lista.filter((_, i) => elegidos.has(i));
}

// El desplegable solo se rehace cuando cambia cuántos casos hay (al tocar «Solo verificados»):
// así, al elegir una tanda, la elección no se pierde mientras se rehacen las opciones.
function ponerOpciones(total) {
  if (total === totalOpciones) return;
  totalOpciones = total;
  const select = $("#cuantos");
  select.innerHTML = opcionesTanda(total, Number(select.value) || 0, "al azar");
  $("#tanda").hidden = total <= TANDAS[0];   // con tan pocos casos no hay nada que elegir
}

function reiniciar() {
  respuestas.clear();
  orden.clear();
  empezar();
}

function empezar() {
  const soloVerificados = $("#solo-verificados").checked;
  disponibles = base.filter((c) => !soloVerificados || c.revisor);
  ponerOpciones(disponibles.length);
  casos = tanda(disponibles, Number($("#cuantos").value) || 0);
  actual = 0;
  if (!casos.length) {
    app.innerHTML = `<section class="panel"><p>Este tema todavía no tiene casos verificados por un radiólogo.
      Quita el filtro «Solo verificados» para practicar con los demás.</p></section>`;
    marcador();
    return;
  }
  vistaCaso();
}

function sinCasos() {
  const enlace = `practica.html?tema=${encodeURIComponent(tema).replace("%2F", "/")}&amp;revision=1`;
  app.innerHTML = `<section class="panel" style="display:grid;gap:10px;max-width:680px">
    <h2>${esc(paquete.titulo)}</h2>
    <p>Este tema todavía no tiene casos publicados: siguen en borrador. Quien los escribió los publica desde el estudio.</p>
    ${paquete.casos.length ? `<p class="src">¿Eres el autor o revisor? <a href="${enlace}">Ver los borradores</a>.</p>` : ""}
  </section>`;
}

async function iniciar() {
  if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(tema)) {
    app.innerHTML = `<section class="panel"><p>Falta el tema. <a href="./">Volver a la lista</a>.</p></section>`;
    return;
  }
  try {
    ({ paquete, fuentes, imagen: srcImagen } = await cargarPaquete(tema));
  } catch (e) {
    app.innerHTML = `<section class="panel"><p>No se pudo cargar el tema: ${esc(e.message)}</p></section>`;
    return;
  }
  document.title = `${paquete.titulo} · RadQuiz`;
  $("#subtitulo").textContent = paquete.titulo;
  $("#modo").textContent = revision ? "Revisión · incluye borradores" : "Práctica";
  if (revision) $("#modo").classList.add("live");
  base = paquete.casos.filter((c) => revision || c.estado === "publicado");
  if (!base.length) return sinCasos();
  $("#solo-verificados").onchange = reiniciar;
  $("#cuantos").onchange = reiniciar;
  empezar();
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
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { $("#zoom").hidden = true; return; }
  if (!casos.length || !$(".opts") || e.target.closest("select")) return;
  const pos = "abcde".indexOf(e.key.toLowerCase());
  if (pos >= 0) {
    const boton = app.querySelector(`button.opt[data-k="${pos}"]`);
    if (boton && !boton.disabled) boton.click();
  } else if (e.key === "ArrowRight") {
    $("#siguiente")?.click();
  } else if (e.key === "ArrowLeft") {
    $("#anterior")?.click();
  }
});

iniciar();
