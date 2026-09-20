// RadQuiz — instrucciones para cualquier IA (ChatGPT, Gemini, Copilot, Claude, DeepSeek…) y lectura de su respuesta.
// No depende de ningún proveedor: el autor copia un texto, lo pega en su IA con el PDF y pega la respuesta de vuelta.
import { imagenesOrdenadas, casosOrdenados, lista, idImagen, LICENCIAS } from "./validacion.js";
import { SEGMENTOS } from "./comun.js";

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
      "tema": "Subtema corto",
      "tipo": "imagen",
      "enunciado": "Descripción técnica de la imagen y la pregunta.",
      "imagenes": [{ "figura": "Figura 2", "mostrar_en": "pregunta" }],
      "opciones": ["Opción A", "Opción B", "Opción C", "Opción D", "Opción E"],
      "correcta": 2,
      "explicacion": "- Primera idea.\\n- Segunda idea.",
      "perla": "Frase práctica (opcional).",
      "evidencia": [{ "ubicacion": "p. 5, leyenda de la Figura 2", "cita": "Frase copiada textual del documento." }],
      "etiquetas": ["palabra clave"]
    }
  ]
}`;

const REGLAS = [
  "Usa SOLO el documento adjunto. Si algo no está ahí, no lo escribas, aunque sepas que es cierto.",
  "No inventes datos clínicos. La edad, el sexo o los síntomas van en la pregunta solo si la leyenda de esa figura los dice.",
  "La pregunta describe la imagen como la leyenda (lado, plano, secuencia, condición) pero no nombra el diagnóstico ni la palabra que lo delata.",
  "Cinco opciones, una sola correcta, todas del mismo tipo y de largo parecido. La correcta NO debe ser la más larga.",
  "Distractores plausibles: diagnósticos diferenciales reales de esa región y modalidad, o errores típicos de un residente.",
  "La explicación son 2 a 4 viñetas que empiezan con «- », con el vocabulario del documento y sin afirmar más que él.",
  "Cada caso lleva «evidencia»: dónde está en el documento y la frase copiada textual que sostiene la respuesta.",
  "Tipo «imagen» si hay que mirar la figura para responder; tipo «concepto» si no hace falta (y entonces sin figura en la pregunta).",
  "Si una figura o tabla contiene la respuesta escrita, úsala con \"mostrar_en\": \"respuesta\".",
  "Copia cada leyenda tal cual está en el documento, en su idioma, sin traducirla ni resumirla.",
  "Texto simple: nada de HTML. Para resaltar usa **negrita**.",
  "«correcta» es la posición de la opción correcta contando desde 0: 0 es la primera opción y 4 la quinta.",
];

function listaFiguras(tema) {
  const imagenes = imagenesOrdenadas(tema);
  if (!imagenes.length) return "No hay figuras cargadas: escribe solo casos de tipo «concepto», sin imágenes.";
  return imagenes.map((i) => `- "${i.figura}"${i.leyenda_original ? ` (leyenda ya cargada)` : ""}`).join("\n");
}

export function instruccionesIA(tema, cantidad = 20) {
  const meta = tema.meta || {};
  const fuente = tema.fuente || {};
  const faltanLeyendas = imagenesOrdenadas(tema).some((i) => !i.leyenda_original);
  return `Eres un radiólogo docente que prepara preguntas de opción múltiple para residentes de radiología, a partir del documento que te adjunto.

TEMA: ${meta.titulo || "(sin título)"} — segmento ${meta.segmento || "(sin segmento)"}.
FUENTE: ${fuente.cita || "(la del documento adjunto)"}

FIGURAS DISPONIBLES (usa exactamente estos nombres en "figura"):
${listaFiguras(tema)}

REGLAS OBLIGATORIAS
${REGLAS.map((r, i) => `${i + 1}. ${r}`).join("\n")}

QUÉ TIENES QUE DEVOLVER
- ${faltanLeyendas ? 'La lista "imagenes": la ficha de cada figura de arriba, con su leyenda textual, los paneles (A, B…) y qué señala cada flecha, círculo o número.' : 'La lista "imagenes" puede ir vacía: las leyendas ya están cargadas.'}
- La lista "casos": alrededor de ${cantidad} casos, con al menos 70 % de tipo "imagen".
- Responde SOLO con un JSON válido, sin texto antes ni después, sin explicaciones y sin bloques de código.

FORMATO EXACTO DE LA RESPUESTA
${EJEMPLO}`;
}

// Para una IA que además de escribir puede ejecutar código (ChatGPT con análisis de datos, Claude
// con su herramienta de análisis, Gemini con ejecución): que devuelva el cuestionario entero —texto
// e imágenes— en un solo .zip, con la misma forma que una carpeta de temas/ en el repositorio.
export function instruccionesPaquete(cantidad = 20) {
  return `Eres un radiólogo docente. Con el documento de acceso abierto que te adjunto tienes que armar
un cuestionario de opción múltiple para residentes de radiología y devolvérmelo en UN SOLO archivo .zip.

QUÉ TIENE QUE LLEVAR EL .ZIP (exactamente estos nombres, sin carpeta de más arriba)
  paquete.json
  fuentes.json
  img/fig02.jpg, img/fig03.jpg, …   una por figura usada

LAS IMÁGENES
- Sácalas del PDF con código (PyMuPDF, pdfimages o similar), en JPG.
- Cada archivo es UNA FIGURA COMPLETA tal como se publicó, con todos sus paneles y su composición.
  Nunca un panel suelto, nunca recortada, nunca con flechas, círculos o texto añadidos por ti:
  la licencia de la mayoría de estas fuentes no permite obras derivadas.
- Lado mayor de 1600 px como máximo y menos de 250 KB por archivo. Redimensionar y comprimir sí se puede.
- Nombra el archivo con el id de la figura: "Figura 2" → fig02.jpg, "Figura 3B" → fig03b.jpg, "Tabla 1" → tabla1.jpg.
- Si no puedes extraer las imágenes, dímelo y devuelve el .zip solo con los dos .json: las subo yo.

REGLAS DE LOS CASOS
${REGLAS.map((r, i) => `${i + 1}. ${r}`).join("\n")}

paquete.json
{
  "id": "minusculas-con-guiones",
  "titulo": "Título del cuestionario",
  "descripcion": "Una línea (opcional)",
  "segmento": "uno de: ${Object.keys(SEGMENTOS).join(", ")}",
  "modalidades": ["RM"],
  "idioma": "es",
  "version": "0.1.0",
  "imagenes": {
    "fig02": {
      "archivo": "fig02.jpg",
      "figura": "Figura 2",
      "leyenda_original": "La leyenda copiada tal cual del documento, sin traducir.",
      "modalidad": "RM",
      "paneles": [{ "id": "A", "lado": "derecho", "plano": "sagital oblicuo", "secuencia": "DP", "condicion": "boca cerrada" }],
      "marcas": [{ "marca": "flecha blanca", "panel": "A", "senala": "qué señala, según la leyenda" }],
      "modificaciones": ["redimensionada", "comprimida"]
    }
  },
  "casos": [
    {
      "id": "caso-01",
      "tema": "Subtema corto",
      "etiquetas": ["palabra clave"],
      "tipo": "imagen",
      "enunciado": "Descripción técnica de la imagen y la pregunta.",
      "imagenes": [{ "ref": "fig02", "mostrar_en": "pregunta" }],
      "opciones": ["Opción A", "Opción B", "Opción C", "Opción D", "Opción E"],
      "correcta": 2,
      "explicacion": "- Primera idea.\\n- Segunda idea.",
      "perla": "Frase práctica (opcional).",
      "evidencia": [{ "ubicacion": "p. 5, leyenda de la Figura 2", "cita": "Frase copiada textual del documento." }]
    }
  ]
}

fuentes.json  (una sola fuente, con la clave que quieras: apellido del primer autor + año)
{
  "lopezramirez2024": {
    "tipo": "articulo",
    "cita": "Cita completa con volumen, páginas y doi:",
    "credito": "López-Ramírez M, et al. Austral J Imaging. 2024",
    "doi": "10.24875/AJI.23000069",
    "url": "https://doi.org/10.24875/AJI.23000069",
    "titular": "© 2024 Sociedad …  (lo que diga el «©» del documento)",
    "licencia": "una de: ${LICENCIAS.map((l) => l.valor).join(", ")}",
    "verificacion": { "donde": "p. 136: «frase del documento donde dice la licencia»" }
  }
}

- Escribe alrededor de ${cantidad} casos, al menos el 70 % de tipo "imagen".
- "correcta" es la posición contando desde 0: 0 es la primera opción y 4 la quinta.
- Comprueba antes de dármelo: que el .zip abra, que los dos .json sean JSON válido, que cada "ref"
  de un caso exista en "imagenes" y que cada "archivo" exista dentro de img/.
- Dame el .zip para descargar y, aparte, dime en una línea qué figuras no pudiste extraer.`;
}

export function instruccionesCorreccion(tema, problemas) {
  const casos = casosOrdenados(tema).map((c) => ({
    id: c.id,
    tema: c.tema,
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
  return `Estos casos son tuyos y tienen problemas. Corrígelos con el mismo documento adjunto y las mismas reglas de antes.

PROBLEMAS POR CASO
${problemas.map((p) => `- ${p.caso}: ${p.textos.join(" | ")}`).join("\n")}

RECUERDA
${REGLAS.slice(0, 7).map((r, i) => `${i + 1}. ${r}`).join("\n")}

CASOS ACTUALES
${JSON.stringify({ casos }, null, 1)}

Devuelve SOLO el JSON corregido completo, con la misma forma ({"casos": [...]}), sin texto antes ni después.`;
}

// Lee la respuesta de la IA aunque venga con bloques de código o texto alrededor.
export function leerRespuestaIA(texto, tema) {
  const limpio = String(texto || "").replace(/```[a-zA-Z]*\n?/g, "").trim();
  const inicio = limpio.indexOf("{");
  const inicioLista = limpio.indexOf("[");
  const desde = inicio === -1 ? inicioLista : inicioLista === -1 ? inicio : Math.min(inicio, inicioLista);
  if (desde === -1) throw new Error("No encontré ningún JSON en la respuesta. Pídele a tu IA: «devuelve solo el JSON».");
  const cierre = limpio[desde] === "{" ? limpio.lastIndexOf("}") : limpio.lastIndexOf("]");
  let datos;
  try {
    datos = JSON.parse(limpio.slice(desde, cierre + 1));
  } catch (e) {
    throw new Error("El JSON de la respuesta está incompleto o mal formado. Pídele a tu IA que lo devuelva entero y sin texto alrededor.");
  }
  const bruto = Array.isArray(datos) ? { casos: datos } : datos;
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
    return {
      tema: String(c.tema || c.subtema || "").trim(),
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
    };
  });
  if (!casos.length && !imagenes.length) throw new Error("La respuesta no traía casos. Revisa que tu IA haya devuelto el JSON completo.");
  return { imagenes, casos };
}
