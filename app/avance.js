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
