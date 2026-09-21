// RadQuiz — instrucciones para cualquier IA (ChatGPT, Gemini, Copilot, Claude, DeepSeek…) y lectura de su respuesta.
// No depende de ningún proveedor: el autor copia un texto, lo pega en su IA con el PDF y pega la respuesta de vuelta.
import { imagenesOrdenadas, casosOrdenados, lista, idImagen, LICENCIAS, MODALIDADES } from "./validacion.js";
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

// El número de casos lo manda el documento, no una cifra fija: un artículo con quince figuras da
// para mucho más que uno con tres, y quedarse corto es desaprovechar material bueno.
const POR_FIGURA = 2;
const MINIMO_CASOS = 10;

function objetivoCasos(nFiguras) {
  return Math.max(MINIMO_CASOS, POR_FIGURA * (nFiguras || 0));
}

// El mismo reparto para los dos prompts. Con las figuras ya cargadas se da la cifra exacta; en el
// del .zip todavía no se sabe cuántas saldrán del PDF, así que se da la regla.
function repartoCasos(nFiguras) {
  const cuantos = nFiguras
    ? `Tienes ${nFiguras} ${nFiguras === 1 ? "figura" : "figuras"}: escribe ${objetivoCasos(nFiguras)} casos o más.`
    : `Cuenta las figuras que conseguiste extraer: ${POR_FIGURA} casos por figura como mínimo, y nunca menos de ${MINIMO_CASOS} en total.`;
  return `- ${cuantos}
- De cada figura salen al menos dos preguntas distintas: una de reconocimiento (qué se ve, qué
  hallazgo es) y otra que vaya más allá con la misma imagen —diagnóstico diferencial, plano o
  secuencia, signo, medida, qué implica en la clínica—. Si la figura tiene varios paneles o varias
  marcas, salen tres o cuatro sin repetirse.
- Suma los casos de tipo "concepto" que dé el texto: definiciones, indicaciones, criterios, errores
  frecuentes. Esos van aparte de la cuenta por figura.
- No hay máximo. Un documento con muchas figuras da para un cuestionario largo: aprovéchalo entero
  en vez de parar en una cifra redonda.
- Ninguna figura puede quedarse sin pregunta.
- Nada de relleno: dos preguntas que piden lo mismo con otras palabras cuentan como una. Antes que
  repetir, deja esa figura con menos casos.`;
}

function listaFiguras(tema) {
  const imagenes = imagenesOrdenadas(tema);
  if (!imagenes.length) return "No hay figuras cargadas: escribe solo casos de tipo «concepto», sin imágenes.";
  return imagenes.map((i) => `- "${i.figura}"${i.leyenda_original ? ` (leyenda ya cargada)` : ""}`).join("\n");
}

export function instruccionesIA(tema) {
  const meta = tema.meta || {};
  const fuente = tema.fuente || {};
  const figuras = imagenesOrdenadas(tema);
  const faltanLeyendas = figuras.some((i) => !i.leyenda_original);
  return `Eres un radiólogo docente que prepara preguntas de opción múltiple para residentes de radiología, a partir del documento que te adjunto.

TEMA: ${meta.titulo || "(sin título)"} — segmento ${meta.segmento || "(sin segmento)"}.
FUENTE: ${fuente.cita || "(la del documento adjunto)"}

FIGURAS DISPONIBLES (usa exactamente estos nombres en "figura"):
${listaFiguras(tema)}

REGLAS OBLIGATORIAS
${REGLAS.map((r, i) => `${i + 1}. ${r}`).join("\n")}

CUÁNTOS CASOS
${repartoCasos(figuras.length)}

QUÉ TIENES QUE DEVOLVER
- ${faltanLeyendas ? 'La lista "imagenes": la ficha de cada figura de arriba, con su leyenda textual, los paneles (A, B…) y qué señala cada flecha, círculo o número.' : 'La lista "imagenes" puede ir vacía: las leyendas ya están cargadas.'}
- La lista "casos": los que salgan de la cuenta de arriba, con al menos 70 % de tipo "imagen".
- Responde SOLO con un JSON válido, sin texto antes ni después, sin explicaciones y sin bloques de código.

FORMATO EXACTO DE LA RESPUESTA
${EJEMPLO}`;
}

// Para una IA que además de escribir puede ejecutar código (ChatGPT con análisis de datos, Claude
// con su herramienta de análisis, Gemini con ejecución): que devuelva el cuestionario entero —texto
// e imágenes— en un solo .zip, con la misma forma que una carpeta de temas/ en el repositorio.
//
// El prompt lleva dentro un comprobador en Python que la IA tiene que correr antes de entregar.
// Repite las reglas del esquema (schema/*.schema.json) porque ahí es donde se equivocan: el .zip
// llega bien formado o no llega, y un aviso del estudio a toro pasado no sirve de nada.
export function instruccionesPaquete() {
  const segmentos = Object.keys(SEGMENTOS).join(" · ");
  const modalidades = MODALIDADES.join(" · ");
  const licencias = LICENCIAS.map((l) => l.valor).join(" · ");
  const nd = LICENCIAS.filter((l) => l.nd).map((l) => l.valor).join(" y ");
  return `Eres un radiólogo docente. Con el documento de acceso abierto que te adjunto vas a armar un
cuestionario de opción múltiple para residentes de radiología y devolvérmelo en UN SOLO archivo .zip.

Necesito que ejecutes código: hay que sacar las figuras del PDF y comprobar el resultado antes de
entregarlo. Si no puedes ejecutar código, dímelo ahora y lo hacemos de otra manera.

──────────────────────────────── 1. QUÉ LLEVA EL .ZIP
Exactamente estos nombres, SIN una carpeta por encima:

    paquete.json
    fuentes.json
    img/fig02.jpg
    img/fig03.jpg   … una por figura usada

Los nombres de img/ van en minúsculas y terminan en .jpg (ni .jpeg ni .png), y se forman con el id
de la figura: "Figura 2" → fig02.jpg · "Figura 3B" → fig03b.jpg · "Tabla 1" → tabla1.jpg.

──────────────────────────────── 2. LAS FIGURAS
- Con PyMuPDF (fitz): localiza el rectángulo que contiene la figura ENTERA —todos sus paneles, sin
  el texto de la leyenda— y renderiza esa zona:
      pagina.get_pixmap(clip=rect, dpi=200).save(...)
  Luego a JPG, lado mayor 1600 px como máximo y por debajo de 250 KB. Sin metadatos EXIF.
- NO uses page.get_images() ni extract_image() para sacar los objetos incrustados uno a uno. Una
  figura de varios paneles suele estar guardada como varias imágenes sueltas, y entregarlas por
  separado es partir la figura.
  Las licencias sin derivadas (${nd}) solo permiten redimensionar y comprimir:
  nada de recortar, partir ni anotar.
- Comprobación mental: el número de archivos de img/ tiene que ser el número de FIGURAS que usas,
  no el de paneles.
- Si no consigues extraer alguna figura, déjala fuera del .zip y dímelo: se sube luego a mano.

──────────────────────────────── 3. CUÁNTAS PREGUNTAS
${repartoCasos(0)}

──────────────────────────────── 4. REGLAS DE LOS CASOS
${REGLAS.map((r, i) => `${i + 1}. ${r}`).join("\n")}
${REGLAS.length + 1}. Escribe los casos en español aunque el documento esté en otro idioma. Las leyendas, no:
    esas van copiadas tal cual, en el idioma original.

──────────────────────────────── 5. paquete.json
Lo que va detrás de // son notas para ti: JSON no admite comentarios, así que no los copies.
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
      "marcas": [                            // [] si la figura no tiene flechas ni círculos
        { "marca": "flecha blanca", "panel": "A", "senala": "qué señala, según la leyenda" }
      ],
      "modificaciones": ["redimensionada", "comprimida"]
    }
  },
  "casos": [
    {
      "id": "caso-01",
      "tema": "Subtema corto",
      "etiquetas": ["palabra clave"],
      "tipo": "imagen",                      // "imagen" o "concepto"
      "enunciado": "Descripción técnica de la imagen y, al final, la pregunta terminada en ?",
      "imagenes": [{ "ref": "fig02", "mostrar_en": "pregunta" }],   // "pregunta" o "respuesta"
      "opciones": ["Primera opción", "Segunda opción", "Tercera opción", "Cuarta opción", "Quinta opción"],
      "correcta": 2,                         // posición desde 0: aquí, "Tercera opción". 0 la primera, 4 la quinta
      "explicacion": "- Primera idea.\\n- Segunda idea.",
      "perla": "Frase práctica (opcional).",
      "evidencia": [
        { "ubicacion": "p. 5, leyenda de la Figura 2", "cita": "Frase copiada textual, 10 caracteres como mínimo." }
      ]
    }
  ]
}

Los campos que no aparecen arriba no van: el catálogo no admite claves de más. Todo "ref" de un
caso tiene que existir como clave de "imagenes"; si la figura no está, el caso no la cita.

──────────────────────────────── 6. fuentes.json
Una sola fuente. La clave: apellido del primer autor + año, en minúsculas.
{
  "lopezramirez2024": {
    "tipo": "articulo",                      // articulo · caso · libro · banco
    "cita": "Cita Vancouver completa, con volumen, páginas y doi:",
    "credito": "López-Ramírez M, et al. Austral J Imaging. 2024",   // corto, va bajo cada imagen
    "doi": "10.24875/AJI.23000069",          // sin https://doi.org/ delante
    "url": "https://doi.org/10.24875/AJI.23000069",
    "titular": "© 2024 Sociedad …",          // copiado del «©» del documento
    "licencia": "una de: ${licencias}",
    "verificacion": { "donde": "p. 136: «frase del documento donde dice la licencia»" }
  }
}

La licencia se copia EXACTA de esa lista: el estudio saca de ahí la URL y si permite o no modificar
la figura. Si el documento no dice claramente su licencia, dímelo en vez de adivinarla.

──────────────────────────────── 7. COMPRUÉBALO ANTES DE DÁRMELO
Corre esto sobre tu .zip y arregla lo que salga. No me lo entregues hasta que imprima «todo bien».

import json, re, zipfile
from PIL import Image
import io

RUTA = "cuestionario.zip"
SEG = "${Object.keys(SEGMENTOS).join(" ")}".split()
MOD = ${JSON.stringify(MODALIDADES)}
ND  = ${JSON.stringify(LICENCIAS.filter((l) => l.nd).map((l) => l.valor))}
LIC = ${JSON.stringify(LICENCIAS.map((l) => l.valor))}

z = zipfile.ZipFile(RUTA)
hay = set(z.namelist())
malo = []
def mal(m): malo.append(m)

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
if src.get("tipo") == "articulo" and not re.fullmatch(r"10\\.\\d{4,9}/\\S+", src.get("doi") or ""):
    mal("un artículo necesita DOI, empezando por 10.")
if len((src.get("verificacion") or {}).get("donde", "")) < 3:
    mal("falta la frase del documento donde dice la licencia")

for iid, img in (p.get("imagenes") or {}).items():
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

vistos = set()
if not p.get("casos"): mal("no hay casos")
for c in p.get("casos") or []:
    cid = c.get("id", "?")
    if cid in vistos: mal("id de caso repetido: " + cid)
    vistos.add(cid)
    if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", cid): mal("id de caso inválido: %r" % cid)
    if not c.get("tema"): mal(cid + ": falta tema")
    if not c.get("enunciado"): mal(cid + ": falta enunciado")
    if c.get("tipo") not in ("imagen", "concepto"): mal(cid + ": tipo inválido")
    op = c.get("opciones") or []
    if len(op) != 5: mal("%s: tiene %d opciones, deben ser 5" % (cid, len(op)))
    if any(not str(o).strip() for o in op): mal(cid + ": hay una opción vacía")
    if len({str(o).strip().lower() for o in op}) != len(op): mal(cid + ": hay opciones repetidas")
    if not isinstance(c.get("correcta"), int) or not 0 <= c["correcta"] < len(op):
        mal(cid + ": correcta fuera de rango")
    elif len(op) > 1 and len(str(op[c["correcta"]])) >= 1.3 * max(len(str(o)) for i, o in enumerate(op) if i != c["correcta"]):
        mal(cid + ": la correcta es mucho más larga que las demás; iguala los largos")
    if not c.get("explicacion"): mal(cid + ": falta explicacion")
    ev = c.get("evidencia") or []
    if not ev or any(len(e.get("cita", "")) < 10 or not e.get("ubicacion") for e in ev):
        mal(cid + ": falta evidencia con ubicación y frase textual")
    refs = c.get("imagenes") or []
    for r in refs:
        if r.get("ref") not in (p.get("imagenes") or {}): mal("%s: usa una imagen que no existe: %r" % (cid, r.get("ref")))
        if r.get("mostrar_en") not in ("pregunta", "respuesta"): mal(cid + ": mostrar_en inválido")
    if c.get("tipo") == "imagen" and not [r for r in refs if r.get("mostrar_en") == "pregunta"]:
        mal(cid + ": es de tipo imagen pero no muestra ninguna en la pregunta")

usadas = {r.get("ref") for c in p.get("casos") or [] for r in (c.get("imagenes") or [])}
for iid in p.get("imagenes") or {}:
    if iid not in usadas: mal(iid + ": ninguna pregunta usa esta figura; escríbele una o quítala del catálogo")
minimo = max(${MINIMO_CASOS}, ${POR_FIGURA} * len(p.get("imagenes") or {}))
if len(p.get("casos") or []) < minimo:
    mal("%d casos para %d figuras: son pocos, el mínimo son %d" % (len(p.get("casos") or []), len(p.get("imagenes") or {}), minimo))

esperadas = {"img/" + i.get("archivo", "") for i in (p.get("imagenes") or {}).values()}
for n in hay:
    if n.startswith("img/") and n not in esperadas: mal("sobra " + n)

print("\\n".join("✗ " + m for m in malo) if malo else "todo bien: %d casos, %d imágenes" % (len(p["casos"]), len(p["imagenes"])))

──────────────────────────────── 8. ENTREGA
- Tantos casos como dé el documento (apartado 3): ${POR_FIGURA} por figura como mínimo y nunca
  menos de ${MINIMO_CASOS}, con al menos el 70 % de tipo "imagen".
- Dame el .zip para descargar.
- Y en una línea aparte: qué figuras no pudiste extraer y qué dudas te quedaron sobre la licencia.`;
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
