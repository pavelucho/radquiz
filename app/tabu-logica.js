// RadQuiz — lógica del Tabú radiológico, sin pantalla: qué casos sirven de carta y qué palabras quedan prohibidas.
//
// Una carta es un caso de imagen con una respuesta corta: quien describe ve la figura y el diagnóstico, y su equipo
// tiene que adivinarlo solo con la descripción de lo que se ve. Prohibidas: las palabras de la respuesta y, hasta
// completar cinco, las etiquetas y el tema del caso. Lo que la app no puede juzgar (si alguien dijo una prohibida)
// lo juzga el otro equipo en voz alta.
import { normal } from "./tablero.js";

export const MAX_PROHIBIDAS = 5;
export const MAX_PALABRAS = 5;          // palabras con significado: con más, es una frase y no un diagnóstico que adivinar
export const PUNTOS = { acierto: 1, tabu: -1, paso: 0, sono: 0 };   // «sono»: la carta en juego cuando sonó el tiempo
export const TIEMPOS = [45, 60, 90];
export const PASES = [0, 1, 2, 3];      // pases por turno; 3 o más se muestra como «sin límite»
export const SIN_LIMITE = 3;

// Respuestas que no se pueden describir con la imagen: un grado, un tipo, sí o no, una cifra, «todas las anteriores».
const NO_CARTA = [
  /^(grado|tipo|estadio|clase|nivel|categor[ií]a)\b/i,
  /^[\divxl.,\s%–-]+$/i,
  /^(s[ií]|no|verdadero|falso|ambos|ninguno)$/i,
  /\b(todas|ninguna|ambas) (las|de)\b/i,
  /\banteriores\b/i,
  /\.$/,                                // termina en punto: es una oración
];

// Palabras que no dan pista (artículos, modalidades, rótulos genéricos de las etiquetas): no se prohíben.
const NEUTRAS = new Set(`
  con del las los para por que sin una unos unas este esta estos estas entre sobre tras como mas muy
  rm tc rx us eco ecografia resonancia tomografia radiografia angiografia imagen imagenes estudio
  reconocimiento diagnostico diagnosticos anatomia tecnica esquema criterios adulto adultos nino ninos pediatria
  radiologia hallazgo hallazgos caso casos signo signos analisis lesion lesiones patron
`.trim().split(/\s+/));

// Dos palabras con la misma raíz cuentan como una («fractura» y «fracturas», «menisco» y «meniscal»).
const raiz = (palabra) => normal(palabra).slice(0, 5);

function palabrasDe(texto) {
  return String(texto || "").split(/[^\p{L}\p{N}-]+/u)
    .map((p) => p.replace(/^-+|-+$/g, ""))
    .filter((p) => {
      const n = normal(p).replace(/ /g, "");
      return n.length > 2 && !NEUTRAS.has(n) && !/^\d+$/.test(n);
    });
}

export const respuesta = (caso) => caso.opciones[caso.correcta];

// La figura que se ve en la carta: las de la pregunta y, si el caso no tiene, cualquiera (quien describe ya sabe
// la respuesta, así que una figura «de respuesta» no le adelanta nada a nadie).
export function figurasCarta(caso) {
  const refs = caso.imagenes || [];
  const pregunta = refs.filter((r) => r.mostrar_en === "pregunta");
  return pregunta.length ? pregunta : refs.slice(0, 1);
}

export function esCarta(caso) {
  const texto = String(respuesta(caso) || "").trim();
  if (caso.tipo === "concepto" || !figurasCarta(caso).length || texto.length < 3) return false;
  if (palabrasDe(texto).length > MAX_PALABRAS) return false;
  return !NO_CARTA.some((patron) => patron.test(texto));
}

// Hasta MAX_PROHIBIDAS palabras: todas las de la respuesta (aunque pasen del máximo: son las que más ayudan),
// después las etiquetas y por último el tema. Se muestran con sus tildes; los nombres propios («Morel-Lavallée») y
// las siglas, como están escritos, y lo demás en minúscula (la respuesta empieza con mayúscula y el tema va en
// mayúsculas de título).
export function prohibidas(caso, max = MAX_PROHIBIDAS) {
  const lista = [];
  const vistas = new Set();
  const agregar = (palabra, obligatoria, minuscula) => {
    const r = raiz(palabra);
    if (vistas.has(r) || (!obligatoria && lista.length >= max)) return;
    vistas.add(r);
    lista.push(minuscula && /^\p{Lu}?[\p{Ll}\d]+$/u.test(palabra) ? palabra.toLowerCase() : palabra);
  };
  palabrasDe(respuesta(caso)).forEach((p, i) => agregar(p, true, i === 0));
  for (const etiqueta of caso.etiquetas || []) palabrasDe(etiqueta).forEach((p) => agregar(p, false, false));
  palabrasDe(String(caso.tema || "").split(" · ").pop()).forEach((p) => agregar(p, false, true));
  return lista;
}

// Las cartas de una partida: una por respuesta (dos casos con el mismo diagnóstico serían la misma carta), con los
// niveles elegidos, barajadas. `entradas` son las del catálogo: { clave, caso }.
export function armarMazo(entradas, { niveles = null, nivelDe = () => 2, barajar = (l) => l } = {}) {
  const porRespuesta = new Map();
  for (const e of entradas) {
    if (!esCarta(e.caso) || (niveles && !niveles.includes(nivelDe(e.caso)))) continue;
    const clave = normal(respuesta(e.caso));
    if (!porRespuesta.has(clave)) porRespuesta.set(clave, []);
    porRespuesta.get(clave).push(e.clave);
  }
  return barajar([...porRespuesta.values()].map((claves) => barajar(claves)[0]));
}

// Para el repaso: la descripción de la fuente, que es la primera viñeta de la explicación («**Hallazgos:** …» en
// los casos escritos desde 2026-10-01; en los de antes, la primera viñeta suele ser la misma descripción).
export function descripcion(caso) {
  const lineas = String(caso.explicacion || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const primera = lineas.find((l) => /^-\s+/.test(l)) || lineas[0] || "";
  const texto = primera.replace(/^-\s+/, "").replace(/^\*\*Hallazgos:\*\*\s*/i, "").trim();
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// Una carta pasada vuelve al fondo del mazo; una jugada (acierto o tabú) sale. Devuelve el mazo nuevo.
export function sacar(mazo, clave, resultado) {
  const resto = mazo.filter((k) => k !== clave);
  return resultado === "paso" ? [...resto, clave] : resto;
}

export const pasesLibres = (limite, usados) => (limite >= SIN_LIMITE ? Infinity : Math.max(0, limite - usados));

// El orden de los turnos: cada equipo describe por turnos, uno tras otro, `vueltas` veces.
export function turnoEn(n, equipos) {
  return { equipo: n % equipos, vuelta: Math.floor(n / equipos) };
}
