// RadQuiz — piezas de las lecturas que comparten la práctica y la proyección (app/lectura.js) y la sesión con
// celulares (app/lectura-vivo.js).
//
// Una lectura es un caso entero al estilo de los libros de casos (schema/lectura.schema.json). La página 1 enseña
// el encabezado clínico, las figuras limpias y todas las preguntas a la vez; la página 2, las respuestas, las
// figuras anotadas con su leyenda, la discusión y las perlas. No hay alternativas: se escribe o se piensa, se pasa
// la página y se compara. La app solo sugiere si lo escrito coincide con una respuesta aceptada; la nota la pone
// quien lee (o el presentador).
import { esc, md, credito } from "./comun.js";
import { TIPOS_PREGUNTA, comparableLibre } from "./validacion.js";

export { TIPOS_PREGUNTA };

// Cómo se califica cada pregunta: lo pone quien lee. Una parcial vale media.
export const NOTAS = {
  completa: { nombre: "Completa", valor: 1, tecla: "1" },
  parcial: { nombre: "Parcial", valor: 0.5, tecla: "2" },
  no: { nombre: "No", valor: 0, tecla: "3" },
};

export const normal = (texto) => comparableLibre(texto).trim();

// Palabras que no cuentan al comparar una respuesta con las aceptadas.
const VACIAS = new Set(["de", "del", "la", "el", "los", "las", "lo", "y", "e", "o", "en", "por", "con", "sin", "a", "al", "un",
  "una", "su", "sus", "que", "of", "the", "and", "or", "with", "in"]);

function distancia(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let previa = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const fila = [i];
    for (let j = 1; j <= b.length; j++) {
      fila[j] = Math.min(previa[j] + 1, fila[j - 1] + 1, previa[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previa = fila;
  }
  return previa[b.length];
}

// Una palabra escrita vale por la aceptada si es la misma o tiene una errata (dos en las largas).
function parecida(escrita, aceptada) {
  if (escrita === aceptada) return true;
  if (aceptada.length < 5) return false;
  return distancia(escrita, aceptada) <= (aceptada.length >= 8 ? 2 : 1);
}

// La respuesta aceptada con la que coincide lo escrito, o null. Coincide si la contiene entera, o si están todas
// sus palabras con peso (sin tildes, sin mayúsculas y con alguna errata): «pronación y rotación externa» vale por
// «pronación-rotación externa». Es solo una sugerencia.
export function coincidencia(escrito, aceptadas = []) {
  const e = normal(escrito);
  if (!e) return null;
  const palabras = e.split(" ");
  for (const aceptada of aceptadas) {
    const a = normal(aceptada);
    if (!a) continue;
    if (` ${e} `.includes(` ${a} `)) return aceptada;
    const claves = a.split(" ").filter((w) => w.length >= 4 && !VACIAS.has(w));
    if (claves.length && claves.every((w) => palabras.some((x) => parecida(x, w)))) return aceptada;
  }
  return null;
}

// Agrupa respuestas escritas por lo que dicen (sin tildes, mayúsculas ni signos), las más repetidas primero.
// Cada grupo: { clave, texto (la forma más frecuente), n, uids, coincide (la aceptada con que coincide o null) }.
export function agrupar(respuestas, aceptadas = []) {
  const grupos = new Map();
  for (const [uid, texto] of respuestas) {
    const clave = normal(texto);
    if (!clave) continue;
    if (!grupos.has(clave)) grupos.set(clave, { clave, formas: new Map(), n: 0, uids: [] });
    const g = grupos.get(clave);
    g.n += 1;
    g.uids.push(uid);
    const forma = String(texto).trim();
    g.formas.set(forma, (g.formas.get(forma) || 0) + 1);
  }
  return [...grupos.values()].map((g) => ({
    clave: g.clave, n: g.n, uids: g.uids,
    texto: [...g.formas.entries()].sort((a, b) => b[1] - a[1])[0][0],
    coincide: coincidencia(g.clave, aceptadas),
  })).sort((a, b) => b.n - a.n || a.clave.localeCompare(b.clave));
}

// Las figuras de una página. En la página 2 cada anotada lleva su leyenda en español.
export function figuras(lectura, origen, cual, { leyendas = cual === "respuesta", clase = "" } = {}) {
  const refs = (lectura.imagenes || []).filter((r) => r.mostrar_en === cual);
  if (!refs.length) return "";
  return `<div class="lec-figuras ${clase} ${refs.length === 1 ? "una" : ""}">${refs.map((r) => {
    const imagen = origen.paquete.imagenes[r.ref];
    if (!imagen) return `<p class="cap">Falta la imagen ${esc(r.ref)}</p>`;
    return `<figure class="lec-figura">
      <div class="lec-img"><img src="${esc(origen.imagen(r.ref))}" alt="${esc(r.leyenda || imagen.figura)}" data-zoom loading="lazy"></div>
      ${leyendas && r.leyenda ? `<figcaption class="lec-leyenda">${esc(r.leyenda)}</figcaption>` : ""}
      <p class="cap"><span>${credito(imagen, origen.fuentes[imagen.fuente])}</span><span>Toca para ampliar</span></p>
    </figure>`;
  }).join("")}</div>`;
}

// La lista de preguntas de la página 1. `campo(i)` devuelve el HTML que va debajo de cada una (la casilla para
// escribir, o nada en el proyector).
export function listaPreguntas(lectura, campo = () => "") {
  return `<ol class="lec-preguntas">${(lectura.preguntas || []).map((p, i) => `<li class="lec-pregunta" data-i="${i}">
    <p class="lec-enunciado">${esc(p.pregunta)}</p>${campo(i)}</li>`).join("")}</ol>`;
}

// Lo que la página 2 dice después de las preguntas: discusión y perlas.
export function cierre(lectura) {
  const perlas = lectura.perlas || [];
  return `${lectura.explicacion ? `<section class="lec-discusion md"><h3>Discusión</h3>${md(lectura.explicacion)}</section>` : ""}
    ${perlas.length ? `<section class="pearl lec-perlas"><b>Perlas</b><ul>${perlas.map((x) => `<li>${md(x).replace(/^<p>|<\/p>$/g, "")}</li>`).join("")}</ul></section>` : ""}`;
}

// La respuesta de la fuente a una pregunta, con los puntos clave (para marcar) si los tiene.
export function respuestaFuente(p) {
  return `<div class="lec-respuesta md"><span class="lec-rotulo">Respuesta</span>${md(p.respuesta)}</div>`;
}

export const tipoDe = (p) => TIPOS_PREGUNTA[p.tipo] || "Pregunta";

// Puntaje de una lectura a partir de las notas por pregunta: de 0 a 1, o null si falta calificar alguna.
export function puntaje(lectura, notas) {
  const n = (lectura.preguntas || []).length;
  if (!n) return null;
  let suma = 0;
  for (let i = 0; i < n; i++) {
    const nota = NOTAS[notas[i]];
    if (!nota) return null;
    suma += nota.valor;
  }
  return suma / n;
}

// Lo que sugiere la lista de puntos clave: todos marcados, completa; alguno, parcial; ninguno, no.
export function notaPorPuntos(marcados, total) {
  if (!total) return null;
  if (marcados >= total) return "completa";
  return marcados ? "parcial" : "no";
}
