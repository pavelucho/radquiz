// RadQuiz — el avance de la práctica, solo en este dispositivo (localStorage). Nada sale de aquí: ni a Firebase ni
// a otro aparato (decisión del 2026-10-01). Sin almacenamiento (ventana privada, datos bloqueados) la práctica
// funciona igual y simplemente no recuerda nada.
//
// Una clave por tema, «radquiz.avance.v1:<segmento>/<tema>»:
//   casos   id → { m: "alt", r: huella de la opción elegida, t, n }        con alternativas
//              { m: "sin", ok: true|false, c: huella de la correcta, t, n } sin alternativas: lo marca el residente
//   tanda   { ids, i, creada, cuales }: la tanda en curso, para retomarla
//   resumen { vistos, bien, total, titulo, t }: lo que muestra la portada sin cargar el tema
//
// Se guarda la huella del texto, no la posición: las opciones se barajan y el autor puede corregir la clave. Al
// leer, cada respuesta se vuelve a calificar contra el caso de hoy; si su texto ya no está, el caso vuelve a
// quedar pendiente.

const PREFIJO = "radquiz.avance.v1:";
const MODO = "radquiz.modo";

function probar() {
  try {
    localStorage.setItem("radquiz.prueba", "1");
    localStorage.removeItem("radquiz.prueba");
    return true;
  } catch {
    return false;
  }
}
export const hayAlmacenamiento = probar();

// FNV-1a de 32 bits sobre el texto sin tildes, mayúsculas ni espacios de más: corta y estable.
export function huella(texto) {
  const limpio = String(texto ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < limpio.length; i++) {
    h ^= limpio.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export function leerAvance(ruta) {
  try {
    const a = JSON.parse(localStorage.getItem(PREFIJO + ruta) || "null");
    if (a && typeof a === "object" && a.casos && typeof a.casos === "object") return a;
  } catch { /* ilegible o sin almacenamiento: se empieza de cero */ }
  return { casos: {}, tanda: null, resumen: null };
}

export function guardarAvance(ruta, avance) {
  try { localStorage.setItem(PREFIJO + ruta, JSON.stringify(avance)); } catch { /* sin almacenamiento */ }
}

export function borrarAvance(ruta) {
  try { localStorage.removeItem(PREFIJO + ruta); } catch { /* idem */ }
}

// Los resúmenes de todos los temas, para la portada: [{ ruta, vistos, bien, total, titulo, t }].
export function resumenes() {
  const salida = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const clave = localStorage.key(i);
      if (!clave?.startsWith(PREFIJO)) continue;
      const r = leerAvance(clave.slice(PREFIJO.length)).resumen;
      if (r && r.total) salida.push({ ...r, ruta: clave.slice(PREFIJO.length) });
    }
  } catch { /* sin almacenamiento */ }
  return salida;
}

export function leerModo() {
  try { return localStorage.getItem(MODO) === "sin" ? "sin" : "alt"; } catch { return "alt"; }
}

export function guardarModo(modo) {
  try { localStorage.setItem(MODO, modo); } catch { /* idem */ }
}

// Cómo quedó un caso según lo guardado: "bien", "mal" o null (sin responder, o el caso cambió desde entonces).
// Con alternativas se recalifica la opción elegida; sin alternativas vale lo que marcó el residente, mientras la
// respuesta correcta siga siendo la misma.
export function estadoDe(caso, r) {
  if (!r || !caso) return null;
  const correcta = huella(caso.opciones[caso.correcta]);
  if (r.m === "sin") return r.c === correcta ? (r.ok ? "bien" : "mal") : null;
  const elegida = caso.opciones.findIndex((o) => huella(o) === r.r);
  if (elegida < 0) return null;
  return elegida === caso.correcta ? "bien" : "mal";
}

export function anotar(avance, caso, respuesta) {
  const previa = avance.casos[caso.id];
  avance.casos[caso.id] = { ...respuesta, t: Date.now(), n: (previa?.n || 0) + 1 };
}

export function contar(casos, avance) {
  let vistos = 0;
  let bien = 0;
  for (const caso of casos) {
    const e = estadoDe(caso, avance.casos[caso.id]);
    if (e) vistos += 1;
    if (e === "bien") bien += 1;
  }
  return { vistos, bien, total: casos.length };
}

// ------------------------------------------------------------------ lecturas (app/lectura.js)
// Aparte de la práctica, con otra clave por tema, «radquiz.lectura.v1:<segmento>/<tema>»:
//   lecturas id → { p: puntaje de 0 a 1, h: huella de las preguntas, t, n }   p = completas + medias partes / preguntas
//   tanda    { ids, i, creada, cuales, orden }: la tanda en curso, para retomarla
//   resumen  { vistas, bien, total, titulo, t }: lo que muestra la portada sin cargar el tema
// Una lectura cuyo texto de preguntas cambió desde que se leyó vuelve a quedar pendiente (otra huella).

const PREFIJO_LECTURA = "radquiz.lectura.v1:";
// Desde qué puntaje una lectura cuenta como bien leída (para «Las que fallé»).
export const UMBRAL_LECTURA = 0.6;

export function huellaLectura(lectura) {
  return huella((lectura.preguntas || []).map((p) => `${p.pregunta}|${p.respuesta}`).join("\n"));
}

export function leerLecturas(ruta) {
  try {
    const a = JSON.parse(localStorage.getItem(PREFIJO_LECTURA + ruta) || "null");
    if (a && typeof a === "object" && a.lecturas && typeof a.lecturas === "object") return a;
  } catch { /* ilegible o sin almacenamiento */ }
  return { lecturas: {}, tanda: null, resumen: null };
}

export function guardarLecturas(ruta, avance) {
  try { localStorage.setItem(PREFIJO_LECTURA + ruta, JSON.stringify(avance)); } catch { /* sin almacenamiento */ }
}

export function borrarLecturas(ruta) {
  try { localStorage.removeItem(PREFIJO_LECTURA + ruta); } catch { /* idem */ }
}

// El puntaje guardado de una lectura, o null si no se leyó o cambió desde entonces.
export function puntajeLectura(lectura, avance) {
  const r = avance.lecturas[lectura.id];
  return r && r.h === huellaLectura(lectura) && typeof r.p === "number" ? r.p : null;
}

export function contarLecturas(lecturas, avance) {
  let vistas = 0;
  let bien = 0;
  for (const l of lecturas) {
    const p = puntajeLectura(l, avance);
    if (p === null) continue;
    vistas += 1;
    if (p >= UMBRAL_LECTURA) bien += 1;
  }
  return { vistas, bien, total: lecturas.length };
}

// Los resúmenes de las lecturas de todos los temas, para la portada.
export function resumenesLecturas() {
  const salida = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const clave = localStorage.key(i);
      if (!clave?.startsWith(PREFIJO_LECTURA)) continue;
      const r = leerLecturas(clave.slice(PREFIJO_LECTURA.length)).resumen;
      if (r && r.total) salida.push({ ...r, ruta: clave.slice(PREFIJO_LECTURA.length) });
    }
  } catch { /* sin almacenamiento */ }
  return salida;
}
