// RadQuiz — utilidades compartidas entre pantallas.

export const $ = (selector, raiz = document) => raiz.querySelector(selector);

// La dirección oficial: la que entra desde la red del hospital. Es el mismo sitio de Firebase Hosting que
// radquiz-shpn2.web.app, con otro nombre. El QR y la dirección del lobby de la sala salen siempre de aquí, aunque el
// presentador la abra desde otra dirección; solo en una copia de ensayo (localhost o la red local) se usa la propia,
// para que los celulares del ensayo lleguen a esa copia.
export const URL_OFICIAL = "https://radquiz-shpn2.firebaseapp.com";
export function origenPublico() {
  const local = /^(localhost|127\.|\[?::1\]?$|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|\.local$/.test(location.hostname);
  return local || !/^https?:$/.test(location.protocol) ? location.origin : URL_OFICIAL;
}

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

// Una fuente sin licencia abierta: sus figuras no llevan enlace a ninguna licencia, sino quién las aloja,
// que es quien las publicó y responde por ellas.
export const CON_COPYRIGHT = "Con copyright";

// Atribución que exigen las licencias CC: figura, autores y enlace a la fuente, titular, licencia con enlace.
// Con copyright: figura, fuente, «© titular» y quién la aloja.
export function credito(imagen, fuente) {
  if (!fuente) return esc(imagen.figura);
  const destino = fuente.doi ? `https://doi.org/${encodeURI(fuente.doi)}` : fuente.url;
  const cerrada = fuente.licencia === CON_COPYRIGHT;
  const titular = cerrada && fuente.titular && !fuente.titular.includes("©") ? `© ${fuente.titular}` : fuente.titular;
  return [
    esc(imagen.figura),
    enlace(destino, fuente.credito || fuente.cita),
    esc(titular),
    cerrada
      ? esc(fuente.alojada_por ? `alojada por ${fuente.alojada_por}` : "sin licencia abierta")
      : enlace(fuente.licencia_url, fuente.licencia),
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

// Dificultad interna de un caso, en cuatro niveles anclados al currículo europeo de la ESR (ETC): se asigna por
// el contenido y la bibliografía, nunca por quién acierta (docs/guia-estilo-ia.md). El residente no la ve; el
// tablero ordena con ella las filas. Un caso sin dificultad cuenta como intermedio.
export const NIVELES = {
  1: { nombre: "Básico", referente: "R1 · ETC nivel I temprano" },
  2: { nombre: "Intermedio", referente: "R2 · ETC nivel I" },
  3: { nombre: "Avanzado", referente: "R3 y egreso · ETC nivel II" },
  4: { nombre: "Subespecialidad", referente: "Fellow · ETC nivel III" },
};
export const NIVEL_POR_DEFECTO = 2;

export function nivelDe(caso) {
  const n = caso?.dificultad?.nivel;
  return NIVELES[n] && Number.isInteger(n) ? n : NIVEL_POR_DEFECTO;
}

// Tandas: cuántos casos pide quien practica o quien crea una sala. El campo numérico admite cualquier número
// del 1 al total, que va en su max. Vacío, 0, el total o más = todos, que se devuelve como 0.
export function leerTanda(campo) {
  const n = Math.floor(Number(campo.value));
  return n >= 1 && n < Number(campo.max) ? n : 0;
}

// Pone un total nuevo en el campo (otro tema, otro filtro). Quien tenía todos sigue con todos, y un número
// escrito se conserva mientras quepa.
export function totalTanda(campo, total) {
  const cuantos = leerTanda(campo);
  campo.max = total;
  campo.value = cuantos && cuantos < total ? cuantos : total;
}

export function barajar(lista) {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}
