// RadQuiz — utilidades compartidas entre pantallas.

export const $ = (selector, raiz = document) => raiz.querySelector(selector);

export const SEGMENTOS = {
  "neurorradiologia": "Neurorradiología",
  "cabeza-cuello": "Cabeza y cuello",
  "torax": "Tórax",
  "cardiovascular": "Cardiovascular",
  "abdomen": "Abdomen",
  "genitourinario": "Genitourinario",
  "musculoesqueletico": "Musculoesquelético",
  "mama": "Mama",
  "pediatria": "Pediatría",
  "intervencionismo": "Intervencionismo",
  "fisica-tecnica": "Física y técnica",
};

export function esc(texto) {
  return String(texto ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function enLinea(texto) {
  return esc(texto)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}

// Markdown limitado del formato: **negrita**, *cursiva*, listas «- » y «1. », párrafos.
// Escapa todo primero, así que ningún texto de un paquete puede inyectar HTML.
export function md(texto) {
  const salida = [];
  let lista = null;
  let parrafo = [];
  const cerrarParrafo = () => {
    if (parrafo.length) salida.push(`<p>${enLinea(parrafo.join(" "))}</p>`);
    parrafo = [];
  };
  const cerrarLista = () => {
    if (lista) salida.push(`<${lista.tipo}>${lista.items.map((i) => `<li>${enLinea(i)}</li>`).join("")}</${lista.tipo}>`);
    lista = null;
  };
  for (const linea of String(texto ?? "").split("\n")) {
    const vineta = linea.match(/^\s*-\s+(.*)$/);
    const numero = linea.match(/^\s*\d+\.\s+(.*)$/);
    const item = vineta || numero;
    if (item) {
      cerrarParrafo();
      const tipo = vineta ? "ul" : "ol";
      if (lista && lista.tipo !== tipo) cerrarLista();
      if (!lista) lista = { tipo, items: [] };
      lista.items.push(item[1]);
    } else if (!linea.trim()) {
      cerrarParrafo();
      cerrarLista();
    } else {
      cerrarLista();
      parrafo.push(linea.trim());
    }
  }
  cerrarParrafo();
  cerrarLista();
  return salida.join("");
}

export async function cargarJSON(url) {
  const respuesta = await fetch(url, { cache: "no-cache" });
  if (!respuesta.ok) throw new Error(`No se pudo cargar ${url} (${respuesta.status})`);
  return respuesta.json();
}

function urlSegura(url) {
  return /^https:\/\//.test(url || "") ? esc(url) : null;
}

function enlace(url, texto) {
  const segura = urlSegura(url);
  return segura ? `<a href="${segura}" target="_blank" rel="noopener">${esc(texto)}</a>` : esc(texto);
}

// Atribución que exigen las licencias CC: figura, autores y enlace a la fuente, titular, licencia con enlace.
export function credito(imagen, fuente) {
  if (!fuente) return esc(imagen.figura);
  const destino = fuente.doi ? `https://doi.org/${encodeURI(fuente.doi)}` : fuente.url;
  return [
    esc(imagen.figura),
    enlace(destino, fuente.credito || fuente.cita),
    esc(fuente.titular),
    enlace(fuente.licencia_url, fuente.licencia),
  ].join(" · ");
}

// Sello de verificación de un caso publicado.
export function sello(caso, personas = {}) {
  if (caso.revisor) {
    const nombre = personas[caso.revisor] || caso.revisor;
    return `<span class="sello" title="Un radiólogo revisó este caso">✓ Verificado por ${esc(nombre)}</span>`;
  }
  return `<span class="sello sin" title="Todavía ningún radiólogo lo revisó">Sin verificar</span>`;
}

// Tandas: cuántos casos puede pedir quien practica o quien crea una sala.
export const TANDAS = [5, 10, 15, 20, 30, 50];

// Opciones del desplegable «cuántos casos». 0 = todos; solo caben las tandas menores que el total.
export function opcionesTanda(total, elegido = 0, sufijo = "casos") {
  return [
    `<option value="0">Todos (${total})</option>`,
    ...TANDAS.filter((n) => n < total).map((n) =>
      `<option value="${n}"${n === elegido ? " selected" : ""}>${n} ${sufijo}</option>`),
  ].join("");
}

export function barajar(lista) {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}
