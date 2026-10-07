// RadQuiz — instrucciones para cualquier IA (ChatGPT, Gemini, Copilot, Claude, DeepSeek…) y lectura de su respuesta.
// No depende de ningún proveedor: el autor copia un texto, lo pega en su IA con el PDF y pega la respuesta de vuelta.
import {
  imagenesOrdenadas, casosOrdenados, lista, idImagen, normalizarClasificacion, normalizarDificultad, LICENCIAS, MODALIDADES,
} from "./validacion.js";
import { SEGMENTOS, CON_COPYRIGHT } from "./comun.js";
import { AREAS } from "./areas.js";

const ID_CASO = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const EJEMPLO = `{
  "imagenes": [
    {
      "figura": "Figura 2",
      "leyenda_original": "Copia aquí la leyenda tal cual aparece en el documento.",
      "modalidad": "RM",
      "paneles": [
        { "id": "A", "lado": "derecho", "plano": "sagital oblicuo", "secuencia": "", "condicion": "boca cerrada" }
      ],
      "marcas": [{ "marca": "flecha blanca", "panel": "A", "senala": "qué señala, según la leyenda" }]
    }
  ],
  "casos": [
    {
      "tema": "Grupo · Subtema",
      "clasificacion": [{ "segmento": "cabeza-cuello", "area": "atm" }],
      "tipo": "imagen",
      "enunciado": "ATM derecha, sagital oblicuo en boca cerrada (A). ¿Qué señala la flecha blanca?",
      "imagenes": [{ "figura": "Figura 2", "mostrar_en": "pregunta" }],
      "opciones": ["Opción A", "Opción B", "Opción C", "Opción D", "Opción E"],
      "correcta": 2,
      "explicacion": "- **Hallazgos:** en A, la flecha blanca señala …: es …\\n- No es … (el distractor más tentador) porque …\\n- La idea clave del documento.",
      "perla": "La enseñanza clave del caso, en una frase práctica sacada del documento.",
      "dificultad": { "nivel": 2, "motivo": "Diagnóstico típico (ETC I); el documento lo llama hallazgo clásico" },
      "evidencia": [{ "ubicacion": "p. 5, leyenda de la Figura 2", "cita": "Frase copiada textual del documento." }],
      "etiquetas": ["palabra clave"]
    }
  ]
}`;

// Las reglas de todos los casos. Las de la pregunta de imagen van aparte, en PREGUNTA_IMAGEN, porque son lo
// principal. Las siete primeras son las de las opciones: el prompt de corrección las repite.
const REGLAS = [
  "Usa SOLO el documento adjunto. Si algo no está ahí, no lo escribas, aunque sepas que es cierto.",
  "No inventes datos clínicos. La edad, el sexo o los síntomas van en la pregunta solo si la leyenda de esa figura, o la presentación clínica de ese caso en un libro o banco de casos, los dice.",
  "Cinco opciones, una sola correcta. Las cinco del mismo tipo (todas diagnósticos, o todas estructuras, o todas signos), del mismo largo y con el mismo nivel de detalle. La correcta no puede ser la más larga ni la más matizada.",
  "Los cuatro distractores son respuestas que un residente daría de verdad ante ESA imagen: los diagnósticos diferenciales de la misma familia que la correcta, la variante normal o el artefacto que la imitan, o el error de quien confunde una entidad con la de al lado. Escríbelos con el vocabulario del documento.",
  "Prohibido el distractor-comodín. En un cuestionario de patología degenerativa, un tumor, una infección, una fractura aguda o una anomalía congénita no son distractores: se descartan sin mirar la imagen. Nada absurdo, catastrófico ni de otro capítulo para rellenar.",
  "Los calificadores extremos (masivo, severo, completo, exacto, puro, siempre, nunca, solamente) delatan al distractor. Si los usas, que aparezcan también en la correcta; mejor, que no aparezcan en ninguna.",
  "Una palabra del enunciado que solo aparezca en la opción correcta es una pista, aunque cambie la terminación («migrado» y «migración»): úsala también en algún distractor o reescríbela.",
  "La explicación son 2 a 4 viñetas que empiezan con «- », con el vocabulario del documento y sin afirmar más que él. En un caso de imagen, la primera empieza con «**Hallazgos:**» y dice qué se ve y dónde (panel, marca) y cómo se llama: ahí va la descripción que no puede ir en el enunciado. Otra, por qué no es el distractor más tentador.",
  "Cada caso lleva «perla»: la enseñanza clave, en una frase práctica sacada del documento. El tablero por equipos la proyecta como «Clave para llevarse».",
  "Cada caso lleva «evidencia»: dónde está en el documento y la frase copiada textual que sostiene la respuesta.",
  "«tema» va como «Grupo · Subtema». El grupo es la columna del tablero por equipos y se ve antes de responder: nombra un área («Roturas meniscales»), nunca la respuesta. El subtema solo se ve después.",
  "Si una figura o tabla trae la respuesta escrita, va con \"mostrar_en\": \"respuesta\", nunca en la pregunta de ese caso.",
  "Copia cada leyenda tal cual está en el documento, en su idioma, sin traducirla ni resumirla.",
  "Texto simple: nada de HTML. Para resaltar usa **negrita**.",
  "«correcta» es la posición de la opción correcta contando desde 0: 0 es la primera opción y 4 la quinta. La app baraja las opciones al presentarlas: nada de «todas las anteriores», de opciones que se refieran a otras ni de preguntas en negativo («¿cuál NO…?»).",
];

// El número de casos lo manda el documento, no una cifra fija: un artículo con quince figuras da
// para mucho más que uno con tres, y quedarse corto es desaprovechar material bueno.
const POR_FIGURA = 2;
const MINIMO_CASOS = 10;

// Familias que suelen colarse como relleno: si una aparece siempre entre los distractores y nunca
// como respuesta, el residente aprende a tacharla y responde sin mirar la imagen. Se comparan por
// el principio de la palabra, sobre texto en minúsculas y sin tildes.
const COMODINES = {
  "tumor o metástasis": ["tumor", "neoplas", "metastas", "linfoma", "sarcoma", "mieloma", "malign"],
  "infección": ["infeccion", "infeccios", "absceso", "osteomielitis", "discitis", "purulent", "tuberculos", "septic"],
  "fractura aguda": ["fractura", "estallido"],
  "anomalía congénita": ["congenit", "malformacion", "agenesia", "disrafismo"],
};
const EXTREMOS = ["masiv", "sever", "complet", "exactament", "solament", "unicament", "siempre", "nunca",
  "absolut", "extrem", "gigant", "totalment", "imposible", "extensa", "extenso", "puro", "pura"];

// Lo principal de los dos prompts: cómo se escribe una pregunta de imagen, al estilo de los bancos de casos
// como RadPrimer (la figura primero, un enunciado corto y una pregunta directa). Sale de los cuestionarios
// de meniscos y tobillo (2026-09-20): en la mayoría de sus casos de imagen el enunciado copiaba de la leyenda la
// descripción del hallazgo —«un fragmento central migrado que simula la empuñadura de un cubo», y la respuesta
// era «asa de cubo»— y la imagen sobraba. La regla de no nombrar el diagnóstico no bastaba: la IA no
// tomaba la descripción por el diagnóstico. Los siete RadCases (2026-10-01) lo repitieron a escala —unos 670 de
// 852 enunciados de imagen con «la RM muestra…»—, copiando la sección de hallazgos de cada caso del libro, que no
// es una leyenda: de ahí la regla de los verbos y el destino de la descripción, la viñeta «Hallazgos».
const PREGUNTA_IMAGEN = `CÓMO SE ESCRIBE UNA PREGUNTA DE IMAGEN
Es de imagen si para responder hay que mirar la figura. El residente ve la figura entera, el enunciado y las
cinco opciones; la leyenda, solo después de responder.
- El enunciado dice dónde mirar, no qué hay. Lleva, en este orden: la historia clínica, solo si la leyenda la
  da; la técnica (modalidad, plano, secuencia, lado, condición, qué panel); la marca que hay que mirar, sin
  decir qué señala; y una sola pregunta directa que termina en «?». De una a tres frases cortas y menos de 250
  caracteres: en la sala hay 45 segundos para leer, mirar y responder.
- Lo que define la respuesta lo pone la imagen, nunca el enunciado: la forma («fragmento», «hendidura»,
  «banda»), el trayecto o adónde se movió («migrado a la escotadura», «paralela al LCP»), el signo, el
  diagnóstico y las palabras del título de la leyenda. Si la figura no tiene marca, di dónde mirar —«el cuerno
  posterior», «el foco hiperintenso de la faceta»— sin decir qué es.
- El enunciado no cuenta lo que muestra la imagen: nada de «la RM muestra…», «se observa…», «la TC revela…»,
  venga de donde venga la descripción —la leyenda, la sección de hallazgos de un caso («Findings», «Imaging
  findings»), el informe o el texto—. Esa descripción se ve al revelar: es la primera viñeta de la explicación,
  «**Hallazgos:** …». «Se muestra la RM» o «RM coronal STIR (A)» sí valen: dicen qué estudio es, no qué hay.
- En un libro o banco de casos (presentación, hallazgos, diagnóstico, diferencial), la presentación clínica
  puede ir en el enunciado; los hallazgos, el diagnóstico y el diferencial van solo en la explicación.
- Preguntas que funcionan: ¿Cuál es el diagnóstico más probable? · ¿Qué señala la flecha (el asterisco, el
  número 3)? · ¿Qué signo se ve en el panel B? · ¿Qué estructura está lesionada? · ¿Qué tipo o grado es,
  según la clasificación del documento? · Y un paso más con la misma imagen —qué hallazgo asociado buscar,
  qué implica, qué plano o secuencia lo muestra mejor—, si el documento lo dice y sin escribir en el
  enunciado lo que se ve.
- Una pregunta mira una sola cosa: un panel o una marca. Tres paneles con tres signos son tres preguntas, no
  una con «respectivamente».
- Las opciones nombran un hallazgo, una estructura, un signo o un diagnóstico, casi siempre en 1 a 8
  palabras: nada de frases largas ni de pares «X asociado a Y».
- Varias preguntas de la misma figura: cada una se responde sola y en cualquier orden —nada de «la misma
  figura» ni «el caso anterior»—, ninguna dice en su enunciado ni en sus opciones la respuesta de otra, y no
  hay dos con la misma respuesta.
- No son de imagen, aunque lleven figura: definiciones, cifras, frecuencias, criterios, protocolos, «qué
  característica define…». Van como "concepto", sin figura en la pregunta.`;

// La dificultad sale del contenido y de la bibliografía, nunca de cuántos aciertan (decisión del 2026-10-01): el
// residente no la ve y el tablero ordena con ella las filas. Los cuatro niveles se anclan al currículo europeo de
// la ESR (ETC: nivel I, años 1–3; nivel II, años 4–5; nivel III, subespecialidad). Las opciones tapadas son la
// regla del manual de redacción del NBME; el modo sin alternativas de la práctica y del tablero depende de ella.
export const DIFICULTAD = `DIFICULTAD DE CADA CASO
Cada caso lleva "dificultad": { "nivel": 1 a 4, "motivo": "…" }. El residente no la ve: ordena las filas del
tablero por equipos. Se juzga por el CONTENIDO del caso contrastado con la bibliografía —nunca por cuántos
aciertan—, con el currículo europeo de la ESR (ETC): nivel I = primeros tres años, nivel II = años 4 y 5,
nivel III = subespecialidad.
- 1 Básico (R1 · ETC I temprano): anatomía normal, técnica, signo o diagnóstico clásico que se reconoce de
  vista, entidad común con presentación típica.
- 2 Intermedio (R2 · ETC I): diagnóstico típico que exige integrar clínica e imagen, diferencial frecuente,
  complicación conocida de una entidad común.
- 3 Avanzado (R3 y egreso · ETC II): entidad poco frecuente, presentación atípica, diferencial fino entre
  parecidos, clasificación o estadificación que cambia el manejo, asociación sindrómica.
- 4 Subespecialidad (fellow · ETC III): entidad rara, signo sutil o de nicho, clasificación detallada propia
  de la subespecialidad, dato que solo trae la literatura especializada.
Mira cuatro cosas: qué tan frecuente es la entidad (lo que dice el documento: «classic», «common» bajan;
«rare», «atypical», «pitfall», «subtle» suben), qué pide el caso (reconocer, diagnosticar, diferenciar o
clasificar y decidir), qué tan sutil es el hallazgo y en qué nivel del currículo se enseña. Pesa más lo más
exigente. El "motivo", de 20 a 200 caracteres, dice qué decidió: «ETC II; entidad poco frecuente según el
documento». No lo pongas todo en un nivel: un cuestionario bien hecho tiene casos de varios.

OPCIONES TAPADAS
Tapa las cinco opciones: con el enunciado (y la figura) se tiene que poder decir la respuesta. Es la regla del
manual de redacción de preguntas del NBME, y RadQuiz tiene un modo sin alternativas que se apoya en ella:
«¿Cuál es el diagnóstico más probable?» sirve; «¿Cuál de las siguientes afirmaciones es correcta?» no. Si la
pregunta de verdad no se entiende sin ver la lista, agrega "requiere_opciones": true; en la duda, reescribe el
enunciado.`;

// La prueba de las opciones solas ya estaba; la de la imagen tapada es la que faltaba: es la que habría
// parado los enunciados de meniscos.
const PRUEBAS = `DOS PRUEBAS, en cada caso de imagen antes de darlo por bueno
a) Imagen tapada. Tapa la figura y lee el enunciado con las opciones. Si alguien que leyó el artículo ya
   sabe la respuesta, el enunciado la está describiendo: pasa la descripción a la viñeta «**Hallazgos:**» de
   la explicación. Cuenta también la historia: un antecedente que por sí solo da el diagnóstico sale del
   enunciado. Si aun así se responde sin mirar, no es de imagen: pásalo a "concepto" o pregunta otra cosa.
b) Opciones solas. Tapa también el enunciado y lee solo las cinco opciones. Si se ve cuál es la correcta
   —la única sensata, la única de su familia, la más larga o la más precisa—, reescribe los distractores.`;

// Errores de cuestionarios publicados, con su arreglo: un ejemplo concreto corrige mejor que una regla más.
// El primero es la Figura 17 de meniscos, que además tiene «HANDLE FRAGMENT» escrito en el panel c; el «así sí»
// es el panel d de la Figura 18, que no tiene rótulos (el c sí: «PCL»). El tercero es el caso 25 de RadCases MSK.
const ERRORES_REALES = `TRES ERRORES REALES (de cuestionarios publicados; no copies su contenido)
1. El enunciado describe el hallazgo y la figura lo trae escrito.
   «En la reconstrucción axial sensible a líquido (panel b) se evidencia una rotura que involucra un tercio
   del menisco, con un fragmento central migrado que simula la empuñadura de un cubo (flecha). ¿Qué tipo de
   rotura representa?»
   «Empuñadura de un cubo» ya es la respuesta (rotura en asa de cubo), y en otro panel de esa figura se lee
   «HANDLE FRAGMENT». Así sí, con un panel sin rótulos de otra figura del mismo artículo:
   «Rodilla, sagital DP (panel d). ¿Qué signo señalan las flechas?»
     Signo del doble cuerno anterior · Signo del doble LCP · Signo del corbatín ausente ·
     Signo del menisco fantasma · Signo de la hendidura en marcha
2. Los distractores son de otro capítulo.
   «En el panel B (axial STIR), ¿qué representa el hallazgo hiperintenso de la faceta?»
     Tumor neurogénico de la raíz · Edema de la médula espinal · Rotura del ligamento amarillo ·
     Grasa epidural hipertrofiada pura · LÍQUIDO ARTICULAR EN LA FACETA (la correcta)
   Las otras cuatro se tachan de memoria. Así sí, todas posibles ante esa imagen:
     Líquido articular · Quiste sinovial facetario · Edema óseo subcondral · Hipertrofia sinovial sin
     líquido · Grasa periarticular
3. El enunciado copia los hallazgos del caso del libro.
   «Una triatleta sufre una caída de bicicleta. La RM coronal de pelvis sensible a líquido muestra un espacio
   lleno de líquido en lugar del tendón proximal de los isquiotibiales en su origen en el isquion, con
   retracción distal del tendón y edema muscular alrededor. ¿Cuál es el diagnóstico?»
   Se responde sin mirar la figura. Así sí:
   «Una triatleta sufre una caída de bicicleta. RM coronal de pelvis, secuencia sensible a líquido. ¿Cuál es
   el diagnóstico?»
   y la descripción pasa a la explicación: «- **Hallazgos:** líquido en lugar del tendón proximal de los
   isquiotibiales en su origen isquiático, con retracción distal y edema muscular: avulsión proximal.»`;

// Una figura con la respuesta escrita en un panel no se ve leyendo la leyenda: hay que mirarla. El prompt
// del estudio la mira en el PDF; el del .zip, en los JPG que acaba de sacar (instruccionesPaquete).
const MIRAR_EN_PDF = `MIRA CADA FIGURA EN EL PDF ANTES DE ESCRIBIR
- Qué es cada panel (imagen, esquema, foto, tabla), qué marcas tiene y qué está escrito dentro de la figura.
- La figura sale entera en la pregunta. Si un panel o un rótulo («HANDLE FRAGMENT», «PCL», «Normal») delata la
  respuesta de un caso, ese caso no lleva la figura en la pregunta: pregunta otra cosa que la figura no
  delate, o pásalo a "concepto" con la figura en "respuesta".`;

// El mismo reparto para los dos prompts. Con las figuras ya cargadas se da la cifra exacta; en el
// del .zip todavía no se sabe cuántas saldrán del PDF, así que se da la regla. Se cuentan los casos de
// imagen: los de concepto no pueden tapar una figura sin preguntas.
function repartoCasos(nFiguras) {
  const cuantos = nFiguras
    ? `Tienes ${nFiguras} ${nFiguras === 1 ? "figura" : "figuras"}: escribe ${POR_FIGURA * nFiguras} casos de imagen o más, y unos ${MINIMO_CASOS} casos en total como mínimo.`
    : `Cuenta las figuras que conseguiste extraer: escribe al menos ${POR_FIGURA} casos de imagen por cada una, y unos ${MINIMO_CASOS} casos en total como mínimo.`;
  return `- ${cuantos}
- De cada figura salen al menos dos preguntas de imagen distintas: una de reconocimiento (qué hallazgo es,
  qué diagnóstico) y otra que vaya más allá con la misma imagen (el signo, el diferencial, el plano o la
  secuencia, qué implica). Una figura con varios paneles o varias marcas da tres o cuatro: una por panel o
  por marca.
- Una figura sin nada que mirar —una tabla, un esquema rotulado— no cuenta para eso: va en la respuesta del
  caso de concepto que responda, y de uno solo (al revelarlo se ve entera y respondería a los demás).
- Los casos de "concepto" (definiciones, indicaciones, criterios, cifras) van aparte y son como mucho 3 de
  cada 10: el cuestionario es de imagen.
- No hay máximo. Un documento con muchas figuras da para un cuestionario largo: aprovéchalo entero en vez
  de parar en una cifra redonda.
- Ninguna figura puede quedarse sin pregunta.
- Nada de relleno: dos preguntas que piden lo mismo con otras palabras cuentan como una, y dos de la misma
  figura con la misma respuesta, también. Si un documento corto no da para ${MINIMO_CASOS} casos sin relleno,
  entrega menos y dilo.`;
}

function listaFiguras(tema) {
  const imagenes = imagenesOrdenadas(tema);
  if (!imagenes.length) return "No hay figuras cargadas: escribe solo casos de tipo «concepto», sin imágenes.";
  return imagenes.map((i) => `- "${i.figura}"${i.leyenda_original ? ` (leyenda ya cargada)` : ""}`).join("\n");
}

// Sale de areas.js: un área nueva aparece sola en los prompts.
function listaAreas() {
  return Object.keys(SEGMENTOS).map((s) => {
    const areas = Object.entries(AREAS[s] || {});
    if (!areas.length) return `${s} — ${SEGMENTOS[s]} (sin áreas: va sin "area")`;
    return `${s} — ${SEGMENTOS[s]}\n${areas.map(([id, nombre]) => `    ${id}: ${nombre}`).join("\n")}`;
  }).join("\n");
}

// El mismo bloque para los tres prompts. «segmento» es el del tema cuando ya se sabe; en el del .zip lo
// elige la IA.
function reglasClasificacion(segmento) {
  const principal = segmento
    ? `Este cuestionario es de ${SEGMENTOS[segmento] || segmento}: casi todos sus casos llevan primero una pareja con "segmento": "${segmento}".`
    : `La primera pareja de casi todos los casos es la del "segmento" del paquete.`;
  return `- Cada caso lleva "clasificacion": una o más parejas { "segmento", "area" }. La primera es la principal.
- Usa solo los segmentos y las áreas de la lista de abajo, escritos como su id (lo que va antes de los dos puntos).
- ${principal}
- Si el caso pertenece a más de un segmento, agrega una pareja por cada uno. Por ejemplo: displasia del
  desarrollo de la cadera → musculoesqueletico/cadera-pelvis y pediatria/musculoesqueletico; biopsia hepática guiada por TC →
  abdomen/higado e intervencionismo; artefacto del ángulo mágico en una RM de rodilla →
  musculoesqueletico/rodilla y fisica-tecnica.
- "pediatria" solo si la entidad es propia de la infancia (malformaciones del desarrollo, tumores pediátricos,
  maltrato, neonatología…). La edad sola no basta: un linfoma o un Chiari I en un adolescente no son pediatría.
  "intervencionismo", si la pregunta trata de un procedimiento guiado por imagen. "fisica-tecnica",
  si trata de la técnica, la secuencia, un artefacto, la dosis o el contraste.
- Columna: la médula, el canal y las raíces van a neurorradiologia/columna; el hueso, las fracturas y las
  articulaciones, a musculoesqueletico/columna. Si toca las dos cosas, las dos parejas.
- Si ninguna área encaja, usa "miscelaneas" de ese segmento: no fuerces un área que no corresponde. Los segmentos
  sin áreas (mama, intervencionismo) van siempre sin "area".

${listaAreas()}`;
}

export function instruccionesIA(tema) {
  const meta = tema.meta || {};
  const fuente = tema.fuente || {};
  const figuras = imagenesOrdenadas(tema);
  const conFiguras = figuras.length > 0;
  const faltanLeyendas = figuras.some((i) => !i.leyenda_original);
  return `Eres un radiólogo docente que prepara preguntas de opción múltiple para residentes de radiología, a partir del documento que te adjunto.${conFiguras ? ` Las de imagen siguen el formato de los bancos de casos tipo RadPrimer: la figura es la pregunta. De RadPrimer tomas solo el formato; el contenido sale únicamente del documento.` : ""}

TEMA: ${meta.titulo || "(sin título)"} — segmento ${meta.segmento || "(sin segmento)"}.
FUENTE: ${fuente.cita || "(la del documento adjunto)"}

FIGURAS DISPONIBLES (usa exactamente estos nombres en "figura"):
${listaFiguras(tema)}

${conFiguras ? `${MIRAR_EN_PDF}

${PREGUNTA_IMAGEN}

${PRUEBAS}

${ERRORES_REALES}

` : ""}REGLAS DE TODOS LOS CASOS
${REGLAS.map((r, i) => `${i + 1}. ${r}`).join("\n")}

CUÁNTOS CASOS
${conFiguras ? repartoCasos(figuras.length) : `- Unos ${MINIMO_CASOS} casos, sin relleno: dos preguntas que piden lo mismo con otras palabras cuentan como una.`}

CLASIFICACIÓN DE CADA CASO
${reglasClasificacion(meta.segmento)}

${DIFICULTAD}

QUÉ TIENES QUE DEVOLVER
- ${faltanLeyendas ? 'La lista "imagenes": la ficha de cada figura de arriba, con su leyenda textual, los paneles (A, B…) y qué señala cada flecha, círculo o número.' : 'La lista "imagenes" puede ir vacía: las leyendas ya están cargadas.'}
- La lista "casos": ${conFiguras ? 'los que salgan de la cuenta de arriba, con al menos 70 % de tipo "imagen"' : 'todos de tipo "concepto", sin figuras'}.
- Si no te caben todos en una sola respuesta, termina en un caso completo, cierra bien el JSON y agrega
  "faltan": true. Después te pediré el resto.
- Responde SOLO con un JSON válido, sin texto antes ni después, sin explicaciones y sin bloques de código.

FORMATO EXACTO DE LA RESPUESTA
${EJEMPLO}`;
}

// Para una IA que además de escribir puede ejecutar código (ChatGPT con análisis de datos, Claude
// con su herramienta de análisis, Gemini con ejecución): que devuelva el cuestionario entero —texto
// e imágenes— en un solo .zip, con la misma forma que una carpeta de temas/ en el repositorio.
//
// Va en el orden en que se trabaja —sacar las figuras, mirarlas, escribir, empaquetar, comprobar— y lo largo
// es lo que importa: las preguntas de imagen (pasos 2 y 3). El formato del .zip es mecánico y lo repite el
// comprobador en Python que la IA tiene que correr antes de entregar, porque ahí es donde se equivocan: el .zip
// llega bien formado o no llega, y un aviso del estudio a toro pasado no sirve de nada. Sus ✗ bloquean; sus ⚠
// son señales de una pregunta mal hecha que no se pueden afirmar sin leerla (un enunciado que describe lo que
// se ve, uno largo), y la IA las revisa con las dos pruebas.
export function instruccionesPaquete() {
  const segmentos = Object.keys(SEGMENTOS).join(" · ");
  const modalidades = MODALIDADES.join(" · ");
  const licencias = LICENCIAS.map((l) => l.valor).join(" · ");
  const nd = LICENCIAS.filter((l) => l.nd).map((l) => l.valor).join(" y ");
  return `Eres un radiólogo docente que escribe preguntas de imagen para residentes de radiología, en el formato
de los bancos de casos tipo RadPrimer: la figura es la pregunta. De RadPrimer tomas solo el formato; el
contenido sale únicamente del documento de acceso abierto que te adjunto. Con él vas a armar un cuestionario
de opción múltiple y devolvérmelo en UN SOLO archivo .zip.

Lo que más importa son las preguntas de imagen (pasos 2 y 3). El formato del .zip es mecánico y lo revisa el
comprobador del paso 7.

Necesito que ejecutes código: hay que sacar las figuras del PDF, mirarlas y comprobar el resultado antes de
entregarlo. Si no puedes ejecutar código, dímelo ahora y lo hacemos de otra manera.

──────────────────────────────── 1. SACA LAS FIGURAS
- Con PyMuPDF (fitz): localiza el rectángulo que contiene la figura ENTERA —todos sus paneles, sin el texto
  de la leyenda— y renderiza esa zona:
      pagina.get_pixmap(clip=rect, dpi=200).save(...)
  Luego a JPG, lado mayor 1600 px como máximo y por debajo de 250 KB. Sin metadatos EXIF.
- Comprueba cada recorte: pagina.get_text("text", clip=rect) no puede traer frases de la leyenda ni de otra
  figura —si las trae, el rectángulo es demasiado grande—, y tienen que estar todos los paneles que nombra
  la leyenda.
- NO uses page.get_images() ni extract_image() para sacar los objetos incrustados uno a uno. Una figura de
  varios paneles suele estar guardada como varias imágenes sueltas, y entregarlas por separado es partir la
  figura.
- Las licencias sin derivadas (${nd}) solo permiten redimensionar y comprimir:
  nada de recortar, partir ni anotar.
- Un archivo por FIGURA, no por panel. El nombre va en minúsculas, termina en .jpg (ni .jpeg ni .png) y sale
  del id de la figura: "Figura 2" → img/fig02.jpg · "Figura 3B" → img/fig03b.jpg · "Tabla 1" → img/tabla1.jpg.
- Si no consigues extraer alguna figura, déjala fuera del .zip y dímelo: se sube luego a mano.

──────────────────────────────── 2. MIRA CADA FIGURA ANTES DE ESCRIBIR
Abre cada JPG a tamaño completo (o la página del PDF) y anota para ti, figura por figura:
- Los paneles como vienen rotulados (A, B… o a, b…) y qué es cada uno: imagen (RM, TC, Rx, US…), esquema o
  dibujo, foto (artroscopia, cirugía, patología), tabla o gráfico.
- Las marcas que se ven —flecha blanca o negra, punta de flecha, asterisco, círculo, número— y en qué panel.
  Van todas en "marcas", con lo que señala cada una según la leyenda.
- Lo que está escrito dentro de la figura: nombres de estructuras, diagnósticos, títulos. «HANDLE FRAGMENT»,
  «PCL» o «Normal» son la respuesta escrita. pagina.get_text("text", clip=rect) da el texto que el PDF guarda
  como texto; el que forma parte de la imagen solo se ve mirándola.
- Qué hallazgo se ve en cada panel y con qué marca: eso es lo que se puede preguntar.
La figura sale entera —las licencias no dejan recortarla— y el residente ve todos sus paneles a la vez. Si un
panel (un esquema, una foto rotulada, un rótulo) delata la respuesta de un caso, ese caso no lleva la figura
en la pregunta: pregunta otra cosa que la figura no delate, o pásalo a "concepto" con la figura en
"respuesta".
Si tu entorno no te deja ver imágenes, dilo antes de empezar, escribe las preguntas con lo que dice la leyenda
de cada panel y de cada marca, y pon en "notas" de cada figura: «No vi la figura: paneles y marcas según la
leyenda».

──────────────────────────────── 3. LAS PREGUNTAS DE IMAGEN
${PREGUNTA_IMAGEN}

${PRUEBAS}

${ERRORES_REALES}

──────────────────────────────── 4. CUÁNTAS PREGUNTAS
${repartoCasos(0)}

──────────────────────────────── 5. REGLAS DE TODOS LOS CASOS
${REGLAS.map((r, i) => `${i + 1}. ${r}`).join("\n")}
${REGLAS.length + 1}. Escribe los casos en español aunque el documento esté en otro idioma. Las leyendas, no:
    esas van copiadas tal cual, en el idioma original.

CLASIFICACIÓN DE CADA CASO
${reglasClasificacion("")}

${DIFICULTAD}

──────────────────────────────── 6. EL .ZIP
Exactamente estos nombres, SIN una carpeta por encima:

    paquete.json
    fuentes.json
    img/fig02.jpg
    img/fig03.jpg   … una por figura usada

paquete.json. Lo que va detrás de // son notas para ti: JSON no admite comentarios, así que no los copies.
{
  "id": "minusculas-con-guiones",            // descriptivo + primer autor + año: "atm-rm-lopezramirez2024"
  "titulo": "Título del cuestionario",
  "descripcion": "Una línea (opcional)",
  "segmento": "uno de: ${segmentos}",
  "modalidades": ["RM"],                     // una o más de: ${modalidades}
  "idioma": "es",
  "version": "0.1.0",
  "imagenes": {
    "fig02": {                               // la clave es el id: minúsculas, números y guiones
      "archivo": "fig02.jpg",
      "fuente": "lopezramirez2024",          // la clave que uses en fuentes.json
      "figura": "Figura 2",                  // como la nombra el documento
      "leyenda_original": "La leyenda copiada tal cual, sin traducir ni resumir.",
      "modalidad": "RM",                     // o null si la leyenda no lo dice
      "paneles": [
        { "id": "A", "lado": "derecho", "plano": "sagital oblicuo", "secuencia": "DP", "condicion": "boca cerrada" }
      ],                                     // "lado": derecho · izquierdo · bilateral · null
      "marcas": [                            // todas las que se ven; [] si no tiene ninguna
        { "marca": "flecha blanca", "panel": "A", "senala": "qué señala, según la leyenda" }
      ],
      "modificaciones": ["redimensionada", "comprimida"],
      "notas": "…"                           // solo si hace falta: lo que ves y la leyenda no dice, o «No vi la figura»
    }
  },
  "casos": [
    {
      "id": "caso-01",
      "tema": "Grupo · Subtema",              // el grupo es la columna del tablero y se ve antes de responder: un área, nunca la respuesta
      "clasificacion": [{ "segmento": "cabeza-cuello", "area": "atm" }],   // paso 5: la primera, la principal
      "etiquetas": ["palabra clave"],
      "tipo": "imagen",                      // "imagen" o "concepto"
      "enunciado": "ATM derecha, sagital oblicuo DP en boca cerrada (A). ¿Qué señala la flecha blanca?",
                                             // dónde mirar, no qué hay (paso 3)
      "imagenes": [{ "ref": "fig02", "mostrar_en": "pregunta" }],   // "pregunta" o "respuesta"
      "opciones": ["Primera opción", "Segunda opción", "Tercera opción", "Cuarta opción", "Quinta opción"],
      "correcta": 2,                         // posición desde 0: aquí, "Tercera opción". 0 la primera, 4 la quinta
      "explicacion": "- **Hallazgos:** en A, la flecha blanca señala …: es …\\n- No es … (el distractor más tentador) porque …\\n- La idea clave del documento.",
      "perla": "La enseñanza clave del caso, en una frase práctica sacada del documento.",
      "dificultad": { "nivel": 2, "motivo": "Diagnóstico típico (ETC I); el documento lo llama clásico" },   // paso 5
                                             // "requiere_opciones": true, solo si no se contesta con las opciones tapadas
      "evidencia": [
        { "ubicacion": "p. 5, leyenda de la Figura 2", "cita": "Frase copiada textual, 10 caracteres como mínimo." }
      ]
    }
  ]
}

Los campos que no aparecen arriba no van: el catálogo no admite claves de más. Todo "ref" de un caso tiene
que existir como clave de "imagenes"; si la figura no está, el caso no la cita.

fuentes.json. Una sola fuente; la clave, apellido del primer autor + año, en minúsculas.
{
  "lopezramirez2024": {
    "tipo": "articulo",                      // articulo · caso · libro · banco
    "cita": "Cita Vancouver completa, con volumen, páginas y doi:",
    "credito": "López-Ramírez M, et al. Austral J Imaging. 2024",   // corto, va bajo cada imagen
    "doi": "10.24875/AJI.23000069",          // sin https://doi.org/ delante; null si la fuente no tiene DOI
    "url": "https://doi.org/10.24875/AJI.23000069",
    "titular": "© 2024 Sociedad …",          // copiado del «©» del documento
    "licencia": "una de: ${licencias}",
    "verificacion": { "donde": "p. 136: «frase del documento donde dice la licencia»" }
  }
}

La licencia se copia EXACTA de esa lista: el estudio saca de ahí la URL y si permite o no modificar la
figura. Una licencia Creative Commons solo vale si el documento la dice con todas sus letras. Si no la dice
—solo «©», «All rights reserved», «for personal use only» o nada—, pon "${CON_COPYRIGHT}" y copia en "donde"
esa frase tal cual. Nunca pongas una licencia CC que el documento no diga, ni para que pase el comprobador:
quien publica responde por lo que declara.

──────────────────────────────── 7. COMPRUÉBALO ANTES DE DÁRMELO
Corre esto sobre tu .zip y arregla cada ✗. No me lo entregues hasta que imprima «todo bien». Los ⚠ no
bloquean: son señales de una pregunta mal hecha; revisa esos casos con las dos pruebas del paso 3 y corrige lo
que haga falta.

import io, json, re, unicodedata, zipfile
from PIL import Image

RUTA = "cuestionario.zip"
SEG = "${Object.keys(SEGMENTOS).join(" ")}".split()
AREAS = ${JSON.stringify(Object.fromEntries(Object.keys(SEGMENTOS).map((s) => [s, Object.keys(AREAS[s] || {})])))}
MOD = ${JSON.stringify(MODALIDADES)}
ND  = ${JSON.stringify(LICENCIAS.filter((l) => l.nd).map((l) => l.valor))}
LIC = ${JSON.stringify(LICENCIAS.map((l) => l.valor))}
POR_FIGURA, MINIMO = ${POR_FIGURA}, ${MINIMO_CASOS}

z = zipfile.ZipFile(RUTA)
hay = {n for n in z.namelist() if not n.endswith("/")}   # las carpetas no cuentan
malo, ojo = [], []
def mal(m): malo.append(m)        # ✗ así no se entrega
def revisa(m): ojo.append(m)      # ⚠ míralo con las dos pruebas del paso 3

for n in ("paquete.json", "fuentes.json"):
    if n not in hay: mal("falta " + n)
if malo: raise SystemExit("\\n".join(malo))

p = json.loads(z.read("paquete.json"))
f = json.loads(z.read("fuentes.json"))
clave = [k for k in f if k != "$schema"]
if len(clave) != 1: mal("fuentes.json debe tener una sola fuente")
src = f[clave[0]] if clave else {}

if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", p.get("id", "")): mal("id del paquete inválido")
if p.get("segmento") not in SEG: mal("segmento inválido: %r" % p.get("segmento"))
if p.get("idioma") != "es": mal("idioma debe ser es")
if not re.fullmatch(r"\\d+\\.\\d+\\.\\d+", str(p.get("version", ""))): mal("version debe ser como 0.1.0")
if not p.get("modalidades"): mal("faltan modalidades")
for m in p.get("modalidades") or []:
    if m not in MOD: mal("modalidad inválida: %r" % m)
for campo in ("tipo", "cita", "url", "titular", "licencia"):
    if not src.get(campo): mal("falta fuentes.json → " + campo)
if src.get("licencia") not in LIC: mal("licencia inválida: %r" % src.get("licencia"))
if len(src.get("cita", "")) < 20: mal("la cita es demasiado corta")
if src.get("doi") and not re.fullmatch(r"10\\.\\d{4,9}/\\S+", str(src["doi"])):
    mal("el DOI no es válido: tiene que empezar por 10. (sin https://doi.org/ delante)")
if not src.get("doi") and src.get("tipo") == "articulo":
    revisa("artículo sin DOI: confírmalo en el documento o en Crossref; si de verdad no tiene, déjalo en null")
if len((src.get("verificacion") or {}).get("donde", "")) < 3:
    mal("falta la frase del documento donde dice la licencia")

IMGS = p.get("imagenes") or {}
for iid, img in IMGS.items():
    if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", iid): mal("id de imagen inválido: %r" % iid)
    arch = img.get("archivo", "")
    if not re.fullmatch(r"[a-z0-9]+([-_][a-z0-9]+)*\\.jpg", arch): mal("nombre inválido: %r" % arch)
    if not img.get("figura"): mal(iid + ": falta figura")
    if not img.get("leyenda_original"): mal(iid + ": falta leyenda_original")
    if img.get("fuente") != (clave[0] if clave else None): mal(iid + ": fuente no coincide")
    if not img.get("paneles"): mal(iid + ": paneles no puede estar vacío")
    if src.get("licencia") in ND and set(img.get("modificaciones") or []) - {"redimensionada", "comprimida"}:
        mal(iid + ": esa licencia no permite recortar, partir ni anotar la figura")
    ruta = "img/" + arch
    if ruta not in hay:
        mal("falta " + ruta); continue
    datos = z.read(ruta)
    if len(datos) > 250 * 1024: mal("%s pesa %d KB, máximo 250" % (arch, len(datos) // 1024))
    im = Image.open(io.BytesIO(datos))
    if im.format != "JPEG": mal(arch + " no es JPEG")
    if max(im.size) > 1600: mal("%s mide %dx%d, lado mayor máximo 1600" % (arch, *im.size))

def limpia(t):
    t = unicodedata.normalize("NFD", str(t).lower())
    return "".join(ch for ch in t if unicodedata.category(ch) != "Mn")
def palabras(t): return re.findall(r"[a-z]+", limpia(t))

# Lo que un enunciado puede decir sin delatar nada: la técnica y las marcas. Se quita antes de buscar pistas.
TECNICA = re.compile(r"\\b(con )?(supresion|saturacion) (de )?(la )?grasa\\b|\\bsensibles? a(l)? liquido\\b|\\bdensidad (protonica|de protones)\\b")
MARCAS = re.compile(r"\\b((puntas?|cabezas?) de flechas?|flechas?|asteriscos?|circulos?|estrellas?|numeros?)"
                    r"( (blanc|negr|roj|amarill|curv|ondulad|discontinu|puntead|continu|fin|grues|abiert|cerrad)(a|o)s?)*\\b")
def sin_marcas(t): return MARCAS.sub(" ", TECNICA.sub(" ", limpia(t)))

# Paneles y marcas que nombra el enunciado: tienen que estar en la ficha de la figura que se ve.
TIPO_MARCA = {"flecha": ["flech"], "punta de flecha": ["punta", "cabeza"], "asterisco": ["asteris"],
              "círculo": ["circul"], "estrella": ["estrell"], "número": ["numer"] + list("0123456789")}
def marcas_de(texto):
    t = limpia(texto)
    vistas = {m for m, rx in (("punta de flecha", r"\\b(punta|cabeza)s? de flecha"), ("asterisco", r"\\basteriscos?\\b"),
              ("círculo", r"\\bcirculos?\\b"), ("estrella", r"\\bestrellas?\\b"), ("número", r"\\bnumeros?\\b")) if re.search(rx, t)}
    if re.search(r"\\bflechas?\\b", re.sub(r"\\b(punta|cabeza)s? de flechas?", " ", t)): vistas.add("flecha")
    return vistas
def paneles_de(texto):
    letras = set(re.findall(r"\\(([A-Ha-h])(?=[),\\s])", texto))
    for m in re.finditer(r"\\bpanel(?:es)?\\s+([A-Ha-h])\\b((?:\\s*(?:,|\\by\\b|\\be\\b)\\s*[A-Ha-h]\\b)*)", texto):
        letras |= {m.group(1)} | set(re.findall(r"(?:,|\\by\\b|\\be\\b)\\s*([A-Ha-h])\\b", m.group(2)))
    return {l.upper() for l in letras}

vistos = set()
CASOS = p.get("casos") or []
if not CASOS: mal("no hay casos")
for c in CASOS:
    cid = c.get("id", "?")
    if cid in vistos: mal("id de caso repetido: " + cid)
    vistos.add(cid)
    if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", cid): mal("id de caso inválido: %r" % cid)
    if not c.get("tema"): mal(cid + ": falta tema")
    enun = str(c.get("enunciado") or "")
    if not enun: mal(cid + ": falta enunciado")
    elif not enun.rstrip().endswith("?"): mal(cid + ": el enunciado tiene que terminar en una pregunta con «?»")
    if re.search(r"\\bNO\\b|\\bEXCEPTO\\b", enun) or re.search(r"\\b(excepto|salvo|incorrecta|falsa)\\b", limpia(enun)):
        mal(cid + ": pregunta en negativo; pregunta por lo que sí es")
    if c.get("tipo") not in ("imagen", "concepto"): mal(cid + ": tipo inválido")
    op = c.get("opciones") or []
    if len(op) != 5: mal("%s: tiene %d opciones, deben ser 5" % (cid, len(op)))
    if any(not str(o).strip() for o in op): mal(cid + ": hay una opción vacía")
    if len({str(o).strip().lower() for o in op}) != len(op): mal(cid + ": hay opciones repetidas")
    if any(re.search(r"\\b(todas|ninguna)( de)? las (opciones )?anteriores\\b|^[a-e] y [a-e]\\b", limpia(o)) for o in op):
        mal(cid + ": nada de «todas/ninguna de las anteriores» ni opciones que nombran a otras: la app las baraja")
    if not isinstance(c.get("correcta"), int) or not 0 <= c["correcta"] < len(op):
        mal(cid + ": correcta fuera de rango")
    elif len(op) > 1 and len(str(op[c["correcta"]])) >= 1.3 * max(len(str(o)) for i, o in enumerate(op) if i != c["correcta"]):
        mal(cid + ": la correcta es mucho más larga que las demás; iguala los largos")
    if not c.get("explicacion"): mal(cid + ": falta explicacion")
    if not c.get("perla"): mal(cid + ": falta perla")
    ev = c.get("evidencia") or []
    if not ev or any(len(e.get("cita", "")) < 10 or not e.get("ubicacion") for e in ev):
        mal(cid + ": falta evidencia con ubicación y frase textual")
    refs = c.get("imagenes") or []
    for r in refs:
        if r.get("ref") not in IMGS: mal("%s: usa una imagen que no existe: %r" % (cid, r.get("ref")))
        if r.get("mostrar_en") not in ("pregunta", "respuesta"): mal(cid + ": mostrar_en inválido")
    en_pregunta = [IMGS[r["ref"]] for r in refs if r.get("mostrar_en") == "pregunta" and r.get("ref") in IMGS]
    if c.get("tipo") == "imagen" and not en_pregunta:
        mal(cid + ": es de tipo imagen pero no muestra ninguna en la pregunta")
    if c.get("tipo") == "concepto" and en_pregunta:
        mal(cid + ": es de concepto y muestra una figura en la pregunta: si hay que mirarla es de imagen; si no, va en la respuesta")
    if en_pregunta:
        ids = {str(x.get("id", "")).strip().upper() for g in en_pregunta for x in (g.get("paneles") or [])}
        faltan = sorted(paneles_de(enun) - ids)
        if faltan:
            mal("%s: el enunciado nombra el panel %s y la figura no lo tiene (paneles: %s)"
                % (cid, ", ".join(faltan), ", ".join(sorted(ids)) or "ninguno"))
        tipos = " ".join(limpia(m.get("marca", "")) for g in en_pregunta for m in (g.get("marcas") or []))
        for m in sorted(marcas_de(enun)):
            if not any(r in tipos for r in TIPO_MARCA[m]):
                mal("%s: el enunciado nombra «%s» y la figura no tiene esa marca en «marcas»: "
                    "añádela con lo que señala según la leyenda, o quítala del enunciado" % (cid, m))
    cl = c.get("clasificacion")
    if not isinstance(cl, list) or not cl:
        mal(cid + ": falta clasificacion, con una pareja segmento → área o más")
    for par in cl if isinstance(cl, list) else []:
        par = par if isinstance(par, dict) else {}
        s, a = par.get("segmento"), par.get("area")
        if s not in AREAS: mal("%s: segmento inválido en clasificacion: %r" % (cid, s))
        elif a is not None and a not in AREAS[s]: mal("%s: %r no es un área de %s (usa una de la lista o ninguna)" % (cid, a, s))
    d = c.get("dificultad")
    if not isinstance(d, dict) or d.get("nivel") not in (1, 2, 3, 4):
        mal(cid + ": falta dificultad, con un nivel del 1 al 4 (paso 5)")
    elif not 20 <= len(str(d.get("motivo") or "")) <= 200:
        mal(cid + ": el motivo de la dificultad tiene que tener entre 20 y 200 caracteres")
    if "requiere_opciones" in c and not isinstance(c["requiere_opciones"], bool):
        mal(cid + ": requiere_opciones es true o no va")

niveles = [c["dificultad"]["nivel"] for c in CASOS if isinstance(c.get("dificultad"), dict) and c["dificultad"].get("nivel") in (1, 2, 3, 4)]
if len(niveles) >= 10 and max(niveles.count(n) for n in set(niveles)) > 0.7 * len(niveles):
    revisa("más del 70 %% de los casos tienen la misma dificultad (%s): revisa que el nivel discrimine"
           % " · ".join("%d: %d" % (n, niveles.count(n)) for n in sorted(set(niveles))))

# Cuántos: el cuestionario es de imagen.
de_imagen = [c for c in CASOS if c.get("tipo") == "imagen"]
usadas = {r.get("ref") for c in CASOS for r in (c.get("imagenes") or [])}
for iid in IMGS:
    if iid not in usadas: mal(iid + ": ninguna pregunta usa esta figura; escríbele una o quítala del catálogo")
con_pregunta = {r.get("ref") for c in de_imagen for r in (c.get("imagenes") or []) if r.get("mostrar_en") == "pregunta"}
if len(de_imagen) < POR_FIGURA * len(con_pregunta):
    mal("%d casos de imagen para %d figuras: son pocos, el mínimo son %d (%d por figura)"
        % (len(de_imagen), len(con_pregunta), POR_FIGURA * len(con_pregunta), POR_FIGURA))
if IMGS and CASOS and len(de_imagen) < 0.7 * len(CASOS):
    mal("solo %d de %d casos son de imagen: tienen que ser al menos el 70 %%" % (len(de_imagen), len(CASOS)))
if CASOS and len(CASOS) < MINIMO:
    revisa("%d casos en total: si el documento da para más sin relleno, escríbelos; si no, dilo en la entrega" % len(CASOS))

# Varias preguntas de una figura: ninguna con la respuesta de otra, y una figura que delata no se reparte.
validos = [c for c in CASOS
           if isinstance(c.get("correcta"), int) and 2 <= len(c.get("opciones") or []) > c["correcta"] >= 0]
por_figura, en_respuesta = {}, {}
for c in validos:
    respuesta = " ".join(palabras(c["opciones"][c["correcta"]]))
    for r in c.get("imagenes") or []:
        if r.get("mostrar_en") == "pregunta" and c.get("tipo") == "imagen":
            por_figura.setdefault(r.get("ref"), []).append((c.get("id", "?"), respuesta))
        if r.get("mostrar_en") == "respuesta":
            en_respuesta.setdefault(r.get("ref"), []).append(c.get("id", "?"))
for iid, lista in por_figura.items():
    for i, (a, ra) in enumerate(lista):
        for b, rb in lista[i + 1:]:
            if ra == rb or (min(len(ra), len(rb)) >= 8 and (ra in rb or rb in ra)):
                mal("%s y %s: misma figura (%s) y misma respuesta; una de las dos tiene que preguntar otra cosa" % (a, b, iid))
for iid, ids in en_respuesta.items():
    if len(ids) > 1:
        revisa("%s sale en la respuesta de %s: al revelar uno se ve la respuesta de los demás" % (iid, ", ".join(ids)))

# ¿Se adivina la correcta sin mirar la imagen?
COMODIN = ${JSON.stringify(COMODINES)}
EXTREMO = ${JSON.stringify(EXTREMOS)}
VACIAS = {w[:5] for w in """panel paneles imagen figura secuencia muestra observa aprecia identifica corresponde
siguiente cuales segun sagital axial coronal oblicuo paciente estudio senala presenta aparece derecho izquierdo
ponderada potenciada reconstruccion corte hallazgo diagnostico probable estructura""".split()}
DESCRIBE = ["hiperintens", "hipointens", "hiperdens", "hipodens", "hiperecog", "hipoecog", "anecog", "realce", "realza",
            "coleccion", "fragment", "hendidura", "banda", "engros", "adelgaz", "edema", "liquido", "quist", "irregular",
            "interrump", "disrup", "discontinu", "migrad", "desplazad", "ausencia", "ausente", "amorf", "linea", "trazo",
            "defecto", "retrai", "retracc"]
# «La RM muestra…», «se observa…» antes de la pregunta: cuenta lo que hay. «Se muestra la RM» y «la lesión que se ve» no.
CUENTA = re.compile(r"(?<!\\bse )\\b(muestran?|demuestran?|revelan?|evidencian?|exhiben?)\\b"
                    r"|(?<!\\bque )\\bse (observan?|aprecian?|identifican?|evidencian?|visualizan?|ven?|detectan?)\\b|\\bcon (hallazgos?|signos?) de\\b")

def tiene(t, raices): return any(w.startswith(r) for w in palabras(t) for r in raices)
def raices(t):
    """Primeras 5 letras de cada palabra de 5 o más: «fragmentos» y «fragmento» son la misma pista."""
    return {w[:5]: w for w in palabras(t) if len(w) >= 5 and w[:5] not in VACIAS}

mas_larga = []
for c in validos:
    op, k, cid = c["opciones"], c["correcta"], c.get("id", "?")
    otras = [o for i, o in enumerate(op) if i != k]
    if len(str(op[k])) > max(len(str(o)) for o in otras): mas_larga.append(cid)
    if sum(1 for o in otras if tiene(o, EXTREMO)) >= 2 and not tiene(op[k], EXTREMO):
        mal(cid + ": los calificadores extremos están solo en los distractores; se tachan sin mirar la imagen")
    enun = raices(sin_marcas(c.get("enunciado", "")))
    pista = (enun.keys() & raices(op[k]).keys()) - set().union(*[raices(o).keys() for o in otras])
    if pista:
        mal("%s: «%s» está en la pregunta y solo en la respuesta correcta; úsala también en un distractor o cámbiala"
            % (cid, ", ".join(sorted(enun[r] for r in pista))))
    if c.get("tipo") != "imagen": continue
    cuenta = CUENTA.search(limpia(c.get("enunciado", "")).split("¿")[0])
    if cuenta:
        mal("%s: el enunciado cuenta lo que muestra la imagen («%s…»): esa descripción va en la explicación, «**Hallazgos:** …»"
            % (cid, cuenta.group(0)))
    describe =sorted({d for d in DESCRIBE if re.search(r"\\b" + d, sin_marcas(c.get("enunciado", "")))})
    if describe:
        revisa("%s: el enunciado describe lo que se ve (%s): que no sea lo que define la respuesta" % (cid, ", ".join(describe)))
    if len(c.get("enunciado", "")) > 250:
        revisa("%s: enunciado de %d caracteres; en la sala hay 45 s para leer, mirar y responder" % (cid, len(c["enunciado"])))
    if max(len(str(o)) for o in op) > 90:
        revisa(cid + ": opciones largas; en una pregunta de imagen son el nombre de un hallazgo, un signo o un diagnóstico")
    if re.search(r"\\brespectivamente\\b|\\ben ese orden\\b|\\bmisma (figura|imagen)\\b|\\b(caso|pregunta) anterior\\b", limpia(c.get("enunciado", ""))):
        revisa(cid + ": cada pregunta mira una sola cosa y se responde sola, sin «respectivamente» ni «la misma figura»")
if len(validos) >= 10 and len(mas_larga) > 0.3 * len(validos):
    mal("la correcta es la opción más larga en %d de %d casos (%s): alarga los distractores o acorta la correcta"
        % (len(mas_larga), len(validos), ", ".join(mas_larga[:8])))
for fam, raiz in COMODIN.items():
    como_mal = [c.get("id", "?") for c in validos
                if any(tiene(o, raiz) for i, o in enumerate(c["opciones"]) if i != c["correcta"])]
    if len(como_mal) >= 3 and not any(tiene(c["opciones"][c["correcta"]], raiz) for c in validos):
        mal("«%s» sale en los distractores de %d casos y en ninguna respuesta correcta (%s): es un comodín, "
            "cámbialo por un diferencial de verdad" % (fam, len(como_mal), ", ".join(como_mal[:8])))

esperadas = {"img/" + i.get("archivo", "") for i in IMGS.values()}
for n in sorted(hay):
    if n.startswith("img/") and n not in esperadas: mal("sobra " + n)

print("\\n".join("✗ " + m for m in malo) if malo
      else "todo bien: %d casos (%d de imagen), %d imágenes" % (len(CASOS), len(de_imagen), len(IMGS)))
if ojo:
    print("\\nRevisa cada uno con las dos pruebas del paso 3 (no bloquean):\\n" + "\\n".join("⚠ " + m for m in ojo))

──────────────────────────────── 8. ENTREGA
- Tantos casos como dé el documento (paso 4): al menos ${POR_FIGURA} de imagen por figura y, en total, como
  mínimo un 70 % de imagen.
- Dame el .zip para descargar.
- Y aparte, en pocas líneas: si pudiste ver las figuras, cuáles no pudiste extraer, qué ⚠ dejaste y por qué,
  y qué dudas te quedaron sobre la licencia.`;
}

export function instruccionesCorreccion(tema, problemas) {
  const casos = casosOrdenados(tema).map((c) => ({
    id: c.id,
    tema: c.tema,
    clasificacion: lista(c.clasificacion),
    tipo: c.tipo,
    enunciado: c.enunciado,
    imagenes: lista(c.imagenes).map((r) => ({ figura: (tema.imagenes[r.ref] || {}).figura || r.ref, mostrar_en: r.mostrar_en })),
    opciones: lista(c.opciones),
    correcta: c.correcta,
    explicacion: c.explicacion,
    perla: c.perla,
    evidencia: lista(c.evidencia).map((e) => ({ ubicacion: e.ubicacion, cita: e.cita })),
    etiquetas: lista(c.etiquetas),
  }));
  // La lista de áreas es larga: va solo si algún problema es de clasificación.
  const deClasificacion = problemas.some((p) => p.textos.some((t) => /clasificación|área|segmento/i.test(t)));
  return `Estos casos son tuyos y tienen problemas. Corrígelos con el mismo documento adjunto y las mismas reglas de antes.

PROBLEMAS POR CASO
${problemas.map((p) => `- ${p.caso}: ${p.textos.join(" | ")}`).join("\n")}

RECUERDA
${PRUEBAS}

${REGLAS.slice(0, 7).map((r, i) => `${i + 1}. ${r}`).join("\n")}
${deClasificacion ? `
CLASIFICACIÓN DE CADA CASO
${reglasClasificacion(tema.meta?.segmento)}
` : ""}
CASOS ACTUALES
${JSON.stringify({ casos }, null, 1)}

Devuelve SOLO el JSON corregido, sin texto antes ni después, con esta forma: {"correccion": true, "casos": [...]}.
Conserva el "id" de cada caso tal cual: así cada corrección reemplaza a su caso en vez de sumarse como uno nuevo.`;
}

// Una respuesta larga puede llegar cortada: los chats tienen un límite de largo por respuesta, y cien casos
// no suelen caber. En vez de perderlo todo, se recorre el texto como JSON y se guardan los elementos de
// «imagenes» y «casos» que llegaron enteros. Sirve para {"imagenes": [...], "casos": [...]} y para una lista
// suelta de casos.
function rescatar(texto) {
  const salida = { imagenes: [], casos: [], correccion: /"correccion"\s*:\s*true/.test(texto) };
  const pila = [];           // las llaves y corchetes abiertos
  let clave = "";            // la última clave del objeto de arriba: a qué lista va cada elemento
  let ultimo = "";           // el último texto entre comillas que se cerró
  let enTexto = false, escapado = false, abreTexto = -1, desde = -1;
  const enLista = () => (pila.length === 1 && pila[0] === "[") || (pila.length === 2 && pila[0] === "{" && pila[1] === "[");
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (enTexto) {
      if (escapado) escapado = false;
      else if (ch === "\\") escapado = true;
      else if (ch === '"') { enTexto = false; ultimo = texto.slice(abreTexto + 1, i); }
    } else if (ch === '"') {
      enTexto = true;
      abreTexto = i;
    } else if (ch === ":" && pila.length === 1 && pila[0] === "{") {
      clave = ultimo;
    } else if (ch === "{" || ch === "[") {
      if (ch === "{" && enLista()) desde = i;
      pila.push(ch);
    } else if (ch === "}" || ch === "]") {
      pila.pop();
      if (ch === "}" && desde !== -1 && enLista()) {
        const destino = pila[0] === "[" ? "casos" : clave;
        try {
          if (salida[destino]) salida[destino].push(JSON.parse(texto.slice(desde, i + 1)));
        } catch { /* un elemento roto no tumba a los demás */ }
        desde = -1;
      }
    }
  }
  return salida;
}

// Lee la respuesta de la IA aunque venga con bloques de código o texto alrededor, o cortada.
export function leerRespuestaIA(texto, tema) {
  const limpio = String(texto || "").replace(/```[a-zA-Z]*\n?/g, "").trim();
  const inicio = limpio.indexOf("{");
  const inicioLista = limpio.indexOf("[");
  const desde = inicio === -1 ? inicioLista : inicioLista === -1 ? inicio : Math.min(inicio, inicioLista);
  if (desde === -1) throw new Error("No encontré ningún JSON en la respuesta. Pídele a tu IA: «devuelve solo el JSON».");
  const cierre = limpio[desde] === "{" ? limpio.lastIndexOf("}") : limpio.lastIndexOf("]");
  let datos;
  let cortada = false;
  try {
    datos = JSON.parse(limpio.slice(desde, cierre + 1));
  } catch (e) {
    datos = rescatar(limpio.slice(desde));
    if (!datos.casos.length && !datos.imagenes.length) {
      throw new Error("El JSON de la respuesta está incompleto o mal formado. Pídele a tu IA que lo devuelva entero y sin texto alrededor.");
    }
    cortada = true;
  }
  const bruto = Array.isArray(datos) ? { casos: datos } : datos;
  const desconocidas = [];
  const porFigura = new Map(imagenesOrdenadas(tema).map((i) => [idImagen(i.figura), i.id]));

  const imagenes = lista(bruto.imagenes).map((i) => ({
    ref: porFigura.get(idImagen(i.figura)) || null,
    figura: i.figura,
    leyenda_original: (i.leyenda_original || "").trim(),
    modalidad: i.modalidad || "",
    paneles: lista(i.paneles).map((p) => ({
      id: String(p.id || "único"), lado: p.lado || "", plano: p.plano || "", secuencia: p.secuencia || "", condicion: p.condicion || "",
    })),
    marcas: lista(i.marcas).map((m) => ({ marca: String(m.marca || ""), panel: m.panel || "", senala: String(m.senala || "") })),
  }));

  const casos = lista(bruto.casos).map((c) => {
    let correcta = c.correcta;
    if (typeof correcta === "string") {
      const letra = "abcde".indexOf(correcta.trim().toLowerCase());
      correcta = letra >= 0 ? letra : Number(correcta);
    }
    // Sin clasificación no se escribe la clave: en una corrección, el caso conserva la que tenía.
    const clasificacion = normalizarClasificacion(c.clasificacion, desconocidas);
    return {
      id: ID_CASO.test(String(c.id || "")) ? String(c.id) : null,
      tema: String(c.tema || c.subtema || "").trim(),
      ...(clasificacion.length ? { clasificacion } : {}),
      tipo: c.tipo === "concepto" ? "concepto" : "imagen",
      enunciado: String(c.enunciado || c.pregunta || "").trim(),
      imagenes: lista(c.imagenes).map((r) => ({
        ref: porFigura.get(idImagen(r.figura || r.ref)) || null,
        figura: r.figura || r.ref,
        mostrar_en: r.mostrar_en === "respuesta" ? "respuesta" : "pregunta",
      })),
      opciones: lista(c.opciones).map((o) => String(o).trim()),
      correcta: Number.isInteger(correcta) ? correcta : -1,
      explicacion: String(c.explicacion || "").trim(),
      perla: String(c.perla || "").trim(),
      evidencia: lista(c.evidencia).map((e) => ({ ubicacion: String(e.ubicacion || "").trim(), cita: String(e.cita || "").trim() })),
      etiquetas: lista(c.etiquetas).map((t) => String(t).trim()).filter(Boolean),
      // Igual que la clasificación: si la respuesta no las trae, una corrección conserva las que el caso tenía.
      ...(normalizarDificultad(c.dificultad, "ia") ? { dificultad: normalizarDificultad(c.dificultad, "ia") } : {}),
      ...(typeof c.requiere_opciones === "boolean" ? { requiere_opciones: c.requiere_opciones || null } : {}),
    };
  });
  if (!casos.length && !imagenes.length) throw new Error("La respuesta no traía casos. Revisa que tu IA haya devuelto el JSON completo.");
  // «correccion» lo pone solo el prompt de corrección: sin esa marca, un id que la IA invente al escribir
  // casos nuevos no puede pisar un caso que ya existe.
  // «cortada»: se rescataron los elementos enteros de una respuesta incompleta. «faltan»: la IA avisó que no le
  // cupieron todos. En los dos casos hay que pedirle el resto (instruccionesContinuar).
  return {
    imagenes, casos, correccion: bruto.correccion === true, cortada, faltan: bruto.faltan === true,
    desconocidas: [...new Set(desconocidas)],
  };
}

// El pedido para que la IA siga donde se quedó, en la misma conversación: ella ya tiene el documento.
export function instruccionesContinuar(datos) {
  const casos = datos.casos || [];
  const ultimo = casos[casos.length - 1];
  const hasta = ultimo
    ? `Me llegaron ${casos.length} ${casos.length === 1 ? "caso completo" : "casos completos"}; el último empieza «${String(ultimo.enunciado || ultimo.tema || "").slice(0, 90)}…».`
    : "No me llegó ningún caso completo, solo fichas de imágenes.";
  return `${datos.cortada ? "Tu respuesta se cortó por el largo." : "Me dijiste que te faltaban casos."} ${hasta}
Sigue desde ahí, con el mismo documento, las mismas reglas y el mismo formato, sin repetir ninguno de los que ya diste.
Si tampoco te caben todos, termina en un caso completo, cierra bien el JSON y agrega "faltan": true.
Responde SOLO con el JSON, sin texto antes ni después: {"casos": [...]}`;
}

function idLibre(usados, desde) {
  for (let n = desde; ; n++) {
    const id = `caso-${String(n).padStart(2, "0")}`;
    if (!usados.has(id)) return id;
  }
}

// Qué escribir en la base al cargar una respuesta de la IA: las rutas para un solo update() y un resumen.
// - Normal: los casos se agregan detrás de los que hay.
// - Corrección (la respuesta trae «correccion»): cada caso con un id conocido reemplaza al suyo, en su mismo
//   lugar; los demás se agregan.
// - Reemplazar: la lista de casos se sustituye entera. Va en una sola ruta, «casos», porque Firebase rechaza
//   un update() en el que una ruta contiene a otra.
// «marca» es la hora del servidor (serverTimestamp()); se recibe de fuera para que esto no dependa del SDK.
export function planDeCarga(tema, datos, { reemplazar = false, marca = null } = {}) {
  const base = `estudio/${tema.id}`;
  const cambios = {};
  let fichas = 0;
  for (const img of datos.imagenes) {
    if (!img.ref) continue;
    fichas += 1;
    cambios[`${base}/imagenes/${img.ref}/leyenda_original`] = img.leyenda_original;
    if (img.modalidad) cambios[`${base}/imagenes/${img.ref}/modalidad`] = img.modalidad;
    if (img.paneles.length) cambios[`${base}/imagenes/${img.ref}/paneles`] = img.paneles;
    if (img.marcas.length) cambios[`${base}/imagenes/${img.ref}/marcas`] = img.marcas;
  }

  const guardado = (caso, orden, anterior = {}) => {
    const { id, ...resto } = caso;
    return {
      ...anterior,
      ...resto,
      imagenes: caso.imagenes.filter((r) => r.ref).map((r) => ({ ref: r.ref, mostrar_en: r.mostrar_en })),
      orden,
      actualizado: marca,
    };
  };
  const actuales = casosOrdenados(tema);
  const reemplaza = reemplazar && datos.casos.length > 0;
  let agregados = 0;
  let corregidos = 0;
  if (reemplaza) {
    const nuevos = {};
    datos.casos.forEach((caso, i) => { nuevos[idLibre(new Set(), i + 1)] = guardado(caso, i + 1); });
    cambios[`${base}/casos`] = nuevos;
    agregados = datos.casos.length;
  } else {
    const usados = new Set(actuales.map((c) => c.id));
    let orden = actuales.reduce((mayor, c) => Math.max(mayor, Number(c.orden) || 0), 0);
    for (const caso of datos.casos) {
      const anterior = datos.correccion && caso.id ? (tema.casos || {})[caso.id] : null;
      if (anterior) {
        cambios[`${base}/casos/${caso.id}`] = guardado(caso, anterior.orden ?? orden + 1, anterior);
        corregidos += 1;
        continue;
      }
      orden += 1;
      const id = idLibre(usados, orden);
      usados.add(id);
      cambios[`${base}/casos/${id}`] = guardado(caso, orden);
      agregados += 1;
    }
  }

  const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
  const partes = [];
  if (reemplaza && actuales.length) partes.push(`Reemplacé ${plural(actuales.length, "caso", "casos")} por ${agregados}`);
  else {
    if (corregidos) partes.push(`Corregí ${plural(corregidos, "caso", "casos")}`);
    if (agregados) partes.push(`${corregidos ? "agregué" : "Cargué"} ${plural(agregados, "caso nuevo", "casos nuevos")}`);
  }
  if (fichas) partes.push(`${partes.length ? "" : "Cargué "}${plural(fichas, "leyenda", "leyendas")}`);
  const ultimo = partes.length > 1 ? ` y ${partes.pop()}` : "";
  let resumen = partes.length ? `${partes.join(", ")}${ultimo}.` : "La respuesta no traía nada que cargar.";
  if (reemplazar && !reemplaza) resumen += " No reemplacé los casos: la respuesta no traía ninguno.";
  const perdidas = [...new Set(datos.casos.flatMap((c) => c.imagenes.filter((r) => !r.ref).map((r) => r.figura)).filter(Boolean))];
  if (perdidas.length) resumen += ` No reconocí: ${perdidas.join(", ")}.`;
  if (datos.desconocidas?.length) {
    resumen += ` Estas clasificaciones no están en la lista de áreas y quedaron fuera: ${datos.desconocidas.join(", ")}.`;
  }
  return { cambios, resumen, agregados, corregidos, fichas };
}
