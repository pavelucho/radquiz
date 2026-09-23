// RadQuiz — reglas del formato para el estudio web. Son las mismas de tools/validar, con mensajes para no expertos.
// El validador de Python vuelve a revisar todo antes de publicar: este módulo es la ayuda inmediata.
import { CON_COPYRIGHT } from "./comun.js";

// «nd»: solo se puede redimensionar y comprimir. «Con copyright» es la fuente sin licencia abierta: sus figuras
// las aloja y responde por ellas quien publica, y la web no muestra ninguna licencia.
export const LICENCIAS = [
  { valor: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/", nd: false },
  { valor: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/", nd: false },
  { valor: "CC BY-NC 4.0", url: "https://creativecommons.org/licenses/by-nc/4.0/", nd: false },
  { valor: "CC BY-NC-SA 4.0", url: "https://creativecommons.org/licenses/by-nc-sa/4.0/", nd: false },
  { valor: "CC BY-NC-ND 4.0", url: "https://creativecommons.org/licenses/by-nc-nd/4.0/", nd: true },
  { valor: "CC BY 3.0", url: "https://creativecommons.org/licenses/by/3.0/", nd: false },
  { valor: "CC BY-NC-SA 3.0", url: "https://creativecommons.org/licenses/by-nc-sa/3.0/", nd: false },
  { valor: "CC BY-NC-ND 3.0", url: "https://creativecommons.org/licenses/by-nc-nd/3.0/", nd: true },
  { valor: "CC0 1.0", url: "https://creativecommons.org/publicdomain/zero/1.0/", nd: false },
  { valor: "Dominio público", url: "", nd: false },
  { valor: CON_COPYRIGHT, url: "", nd: true, etiqueta: "Con copyright (sin licencia abierta)" },
];
export const MODALIDADES = ["Rx", "US", "TC", "RM", "MN", "PET-TC", "Mamografía", "Fluoroscopía", "Angiografía"];
export const LADOS = ["derecho", "izquierdo", "bilateral"];
const BLOQUEADOS = ["statdx.com", "radprimer.com", "imaios.com", "e-anatomy.org"];
// La frase copiada de la fuente tiene que decir la licencia CC que se eligió. Las mismas tres pruebas están en
// tools/validar. Salieron de temas reales: IA que «asumieron» una licencia CC para pasar el validador.
const MENCIONA_CC = /creative\s*commons|creativecommons\.org|\bCC[\s-]?(BY|0)\b/i;
const SUPUESTO = /asumid|provisional|para (la )?validaci|no se documenta|seg[uú]n (las )?instrucciones/i;
const RESERVADOS = /personal (non-commercial )?use|uso personal|all rights reserved|todos los derechos reservados/i;
const HTML = /<\/?[a-zA-Z][^>]*>|&[a-zA-Z]+;|&#[0-9]+;/;
const LETRAS = "ABCDE";

export const lista = (x) => (Array.isArray(x) ? x : x && typeof x === "object" ? Object.values(x) : []);

export function slug(texto) {
  return String(texto || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

// «Figura 2» → fig02 · «Tabla 1» → tabla1 · «Fig. 3B» → fig03b
export function idImagen(figura) {
  const t = slug(figura);
  const m = t.match(/^(fig|figura|figure|imagen|tabla|table|cuadro)-?(\d+)-?([a-z])?$/);
  if (!m) return t || "imagen";
  const base = /tab|cuadro/.test(m[1]) ? "tabla" : "fig";
  const numero = base === "fig" ? m[2].padStart(2, "0") : m[2];
  return `${base}${numero}${m[3] || ""}`;
}

export function normalizarFigura(texto) {
  return idImagen(texto);
}

function problema(tipo, texto) {
  return { tipo, texto };
}

export function validarFuente(f) {
  const p = [];
  if (!f) return [problema("error", "Falta completar la fuente.")];
  if (!f.cita || f.cita.length < 20) p.push(problema("error", "Falta la cita completa del artículo o caso."));
  if (f.tipo === "articulo" && !/^10\.\d{4,9}\/\S+$/.test(f.doi || "")) p.push(problema("error", "Un artículo necesita su DOI (empieza con 10.)."));
  if (!/^https:\/\/\S+$/.test(f.url || "")) p.push(problema("error", "Falta el enlace (https://…) a la fuente."));
  const host = (() => { try { return new URL(f.url).hostname; } catch { return ""; } })();
  if (BLOQUEADOS.some((d) => host === d || host.endsWith("." + d))) p.push(problema("error", `No se puede usar ${host}: su contenido tiene copyright.`));
  if (!LICENCIAS.some((l) => l.valor === f.licencia)) p.push(problema("error", "Elige la licencia de la fuente."));
  if (!f.titular) p.push(problema("error", "Falta el titular de los derechos (lo que dice «©» en la fuente)."));
  const donde = f.verificacion?.donde || "";
  if (donde.length < 3) {
    p.push(problema("error", "Copia la frase de la fuente donde dice la licencia (así se comprueba que la leíste)."));
  } else if (/^CC/.test(f.licencia || "")) {
    if (!MENCIONA_CC.test(donde) || SUPUESTO.test(donde)) {
      p.push(problema("error", `La frase que copiaste no dice que la fuente tenga licencia ${f.licencia}. Si el documento no la dice con todas sus letras, elige «${CON_COPYRIGHT}».`));
    } else if (RESERVADOS.test(donde)) {
      p.push(problema("aviso", "La frase habla de derechos reservados o de uso personal: comprueba que la licencia abierta sea de verdad de este documento."));
    }
  }
  if (!f.credito) p.push(problema("aviso", "Falta el crédito corto que se muestra bajo cada imagen."));
  if (f.licencia === CON_COPYRIGHT) {
    p.push(problema("aviso", "Sin licencia abierta: bajo cada figura se verá «© titular · alojada por» quien publique, "
      + "sin enlace a ninguna licencia. Mostrarlas es responsabilidad de quien publica."));
  }
  return p;
}

export function validarImagen(img, fuente) {
  const p = [];
  if (!img.figura) p.push(problema("error", "Falta cómo se llama la figura en la fuente (por ejemplo, «Figura 2»)."));
  if (!img.leyenda_original) p.push(problema("error", "Falta la leyenda original de la figura."));
  const malos = lista(img.paneles).filter((p) => p.lado && !LADOS.includes(p.lado));
  if (malos.length) {
    p.push(problema("error", `El lado de un panel solo puede ser ${LADOS.join(", ")} o quedar vacío`
      + ` (panel ${malos.map((x) => x.id || "?").join(", ")}: «${malos[0].lado}»).`));
  }
  const licencia = LICENCIAS.find((l) => l.valor === fuente?.licencia);
  const prohibidas = lista(img.modificaciones).filter((m) => !["redimensionada", "comprimida"].includes(m));
  if (licencia?.nd && prohibidas.length) p.push(problema("error", "La licencia no permite recortar ni marcar esta figura."));
  return p;
}

export function validarCaso(caso, imagenes) {
  const p = [];
  const opciones = lista(caso.opciones);
  const refs = lista(caso.imagenes);
  if (!caso.tema) p.push(problema("error", "Falta el subtema (por ejemplo, «Desplazamiento discal»)."));
  if (!caso.enunciado) p.push(problema("error", "Falta la pregunta."));
  else if (!caso.enunciado.trim().endsWith("?")) p.push(problema("aviso", "La pregunta debería terminar con «?»."));
  if (opciones.length < 4 || opciones.length > 5) p.push(problema("error", `Tiene ${opciones.length} opciones; deben ser 5.`));
  else if (opciones.length === 4) p.push(problema("aviso", "Tiene 4 opciones; la guía pide 5."));
  if (opciones.some((o) => !String(o || "").trim())) p.push(problema("error", "Hay una opción vacía."));
  const normal = opciones.map((o) => String(o).trim().toLowerCase());
  if (new Set(normal).size !== normal.length) p.push(problema("error", "Hay opciones repetidas."));
  if (!Number.isInteger(caso.correcta) || caso.correcta < 0 || caso.correcta >= opciones.length) p.push(problema("error", "Marca cuál es la opción correcta."));
  if (!caso.explicacion) p.push(problema("error", "Falta la explicación."));
  const evidencia = lista(caso.evidencia);
  if (!evidencia.length || evidencia.some((e) => !e.cita || e.cita.length < 10 || !e.ubicacion)) {
    p.push(problema("error", "Falta la evidencia: la página y la frase textual de la fuente que respalda la respuesta."));
  }
  for (const r of refs) {
    if (!imagenes[r.ref]) p.push(problema("error", `Usa una imagen que no está subida (${r.figura || r.ref}).`));
  }
  const enPregunta = refs.filter((r) => r.mostrar_en === "pregunta");
  if (caso.tipo === "imagen" && !enPregunta.length) p.push(problema("error", "Es un caso de imagen pero no muestra ninguna imagen en la pregunta."));
  if (caso.tipo === "concepto" && enPregunta.length) p.push(problema("aviso", "Es un caso de concepto con imagen en la pregunta: ¿la imagen hace falta?"));
  for (const [campo, texto] of [["pregunta", caso.enunciado], ["explicación", caso.explicacion], ["perla", caso.perla], ...opciones.map((o, i) => [`opción ${LETRAS[i]}`, o])]) {
    if (texto && HTML.test(texto)) p.push(problema("error", `La ${campo} tiene código HTML; usa texto normal.`));
  }
  if (Number.isInteger(caso.correcta) && opciones.length > 1 && caso.correcta < opciones.length) {
    const largos = opciones.map((o) => String(o).length);
    const otras = Math.max(...largos.filter((_, i) => i !== caso.correcta));
    if (largos[caso.correcta] >= 1.3 * otras) {
      p.push(problema("aviso", "La correcta es mucho más larga que las demás: se adivina por el largo. Iguala los largos."));
    }
  }
  return p;
}

export function casosOrdenados(tema) {
  return Object.entries(tema.casos || {})
    .map(([id, c]) => ({ ...c, id }))
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || a.id.localeCompare(b.id));
}

export function imagenesOrdenadas(tema) {
  return Object.entries(tema.imagenes || {})
    .map(([id, i]) => ({ ...i, id }))
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || a.id.localeCompare(b.id));
}

export function validarTema(tema) {
  const imagenes = tema.imagenes || {};
  const r = { fuente: validarFuente(tema.fuente), imagenes: {}, casos: {}, tema: [], errores: 0, avisos: 0 };
  for (const img of imagenesOrdenadas(tema)) r.imagenes[img.id] = validarImagen(img, tema.fuente);
  const casos = casosOrdenados(tema);
  for (const c of casos) r.casos[c.id] = validarCaso(c, imagenes);
  if (!casos.length) r.tema.push(problema("error", "Todavía no hay casos."));
  if (casos.length >= 10) {
    const largos = casos.filter((c) => {
      const o = lista(c.opciones).map((x) => String(x).length);
      return Number.isInteger(c.correcta) && o[c.correcta] > Math.max(...o.filter((_, i) => i !== c.correcta));
    }).length;
    if (largos / casos.length > 0.35) r.tema.push(problema("aviso", `La correcta es la opción más larga en ${largos} de ${casos.length} casos.`));
  }
  const todos = [r.fuente, r.tema, ...Object.values(r.imagenes), ...Object.values(r.casos)].flat();
  r.errores = todos.filter((x) => x.tipo === "error").length;
  r.avisos = todos.filter((x) => x.tipo === "aviso").length;
  return r;
}

// Un caso está verificado si un radiólogo lo marcó y el autor no lo cambió después.
export function estadoVerificacion(caso, verificacion) {
  if (!verificacion) return "sin verificar";
  const base = verificacion.base || verificacion.fecha || 0;
  if (caso.actualizado && caso.actualizado > base) return "cambiado";
  return verificacion.decision === "problema" ? "problema" : "verificado";
}

// Arma paquete.json y fuentes.json con todos los casos del tema, listos para el repositorio.
// La verificación se añade al publicar en la web: aquí los casos salen sin revisor.
// Solo la publicación pasa las opciones:
// - «drive»: id de imagen → id del archivo en el Drive de quien publica. El .zip que se descarga lleva los
//   archivos y no apunta al Drive de nadie.
// - «publicador» ({ nombre, fecha }): quien publica. Completa la verificación de la licencia si vino vacía (un
//   .zip hecho por una IA suele traer solo la frase) y, si hay figuras en su Drive, queda como «alojada_por».
export function aPaquete(tema, version, { drive = {}, publicador = null } = {}) {
  const meta = tema.meta;
  const f = tema.fuente;
  const casos = casosOrdenados(tema);
  const usadas = new Set(casos.flatMap((c) => lista(c.imagenes).map((r) => r.ref)));
  const imagenes = {};
  for (const img of imagenesOrdenadas(tema)) {
    if (!usadas.has(img.id)) continue;
    const vacio = (v) => (v === undefined || v === "" ? null : v);
    imagenes[img.id] = {
      archivo: `${img.id}.jpg`,
      fuente: f.clave,
      figura: img.figura,
      leyenda_original: img.leyenda_original,
      modalidad: vacio(img.modalidad),
      paneles: lista(img.paneles).length
        ? lista(img.paneles).map((p) => ({ id: p.id || "único", ...(p.lado ? { lado: p.lado } : {}), plano: vacio(p.plano), secuencia: vacio(p.secuencia), condicion: vacio(p.condicion) }))
        : [{ id: "único", plano: null, secuencia: null, condicion: null }],
      marcas: lista(img.marcas).map((m) => ({ marca: m.marca, panel: vacio(m.panel), senala: m.senala })),
      modificaciones: lista(img.modificaciones),
      ...(img.notas ? { notas: img.notas } : {}),
      ...(drive[img.id] ? { drive: drive[img.id] } : {}),
    };
  }
  const actualizados = {};
  const casosPaquete = casos.map((c) => {
    actualizados[c.id] = c.actualizado || 0;
    return {
      id: c.id,
      tema: c.tema,
      etiquetas: lista(c.etiquetas),
      tipo: c.tipo,
      enunciado: c.enunciado,
      imagenes: lista(c.imagenes).map((r) => ({ ref: r.ref, mostrar_en: r.mostrar_en })),
      opciones: lista(c.opciones),
      correcta: c.correcta,
      ...(c.barajar === false ? { barajar: false } : {}),
      explicacion: c.explicacion,
      ...(c.perla ? { perla: c.perla } : {}),
      evidencia: lista(c.evidencia).map((e) => ({ fuente: f.clave, ubicacion: e.ubicacion, cita: e.cita })),
      estado: "publicado",
      autor: meta.autor_usuario,
      revisor: null,
    };
  });
  const paquete = {
    $schema: "../../../schema/paquete.schema.json",
    id: meta.id,
    titulo: meta.titulo,
    ...(meta.descripcion ? { descripcion: meta.descripcion } : {}),
    segmento: meta.segmento,
    modalidades: lista(meta.modalidades).length ? lista(meta.modalidades) : ["RM"],
    idioma: "es",
    version,
    personas: { [meta.autor_usuario]: meta.autor_nombre },
    imagenes,
    casos: casosPaquete,
  };
  // Lo que no aplica va como null, no como texto vacío: el esquema pide un DOI o un enlace válidos, o null.
  const { clave, ...resto } = f;
  const verificacion = { ...(resto.verificacion || {}) };
  if (publicador) {
    verificacion.fecha = verificacion.fecha || publicador.fecha;
    verificacion.por = verificacion.por || publicador.nombre;
  }
  const fuente = {
    ...resto,
    doi: resto.doi || null,
    licencia_url: resto.licencia_url || null,
    modificaciones_permitidas: !LICENCIAS.find((l) => l.valor === f.licencia)?.nd,
    verificacion,
    ...(publicador && Object.keys(drive).length ? { alojada_por: publicador.nombre } : {}),
  };
  const fuentes = { $schema: "../../../schema/fuentes.schema.json", [clave]: fuente };
  return { paquete, fuentes, imagenesUsadas: [...usadas], actualizados };
}

// Lo contrario de aPaquete(): de paquete.json + fuentes.json a la forma que usa el estudio.
// El formato es el mismo que el del repositorio, así que un .zip vale igual venga de donde venga:
// de otra copia de RadQuiz, de una carpeta de temas/ o de una IA que lo armó desde el PDF.
// Lo que la fuente no dice viaja como null y aquí vuelve a ser «vacío», que es lo que espera el editor.
// En la ficha, además, «null» escrito como texto es vacío: una IA que arma el JSON suele escribirlo así,
// y si se cuela el lector acaba viendo «null» donde debería no haber nada.
export function dePaquete(paquete, fuentes) {
  const texto = (v) => (v === null || v === undefined ? "" : String(v));
  const dato = (v) => (["null", "none", "n/a"].includes(texto(v).trim().toLowerCase()) ? "" : texto(v));
  const claves = Object.keys(fuentes || {}).filter((k) => k !== "$schema");
  const clave = claves[0] || "fuente";
  const f = (fuentes || {})[clave] || {};
  const fuente = {
    clave,
    tipo: f.tipo === "caso" ? "caso" : "articulo",
    cita: texto(f.cita),
    credito: texto(f.credito),
    doi: texto(f.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//, ""),
    url: texto(f.url),
    titular: texto(f.titular),
    licencia: texto(f.licencia),
    licencia_url: texto(f.licencia_url) || LICENCIAS.find((l) => l.valor === f.licencia)?.url || "",
    modificaciones_permitidas: !LICENCIAS.find((l) => l.valor === f.licencia)?.nd,
    verificacion: {
      fecha: texto(f.verificacion?.fecha),
      por: texto(f.verificacion?.por),
      donde: texto(f.verificacion?.donde),
    },
  };

  const imagenes = {};
  let orden = 0;
  for (const [id, img] of Object.entries(paquete.imagenes || {})) {
    orden += 1;
    imagenes[id] = {
      archivo: texto(img.archivo) || `${id}.jpg`,
      figura: texto(img.figura),
      leyenda_original: texto(img.leyenda_original),
      modalidad: dato(img.modalidad),
      paneles: lista(img.paneles).map((p) => ({
        id: texto(p.id) || "único", lado: dato(p.lado), plano: dato(p.plano),
        secuencia: dato(p.secuencia), condicion: dato(p.condicion),
      })),
      marcas: lista(img.marcas).map((m) => ({ marca: texto(m.marca), panel: dato(m.panel), senala: texto(m.senala) })),
      modificaciones: lista(img.modificaciones).map(texto),
      ...(img.notas ? { notas: texto(img.notas) } : {}),
      orden,
    };
    if (!imagenes[id].paneles.length) imagenes[id].paneles = [{ id: "único", lado: "", plano: "", secuencia: "", condicion: "" }];
  }

  const casos = {};
  let n = 0;
  for (const c of lista(paquete.casos)) {
    n += 1;
    let id = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.id || "") ? c.id : `caso-${String(n).padStart(2, "0")}`;
    while (casos[id]) id = `${id}b`;
    casos[id] = {
      tema: texto(c.tema),
      tipo: c.tipo === "concepto" ? "concepto" : "imagen",
      enunciado: texto(c.enunciado),
      imagenes: lista(c.imagenes)
        .filter((r) => imagenes[r.ref])
        .map((r) => ({ ref: r.ref, mostrar_en: r.mostrar_en === "respuesta" ? "respuesta" : "pregunta" })),
      opciones: lista(c.opciones).map(texto),
      correcta: Number.isInteger(c.correcta) ? c.correcta : -1,
      ...(c.barajar === false ? { barajar: false } : {}),
      explicacion: texto(c.explicacion),
      perla: texto(c.perla),
      // «fuente» se cae: en el estudio hay una sola por tema y se guarda aparte.
      evidencia: lista(c.evidencia).map((e) => ({ ubicacion: texto(e.ubicacion), cita: texto(e.cita) })),
      etiquetas: lista(c.etiquetas).map(texto).filter(Boolean),
      orden: n,
    };
  }

  const meta = {
    id: texto(paquete.id),
    titulo: texto(paquete.titulo),
    descripcion: texto(paquete.descripcion),
    segmento: texto(paquete.segmento),
    modalidades: lista(paquete.modalidades).map(texto).filter(Boolean),
    version: texto(paquete.version) || "0.1.0",
  };
  return { meta, fuente, imagenes, casos };
}
