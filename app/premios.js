// RadQuiz — lo que le da historia a una sesión en vivo, sin pantalla ni Firebase: rachas, el bono por ver lo que nadie
// vio, los datos que se cuentan al revelar, los títulos del final y los equipos.
//
// Todo lo calcula el presentador al revelar (como los puntajes) y lo guarda en la sala:
//   stats/<uid> = { r: racha actual, mr: mejor racha, a: aciertos, s: segundos sumados en los aciertos,
//                   f: fallos (incluye no responder), k: veces que respondió primero y falló }
//   premio/<uid> = { i: caso, pts: lo que ganó en ese caso, racha: si tuvo el multiplicador, solo: si acertó solo }
//   titulos/<uid> = id del título, al terminar.

export const RACHA_MIN = 3;          // desde el 3.º acierto seguido, el puntaje se multiplica
export const MULT_RACHA = 1.5;
export const BONO_SOLO = 200;        // acertar cuando nadie más acertó (con al menos 3 que respondieron)
export const MIN_PARA_SOLO = 3;
export const TRAMPA_MIN = 0.4;       // una opción incorrecta que eligió el 40 % o más

export const multiplicador = (racha) => (racha >= RACHA_MIN ? MULT_RACHA : 1);

// Lo que se cuenta al revelar. `respuestas`: uid → { opcion, t }; `inicio`: hora de inicio del caso.
// Devuelve { total, aciertos, solo (uid o null), rapido ({ uid, segundos } o null), trampa ({ opcion, pct } o null),
// primero (uid del que respondió primero, o null) }.
export function datosRevelado({ respuestas = {}, correcta, inicio }) {
  const lista = Object.entries(respuestas || {});
  const bien = lista.filter(([, r]) => r.opcion === correcta);
  const porOpcion = new Map();
  for (const [, r] of lista) porOpcion.set(r.opcion, (porOpcion.get(r.opcion) || 0) + 1);
  let trampa = null;
  for (const [opcion, n] of porOpcion) {
    const pct = n / lista.length;
    if (opcion !== correcta && n >= 2 && pct >= TRAMPA_MIN && (!trampa || pct > trampa.pct)) trampa = { opcion, pct };
  }
  const tiempo = (r) => (typeof inicio === "number" && typeof r.t === "number" ? Math.max(0, (r.t - inicio) / 1000) : Infinity);
  const masRapido = bien.reduce((mejor, [id, r]) => (!mejor || tiempo(r) < mejor.segundos ? { uid: id, segundos: tiempo(r) } : mejor), null);
  const primero = lista.reduce((mejor, [id, r]) => (!mejor || r.t < mejor.t ? { uid: id, t: r.t } : mejor), null);
  return {
    total: lista.length,
    aciertos: bien.length,
    solo: bien.length === 1 && lista.length >= MIN_PARA_SOLO ? bien[0][0] : null,
    rapido: masRapido && Number.isFinite(masRapido.segundos) ? masRapido : null,
    trampa,
    primero: primero ? primero.uid : null,
  };
}

// Las cuentas de una ronda para cada uno de los que podían responder (`habilitados`).
// `base(uid)` = puntos sin multiplicar (0 si falló). Devuelve uid → { stats nuevas, premio }.
export function cuentasRonda({ habilitados, stats = {}, respuestas = {}, correcta, inicio, base, indice }) {
  const datos = datosRevelado({ respuestas, correcta, inicio });
  const salida = {};
  for (const id of habilitados) {
    const previo = { r: 0, mr: 0, a: 0, s: 0, f: 0, k: 0, ...(stats[id] || {}) };
    const r = respuestas[id];
    const acerto = Boolean(r) && r.opcion === correcta;
    const nuevo = { ...previo };
    let pts = 0;
    let conRacha = false;
    if (acerto) {
      nuevo.r = previo.r + 1;
      nuevo.mr = Math.max(previo.mr, nuevo.r);
      nuevo.a = previo.a + 1;
      const segundos = typeof inicio === "number" && typeof r.t === "number" ? Math.max(0, (r.t - inicio) / 1000) : 0;
      nuevo.s = Math.round((previo.s + segundos) * 10) / 10;
      conRacha = multiplicador(nuevo.r) > 1;
      pts = Math.round(base(id) * multiplicador(nuevo.r)) + (datos.solo === id ? BONO_SOLO : 0);
    } else {
      nuevo.r = 0;
      nuevo.f = previo.f + 1;
      if (r && datos.primero === id) nuevo.k = previo.k + 1;
    }
    salida[id] = { stats: nuevo, premio: { i: indice, pts, racha: conRacha, solo: datos.solo === id } };
  }
  return { datos, cuentas: salida };
}

// ------------------------------------------------------------------ títulos del final
export const TITULOS = {
  impecable: { nombre: "Impecable", texto: () => "No falló ni uno" },
  fenix: { nombre: "Fénix", texto: () => "Volvió de un rescate y llegó al final" },
  francotirador: { nombre: "Francotirador", texto: (s) => `La racha más larga: ${s.mr} seguidas` },
  "ojo-de-halcon": { nombre: "Ojo de halcón", texto: (s) => `El más rápido en sus aciertos: ${formatoSegundos(s.s / s.a)} de promedio` },
  constante: { nombre: "Constante", texto: (s) => `${s.a} aciertos` },
  kamikaze: { nombre: "Kamikaze", texto: (s) => `Respondió primero… y falló ${s.k} ${s.k === 1 ? "vez" : "veces"}` },
};

export const formatoSegundos = (s) => `${(Math.round(s * 10) / 10).toLocaleString("es")} s`;

// Un título por persona como mucho, cada título para una sola persona, en este orden de prioridad. `enPie(uid)` dice
// si llegó en pie al final (supervivencia) y `volvio(uid)` si se salvó en un rescate.
export function asignarTitulos(stats = {}, { jugadores = {}, enPie = () => true, volvio = () => false } = {}) {
  const ids = Object.keys(jugadores).filter((id) => stats[id]);
  const s = (id) => ({ r: 0, mr: 0, a: 0, s: 0, f: 0, k: 0, ...stats[id] });
  const asignados = {};
  const libre = (id) => !(id in asignados);
  const elegir = (titulo, candidatos, mejor) => {
    const lista = candidatos.filter(libre);
    if (!lista.length) return;
    lista.sort(mejor);
    asignados[lista[0]] = titulo;
  };
  elegir("impecable", ids.filter((id) => s(id).f === 0 && s(id).a >= RACHA_MIN && enPie(id)), (x, y) => s(y).a - s(x).a);
  elegir("fenix", ids.filter((id) => volvio(id) && enPie(id)), (x, y) => s(y).a - s(x).a);
  elegir("francotirador", ids.filter((id) => s(id).mr >= RACHA_MIN), (x, y) => s(y).mr - s(x).mr || s(y).a - s(x).a);
  elegir("ojo-de-halcon", ids.filter((id) => s(id).a >= 2), (x, y) => s(x).s / s(x).a - s(y).s / s(y).a);
  elegir("kamikaze", ids.filter((id) => s(id).k >= 2), (x, y) => s(y).k - s(x).k);
  elegir("constante", ids.filter((id) => s(id).a >= 2), (x, y) => s(y).a - s(x).a);
  return asignados;
}

// ------------------------------------------------------------------ equipos
// Por año de residencia, o por colores (de la paleta de las letras A–E). El valor va en info.equipos.
// Es una lista y no un objeto: en un objeto, las claves «2», «3» y «4» irían primero y «Sin equipos» dejaría de ser
// la opción por defecto.
export const FORMAS_EQUIPO = [
  ["", "Sin equipos"],
  ["anio", "Por año de residencia"],
  ["2", "2 equipos"],
  ["3", "3 equipos"],
  ["4", "4 equipos"],
];
const POR_ANIO = [
  { id: "r1", nombre: "R1", color: "var(--a)" },
  { id: "r2", nombre: "R2", color: "var(--c)" },
  { id: "r3", nombre: "R3", color: "var(--b)" },
  { id: "otro", nombre: "Otros", color: "var(--d)" },
];
const COLORES = [
  { id: "rojo", nombre: "Equipo Rojo", color: "var(--e)" },
  { id: "azul", nombre: "Equipo Azul", color: "var(--a)" },
  { id: "verde", nombre: "Equipo Verde", color: "var(--c)" },
  { id: "morado", nombre: "Equipo Morado", color: "var(--d)" },
];
export function equiposDe(info) {
  const forma = String(info?.equipos ?? "");
  if (forma === "anio") return POR_ANIO;
  const n = Number(forma);
  return n >= 2 && n <= 4 ? COLORES.slice(0, n) : [];
}

// Para el proyector: cuántos hay en cada equipo, su promedio de puntos (justo aunque los equipos no tengan el mismo
// tamaño) y, en supervivencia, cuántos siguen en pie. Ordenados del mejor al peor.
export function resumenEquipos(info, jugadores = {}, puntajes = {}, eliminados = null) {
  return equiposDe(info).map((e) => {
    const miembros = Object.entries(jugadores).filter(([, j]) => j.equipo === e.id).map(([id]) => id);
    const total = miembros.reduce((n, id) => n + (puntajes[id] || 0), 0);
    const enPie = eliminados ? miembros.filter((id) => !(id in eliminados)).length : null;
    return { ...e, n: miembros.length, total, promedio: miembros.length ? Math.round(total / miembros.length) : 0, enPie };
  }).filter((e) => e.n > 0)
    .sort((x, y) => (eliminados ? (y.enPie / y.n) - (x.enPie / x.n) : 0) || y.promedio - x.promedio);
}
