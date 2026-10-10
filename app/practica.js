// RadQuiz — práctica individual. Con ?revision=1 muestra también los borradores y la información para el revisor
// (evidencia, ficha técnica, notas): es el previsualizador de la fase de revisión, y no guarda avance.
//
// El avance queda en este dispositivo (app/avance.js): qué casos se respondieron y la tanda en curso, que se
// retoma al volver. Dos modos: con alternativas, y sin ellas —se piensa la respuesta, se revela y uno mismo marca
// si acertó—. Un caso con «requiere_opciones» sale siempre con sus opciones.
//
// Con ?segmento=…&area=…&q=… (y opcionalmente ?tema=… para un solo tema) es un cuestionario armado con casos de
// varios temas (app/cuestionario.js). Cada caso sabe de qué tema viene (su «origen»): de ahí salen sus figuras,
// sus fuentes y su avance, que se guarda en la clave de su tema como si se hubiera practicado ahí. La tanda en
// curso del cuestionario armado va aparte, en una clave propia por criterio.
import { $, esc, md, credito, barajar, sello, leerTanda, totalTanda } from "./comun.js";
import { cargarPaquete, indicesDeCasos } from "./publicado.js";
import { cargarIndice, cargarTemas } from "./catalogo.js";
import { criterioDe, hayCriterio, consultaDe, nombreCriterio, indicePorRuta, temasPara, casosPara } from "./cuestionario.js";
import { reportar } from "./reportar.js";
import { activarAmpliacion } from "./ampliar.js";
import {
  hayAlmacenamiento, huella, leerAvance, guardarAvance, borrarAvance, leerModo, guardarModo, estadoDe, anotar, contar,
} from "./avance.js";

const LETRAS = "ABCDE";
const params = new URLSearchParams(location.search);
const tema = params.get("tema") || "";
const revision = params.get("revision") === "1";
const criterio = criterioDe(params);
const mezcla = !revision && hayCriterio(criterio);   // cuestionario armado por segmento, área o búsqueda
const CLAVE_MEZCLA = `mezcla:${tema ? `${tema}?` : ""}${consultaDe(criterio)}`;
const DEL = mezcla ? "de la selección" : "del tema";
const app = $("#app");

let titulo = "";
let base;                // los casos publicados (o, en revisión, todos), cada uno con su origen en «_o»
const origenes = new Map();   // ruta → { ruta, paquete, fuentes, imagen, avance, todos }
const tocados = new Set();    // rutas cuyo avance cambió en esta visita
let disponibles = [];   // los casos del tema que pasan el filtro «Solo verificados»
let casos = [];         // la tanda que se está practicando
let totalPrevio = -1;
let actual = 0;
let creada = 0;         // cuándo empezó la tanda: lo respondido antes es de otra vuelta
let retomada = false;   // la tanda viene de una visita anterior: se avisa una vez
let modo = leerModo();  // "alt": con alternativas · "sin": sin alternativas
let avance = { casos: {}, tanda: null, resumen: null };   // la tanda en curso (en un solo tema, también su avance)
const orden = new Map();       // id del caso → índices originales en el orden mostrado
const respuestas = new Map();  // id del caso → { m: "alt", elegida } | { m: "sin", ok }, en esta tanda
const reveladas = new Set();   // sin alternativas: casos con la respuesta a la vista que falta calificar
const escritas = new Map();    // sin alternativas: lo que el residente escribió (no se guarda)

const acerto = (caso) => {
  const r = respuestas.get(caso.id);
  return r ? (r.m === "sin" ? r.ok : r.elegida === caso.correcta) : false;
};
const estado = (caso) => estadoDe(caso, caso._o.avance.casos[caso._id]);

// Cuántos de la lista se respondieron y cuántos bien, cada uno según el avance de su tema.
function contarLista(lista) {
  let vistos = 0;
  let bien = 0;
  for (const caso of lista) {
    const e = estado(caso);
    if (e) vistos += 1;
    if (e === "bien") bien += 1;
  }
  return { vistos, bien, total: lista.length };
}

// En revisión no se guarda nada: el revisor mira borradores, no practica.
function guardar() {
  if (revision) return;
  const tanda = { ids: casos.map((c) => c.id), i: actual, creada, cuales: $("#cuales").value };
  if (!mezcla) {
    const o = [...origenes.values()][0];
    o.avance.tanda = tanda;
    o.avance.resumen = { ...contar(o.todos, o.avance), titulo: o.paquete.titulo, t: Date.now() };
    guardarAvance(o.ruta, o.avance);
    return;
  }
  // Cada tema guarda lo suyo (y la portada lo cuenta); la tanda armada va en su propia clave.
  for (const ruta of tocados) {
    const o = origenes.get(ruta);
    o.avance.resumen = { ...contar(o.todos, o.avance), titulo: o.paquete.titulo, t: Date.now() };
    guardarAvance(ruta, o.avance);
  }
  tocados.clear();
  avance.tanda = tanda;
  guardarAvance(CLAVE_MEZCLA, avance);
}

function anotarCaso(caso, respuesta) {
  anotar(caso._o.avance, { id: caso._id }, respuesta);
  tocados.add(caso._o.ruta);
}

function ordenDe(caso) {
  if (!orden.has(caso.id)) {
    const indices = caso.opciones.map((_, i) => i);
    orden.set(caso.id, caso.barajar === false ? indices : barajar(indices));
  }
  return orden.get(caso.id);
}

function visor(caso, refs) {
  if (!refs.length) return "";
  const o = caso._o;
  return `<div class="viewer">${refs.map((ref) => {
    const imagen = o.paquete.imagenes[ref.ref];
    if (!imagen) return `<p class="cap">Falta la imagen ${esc(ref.ref)}</p>`;
    const src = o.imagen(ref.ref);
    return `<figure>
      <img src="${esc(src)}" alt="${esc(imagen.figura)}" data-zoom>
      <figcaption class="cap"><span>${credito(imagen, o.fuentes[imagen.fuente])}</span><span>Toca para ampliar</span></figcaption>
    </figure>`;
  }).join("")}</div>`;
}

function marcador() {
  const hechas = casos.filter((c) => respuestas.has(c.id));
  const bien = hechas.filter(acerto).length;
  const chip = $("#marcador");
  chip.hidden = !hechas.length;
  chip.textContent = `${bien}/${hechas.length} correctas`;
}

function fichaImagen(o, ref) {
  const imagen = o.paquete.imagenes[ref];
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
    <p class="src">${esc(caso._o.ruta)}/${esc(caso._id)} · estado ${esc(caso.estado)} ·
      tipo ${esc(caso.tipo)} · clave ${clave} · autor ${esc(caso.autor)}${caso.revisor ? ` · revisor ${esc(caso.revisor)}` : ""}</p>
    ${caso.notas_revision ? `<p class="nota">Nota: ${esc(caso.notas_revision)}</p>` : ""}
    <details open><summary>Evidencia (${(caso.evidencia || []).length})</summary><div style="display:grid;gap:8px">${evidencia}</div></details>
    ${caso.imagenes.length ? `<details><summary>Ficha técnica</summary><div style="display:grid;gap:14px">${caso.imagenes.map((r) => fichaImagen(caso._o, r.ref)).join("")}</div></details>` : ""}
  </section>`;
}

// Con alternativas: los botones A–E y, al responder, la correcta en verde y la elegida en rojo.
function bloqueAlternativas(caso, resp) {
  const indices = ordenDe(caso);
  return `<div class="opts">${indices.map((original, pos) => {
    let clase = "";
    if (resp) clase = original === caso.correcta ? "right" : "wrong";
    if (resp && original === resp.elegida) clase += " mine";
    return `<button class="opt ${clase}" data-k="${pos}" data-original="${original}" ${resp ? "disabled" : ""}>
      <span class="k">${LETRAS[pos]}</span><span>${esc(caso.opciones[original])}</span></button>`;
  }).join("")}</div>`;
}

// Sin alternativas: se piensa (o se escribe) la respuesta y se revela.
function bloqueLibre(caso, revelado) {
  const escrita = escritas.get(caso.id) || "";
  if (revelado) return escrita ? `<p class="libre-escrita"><span class="muted">Tu respuesta:</span> ${esc(escrita)}</p>` : "";
  return `<div class="libre">
    <label class="grid-label">Tu respuesta <span class="muted">(opcional: también puedes pensarla)</span>
      <textarea id="libre" rows="2" maxlength="300" placeholder="Escribe el diagnóstico o el hallazgo">${esc(escrita)}</textarea></label>
    <div class="row"><button class="primary" id="revelar">Ver respuesta</button></div>
  </div>`;
}

function leyendasDe(caso) {
  return caso.imagenes.map((r) => caso._o.paquete.imagenes[r.ref]).filter((i) => i && i.leyenda_original)
    .map((i) => `<details><summary>Leyenda original · ${esc(i.figura)}</summary><p>${esc(i.leyenda_original)}</p></details>`).join("");
}

function vistaCaso() {
  const caso = casos[actual];
  const resp = respuestas.get(caso.id);
  // Lo ya respondido se ve como se respondió; lo pendiente, en el modo elegido.
  const libre = resp ? resp.m === "sin" : modo === "sin" && !caso.requiere_opciones;
  const revelado = Boolean(resp) || (libre && reveladas.has(caso.id));
  const refs = caso.imagenes.filter((r) => r.mostrar_en === "pregunta" || revelado);
  const indices = ordenDe(caso);

  let despues = "";
  if (revelado && libre) {
    despues = `
      ${resp ? `<div class="verdict ${resp.ok ? "ok" : "no"}">${resp.ok ? "Acertaste" : "Fallaste"} <small>· lo marcaste tú</small></div>` : ""}
      <div class="exp md"><div class="ans">Respuesta: ${esc(caso.opciones[caso.correcta])}</div>${md(caso.explicacion)}</div>
      ${caso.perla ? `<div class="pearl md"><b>Perla:</b> ${md(caso.perla)}</div>` : ""}
      ${resp ? "" : `<div class="autocalif" role="group" aria-label="¿Acertaste?">
        <span>¿La tenías?</span>
        <button class="si" id="acerte">Acerté <kbd>1</kbd></button>
        <button class="no" id="falle">Fallé <kbd>2</kbd></button></div>`}
      <details><summary>Las alternativas eran</summary><ol class="alternativas">${indices.map((o) =>
        `<li class="${o === caso.correcta ? "correcta" : ""}">${esc(caso.opciones[o])}</li>`).join("")}</ol></details>
      ${leyendasDe(caso)}
      <div class="row"><button id="reportar" class="reportar">Reportar un error en este caso</button></div>`;
  } else if (resp) {
    const letra = LETRAS[indices.indexOf(caso.correcta)];
    despues = `
      <div class="verdict ${acerto(caso) ? "ok" : "no"}">${acerto(caso) ? "Correcto" : "Incorrecto"}</div>
      <div class="exp md"><div class="ans">Respuesta: ${letra}. ${esc(caso.opciones[caso.correcta])}</div>${md(caso.explicacion)}</div>
      ${caso.perla ? `<div class="pearl md"><b>Perla:</b> ${md(caso.perla)}</div>` : ""}
      ${leyendasDe(caso)}
      <div class="row"><button id="reportar" class="reportar">Reportar un error en este caso</button></div>`;
  }

  const ultima = actual === casos.length - 1;
  const delTema = contarLista(base);
  const teclas = libre
    ? (revelado ? (resp ? "<kbd>→</kbd> siguiente" : "<kbd>1</kbd> acerté · <kbd>2</kbd> fallé")
      : "<kbd>Enter</kbd> ver respuesta · <kbd>→</kbd> siguiente")
    : "<kbd>A</kbd>–<kbd>E</kbd> responde · <kbd>→</kbd> siguiente";
  app.innerHTML = `
    ${retomada ? `<p class="retomada src">Seguiste donde lo dejaste.
      <button id="otra-tanda" class="enlace">Empezar otra tanda</button></p>` : ""}
    <div class="avance" role="progressbar" aria-label="Avance de la tanda" aria-valuemin="1" aria-valuemax="${casos.length}"
      aria-valuenow="${actual + 1}"><i style="width:${(100 * (actual + 1)) / casos.length}%"></i></div>
    <div class="qhead">
      <span class="qnum">${actual + 1}<small> / ${casos.length}</small></span>
      ${revelado ? `<span class="tema">${esc(caso.tema)}</span>` : ""}
      ${revelado && mezcla ? `<span class="src">${esc(caso._o.paquete.titulo)}</span>` : ""}
      ${caso.estado !== "publicado" ? `<span class="badge borrador">${esc(caso.estado)}</span>` : sello(caso, caso._o.paquete.personas)}
      ${revision ? "" : `<span class="spacer"></span><span class="src avance-tema" title="Casos ${DEL} que ya respondiste en este dispositivo">
        ${mezcla ? "Selección" : "Tema"} · ${delTema.vistos} de ${delTema.total}</span>`}
    </div>
    <section class="stage ${refs.length ? "" : "sin-imagen"}">
      ${visor(caso, refs)}
      <div class="pregunta">
        <div class="stem md">${md(caso.enunciado)}</div>
        ${modo === "sin" && !libre && !resp ? `<p class="src">Esta pregunta necesita ver las opciones.</p>` : ""}
        ${libre ? bloqueLibre(caso, revelado) : bloqueAlternativas(caso, resp)}
        ${despues}
      </div>
    </section>
    ${revision ? panelRevision(caso) : ""}
    <div class="ctrl">
      <button id="anterior" ${actual === 0 ? "disabled" : ""}>Anterior</button>
      <button class="primary" id="siguiente">${ultima ? "Ver resultado" : "Siguiente caso"}</button>
      <span class="spacer"></span>
      <span class="src teclas">${teclas}</span>
    </div>`;

  app.querySelectorAll("button.opt").forEach((boton) => {
    boton.onclick = () => responder(Number(boton.dataset.original));
  });
  const campo = $("#libre");
  if (campo) {
    campo.oninput = () => escritas.set(caso.id, campo.value);
    // Enter revela; Mayús + Enter es un salto de línea.
    campo.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); revelar(); } };
  }
  if ($("#revelar")) $("#revelar").onclick = revelar;
  if ($("#acerte")) $("#acerte").onclick = () => calificar(true);
  if ($("#falle")) $("#falle").onclick = () => calificar(false);
  if ($("#otra-tanda")) $("#otra-tanda").onclick = () => { retomada = false; empezar(); };
  const botonReporte = $("#reportar");
  if (botonReporte) botonReporte.onclick = () => reportar(caso._o.ruta, caso._id, botonReporte);
  $("#anterior").onclick = () => ir(actual - 1);
  $("#siguiente").onclick = () => (ultima ? resultado() : ir(actual + 1));
  marcador();
  precargar(casos[actual + 1]);
}

// Descarga de antemano las imágenes del caso siguiente, para que la red lenta no frene la clase.
function precargar(caso) {
  for (const ref of caso?.imagenes || []) {
    const src = caso._o.imagen(ref.ref);
    if (src) new Image().src = src;
  }
}

function responder(original) {
  const caso = casos[actual];
  if (respuestas.has(caso.id)) return;
  respuestas.set(caso.id, { m: "alt", elegida: original });
  anotarCaso(caso, { m: "alt", r: huella(caso.opciones[original]) });
  guardar();
  vistaCaso();
}

function revelar() {
  const caso = casos[actual];
  if (respuestas.has(caso.id) || reveladas.has(caso.id)) return;
  reveladas.add(caso.id);
  vistaCaso();
}

// Sin alternativas, el resultado lo pone el residente: compara lo que pensó con la respuesta.
function calificar(ok) {
  const caso = casos[actual];
  if (respuestas.has(caso.id) || !reveladas.has(caso.id)) return;
  respuestas.set(caso.id, { m: "sin", ok });
  anotarCaso(caso, { m: "sin", ok, c: huella(caso.opciones[caso.correcta]) });
  guardar();
  vistaCaso();
}

function ir(indice) {
  actual = Math.max(0, Math.min(casos.length - 1, indice));
  retomada = false;
  guardar();
  vistaCaso();
  window.scrollTo({ top: 0 });
}

function borrarMiAvance() {
  const o = [...origenes.values()][0];
  if (!confirm(`¿Borrar tu avance en «${o.paquete.titulo}»? Se olvida qué casos respondiste en este dispositivo.`)) return;
  borrarAvance(o.ruta);
  o.avance = avance = { casos: {}, tanda: null, resumen: null };
  $("#cuales").value = "faltan";
  empezar();
}

// Lo que el residente lleva del tema, con la nota de que vive en este dispositivo.
function lineaDelTema() {
  if (revision) return "";
  const t = contarLista(disponibles);
  const porcentaje = t.vistos ? Math.round((100 * t.bien) / t.vistos) : 0;
  return `<div class="medidor"><div class="barra"><i style="width:${t.total ? (100 * t.vistos) / t.total : 0}%"></i></div>
    <span>${mezcla ? "De la selección" : "Del tema"}: ${t.vistos} de ${t.total} casos respondidos${t.vistos ? ` · ${porcentaje} % de aciertos` : ""}.
    ${hayAlmacenamiento ? "Se guarda en este dispositivo." : "Este navegador no guarda el avance (ventana privada o datos bloqueados)."}</span></div>`;
}

function otraVuelta(cuales) {
  $("#cuales").value = cuales;
  empezar();
}

// Botones para seguir: lo que falta del tema, las falladas o una vuelta entera; y borrar el avance.
function botonesSeguir(falladasTanda = []) {
  const faltan = disponibles.filter((c) => !estado(c)).length;
  const falladasTema = disponibles.filter((c) => estado(c) === "mal").length;
  const cuantos = leerTanda($("#cuantos")) || faltan;
  return `<div class="row">
    ${faltan ? `<button class="primary" id="seguir">${cuantos < faltan ? `Seguir con ${cuantos} de los ${faltan} que faltan` : `Seguir con los ${faltan} que faltan`}</button>`
      : `<button class="primary" id="vuelta">Otra vuelta con todos</button>`}
    ${falladasTanda.length ? `<button id="falladas">Repasar las ${falladasTanda.length} falladas de esta tanda</button>` : ""}
    ${falladasTema > falladasTanda.length ? `<button id="falladas-tema">Repasar las ${falladasTema} falladas ${DEL}</button>` : ""}
    ${!revision && !mezcla && Object.keys(avance.casos).length ? `<button class="peligrosa" id="borrar-avance">Borrar mi avance</button>` : ""}
  </div>`;
}

function enlazarSeguir(falladasTanda = []) {
  if ($("#seguir")) $("#seguir").onclick = () => otraVuelta("faltan");
  if ($("#vuelta")) $("#vuelta").onclick = () => otraVuelta("todos");
  if ($("#falladas-tema")) $("#falladas-tema").onclick = () => otraVuelta("falladas");
  if ($("#borrar-avance")) $("#borrar-avance").onclick = borrarMiAvance;
  const boton = $("#falladas");
  if (boton) boton.onclick = () => {
    casos = falladasTanda;
    falladasTanda.forEach((c) => { respuestas.delete(c.id); reveladas.delete(c.id); escritas.delete(c.id); orden.delete(c.id); });
    actual = 0;
    creada = Date.now();
    guardar();
    vistaCaso();
  };
}

function resultado() {
  const hechas = casos.filter((c) => respuestas.has(c.id));
  const falladas = hechas.filter((c) => !acerto(c));
  const bien = hechas.length - falladas.length;
  const porcentaje = hechas.length ? Math.round((100 * bien) / hechas.length) : 0;
  const completo = !revision && disponibles.length && disponibles.every((c) => estado(c));
  app.innerHTML = `<section class="panel resultado">
    <span class="tema">${esc(titulo)}</span>
    <div class="big">${bien}<small> / ${hechas.length}</small></div>
    <div class="medidor"><div class="barra"><i style="width:${porcentaje}%"></i></div>
      <span>${porcentaje} % de aciertos · ${hechas.length} respondidas de ${casos.length} en esta tanda.</span></div>
    ${completo ? `<p class="completo">Respondiste todos los casos ${DEL}.</p>` : ""}
    ${lineaDelTema()}
    ${botonesSeguir(falladas)}
  </section>`;
  enlazarSeguir(falladas);
}

// No queda nada en el grupo elegido: el tema está terminado, o no hay falladas.
function nadaQueMostrar(cuales) {
  const texto = cuales === "falladas" ? `No tienes casos fallados en ${mezcla ? "esta selección" : "este tema"}.`
    : `Respondiste los ${disponibles.length} casos ${DEL}.`;
  app.innerHTML = `<section class="panel resultado">
    <span class="tema">${esc(titulo)}</span>
    <p class="completo">${texto}</p>
    ${lineaDelTema()}
    ${botonesSeguir()}
  </section>`;
  enlazarSeguir();
  marcador();
}

// Elige «cuantos» casos al azar, pero los deja en el orden del tema. Una selección de varios temas no tiene
// orden propio: sale mezclada, para no pasar un tema entero antes que el siguiente.
function tanda(lista, cuantos) {
  if (mezcla) return barajar(lista).slice(0, cuantos || lista.length);
  if (!cuantos || cuantos >= lista.length) return lista;
  const elegidos = new Set(barajar(lista.map((_, i) => i)).slice(0, cuantos));
  return lista.filter((_, i) => elegidos.has(i));
}

// El campo solo se toca cuando cambia cuántos casos hay (al tocar «Solo verificados»): así el número
// escrito se conserva mientras quepa.
function ponerTotal(total) {
  if (total === totalPrevio) return;
  totalPrevio = total;
  totalTanda($("#cuantos"), total);
  $("#de-total").textContent = `de ${total}`;
  $("#tanda").hidden = total < 2;   // con un solo caso no hay nada que elegir
}

// Los casos de donde sale la tanda: los que faltan, los fallados o todos.
function grupo(cuales) {
  if (cuales === "faltan") return disponibles.filter((c) => !estado(c));
  if (cuales === "falladas") return disponibles.filter((c) => estado(c) === "mal");
  return disponibles;
}

function filtrar() {
  const soloVerificados = $("#solo-verificados").checked;
  disponibles = base.filter((c) => !soloVerificados || c.revisor);
}

// Una tanda nueva: lo respondido en otras vueltas sigue en el avance, pero aquí se responde otra vez.
function empezar() {
  filtrar();
  const cuales = $("#cuales").value;
  const desde = grupo(cuales);
  ponerTotal(desde.length);
  casos = tanda(desde, leerTanda($("#cuantos")));
  $("#cuantos").value = casos.length;   // lo escrito fuera de rango queda como lo que de verdad sale
  respuestas.clear();
  reveladas.clear();
  escritas.clear();
  orden.clear();
  actual = 0;
  creada = Date.now();
  if (!casos.length) {
    if (!disponibles.length) {
      app.innerHTML = `<section class="panel"><p>${mezcla ? "Esta selección" : "Este tema"} todavía no tiene casos verificados por un radiólogo.
        Quita el filtro «Solo verificados» para practicar con los demás.</p></section>`;
      marcador();
      return;
    }
    return nadaQueMostrar(cuales);
  }
  guardar();
  vistaCaso();
}

// La tanda de la visita anterior, si le quedan casos sin responder. Lo respondido desde que empezó se vuelve a
// mostrar como se respondió.
function retomar() {
  const t = avance.tanda;
  if (!t || !Array.isArray(t.ids)) return false;
  const porId = new Map(base.map((c) => [c.id, c]));
  const lista = t.ids.map((id) => porId.get(id)).filter(Boolean);
  if (!lista.length) return false;
  for (const caso of lista) {
    const r = caso._o.avance.casos[caso._id];
    if (!r || r.t < (t.creada || 0) || !estado(caso)) continue;
    if (r.m === "sin") respuestas.set(caso.id, { m: "sin", ok: r.ok });
    else respuestas.set(caso.id, { m: "alt", elegida: caso.opciones.findIndex((o) => huella(o) === r.r) });
  }
  if (lista.every((c) => respuestas.has(c.id))) {
    respuestas.clear();
    return false;
  }
  if (["faltan", "todos", "falladas"].includes(t.cuales)) $("#cuales").value = t.cuales;
  filtrar();
  ponerTotal(grupo($("#cuales").value).length + lista.filter((c) => respuestas.has(c.id)).length);
  casos = lista;
  $("#cuantos").value = casos.length;
  creada = t.creada || Date.now();
  const pendiente = casos.findIndex((c) => !respuestas.has(c.id));
  actual = Number.isInteger(t.i) && casos[t.i] && !respuestas.has(casos[t.i].id) ? t.i : pendiente;
  retomada = true;
  vistaCaso();
  return true;
}

function sinCasos(paquete) {
  const enlace = `practica.html?tema=${encodeURIComponent(tema).replace("%2F", "/")}&amp;revision=1`;
  app.innerHTML = `<section class="panel" style="display:grid;gap:10px;max-width:680px">
    <h2>${esc(paquete.titulo)}</h2>
    <p>Este tema todavía no tiene casos publicados: siguen en borrador. Quien los escribió los publica desde el estudio.</p>
    ${paquete.casos.length ? `<p class="src">¿Eres el autor o revisor? <a href="${enlace}">Ver los borradores</a>.</p>` : ""}
  </section>`;
}

// El origen de cada caso: su tema, con sus figuras, sus fuentes y su avance en este dispositivo.
function origen(ruta, datos) {
  const o = {
    ruta, paquete: datos.paquete, fuentes: datos.fuentes, imagen: datos.imagen,
    avance: revision ? { casos: {}, tanda: null, resumen: null } : leerAvance(ruta),
  };
  o.todos = datos.paquete.casos.filter((c) => c.estado === "publicado");
  origenes.set(ruta, o);
  return o;
}

// Un solo tema, como siempre: los ids de los casos son los del tema.
async function cargarUnTema() {
  if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(tema)) {
    app.innerHTML = `<section class="panel"><p>Falta el tema. <a href="./">Volver a la lista</a>.</p></section>`;
    return false;
  }
  let datos;
  try {
    datos = await cargarPaquete(tema);
  } catch (e) {
    app.innerHTML = `<section class="panel"><p>No se pudo cargar el tema: ${esc(e.message)}</p></section>`;
    return false;
  }
  const o = origen(tema, datos);
  titulo = datos.paquete.titulo;
  base = datos.paquete.casos.filter((c) => revision || c.estado === "publicado")
    .map((c) => Object.assign(c, { _o: o, _id: c.id }));
  if (!base.length) {
    sinCasos(datos.paquete);
    return false;
  }
  avance = o.avance;
  return true;
}

// Un cuestionario armado: los temas que tienen algún caso del criterio (según el índice de casos) y, de ellos,
// los casos que lo cumplen. Los ids pasan a ser «<tema>/<caso>», porque dos temas pueden repetir un id.
async function cargarMezcla() {
  app.innerHTML = `<p class="muted">Armando el cuestionario…</p>`;
  let rutas;
  if (tema) {
    rutas = [tema];
  } else {
    const [temas, indices] = await Promise.all([cargarIndice(), indicesDeCasos()]);
    rutas = temasPara(temas, indicePorRuta(temas, indices.vivo, indices.estatico), criterio);
  }
  const datosDe = new Map();
  await cargarTemas(rutas, datosDe);
  for (const ruta of rutas) if (datosDe.has(ruta)) origen(ruta, datosDe.get(ruta));
  base = casosPara(rutas, datosDe, criterio).map(({ ruta, paquete, caso }) =>
    ({ ...caso, id: `${paquete.id}/${caso.id}`, _id: caso.id, _o: origenes.get(ruta) }));
  titulo = nombreCriterio(criterio) + (tema && origenes.has(tema) ? ` · ${origenes.get(tema).paquete.titulo}` : "");
  if (!base.length) {
    app.innerHTML = `<section class="panel" style="display:grid;gap:10px;max-width:680px">
      <h2>${esc(nombreCriterio(criterio))}</h2>
      <p>${rutas.length && !datosDe.size ? "No se pudieron cargar los temas: revisa la conexión y vuelve a intentarlo."
        : "Ningún caso publicado coincide con esta búsqueda."}</p>
      <p><a href="./?${consultaDe(criterio)}#temas">Volver a buscar</a></p></section>`;
    return false;
  }
  avance = leerAvance(CLAVE_MEZCLA);
  return true;
}

async function iniciar() {
  if (!(mezcla ? await cargarMezcla() : await cargarUnTema())) return;
  document.title = `${titulo} · RadQuiz`;
  $("#subtitulo").textContent = titulo;
  $("#modo").textContent = revision ? "Revisión · incluye borradores" : mezcla ? `Práctica · ${origenes.size === 1 ? "1 tema" : `${origenes.size} temas`}` : "Práctica";
  if (revision) $("#modo").classList.add("live");
  $("#modo-respuesta").value = modo;
  $("#modo-respuesta").onchange = () => {
    modo = $("#modo-respuesta").value;
    guardarModo(modo);
    if (casos.length && $(".stage")) vistaCaso();
  };
  $("#solo-verificados").onchange = empezar;
  $("#cuales").onchange = empezar;
  $("#cuantos").onchange = empezar;
  // Enter confirma el número; al soltar el campo se cierra el teclado del celular.
  $("#cuantos").onkeydown = (e) => { if (e.key === "Enter") e.target.blur(); };
  if (!retomar()) empezar();
}

activarAmpliacion();
document.addEventListener("keydown", (e) => {
  if (!casos.length || !$(".stage") || e.target.closest("select, textarea, input:not([type=checkbox])")) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if ($("#revelar") && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    revelar();
    return;
  }
  if ($("#acerte") && (e.key === "1" || e.key === "2")) {
    calificar(e.key === "1");
    return;
  }
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
