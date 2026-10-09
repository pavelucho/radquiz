// RadQuiz — lectura de casos, como en los libros de casos (Radiology Case Review Series y parecidos).
//
// Cada lectura es un caso entero (schema/lectura.schema.json). Página 1: el encabezado clínico, las figuras
// limpias y todas las preguntas a la vez, cada una con su casilla para escribir (escribir es opcional; lo que
// enseña es comprometerse con una respuesta antes de mirar). «Pasar la página» es una sola vez y sin vuelta atrás:
// lo escrito queda congelado. Página 2: el diagnóstico, las figuras anotadas con su leyenda, cada pregunta con tu
// respuesta al lado de la de la fuente, los puntos clave de los hallazgos para marcar los que viste, y la nota que
// te pones: completa, parcial o no. Cierran la discusión y las perlas.
//
// Con ?proyectar=1 es la sesión de clase en el proyector: sin casillas ni notas, letra grande, y en la página 2 cada
// respuesta se muestra cuando el presentador quiere (teclas 1–8, A todas). Desde ahí se abre la sesión con celulares
// (lectura-vivo.html). Con ?revision=1 incluye los borradores para el revisor y no guarda nada.
//
// El avance queda en este dispositivo (lecturas en app/avance.js), como en la práctica.
import { $, esc, md, barajar, sello, leerTanda, totalTanda, nivelDe, cargarJSON, SEGMENTOS } from "./comun.js";
import { cargarPaquete, indiceEnVivo, fusionarIndice } from "./publicado.js";
import { reportar } from "./reportar.js";
import { activarAmpliacion } from "./ampliar.js";
import {
  hayAlmacenamiento, leerLecturas, guardarLecturas, borrarLecturas, puntajeLectura, contarLecturas, huellaLectura,
  UMBRAL_LECTURA,
} from "./avance.js";
import {
  NOTAS, coincidencia, figuras, listaPreguntas, cierre, respuestaFuente, tipoDe, puntaje, notaPorPuntos,
} from "./lectura-vista.js";

const params = new URLSearchParams(location.search);
const ruta = params.get("tema") || "";
const proyectar = params.get("proyectar") === "1";
const revision = !proyectar && params.get("revision") === "1";
const app = $("#app");

let origen = null;          // { ruta, paquete, fuentes, imagen }
let base = [];              // las lecturas publicadas (o, en revisión, todas)
let disponibles = [];       // las que pasan «Solo verificadas»
let tanda = [];             // las de esta vuelta
let actual = 0;
let creada = 0;
let retomada = false;
let avance = { lecturas: {}, tanda: null, resumen: null };
let totalPrevio = -1;
// Lo de cada lectura en esta tanda: { pagina, escritas[], marcados: [Set], notas: {}, elegidas: Set, vistas: Set }.
// «elegidas»: preguntas cuya nota puso quien lee (la de los puntos clave es solo una sugerencia). «vistas»: en el
// proyector, las respuestas ya mostradas.
const estados = new Map();
let avisoVacio = false;     // primer «Pasar la página» sin nada escrito: se avisa una vez

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const enlaceTema = (r, extra = "") => `lectura.html?tema=${encodeURIComponent(r).replace("%2F", "/")}${extra}`;

function estadoDe(lectura) {
  if (!estados.has(lectura.id)) {
    const n = lectura.preguntas.length;
    // Una lectura con la página ya pasada vuelve a la página 2 con lo que se escribió y las notas puestas: pasar la
    // página no tiene vuelta atrás, ni siquiera recargando.
    const pasada = avance.tanda?.pasadas?.[lectura.id];
    const borrador = pasada?.e || avance.tanda?.escritas?.[lectura.id];
    const notas = Object.fromEntries(Object.entries(pasada?.n || {}).filter(([i, v]) => NOTAS[v] && Number(i) < n));
    estados.set(lectura.id, {
      pagina: pasada ? 2 : 1,
      escritas: Array.isArray(borrador) ? [...borrador.slice(0, n).map(String), ...Array(n).fill("")].slice(0, n) : Array(n).fill(""),
      marcados: lectura.preguntas.map((_, i) => new Set(pasada?.m?.[i] || [])),
      notas,
      sugerencias: {},
      elegidas: new Set(Object.keys(notas).map(Number)),
      vistas: new Set(),
    });
  }
  return estados.get(lectura.id);
}

// ------------------------------------------------------------------ avance
function guardar() {
  if (revision || proyectar) return;
  const escritas = {};
  const pasadas = {};
  for (const l of tanda) {
    const e = estados.get(l.id);
    if (!e) {
      if (avance.tanda?.pasadas?.[l.id]) pasadas[l.id] = avance.tanda.pasadas[l.id];
      else if (avance.tanda?.escritas?.[l.id]) escritas[l.id] = avance.tanda.escritas[l.id];
    } else if (e.pagina === 2) {
      pasadas[l.id] = { e: e.escritas, n: e.notas, m: e.marcados.map((s) => [...s]) };
    } else if (e.escritas.some((x) => x.trim())) {
      escritas[l.id] = e.escritas;
    }
  }
  avance.tanda = { ids: tanda.map((l) => l.id), i: actual, creada, cuales: $("#cuales").value, orden: $("#orden").value, escritas, pasadas };
  avance.resumen = { ...contarLecturas(base, avance), titulo: origen.paquete.titulo, t: Date.now() };
  guardarLecturas(origen.ruta, avance);
}

function anotarPuntaje(lectura, valor) {
  if (revision || proyectar) return;
  const previo = avance.lecturas[lectura.id];
  avance.lecturas[lectura.id] = { p: Math.round(valor * 1000) / 1000, h: huellaLectura(lectura), t: Date.now(), n: (previo?.n || 0) + 1 };
}

// ------------------------------------------------------------------ página 1
function campoEscribir(lectura, i) {
  const e = estadoDe(lectura);
  return `<label class="visualmente-oculto" for="r${i}">Tu respuesta a la pregunta ${i + 1}</label>
    <textarea id="r${i}" class="lec-campo" data-i="${i}" rows="2" maxlength="600"
      placeholder="Tu respuesta (o piénsala)">${esc(e.escritas[i] || "")}</textarea>`;
}

function cabecera(lectura, pagina) {
  const delTema = contarLecturas(disponibles, avance);
  return `<div class="avance" role="progressbar" aria-label="Avance de la tanda" aria-valuemin="1" aria-valuemax="${tanda.length}"
      aria-valuenow="${actual + 1}"><i style="width:${(100 * (actual + 1)) / tanda.length}%"></i></div>
    <div class="qhead">
      <span class="qnum">${actual + 1}<small> / ${tanda.length}</small></span>
      <span class="lec-paso ${pagina === 2 ? "dos" : ""}">${pagina === 1 ? "Página 1 · El caso" : "Página 2 · Respuestas"}</span>
      ${lectura.estado !== "publicado" ? `<span class="badge borrador">${esc(lectura.estado)}</span>` : ""}
      ${revision || proyectar ? "" : `<span class="spacer"></span><span class="src avance-tema" title="Lecturas del tema que ya calificaste en este dispositivo">
        Tema · ${delTema.vistas} de ${delTema.total}</span>`}
    </div>`;
}

function paginaUno(lectura) {
  const e = estadoDe(lectura);
  const algo = e.escritas.some((x) => x.trim());
  return `${retomada ? `<p class="retomada src">Seguiste donde lo dejaste.
      <button id="otra-tanda" class="enlace">Empezar otra tanda</button></p>` : ""}
    ${cabecera(lectura, 1)}
    <article class="lec-hoja lec-p1">
      <header class="lec-cabeza">
        <p class="eyebrow">Caso ${actual + 1}</p>
        <h2 class="lec-presentacion">${esc(lectura.presentacion)}</h2>
      </header>
      <div class="lec-cuerpo">
        ${figuras(lectura, origen, "pregunta", { clase: "lec-limpias" })}
        <div class="lec-lado">
          ${listaPreguntas(lectura, proyectar ? () => "" : (i) => campoEscribir(lectura, i))}
          ${proyectar ? "" : `<p class="src lec-consejo">${avisoVacio && !algo
            ? "<b>No escribiste nada.</b> Si ya las pensaste, vuelve a tocar «Pasar la página»."
            : "Escribir es opcional, pero comprometerse con una respuesta antes de mirar es lo que enseña."}</p>`}
          <div class="row"><button class="primary lg" id="pasar">Pasar la página</button></div>
        </div>
      </div>
    </article>`;
}

// ------------------------------------------------------------------ página 2
function bloquePuntos(lectura, i) {
  const p = lectura.preguntas[i];
  const puntos = p.puntos_clave || [];
  if (!puntos.length || proyectar) return "";
  const e = estadoDe(lectura);
  return `<fieldset class="lec-puntos"><legend>Marca lo que dijiste</legend>
    ${puntos.map((punto, k) => `<label class="lec-punto"><input type="checkbox" data-i="${i}" data-k="${k}" ${e.marcados[i].has(k) ? "checked" : ""}>
      <span>${esc(punto)}</span></label>`).join("")}</fieldset>`;
}

function bloqueNota(lectura, i) {
  if (proyectar) return "";
  const e = estadoDe(lectura);
  const nota = e.notas[i];
  const sugerida = !e.elegidas.has(i) && nota;
  return `<div class="lec-nota" role="group" aria-label="¿Cómo te fue en la pregunta ${i + 1}?">
    <span>¿La tenías?</span>
    ${Object.entries(NOTAS).map(([clave, n]) => `<button type="button" class="nota-${clave} ${nota === clave ? "elegida" : ""}" data-i="${i}" data-nota="${clave}"
      aria-pressed="${nota === clave}">${n.nombre}</button>`).join("")}
    ${sugerida ? `<span class="src">${e.sugerencias[i] === "coincide" ? "sugerida porque coincide con una respuesta aceptada" : "sugerida por lo que marcaste"}</span>` : ""}
  </div>`;
}

function tuRespuesta(lectura, i) {
  const p = lectura.preguntas[i];
  const escrita = (estadoDe(lectura).escritas[i] || "").trim();
  if (!escrita) return `<div class="lec-mia vacia"><span class="lec-rotulo">Tu respuesta</span><p>No la escribiste.</p></div>`;
  const igual = p.aceptadas?.length ? coincidencia(escrita, p.aceptadas) : null;
  return `<div class="lec-mia"><span class="lec-rotulo">Tu respuesta</span><p>${esc(escrita)}</p>
    ${igual ? `<p class="lec-coincide">Coincide con «${esc(igual)}»</p>` : ""}</div>`;
}

function respuestaProyector(lectura, i) {
  const e = estadoDe(lectura);
  if (e.vistas.has(i)) return `${respuestaFuente(lectura.preguntas[i])}${puntosProyector(lectura.preguntas[i])}`;
  return `<button type="button" class="lec-mostrar" data-mostrar="${i}">Mostrar la respuesta <kbd>${i + 1}</kbd></button>`;
}

function puntosProyector(p) {
  return p.puntos_clave?.length ? `<ul class="lec-puntos-lista">${p.puntos_clave.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "";
}

function paginaDos(lectura) {
  const e = estadoDe(lectura);
  const valor = puntaje(lectura, e.notas);
  const anotadas = figuras(lectura, origen, "respuesta", { clase: "lec-anotadas" });
  const n = lectura.preguntas.length;
  return `${cabecera(lectura, 2)}
    <article class="lec-hoja lec-p2">
      <header class="lec-cabeza">
        <p class="eyebrow">Caso ${actual + 1} · ${esc(lectura.presentacion)}</p>
        <h2 class="lec-diagnostico">${esc(lectura.tema)}</h2>
        ${lectura.estado === "publicado" ? sello(lectura, origen.paquete.personas) : ""}
      </header>
      ${anotadas || figuras(lectura, origen, "pregunta", { clase: "lec-anotadas" })}
      ${anotadas ? `<details class="lec-limpias-otra"><summary>Las figuras sin anotar</summary>${figuras(lectura, origen, "pregunta", { clase: "lec-limpias" })}</details>` : ""}
      ${proyectar ? `<div class="row"><button type="button" id="mostrar-todas">Mostrar todas las respuestas <kbd>A</kbd></button></div>` : ""}
      <ol class="lec-respuestas">${lectura.preguntas.map((p, i) => `<li class="lec-r ${e.notas[i] ? `con-nota nota-${e.notas[i]}` : ""}" data-i="${i}">
        <p class="lec-tipo">${esc(tipoDe(p))}</p>
        <p class="lec-enunciado">${esc(p.pregunta)}</p>
        ${proyectar ? respuestaProyector(lectura, i) : `<div class="lec-par">${tuRespuesta(lectura, i)}${respuestaFuente(p)}</div>
          ${bloquePuntos(lectura, i)}${bloqueNota(lectura, i)}`}
      </li>`).join("")}</ol>
      ${cierre(lectura)}
      ${proyectar ? "" : `<div class="lec-total ${valor === null ? "" : valor >= UMBRAL_LECTURA ? "bien" : "mal"}">${valor === null
        ? `Califica las ${n} preguntas para guardar el caso${hayAlmacenamiento && !revision ? "" : " (este navegador no guarda el avance)"}.`
        : `Este caso: <b>${formatoPuntos(valor * n)} de ${n}</b>${revision ? "" : " · guardado en este dispositivo"}`}</div>`}
      ${revision ? panelRevision(lectura) : ""}
      ${proyectar ? "" : `<div class="row"><button id="reportar" class="reportar">Reportar un error en este caso</button></div>`}
    </article>`;
}

const formatoPuntos = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(1).replace(".", ","));

function panelRevision(lectura) {
  const evidencia = (lectura.evidencia || []).map((ev) => `<div><p class="ubic">${esc(ev.ubicacion)} · ${esc(ev.fuente)}</p>
    <blockquote>${esc(ev.cita)}</blockquote></div>`).join("") || `<p class="nota">Sin evidencia.</p>`;
  const aceptadas = lectura.preguntas.map((p, i) => (p.aceptadas?.length ? `<li>${i + 1}: ${p.aceptadas.map(esc).join(" · ")}</li>` : "")).join("");
  return `<section class="revision">
    <h3>Para el revisor</h3>
    <p class="src">${esc(origen.ruta)}/${esc(lectura.id)} · estado ${esc(lectura.estado)} · autor ${esc(lectura.autor)}${lectura.revisor ? ` · revisor ${esc(lectura.revisor)}` : ""}
      · nivel ${nivelDe(lectura)}${lectura.dificultad?.motivo ? ` (${esc(lectura.dificultad.motivo)})` : ""}</p>
    ${lectura.notas_revision ? `<p class="nota">Nota: ${esc(lectura.notas_revision)}</p>` : ""}
    ${aceptadas ? `<details open><summary>Respuestas aceptadas</summary><ul>${aceptadas}</ul></details>` : ""}
    <details open><summary>Evidencia (${(lectura.evidencia || []).length})</summary><div style="display:grid;gap:8px">${evidencia}</div></details>
  </section>`;
}

// ------------------------------------------------------------------ vista
function vista() {
  const lectura = tanda[actual];
  const e = estadoDe(lectura);
  const ultima = actual === tanda.length - 1;
  const listo = e.pagina === 2 && (proyectar || puntaje(lectura, e.notas) !== null);
  const teclas = proyectar
    ? (e.pagina === 1 ? "<kbd>→</kbd> pasar la página" : "<kbd>1</kbd>–<kbd>8</kbd> respuesta · <kbd>A</kbd> todas · <kbd>→</kbd> siguiente")
    : e.pagina === 1 ? "<kbd>Ctrl</kbd>+<kbd>Enter</kbd> pasar la página"
      : "<kbd>1</kbd> completa · <kbd>2</kbd> parcial · <kbd>3</kbd> no · <kbd>→</kbd> siguiente";
  app.innerHTML = `${e.pagina === 1 ? paginaUno(lectura) : paginaDos(lectura)}
    <div class="ctrl">
      <button id="anterior" ${actual === 0 ? "disabled" : ""}>Anterior</button>
      ${e.pagina === 2 ? `<button class="${listo ? "primary" : ""}" id="siguiente">${ultima ? "Ver resultado" : "Siguiente caso"}</button>` : ""}
      <span class="spacer"></span>
      <span class="src teclas">${teclas}</span>
    </div>`;
  enlazar(lectura);
  precargar(lectura);
  precargar(tanda[actual + 1]);
}

function enlazar(lectura) {
  const e = estadoDe(lectura);
  app.querySelectorAll(".lec-campo").forEach((campo) => {
    campo.oninput = () => {
      e.escritas[Number(campo.dataset.i)] = campo.value;
      guardarPronto();
    };
    campo.onkeydown = (ev) => {
      if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); pasarPagina(); }
    };
  });
  app.querySelectorAll(".lec-punto input").forEach((casilla) => {
    casilla.onchange = () => {
      const i = Number(casilla.dataset.i);
      const k = Number(casilla.dataset.k);
      if (casilla.checked) e.marcados[i].add(k); else e.marcados[i].delete(k);
      if (!e.elegidas.has(i)) {
        e.notas[i] = notaPorPuntos(e.marcados[i].size, lectura.preguntas[i].puntos_clave.length);
        e.sugerencias[i] = "puntos";
        alCalificar(lectura);
      }
    };
  });
  app.querySelectorAll(".lec-nota button").forEach((boton) => {
    boton.onclick = () => calificar(lectura, Number(boton.dataset.i), boton.dataset.nota);
  });
  app.querySelectorAll("[data-mostrar]").forEach((boton) => {
    boton.onclick = () => mostrar(lectura, Number(boton.dataset.mostrar));
  });
  if ($("#mostrar-todas")) $("#mostrar-todas").onclick = () => mostrarTodas(lectura);
  if ($("#pasar")) $("#pasar").onclick = pasarPagina;
  if ($("#otra-tanda")) $("#otra-tanda").onclick = () => { retomada = false; empezar(); };
  const botonReporte = $("#reportar");
  if (botonReporte) botonReporte.onclick = () => reportar(origen.ruta, lectura.id, botonReporte);
  $("#anterior").onclick = () => ir(actual - 1);
  if ($("#siguiente")) $("#siguiente").onclick = () => (actual === tanda.length - 1 ? resultado() : ir(actual + 1));
}

let esperaGuardar = 0;
function guardarPronto() {
  clearTimeout(esperaGuardar);
  esperaGuardar = setTimeout(guardar, 400);
}

function precargar(lectura) {
  for (const r of lectura?.imagenes || []) {
    const src = origen.imagen(r.ref);
    if (src) new Image().src = src;
  }
}

function pasarPagina() {
  const lectura = tanda[actual];
  const e = estadoDe(lectura);
  if (e.pagina !== 1) return;
  if (!proyectar && !avisoVacio && !e.escritas.some((x) => x.trim())) {
    avisoVacio = true;
    vista();
    $("#pasar")?.focus();
    return;
  }
  avisoVacio = false;
  e.pagina = 2;
  // Lo que coincide con una respuesta aceptada sale ya sugerido como completa; la nota la confirma quien lee.
  lectura.preguntas.forEach((p, i) => {
    if (p.aceptadas?.length && coincidencia(e.escritas[i], p.aceptadas)) {
      e.notas[i] = "completa";
      e.sugerencias[i] = "coincide";
    }
  });
  guardar();
  vista();
  window.scrollTo({ top: 0 });
}

function calificar(lectura, i, nota) {
  const e = estadoDe(lectura);
  if (e.pagina !== 2 || !NOTAS[nota]) return;
  e.notas[i] = nota;
  e.elegidas.add(i);
  alCalificar(lectura);
}

// Cuando todas las preguntas tienen nota, el caso se guarda (y se vuelve a guardar si se cambia una nota).
function alCalificar(lectura) {
  const e = estadoDe(lectura);
  const valor = puntaje(lectura, e.notas);
  if (valor !== null) anotarPuntaje(lectura, valor);
  guardar();
  const y = scrollY;
  vista();
  window.scrollTo({ top: y });
}

function mostrar(lectura, i) {
  const e = estadoDe(lectura);
  if (e.pagina !== 2 || i >= lectura.preguntas.length) return;
  e.vistas.add(i);
  const y = scrollY;
  vista();
  window.scrollTo({ top: y });
}

function mostrarTodas(lectura) {
  lectura.preguntas.forEach((_, i) => estadoDe(lectura).vistas.add(i));
  const y = scrollY;
  vista();
  window.scrollTo({ top: y });
}

function ir(indice) {
  actual = Math.max(0, Math.min(tanda.length - 1, indice));
  retomada = false;
  avisoVacio = false;
  guardar();
  vista();
  window.scrollTo({ top: 0 });
}

// ------------------------------------------------------------------ tandas
function grupo(cuales) {
  if (proyectar || revision) return disponibles;
  if (cuales === "faltan") return disponibles.filter((l) => puntajeLectura(l, avance) === null);
  if (cuales === "falladas") return disponibles.filter((l) => { const p = puntajeLectura(l, avance); return p !== null && p < UMBRAL_LECTURA; });
  return disponibles;
}

// Como el libro (el orden del tema), de lo básico a lo avanzado (el nivel interno, que no se muestra) o al azar.
function ordenar(lista) {
  const orden = $("#orden").value;
  if (orden === "azar") return barajar(lista);
  if (orden === "nivel") return lista.map((l, i) => [l, i]).sort((a, b) => nivelDe(a[0]) - nivelDe(b[0]) || a[1] - b[1]).map(([l]) => l);
  return lista;
}

function elegir(lista, cuantos) {
  if (!cuantos || cuantos >= lista.length) return lista;
  const elegidos = new Set(barajar(lista.map((_, i) => i)).slice(0, cuantos));
  return lista.filter((_, i) => elegidos.has(i));
}

function ponerTotal(total) {
  if (total === totalPrevio) return;
  totalPrevio = total;
  totalTanda($("#cuantos"), total);
  $("#de-total").textContent = `de ${total}`;
  $("#tanda").hidden = total < 2;
}

function filtrar() {
  const solo = $("#solo-verificadas").checked;
  disponibles = base.filter((l) => !solo || l.revisor);
}

function empezar() {
  filtrar();
  const desde = grupo($("#cuales").value);
  ponerTotal(desde.length);
  tanda = ordenar(elegir(desde, leerTanda($("#cuantos"))));
  $("#cuantos").value = tanda.length;
  estados.clear();
  if (avance.tanda) { avance.tanda.escritas = {}; avance.tanda.pasadas = {}; }
  actual = 0;
  creada = Date.now();
  if (!tanda.length) return nadaQueMostrar();
  guardar();
  vista();
}

function retomar() {
  const t = avance.tanda;
  if (proyectar || revision || !t || !Array.isArray(t.ids)) return false;
  const porId = new Map(base.map((l) => [l.id, l]));
  const lista = t.ids.map((id) => porId.get(id)).filter(Boolean);
  const pendientes = lista.filter((l) => {
    const r = avance.lecturas[l.id];
    return !(r && r.t >= (t.creada || 0) && puntajeLectura(l, avance) !== null);
  });
  if (!pendientes.length) return false;
  if (["faltan", "todas", "falladas"].includes(t.cuales)) $("#cuales").value = t.cuales;
  if (["libro", "nivel", "azar"].includes(t.orden)) $("#orden").value = t.orden;
  filtrar();
  ponerTotal(grupo($("#cuales").value).length + (lista.length - pendientes.length));
  tanda = lista;
  $("#cuantos").value = tanda.length;
  creada = t.creada || Date.now();
  // Las lecturas con la página ya pasada vuelven a la página 2, con lo escrito y las notas (estadoDe()).
  const primera = tanda.findIndex((l) => pendientes.includes(l));
  actual = Number.isInteger(t.i) && tanda[t.i] && pendientes.includes(tanda[t.i]) ? t.i : primera;
  retomada = true;
  vista();
  return true;
}

function nadaQueMostrar() {
  const cuales = $("#cuales").value;
  const texto = !disponibles.length ? "Este tema todavía no tiene lecturas verificadas por un radiólogo. Quita «Solo verificadas» para leer las demás."
    : cuales === "falladas" ? "No tienes lecturas falladas en este tema."
    : `Leíste las ${disponibles.length} lecturas del tema.`;
  app.innerHTML = `<section class="panel resultado">
    <span class="tema">${esc(origen.paquete.titulo)}</span>
    <p class="completo">${esc(texto)}</p>
    ${lineaDelTema()}
    ${botonesSeguir()}
  </section>`;
  enlazarSeguir();
}

function lineaDelTema() {
  if (revision || proyectar) return "";
  const t = contarLecturas(disponibles, avance);
  return `<div class="medidor"><div class="barra"><i style="width:${t.total ? (100 * t.vistas) / t.total : 0}%"></i></div>
    <span>Del tema: ${t.vistas} de ${t.total} lecturas calificadas${t.vistas ? ` · ${t.bien} con ${Math.round(UMBRAL_LECTURA * 100)} % o más` : ""}.
    ${hayAlmacenamiento ? "Se guarda en este dispositivo." : "Este navegador no guarda el avance (ventana privada o datos bloqueados)."}</span></div>`;
}

function botonesSeguir(falladasTanda = []) {
  if (proyectar) return `<div class="row"><button class="primary" id="vuelta">Otra vuelta</button></div>`;
  const faltan = disponibles.filter((l) => puntajeLectura(l, avance) === null).length;
  const falladas = disponibles.filter((l) => { const p = puntajeLectura(l, avance); return p !== null && p < UMBRAL_LECTURA; }).length;
  return `<div class="row">
    ${faltan ? `<button class="primary" id="seguir">Seguir con las ${faltan} que faltan</button>` : `<button class="primary" id="vuelta">Otra vuelta con todas</button>`}
    ${falladasTanda.length ? `<button id="falladas">Repasar las ${falladasTanda.length} de esta tanda que no salieron bien</button>` : ""}
    ${falladas > falladasTanda.length ? `<button id="falladas-tema">Repasar las ${falladas} que fallé del tema</button>` : ""}
    ${!revision && Object.keys(avance.lecturas).length ? `<button class="peligrosa" id="borrar-avance">Borrar mi avance</button>` : ""}
  </div>`;
}

function enlazarSeguir(falladasTanda = []) {
  const vuelta = (cuales) => { $("#cuales").value = cuales; empezar(); };
  if ($("#seguir")) $("#seguir").onclick = () => vuelta("faltan");
  if ($("#vuelta")) $("#vuelta").onclick = () => vuelta("todas");
  if ($("#falladas-tema")) $("#falladas-tema").onclick = () => vuelta("falladas");
  if ($("#borrar-avance")) $("#borrar-avance").onclick = () => {
    if (!confirm(`¿Borrar tu avance en «${origen.paquete.titulo}»? Se olvida qué lecturas calificaste en este dispositivo.`)) return;
    borrarLecturas(origen.ruta);
    avance = { lecturas: {}, tanda: null, resumen: null };
    vuelta("faltan");
  };
  if ($("#falladas")) $("#falladas").onclick = () => {
    tanda = falladasTanda;
    estados.clear();
    if (avance.tanda) { avance.tanda.escritas = {}; avance.tanda.pasadas = {}; }
    actual = 0;
    creada = Date.now();
    guardar();
    vista();
  };
}

function resultado() {
  if (proyectar) {
    app.innerHTML = `<section class="panel resultado"><span class="tema">${esc(origen.paquete.titulo)}</span>
      <p class="completo">Fin de la sesión: ${plural(tanda.length, "caso", "casos")}.</p>${botonesSeguir()}</section>`;
    return enlazarSeguir();
  }
  const hechas = tanda.filter((l) => puntaje(l, estadoDe(l).notas) !== null);
  const valores = hechas.map((l) => puntaje(l, estadoDe(l).notas));
  const falladas = hechas.filter((l, k) => valores[k] < UMBRAL_LECTURA);
  const medio = valores.length ? valores.reduce((a, b) => a + b, 0) / valores.length : 0;
  app.innerHTML = `<section class="panel resultado">
    <span class="tema">${esc(origen.paquete.titulo)}</span>
    <div class="big">${Math.round(medio * 100)}<small> %</small></div>
    <div class="medidor"><div class="barra"><i style="width:${Math.round(medio * 100)}%"></i></div>
      <span>Promedio de tus notas en ${plural(hechas.length, "caso calificado", "casos calificados")} de ${tanda.length} en esta tanda.</span></div>
    ${hechas.length ? `<ol class="lec-resumen">${hechas.map((l, k) => `<li><span>${esc(l.tema)}</span><b class="${valores[k] >= UMBRAL_LECTURA ? "bien" : "mal"}">${Math.round(valores[k] * 100)} %</b></li>`).join("")}</ol>` : ""}
    ${lineaDelTema()}
    ${botonesSeguir(falladas)}
  </section>`;
  enlazarSeguir(falladas);
}

// ------------------------------------------------------------------ sin tema: la lista de temas con lecturas
async function elegirTema() {
  const [indice, vivo] = await Promise.all([cargarJSON("temas/indice.json").catch(() => null), indiceEnVivo()]);
  const temas = fusionarIndice(indice?.paquetes || [], vivo).filter((p) => p.lecturas?.publicado > 0);
  document.title = `${proyectar ? "Proyectar lecturas" : "Lectura de casos"} · RadQuiz`;
  $("#subtitulo").textContent = proyectar ? "Proyectar lecturas" : "Lectura de casos";
  app.innerHTML = `<section class="stack">
    <div class="seccion-cabeza"><h1>${proyectar ? "Proyectar una sesión de lectura" : "Lectura de casos"}</h1></div>
    <p class="lead">${proyectar
      ? "Proyectas el caso entero: figuras y preguntas a la vez. El grupo responde en voz alta y tú pasas la página y muestras cada respuesta. También puedes abrirla a los celulares para que cada uno escriba."
      : "El caso entero, como en los libros de casos: miras las figuras, contestas las preguntas por escrito o de memoria, pasas la página y te comparas con las respuestas y las figuras anotadas."}</p>
    ${temas.length ? `<div class="temas">${temas.map((p) => `<article class="panel tema-card tema-portada clicable">
        <div class="tc-texto"><h4>${esc(p.titulo)}</h4>
          <p class="meta">${esc(SEGMENTOS[p.segmento] || p.segmento)} · ${plural(p.lecturas.publicado, "lectura", "lecturas")}</p></div>
        <a class="boton primary abrir" href="${enlaceTema(p.ruta, proyectar ? "&proyectar=1" : "")}">${proyectar ? "Proyectar" : "Leer"}</a>
      </article>`).join("")}</div>`
      : `<p class="muted">Todavía no hay temas con lecturas publicadas.</p>`}
  </section>`;
}

// ------------------------------------------------------------------ inicio
async function iniciar() {
  activarAmpliacion();
  if (!ruta) return elegirTema();
  if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(ruta)) {
    app.innerHTML = `<section class="panel"><p>El tema no es válido. <a href="lectura.html">Ver los temas con lecturas</a>.</p></section>`;
    return;
  }
  try {
    origen = { ruta, ...(await cargarPaquete(ruta, { ocultos: proyectar })) };
  } catch (e) {
    app.innerHTML = `<section class="panel"><p>No se pudo cargar el tema: ${esc(e.message)}</p></section>`;
    return;
  }
  const todas = origen.paquete.lecturas || [];
  base = todas.filter((l) => revision || l.estado === "publicado");
  document.title = `${origen.paquete.titulo} · Lectura · RadQuiz`;
  $("#subtitulo").textContent = origen.paquete.titulo;
  if (!base.length) {
    app.innerHTML = `<section class="panel" style="display:grid;gap:10px;max-width:680px"><h2>${esc(origen.paquete.titulo)}</h2>
      <p>Este tema no tiene lecturas publicadas${todas.length ? " todavía: siguen en borrador" : ""}.</p>
      ${origen.paquete.casos?.some((c) => c.estado === "publicado") ? `<p><a href="practica.html?tema=${esc(ruta)}">Practicar sus casos</a></p>` : ""}</section>`;
    return;
  }
  avance = revision || proyectar ? { lecturas: {}, tanda: null, resumen: null } : leerLecturas(ruta);
  $("#herramientas").hidden = false;
  $("#fila-cuales").hidden = proyectar || revision;
  $("#modo").textContent = proyectar ? "Proyector" : revision ? "Revisión · incluye borradores" : "Lectura";
  $("#modo").classList.toggle("live", proyectar || revision);
  const otro = $("#cambiar-modo");
  otro.textContent = proyectar ? "Leer a mi ritmo" : "Proyectar";
  otro.href = enlaceTema(ruta, proyectar ? "" : "&proyectar=1");
  otro.hidden = revision;
  if (proyectar) {
    document.body.classList.add("proyector");
    const vivo = document.createElement("a");
    vivo.className = "boton primary";
    vivo.textContent = "Abrir a los celulares";
    vivo.title = "Cada residente escribe sus respuestas desde el celular; tú las ves agrupadas al pasar la página";
    vivo.href = `lectura-vivo.html?crear=1&tema=${encodeURIComponent(ruta).replace("%2F", "/")}`;
    vivo.onclick = () => {
      // La tanda que se está proyectando pasa a la sesión con celulares.
      try { sessionStorage.setItem("radquiz.lectura.tanda", JSON.stringify({ ruta, ids: tanda.map((l) => l.id), i: actual })); } catch { /* sin almacenamiento */ }
    };
    otro.after(vivo);
  }
  $("#solo-verificadas").onchange = empezar;
  $("#cuales").onchange = empezar;
  $("#orden").onchange = empezar;
  $("#cuantos").onchange = empezar;
  $("#cuantos").onkeydown = (e) => { if (e.key === "Enter") e.target.blur(); };
  if (!retomar()) empezar();
}

document.addEventListener("keydown", (e) => {
  if (!tanda.length || !$(".lec-hoja") || e.ctrlKey || e.metaKey || e.altKey) return;
  const destino = e.target instanceof Element ? e.target : document.body;
  if (destino.closest("select, textarea, input, button") && !(destino.closest("button") && /^Arrow/.test(e.key))) return;
  const lectura = tanda[actual];
  const est = estadoDe(lectura);
  if (e.key === "ArrowRight") {
    if (est.pagina === 1 && proyectar) pasarPagina();
    else $("#siguiente")?.click();
  } else if (e.key === "ArrowLeft") {
    $("#anterior")?.click();
  } else if (est.pagina === 2 && proyectar && /^[1-8]$/.test(e.key)) {
    mostrar(lectura, Number(e.key) - 1);
  } else if (est.pagina === 2 && proyectar && e.key.toLowerCase() === "a") {
    mostrarTodas(lectura);
  } else if (est.pagina === 2 && !proyectar && /^[123]$/.test(e.key)) {
    // La nota va a la primera pregunta que falta calificar.
    const i = lectura.preguntas.findIndex((_, k) => !est.elegidas.has(k));
    if (i >= 0) calificar(lectura, i, Object.keys(NOTAS)[Number(e.key) - 1]);
  } else if (est.pagina === 1 && proyectar && e.key === " ") {
    e.preventDefault();
    pasarPagina();
  }
});

iniciar();
