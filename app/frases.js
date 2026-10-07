// RadQuiz — el humor de la sala en vivo, sin pantalla ni Firebase: las frases del proyector al revelar, los mensajes
// del celular mientras se espera y los nombres de los equipos por color. Todo sale de listas y se elige de forma
// estable (por el número del caso o por la hora de creación de la sala), para que la pantalla no cambie de frase cada
// vez que se redibuja y todos vean lo mismo.

// Un número de 32 bits a partir de un texto o un número: la «semilla» de las elecciones estables.
function semilla(valor) {
  let h = 2166136261;
  for (const c of String(valor)) h = Math.imul(h ^ c.codePointAt(0), 16777619);
  return h >>> 0;
}
const elegir = (lista, clave) => lista[semilla(clave) % lista.length];

// ------------------------------------------------------------------ frases al revelar
const FRASES = {
  nadie: [
    "Correlacionar con la clínica.",
    "Se sugiere control evolutivo… de todo el grupo.",
    "Estudio no concluyente para todos los lectores.",
    "Hallazgo no descrito en ningún informe.",
    "Se recomienda segunda lectura. Y tercera.",
  ],
  todos: [
    "Sin hallazgos significativos: lo vieron todos.",
    "Concordancia interobservador perfecta: kappa = 1.",
    "Estudio de rutina para este grupo.",
    "Informe sin observaciones del jefe.",
  ],
  solo: [
    "Hallazgo incidental para el resto del grupo.",
    "Una sola lectura vio lo que las demás pasaron por alto.",
    "Sensibilidad del grupo: un lector.",
  ],
  trampa: [
    "Pseudolesión: la {letra} engañó a muchos.",
    "Falso positivo colectivo en la {letra}.",
    "La {letra} realzaba igualito, pero no era.",
  ],
  pocos: [
    "Lesión sutil: pocos la vieron.",
    "Sensibilidad baja en esta sala.",
    "Hallazgo escondido detrás de la ventana equivocada.",
  ],
  muchos: [
    "Concordancia buena: casi todos lo vieron.",
    "La mayoría lo vio en la primera lectura.",
    "Visible desde la sala de espera.",
  ],
  dividido: [
    "Interobservador moderado: a leer la explicación.",
    "Opiniones divididas, como en la sesión de casos.",
    "Diagnóstico diferencial abierto en la sala.",
  ],
};

// La frase del proyector para un caso revelado. `datos` es lo que da datosRevelado (premios.js); `letra(opcion)`
// convierte una opción en la letra que se ve. Sin respuestas, no hay frase.
export function fraseRevelado(datos, indice, letra = () => "") {
  if (!datos || !datos.total) return "";
  // Con una sola respuesta no hay grupo del que hablar: solo se comenta si falló.
  if (datos.total === 1 && datos.aciertos === 1) return "";
  const pct = datos.aciertos / datos.total;
  let tipo;
  if (datos.aciertos === 0) tipo = "nadie";
  else if (datos.aciertos === datos.total && datos.total >= 2) tipo = "todos";
  else if (datos.solo) tipo = "solo";
  else if (datos.trampa) tipo = "trampa";
  else if (pct <= 0.3) tipo = "pocos";
  else if (pct >= 0.75) tipo = "muchos";
  else tipo = "dividido";
  const frase = elegir(FRASES[tipo], `${tipo}:${indice}`);
  return frase.replace("{letra}", datos.trampa ? letra(datos.trampa.opcion) : "");
}

// ------------------------------------------------------------------ mientras se espera, en el celular
export const ESPERAS = [
  "Ajustando la ventana…",
  "Midiendo en UH…",
  "Esperando al tecnólogo…",
  "Comparando con estudios previos…",
  "Buscando el estudio anterior en el PACS…",
  "Reconstruyendo en 3D…",
  "Pidiendo la creatinina…",
  "Dictando el informe…",
  "Esperando que cargue el PACS…",
  "Revisando el campo de visión completo…",
  "Llamando al médico tratante…",
  "Buscando el hallazgo incidental…",
];
export const SEGUNDOS_POR_ESPERA = 3;

// El mensaje que toca a los `segundos` de haber empezado el caso: cada caso empieza en un punto distinto de la lista.
export function mensajeEspera(indice, segundos) {
  const inicio = semilla(`espera:${indice}`) % ESPERAS.length;
  return ESPERAS[(inicio + Math.floor(Math.max(0, segundos) / SEGUNDOS_POR_ESPERA)) % ESPERAS.length];
}

// ------------------------------------------------------------------ equipos por color
// Los nombres de los equipos por color salen de la hora en que se creó la sala: todos los celulares y el proyector
// eligen los mismos, sin guardar nada más en la base. El id y el color del equipo no cambian.
export const NOMBRES_EQUIPO = [
  "Los Hipointensos", "Los Hiperintensos", "Gadolinio FC", "Los Artefactos", "Escuadrón Gantry", "Los Isodensos",
  "Brigada Tesla", "Los Vóxeles", "Club del Yodo", "Los Incidentalomas", "Los del PACS", "Ventana Pulmonar",
];

export function nombresEquipo(n, clave) {
  const lista = [...NOMBRES_EQUIPO];
  let s = semilla(`equipos:${clave}`);
  for (let i = lista.length - 1; i > 0; i--) {   // Fisher-Yates con un generador fijo
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [lista[i], lista[j]] = [lista[j], lista[i]];
  }
  return lista.slice(0, n);
}
