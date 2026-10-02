// RadQuiz — lógica de la Supervivencia en la sala en vivo, sin pantalla ni Firebase.
//
// Una vida: quien falla o no responde queda eliminado y mira el resto como espectador. Si fallan todos los que
// seguían, no cae nadie («se salvan todos»), así la sala nunca se vacía. Gana el último en pie; si se acaban los
// casos con varios vivos, ganan todos ellos, ordenados por puntos (los de rapidez, como en la sala clásica).
// Los casos van del más fácil al más difícil (nivel de `dificultad`), así la presión sube sola.
//
// Con rescate, cada RESCATE_CADA casos se intercala uno de rescate, de nivel bajo: responden todos, los vivos sin
// arriesgar nada, y el eliminado que acierta vuelve. Cada persona se rescata una vez, y en el último tercio no hay
// rescates. Un rescate sin nadie que pueda volver se salta.
//
// En la base: info.modo, info.rescates (posiciones de los casos de rescate en info.casos), info.empezo (cuándo se
// pulsó Empezar: quien entra después entra eliminado), estado.rescate (ronda de rescate), estado.salvados,
// eliminados/<uid> = caso en que cayó y rescatados/<uid> = caso en que volvió.

export const MODOS = {
  clasico: "Clásico",
  supervivencia: "Supervivencia",
  rescate: "Supervivencia con rescate",
};
export const RESCATE_CADA = 3;

export const modoDe = (info) => (MODOS[info?.modo] ? info.modo : "clasico");
export const esSupervivencia = (info) => modoDe(info) !== "clasico";
export const esRescate = (info, indice) => (info?.rescates || []).includes(indice);

// Las posiciones de los rescates para `n` casos principales: después del 3.º, el 6.º… mientras no se entre en el
// último tercio de la partida.
export function posicionesRescate(n) {
  const posiciones = [];
  for (let tras = RESCATE_CADA; tras <= Math.floor((2 * n) / 3) && tras < n; tras += RESCATE_CADA) posiciones.push(tras);
  return posiciones;
}

// Arma la secuencia de la sala. `casos` ya viene filtrado (publicados, verificados…). Elige `cuantos` al azar, los
// ordena por nivel y, con rescate, reserva antes los de rescate (los de nivel más bajo) entre los que sobran.
// Devuelve { casos: [ids en orden], rescates: [posiciones en esa lista] }.
export function armarSecuencia(casos, { cuantos, rescate = false, nivelDe = () => 2, barajar = (l) => l, tope = 200 }) {
  const mezclados = barajar([...casos]);
  const total = mezclados.length;
  const pedidos = Math.min(cuantos || total, total, tope);
  // Cuántos rescates: los que caben en la partida. Si no sobran casos para todos, se ceden algunos de los
  // principales (un rescate vale más que un caso), hasta el número de rescates que todavía tienen lugar.
  let cuantosRescates = 0;
  let principalesN = pedidos;
  if (rescate) {
    for (let r = posicionesRescate(pedidos).length; r > 0; r--) {
      const p = Math.min(pedidos, total - r, tope - r);
      if (posicionesRescate(p).length >= r) {
        cuantosRescates = r;
        principalesN = p;
        break;
      }
    }
  }
  // Los de rescate, de los de nivel más bajo.
  const reserva = [...mezclados].sort((a, b) => nivelDe(a) - nivelDe(b)).slice(0, cuantosRescates);
  const apartados = new Set(reserva);
  const principales = mezclados.filter((c) => !apartados.has(c)).slice(0, principalesN);
  principales.sort((a, b) => nivelDe(a) - nivelDe(b));   // sort es estable: dentro de cada nivel queda al azar
  const lugares = new Set(posicionesRescate(principales.length).slice(0, reserva.length));
  const secuencia = [];
  const rescates = [];
  principales.forEach((caso, i) => {
    if (lugares.has(i) && reserva.length) {
      rescates.push(secuencia.length);
      secuencia.push(reserva.shift());
    }
    secuencia.push(caso);
  });
  return { casos: secuencia.map((c) => c.id), rescates };
}

export const vivos = (jugadores, eliminados = {}) => Object.keys(jugadores || {}).filter((uid) => !(uid in (eliminados || {})));

// Puede volver: está eliminado, sigue en la sala y no usó su rescate.
export const puedeVolver = (uid, eliminados = {}, rescatados = {}) => uid in (eliminados || {}) && !(uid in (rescatados || {}));

export const puedeResponder = (uid, eliminados = {}, enRescate = false) => enRescate || !(uid in (eliminados || {}));

// Quiénes pueden responder en esta ronda: en un rescate, todos; si no, los vivos.
export const habilitados = (jugadores, eliminados, enRescate) =>
  (enRescate ? Object.keys(jugadores || {}) : vivos(jugadores, eliminados));

// El resultado de una ronda. `acerto(uid)` dice si esa persona respondió bien.
// Devuelve { caen: [uid], vuelven: [uid], salvados: bool }.
export function resolverRonda({ jugadores, eliminados = {}, rescatados = {}, acerto, rescate = false }) {
  if (rescate) {
    const vuelven = Object.keys(jugadores || {}).filter((uid) => puedeVolver(uid, eliminados, rescatados) && acerto(uid));
    return { caen: [], vuelven, salvados: false };
  }
  const enPie = vivos(jugadores, eliminados);
  const fallan = enPie.filter((uid) => !acerto(uid));
  if (enPie.length && fallan.length === enPie.length) return { caen: [], vuelven: [], salvados: true };
  return { caen: fallan, vuelven: [], salvados: false };
}

// La partida está decidida cuando queda uno solo en pie (y empezaron al menos dos), salvo que todavía venga un
// rescate en el que alguien pueda volver: entonces se sigue jugando hasta ese rescate.
export function decidida(jugadores, eliminados, { info = null, indice = -1, rescatados = {} } = {}) {
  if (Object.keys(jugadores || {}).length < 2 || vivos(jugadores, eliminados).length > 1) return false;
  const quedaRescate = info && faltanParaRescate(indice, info) !== null;
  return !(quedaRescate && Object.keys(jugadores).some((uid) => puedeVolver(uid, eliminados, rescatados)));
}

// El caso que sigue al `indice`: salta los rescates en los que nadie puede volver. null = no quedan casos.
export function siguiente(indice, info, { jugadores, eliminados, rescatados }) {
  const hayQuienVuelva = Object.keys(jugadores || {}).some((uid) => puedeVolver(uid, eliminados, rescatados));
  for (let i = indice + 1; i < info.casos.length; i++) {
    if (!esRescate(info, i) || hayQuienVuelva) return i;
  }
  return null;
}

// Cuántos casos faltan para el próximo rescate (para el eliminado que espera). null = no quedan rescates.
export function faltanParaRescate(indice, info) {
  const proximo = (info?.rescates || []).find((i) => i > indice);
  return proximo === undefined ? null : proximo - indice;
}

// Número de caso que ve la gente: los de rescate no cuentan en «7 / 20».
export function numeroDe(indice, info) {
  const antes = (info?.rescates || []).filter((i) => i < indice).length;
  return { numero: indice - antes + 1, total: info.casos.length - (info?.rescates || []).length, rescate: esRescate(info, indice) };
}

// Clasificación: primero los que siguen en pie, después los eliminados (el que cayó más tarde, más arriba); dentro
// de cada grupo, por puntos.
export function clasificacion(jugadores, eliminados = {}, puntajes = {}) {
  return Object.entries(jugadores || {})
    .map(([id, j]) => ({ id, nombre: j.nombre, pts: puntajes[id] || 0, cayo: id in (eliminados || {}) ? eliminados[id] : null }))
    .sort((a, b) => (a.cayo === null ? -1 : 0) - (b.cayo === null ? -1 : 0)
      || (b.cayo ?? 0) - (a.cayo ?? 0) || b.pts - a.pts || a.nombre.localeCompare(b.nombre));
}
