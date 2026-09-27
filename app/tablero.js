// RadQuiz — tablero por equipos, al estilo Jeopardy: la lógica, sin pantalla ni Firebase.
//
// Trabaja sobre un catálogo de casos ya cargados: clave global «<paquete>/<caso>» →
// { clave, ruta, paquete, caso, grupo }. Lo usa el tablero en el proyector (app/tablero-local.js), y la sala en
// vivo podrá usarlo igual cuando tenga su modo tablero. Las casillas, la casilla doble, la final y los casos para
// comparar se guardan por clave, no por posición: así se pueden reordenar sin perder nada.
import { AREAS } from "./areas.js";
import { barajar } from "./comun.js";

export const SEPARADOR = " · ";
export const MAX_COLUMNAS = 6;
export const MAX_COMPARAR = 2;

export const claveDe = (paquete, caso) => `${paquete}/${caso}`;
export const valores = (filas) => Array.from({ length: filas }, (_, i) => (i + 1) * 100);
export const respuestaDe = (caso) => caso.opciones[caso.correcta];

// El grupo de un caso es lo que va antes de « · » en su campo «tema»: «Técnica · Protocolo» → «Técnica».
export function grupoDe(caso) {
  return String(caso.tema || "").split(SEPARADOR)[0].trim();
}

// «Derrame», «Morfología discal» y «Artrosis» → «Derrame, morfología discal y artrosis». Delante de «i» o «hi»
// va «e», como en «sinovial e inflamatoria».
export function enumerar(nombres) {
  const [primero, ...resto] = nombres;
  if (!resto.length) return primero;
  const siguientes = resto.map((n) => (/^\p{Lu}{2}/u.test(n) ? n : n.charAt(0).toLowerCase() + n.slice(1)));
  const ultimo = siguientes.pop();
  const y = /^h?i(?!e)/i.test(ultimo) ? "e" : "y";
  return `${[primero, ...siguientes].join(", ")} ${y} ${ultimo}`;
}

// Para saber si dos respuestas son la misma: sin tildes, mayúsculas ni signos.
export function normal(texto) {
  return String(texto || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

// Palabras con significado, para medir cuánto se parecen dos casos. «Con» y «sin» no cuentan: «con reducción» y
// «sin reducción» son justo el par que conviene comparar.
const VACIAS = new Set("con del las los para por que sin una unos unas este esta".split(" "));
export function palabras(texto) {
  return new Set(normal(texto).split(" ").filter((p) => p.length > 2 && !VACIAS.has(p)));
}

const palabrasDe = (e) => palabras([e.caso.tema, respuestaDe(e.caso), ...(e.caso.etiquetas || [])].join(" "));
export const figurasDe = (e) => (e ? e.caso.imagenes.map((r) => `${e.paquete}/${r.ref}`) : []);

// Grupos del catálogo para proponer las columnas, en este orden de preferencia:
// 1. Varios temas con todos sus casos clasificados, en dos áreas o más: un grupo por área (la pareja principal).
// 2. Un tema que escribe «Grupo · Subtema» en el campo «tema», como ATM: un grupo por lo que va antes de « · ».
//    Los grupos chicos se juntan con el siguiente hasta llenar una columna: «Derrame», «Morfología discal» y
//    «Artrosis» (1, 1 y 2 casos) hacen una de 4.
// 3. Si no, el tema entero es un grupo.
// temas: [{ ruta, titulo, entradas: [entrada del catálogo] }]
export function proponerGrupos(temas, filas) {
  const todas = temas.flatMap((t) => t.entradas);
  const areaDe = (e) => {
    const pareja = (e.caso.clasificacion || [])[0];
    return pareja && pareja.area ? `${pareja.segmento}/${pareja.area}` : "";
  };
  const areas = new Set(todas.map(areaDe));
  if (temas.length > 1 && !areas.has("") && areas.size > 1) {
    return agrupar(todas, areaDe, (clave) => {
      const [segmento, area] = clave.split("/");
      return (AREAS[segmento] || {})[area] || area;
    }, "area:");
  }
  return temas.flatMap((t) => {
    if (!t.entradas.length) return [];
    const conGrupo = t.entradas.filter((e) => String(e.caso.tema || "").includes(SEPARADOR)).length;
    if (conGrupo * 2 < t.entradas.length) {
      return [{ id: t.ruta, nombre: t.titulo, claves: t.entradas.map((e) => e.clave) }];
    }
    return juntarChicos(agrupar(t.entradas, (e) => e.grupo, (g) => g, `${t.ruta}:`), filas);
  });
}

function agrupar(entradas, claveDeGrupo, nombreDe, ambito) {
  const grupos = new Map();
  for (const e of entradas) {
    const k = claveDeGrupo(e);
    if (!grupos.has(k)) grupos.set(k, { id: ambito + k, nombre: nombreDe(k), claves: [] });
    grupos.get(k).claves.push(e.clave);
  }
  return [...grupos.values()];
}

function juntarChicos(grupos, filas) {
  const salida = [];
  for (const g of grupos) {
    const previo = salida[salida.length - 1];
    if (previo && previo.claves.length < filas) {
      previo.id += `+${g.id}`;
      previo.nombres.push(g.nombre);
      previo.claves.push(...g.claves);
    } else {
      salida.push({ id: g.id, nombres: [g.nombre], claves: [...g.claves] });
    }
  }
  return salida.map((g) => ({ id: g.id, nombre: enumerar(g.nombres), claves: g.claves }));
}

// Junta un grupo con el siguiente (lo pide el presentador).
export function juntar(a, b) {
  return { id: `${a.id}+${b.id}`, nombre: enumerar([a.nombre, b.nombre]), claves: [...a.claves, ...b.claves], usar: a.usar || b.usar };
}

// Una columna por grupo, con «filas» casos del grupo al azar: el formato no tiene dificultad, así que el valor
// no dice «más difícil» (el presentador puede reordenarlos). Las columnas ya armadas de un grupo se conservan:
// marcar otra columna no vuelve a sortear las demás.
export function armarColumnas(grupos, filas, previas = []) {
  const porGrupo = new Map(previas.map((c) => [c.grupo, c]));
  return grupos.map((g) => {
    const previa = porGrupo.get(g.id);
    if (previa && previa.casos.length === filas) return { ...previa, nombre: g.nombre };
    const casos = barajar(g.claves).slice(0, filas);
    while (casos.length < filas) casos.push(null);
    return { grupo: g.id, nombre: g.nombre, casos };
  });
}

export function enTablero(columnas, final = null) {
  const claves = new Set(columnas.flatMap((c) => c.casos).filter(Boolean));
  if (final) claves.add(final);
  return claves;
}

// La casilla doble va escondida fuera de la primera fila, como en el programa.
export function sortearDobles(columnas, cuantas = 1) {
  const candidatas = columnas.flatMap((col) => col.casos.filter((clave, r) => clave && r > 0));
  return barajar(candidatas).slice(0, cuantas);
}

// La ronda final sale de un caso que no está en el tablero; mejor de un grupo que no es columna.
export function proponerFinal(grupos, columnas) {
  const usados = enTablero(columnas);
  const deColumnas = new Set(columnas.map((c) => c.grupo));
  const libres = (g) => g.claves.filter((k) => !usados.has(k));
  const fuera = grupos.filter((g) => !deColumnas.has(g.id)).flatMap(libres);
  const resto = grupos.filter((g) => deColumnas.has(g.id)).flatMap(libres);
  return barajar(fuera.length ? fuera : resto)[0] || null;
}

// Lo que no puede aparecer en la enseñanza de otra casilla mientras estas claves sigan sin jugarse: sus figuras
// (la lista de marcas de una figura compartida responde otra casilla, y una figura que se muestra solo al
// responder ya es la pista) y sus respuestas.
function reservar(claves, catalogo) {
  const figuras = new Set();
  const respuestas = new Set();
  for (const clave of claves) {
    const e = catalogo.get(clave);
    if (!e) continue;
    figurasDe(e).forEach((f) => figuras.add(f));
    respuestas.add(normal(respuestaDe(e.caso)));
  }
  return { figuras, respuestas };
}

// Casos parecidos para la diapositiva «Compárelo», del más al menos parecido. Quedan fuera los del tablero, los
// que comparten figura con una casilla y los que tienen la respuesta de una casilla: adelantarían una respuesta.
// Cuenta las palabras que comparten el tema, la respuesta y las etiquetas, y suma 2 si son del mismo grupo del
// mismo paquete. Pide al menos 3 puntos: dos casos de ATM comparten siempre la etiqueta «ATM» y nada más.
// Un caso sin figura no tiene con qué compararse.
export function proponerSimilares(clave, catalogo, columnas, final = null, max = 3) {
  const base = catalogo.get(clave);
  if (!base || !figurasDe(base).length) return [];
  const bloqueadas = enTablero(columnas, final);
  const reservas = reservar(bloqueadas, catalogo);
  const pb = palabrasDe(base);
  return [...catalogo.values()]
    .filter((e) => !bloqueadas.has(e.clave) && figurasDe(e).length
      && !figurasDe(e).some((f) => reservas.figuras.has(f))
      && !reservas.respuestas.has(normal(respuestaDe(e.caso))))
    .map((e) => {
      const mismoGrupo = e.paquete === base.paquete && e.grupo === base.grupo;
      const comunes = [...palabrasDe(e)].filter((p) => pb.has(p)).length;
      return { clave: e.clave, puntos: comunes + (mismoGrupo ? 2 : 0), mismoGrupo };
    })
    .filter((p) => p.puntos >= 3)
    .sort((a, b) => b.puntos - a.puntos)
    .slice(0, max);
}

// Lo que las casillas sin jugar (y la final, si falta) necesitan esconder en este momento de la partida.
export function reservasDe(config, usadas, catalogo) {
  const pendientes = config.columnas.flatMap((col) => col.casos).filter((k) => k && !usadas[k]);
  if (config.final && !usadas[config.final]) pendientes.push(config.final);
  return reservar(pendientes, catalogo);
}

// En la casilla doble se apuesta hasta el puntaje propio o hasta el valor más alto del tablero, lo que sea mayor;
// en la final, hasta el puntaje propio (con 0 o menos, nada).
export const maxApuestaDoble = (puntos, vals) => Math.max(puntos, ...vals);
export const maxApuestaFinal = (puntos) => Math.max(puntos, 0);

// Unos 2 minutos por casilla (pista, respuestas y explicación), 3 con las diapositivas; redondeado a 5.
export function minutos(casillas, conFinal, diapositivas) {
  const total = (casillas + (conFinal ? 1 : 0)) * (diapositivas ? 3 : 2);
  return Math.max(5, Math.round(total / 5) * 5);
}
