// RadQuiz — cuestionarios armados con casos de varios temas: por segmento, por área o por una búsqueda.
//
// Un criterio es { segmento, area, q }: «Tórax · Pleura», «Abdomen» o «neumotórax». Lo usan la portada
// (buscador y conteos), la práctica, la sala y el tablero, siempre con la misma regla (coincide()).
//
// Para no bajar todos los temas solo para buscar, cada publicación escribe además «indice_casos/<tema>»: por
// caso, su clasificación, su nivel, sus etiquetas, su subtema y su respuesta (resumenCaso()). Nunca se muestra
// nada de eso: la búsqueda dice cuántos casos hay y en qué temas, sin enunciados ni respuestas, para no
// adelantar nada. Con el índice se sabe qué temas cargar; después se filtra sobre los casos de verdad.
// Un tema sin índice (publicado antes, o de una base que no responde) se carga entero cuando hace falta.
import { SEGMENTOS } from "./comun.js";
import { AREAS } from "./areas.js";

export const SIN_TILDES = (texto) => String(texto ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const PALABRA = /[a-z0-9ñ]+/g;
const MINIMO = 2;   // letras de una palabra buscada: «rm» sí, «a» no

// Las parejas segmento → área del caso, como texto «segmento/área» o «segmento». Sin «clasificacion», el caso es
// del segmento del tema (el mismo criterio que clasificacionDe() en app/validacion.js).
export function parejasDe(caso, segmentoTema) {
  const propias = (Array.isArray(caso?.clasificacion) ? caso.clasificacion : Object.values(caso?.clasificacion || {}))
    .filter((p) => p && SEGMENTOS[p.segmento]);
  const lista = propias.length ? propias : segmentoTema ? [{ segmento: segmentoTema }] : [];
  return lista.map((p) => (p.area ? `${p.segmento}/${p.area}` : p.segmento));
}

// Lo que se guarda de cada caso en «indice_casos»: lo justo para buscar y contar.
export function resumenCaso(caso, segmentoTema) {
  const lista = (v) => (Array.isArray(v) ? v : Object.values(v || {}));
  const r = {
    c: parejasDe(caso, segmentoTema),
    n: Number.isInteger(caso?.dificultad?.nivel) ? caso.dificultad.nivel : 0,
    e: lista(caso?.etiquetas).map(String).slice(0, 12),
    t: String(caso?.tema || ""),
    r: String(lista(caso?.opciones)[caso?.correcta] ?? ""),
  };
  if (!r.e.length) delete r.e;
  return r;
}

// «indice_casos/<tema>» de un paquete ya armado: { version, casos: { <id>: resumen } }.
export function indiceDePaquete(paquete) {
  const casos = {};
  for (const caso of paquete.casos || []) {
    if (caso.estado === "publicado") casos[caso.id] = resumenCaso(caso, paquete.segmento);
  }
  return { version: paquete.version, casos };
}

// ------------------------------------------------------------------ criterios
export function criterioDe(params) {
  const segmento = SEGMENTOS[params.get("segmento")] ? params.get("segmento") : "";
  const area = segmento && (AREAS[segmento] || {})[params.get("area")] ? params.get("area") : "";
  const q = (params.get("q") || "").trim().replace(/\s+/g, " ").slice(0, 80);
  return { segmento, area, q };
}

export const hayCriterio = (c) => Boolean(c && (c.segmento || palabras(c.q).length));

// La consulta para el enlace: «segmento=torax&area=pleura&q=…».
export function consultaDe(c) {
  const p = new URLSearchParams();
  if (c.segmento) p.set("segmento", c.segmento);
  if (c.segmento && c.area) p.set("area", c.area);
  if (c.q) p.set("q", c.q);
  return p.toString();
}

export const nombreArea = (segmento, area) => (AREAS[segmento] || {})[area] || area;

export function nombreCriterio(c) {
  const partes = [];
  if (c.segmento) partes.push(SEGMENTOS[c.segmento] + (c.area ? ` · ${nombreArea(c.segmento, c.area)}` : ""));
  if (palabras(c.q).length) partes.push(`«${c.q}»`);
  return partes.join(" · ") || "Todos los temas";
}

export function palabras(texto) {
  return (SIN_TILDES(texto).match(PALABRA) || []).filter((p) => p.length >= MINIMO);
}

// El texto en que se busca: etiquetas, subtema, respuesta, título del tema y nombres de segmento y área.
function pajar(resumen, titulo) {
  const nombres = (resumen.c || []).map((par) => {
    const [s, a] = par.split("/");
    return `${SEGMENTOS[s] || ""} ${a ? nombreArea(s, a) : ""}`;
  });
  return SIN_TILDES([...(resumen.e || []), resumen.t, resumen.r, titulo, ...nombres].join(" "));
}

// ¿El caso (su resumen) entra en el criterio? El segmento y el área valen en cualquiera de sus parejas; todas
// las palabras buscadas tienen que estar, como principio de palabra o dentro de ella («neumo» → «neumotórax»).
export function coincide(resumen, c, titulo = "") {
  if (c.segmento) {
    const ok = (resumen.c || []).some((par) => {
      const [s, a] = par.split("/");
      return s === c.segmento && (!c.area || a === c.area);
    });
    if (!ok) return false;
  }
  const buscadas = palabras(c.q);
  if (!buscadas.length) return true;
  const texto = pajar(resumen, titulo);
  return buscadas.every((p) => texto.includes(p));
}

// ------------------------------------------------------------------ índice de casos
// Junta el índice de la base con el del sitio (temas/indice_casos.json). Vale el que tenga la misma versión
// que el tema en la lista fusionada; si ninguno coincide, el tema queda sin índice (null).
export function indicePorRuta(temas, vivo, estatico) {
  const porRuta = new Map();
  for (const t of temas) {
    const id = t.ruta.split("/").pop();
    const candidatos = [vivo?.[id], estatico?.[id]].filter((x) => x && x.casos && typeof x.casos === "object");
    porRuta.set(t.ruta, candidatos.find((x) => x.version === t.version) || null);
  }
  return porRuta;
}

// Cuántos casos hay por segmento y por «segmento/área», y por tema, para un criterio (sin el segmento, que es
// lo que se elige con estos conteos). Un caso con dos segmentos cuenta en los dos. Los temas sin índice
// cuentan con todos sus casos en su segmento, sin área.
export function contar(temas, indices, c = {}) {
  const porSegmento = {}, porArea = {}, porTema = {};
  const soloTexto = { q: c.q };
  const sumar = (obj, k) => { obj[k] = (obj[k] || 0) + 1; };
  for (const t of temas) {
    const ind = indices.get(t.ruta);
    if (!ind) {
      if (palabras(c.q).length && !palabras(c.q).every((p) => SIN_TILDES(t.titulo).includes(p))) continue;
      const n = t.casos?.publicado || 0;
      porSegmento[t.segmento] = (porSegmento[t.segmento] || 0) + n;
      if (!c.segmento || c.segmento === t.segmento) porTema[t.ruta] = n;
      continue;
    }
    for (const resumen of Object.values(ind.casos)) {
      if (!coincide(resumen, soloTexto, t.titulo)) continue;
      const segmentos = new Set();
      for (const par of resumen.c || []) {
        const [s, a] = par.split("/");
        segmentos.add(s);
        if (a) sumar(porArea, `${s}/${a}`);
      }
      segmentos.forEach((s) => sumar(porSegmento, s));
      if (coincide(resumen, c, t.titulo)) sumar(porTema, t.ruta);
    }
  }
  return { porSegmento, porArea, porTema };
}

// Los temas que hay que cargar para un criterio: los que tienen algún caso en el índice y, de los que no
// tienen índice, los que podrían tener alguno.
export function temasPara(temas, indices, c) {
  return temas.filter((t) => {
    const ind = indices.get(t.ruta);
    if (ind) return Object.values(ind.casos).some((r) => coincide(r, c, t.titulo));
    return !c.segmento || c.segmento === t.segmento || palabras(c.q).length > 0;
  }).map((t) => t.ruta);
}

// Los casos de verdad que cumplen el criterio, de los temas ya cargados: [{ ruta, paquete, caso }], tema por
// tema y en el orden de cada tema.
export function casosPara(rutas, datosDe, c, { estados = ["publicado"] } = {}) {
  const salida = [];
  for (const ruta of rutas) {
    const datos = datosDe.get(ruta);
    if (!datos) continue;
    const { paquete } = datos;
    for (const caso of paquete.casos || []) {
      if (!estados.includes(caso.estado)) continue;
      if (coincide(resumenCaso(caso, paquete.segmento), c, paquete.titulo)) salida.push({ ruta, paquete, caso });
    }
  }
  return salida;
}
