// RadQuiz — un tablero ya armado, listo para jugar: la «plantilla». Sin pantalla ni Firebase, así que la usan
// igual el tablero (guardar, abrir, enlace), las instrucciones para armarlo con cualquier IA y el servidor MCP.
//
// Una plantilla nombra los casos por su clave global «<paquete>/<caso>» y nada más: los casos se cargan de lo
// publicado al abrirla. Forma (la misma que se le pide a la IA, con opciones de la partida):
//   { v: 1, nombre, filas, columnas: [{ nombre, casos: [clave | null, … de 100 a filas × 100] }],
//     dobles: [clave], final: clave | null, categoria_final, comparar: { clave: [clave] },
//     equipos: [nombre], restar, diapositivas, alternativas, empieza, criterio?, temas: [ruta] }
// «temas» se deduce de las claves; se guarda para cargar sin tener que buscar.
import { MAX_COLUMNAS, MAX_COMPARAR, enTablero, respuestaDe, figurasDe } from "./tablero.js";
import { nivelDe } from "./comun.js";

export const VERSION = 1;
export const MIN_FILAS = 3;
export const MAX_FILAS = 5;
export const MAX_DOBLES = 2;
export const MAX_EQUIPOS = 6;
const ALTERNATIVAS = ["pedido", "nunca", "siempre"];
const texto = (v, max) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);

// ------------------------------------------------------------------ del armado a la plantilla
// `b` es el borrador del tablero (app/tablero-local.js).
export function deBorrador(b, nombre) {
  const enJuego = enTablero(b.tablero, b.final);
  const comparar = {};
  for (const [clave, lista] of Object.entries(b.comparar || {})) {
    if (enJuego.has(clave) && lista?.length) comparar[clave] = lista.slice(0, MAX_COMPARAR);
  }
  return {
    v: VERSION,
    nombre: texto(nombre, 80) || "Tablero",
    filas: b.filas,
    columnas: b.tablero.map((col) => ({ nombre: texto(col.nombre, 60), casos: [...col.casos] })),
    dobles: [...(b.dobles || [])],
    final: b.final || null,
    categoria_final: texto(b.finalNombre, 60),
    comparar,
    equipos: [...b.equipos],
    restar: b.restar !== false,
    diapositivas: b.diapositivas !== false,
    alternativas: ALTERNATIVAS.includes(b.alternativas) ? b.alternativas : "pedido",
    empieza: Number.isInteger(b.empieza) ? b.empieza : 0,
    ...(b.criterio && (b.criterio.segmento || b.criterio.q) ? { criterio: b.criterio } : {}),
    temas: [...b.temas],
  };
}

// ------------------------------------------------------------------ leer y comprobar una plantilla
// Las claves de una plantilla, para saber qué temas cargar: «<paquete>/<caso>» → paquete.
export function clavesDe(p) {
  const claves = new Set();
  for (const col of lista(p?.columnas)) lista(col?.casos).forEach((k) => typeof k === "string" && claves.add(k));
  lista(p?.dobles).forEach((k) => typeof k === "string" && claves.add(k));
  if (typeof p?.final === "string") claves.add(p.final);
  for (const [k, v] of Object.entries(p?.comparar || {})) { claves.add(k); lista(v).forEach((x) => typeof x === "string" && claves.add(x)); }
  return [...claves];
}
const lista = (v) => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : []);

// Las rutas de los temas que usa la plantilla, con la lista de temas publicados ([{ ruta, id }]).
export function temasDe(p, temas) {
  const porId = new Map(temas.map((t) => [t.ruta.split("/").pop(), t.ruta]));
  const rutas = new Set(lista(p?.temas).filter((r) => typeof r === "string" && temas.some((t) => t.ruta === r)));
  for (const clave of clavesDe(p)) {
    const ruta = porId.get(clave.split("/")[0]);
    if (ruta) rutas.add(ruta);
  }
  return [...rutas];
}

// Deja la plantilla como la necesita el tablero, con el catálogo de casos ya cargado (clave → entrada). Lo que no
// encaja se corrige o se quita, y cada cosa se anota en «problemas» (texto para la persona). Devuelve
// { plantilla, problemas, errores } — «errores» cuenta lo que impide jugar (ninguna casilla con caso).
export function normalizar(bruto, catalogo) {
  const problemas = [];
  const p = bruto && typeof bruto === "object" ? bruto : {};
  const existe = (k) => typeof k === "string" && catalogo.has(k);
  const usados = new Set();
  let columnas = lista(p.columnas).map((col, c) => ({
    nombre: texto(col?.nombre, 60) || `Columna ${c + 1}`,
    casos: lista(col?.casos).map((k) => {
      if (k === null || k === "") return null;
      if (!existe(k)) { problemas.push(`«${k}» no es un caso publicado: la casilla quedó vacía.`); return null; }
      if (usados.has(k)) { problemas.push(`«${k}» estaba dos veces: la segunda casilla quedó vacía.`); return null; }
      usados.add(k);
      return k;
    }),
  })).filter((col) => col.casos.length);
  if (columnas.length > MAX_COLUMNAS) {
    problemas.push(`Caben ${MAX_COLUMNAS} columnas: sobraban ${columnas.length - MAX_COLUMNAS}.`);
    columnas = columnas.slice(0, MAX_COLUMNAS);
  }
  const pedidas = Number(p.filas) || Math.max(0, ...columnas.map((col) => col.casos.length));
  const filas = Math.min(MAX_FILAS, Math.max(MIN_FILAS, pedidas));
  if (pedidas > MAX_FILAS) problemas.push(`Caben ${MAX_FILAS} filas: las casillas de más se quitaron.`);
  for (const col of columnas) {
    col.casos = col.casos.slice(0, filas);
    while (col.casos.length < filas) col.casos.push(null);
  }
  const enJuego = enTablero(columnas);
  const dobles = lista(p.dobles).filter((k) => {
    if (enJuego.has(k)) return true;
    problemas.push(`La casilla doble «${k}» no está en el tablero: se quitó.`);
    return false;
  }).slice(0, MAX_DOBLES);
  let final = typeof p.final === "string" && p.final ? p.final : null;
  if (final && (!existe(final) || enJuego.has(final))) {
    problemas.push(existe(final) ? `La ronda final «${final}» también estaba en el tablero: se quitó la final.`
      : `«${final}» no es un caso publicado: no hay ronda final.`);
    final = null;
  }
  const bloqueados = enTablero(columnas, final);
  const comparar = {};
  for (const [clave, otros] of Object.entries(p.comparar || {})) {
    if (!bloqueados.has(clave)) continue;
    const validos = lista(otros).filter((k) => existe(k) && !bloqueados.has(k) && figurasDe(catalogo.get(k)).length);
    if (validos.length < lista(otros).length) problemas.push(`Algunos casos para comparar con «${clave}» no valían (en el tablero, sin figura o no publicados).`);
    if (validos.length) comparar[clave] = validos.slice(0, MAX_COMPARAR);
  }
  const equipos = lista(p.equipos).map((n) => texto(n, 24)).filter(Boolean).slice(0, MAX_EQUIPOS);
  const plantilla = {
    v: VERSION,
    nombre: texto(p.nombre, 80) || "Tablero",
    filas,
    columnas,
    dobles,
    final,
    categoria_final: final ? texto(p.categoria_final ?? p.finalNombre, 60) || catalogo.get(final).grupo || "Ronda final" : "",
    comparar,
    equipos: equipos.length >= 2 ? equipos : ["Equipo 1", "Equipo 2", "Equipo 3"],
    restar: p.restar !== false,
    diapositivas: p.diapositivas !== false,
    alternativas: ALTERNATIVAS.includes(p.alternativas) ? p.alternativas : "pedido",
    empieza: Number.isInteger(p.empieza) ? p.empieza : 0,
    ...(p.criterio && typeof p.criterio === "object" ? { criterio: p.criterio } : {}),
    temas: [...new Set([...bloqueados, ...Object.values(comparar).flat()].map((k) => catalogo.get(k)?.ruta).filter(Boolean))],
  };
  if (plantilla.empieza >= plantilla.equipos.length) plantilla.empieza = 0;
  const casillas = columnas.reduce((n, col) => n + col.casos.filter(Boolean).length, 0);
  return { plantilla, problemas, errores: casillas ? 0 : 1, casillas };
}

// ------------------------------------------------------------------ enlace
// La plantilla viaja entera en el enlace (#t=…), comprimida: así se arma en una computadora y se juega en otra,
// sin cuentas ni servidor. «z» = deflate + base64url; «j» = solo base64url (navegador sin CompressionStream).
const aBase64 = (bytes) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const deBase64 = (t) => Uint8Array.from(atob(t.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function pasar(bytes, flujo) {
  const salida = new Blob([bytes]).stream().pipeThrough(flujo);
  return new Uint8Array(await new Response(salida).arrayBuffer());
}

export async function codificar(plantilla) {
  const bytes = new TextEncoder().encode(JSON.stringify(plantilla));
  if (typeof CompressionStream === "function") return `z${aBase64(await pasar(bytes, new CompressionStream("deflate-raw")))}`;
  return `j${aBase64(bytes)}`;
}

export async function decodificar(codigo) {
  const tipo = codigo[0];
  let bytes = deBase64(codigo.slice(1));
  if (tipo === "z") bytes = await pasar(bytes, new DecompressionStream("deflate-raw"));
  else if (tipo !== "j") throw new Error("El enlace no es de un tablero.");
  return JSON.parse(new TextDecoder().decode(bytes));
}

// ------------------------------------------------------------------ armarlo con una IA
// Los casos que la IA puede usar, uno por línea: clave | área | subtema | respuesta | nivel | marcas.
// La respuesta va porque la IA tiene que saber qué enseña cada casilla para no repetir respuestas ni poner en
// el tablero un caso que responde otro; las instrucciones le piden no copiarla en ningún nombre.
export function lineaCandidato(e, nombreArea = (par) => par) {
  const pareja = (e.caso.clasificacion || [])[0];
  const area = pareja ? nombreArea(pareja) : "";
  const marcas = [
    figurasDe(e).length ? "" : "sin figura",
    e.caso.revisor ? "verificado" : "",
    e.caso.requiere_opciones ? "necesita opciones" : "",
  ].filter(Boolean).join(", ");
  return [e.clave, area, texto(e.caso.tema, 90), texto(respuestaDe(e.caso), 90), `nivel ${nivelDe(e.caso)}`, marcas]
    .filter((x, i) => i < 5 || x).join(" | ");
}

export const FORMATO_IA = `{
  "nombre": "Nombre corto del tablero",
  "filas": 4,
  "columnas": [
    { "nombre": "Categoría que se proyecta", "casos": ["<clave del caso de 100>", "<200>", "<300>", "<400>"] }
  ],
  "dobles": ["<clave de una casilla del tablero>"],
  "final": "<clave de un caso que NO esté en el tablero>",
  "categoria_final": "Categoría que se anuncia antes de la final",
  "comparar": { "<clave de una casilla>": ["<clave de un caso parecido que NO esté en el tablero>"] }
}`;

export const REGLAS_IA = `- Usa solo claves de la lista, copiadas tal cual («paquete/caso»). Cada caso, una sola vez.
- Entre 2 y ${MAX_COLUMNAS} columnas, todas con el mismo número de casillas (de ${MIN_FILAS} a ${MAX_FILAS}). En cada columna, del caso
  más fácil al más difícil: el valor (100, 200…) sube con el nivel.
- Las columnas son categorías que se proyectan antes de elegir: el nombre no puede decir la respuesta de ninguna
  casilla («Tumores de fosa posterior», no «Meduloblastoma»).
- No pongas en el tablero dos casos con la misma respuesta, ni dos que muestren la misma figura.
- "dobles": 1 casilla (2 como mucho), mejor de nivel 3 o 4 y fuera de la primera fila.
- "final": un caso que no esté en el tablero, de los más difíciles. "categoria_final" tampoco dice la respuesta.
- "comparar" es opcional: para la diapositiva «Compárelo», hasta 2 casos parecidos por casilla, que no estén en el
  tablero ni sean la final.
- Evita los casos marcados «sin figura» y, si se va a jugar sin alternativas, los que «necesitan opciones».
- Responde solo con el JSON, sin texto antes ni después.`;

// El texto completo para pegar en cualquier IA.
export function instruccionesIA({ pedido, lineas, filas, columnas }) {
  return `Arma un tablero de preguntas por equipos, al estilo Jeopardy, para una clase de residentes de radiología.

Lo que pide el presentador:
${texto(pedido, 2000) || "(sin indicaciones: un tablero variado y equilibrado)"}

Tamaño: ${columnas} columnas y ${filas} filas (de 100 a ${filas * 100}), salvo que el pedido diga otra cosa.

Reglas:
${REGLAS_IA}

Formato de la respuesta:
${FORMATO_IA}

Casos disponibles (clave | área | subtema | respuesta | nivel 1 a 4 | marcas):
${lineas.join("\n")}`;
}

// Saca el JSON de lo que respondió la IA (puede venir entre \`\`\` o con texto alrededor).
export function leerRespuesta(textoIA) {
  const t = String(textoIA || "");
  const bloque = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidato = bloque ? bloque[1] : t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1);
  if (!candidato.trim()) throw new Error("No encontré un JSON en la respuesta.");
  try {
    return JSON.parse(candidato);
  } catch (e) {
    throw new Error(`El JSON de la respuesta no se puede leer (${e.message}). Pídele a la IA que responda solo con el JSON.`);
  }
}
