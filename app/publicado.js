// RadQuiz — lo que los autores acaban de publicar, leído directamente del estudio.
//
// El sitio de GitHub Pages se arma cuando corre el workflow, así que un tema recién publicado
// tardaría en aparecer. Estos nodos de la base son de lectura pública (database.rules.json),
// así que la web los consulta y el tema sale al instante. No hace falta el SDK de Firebase:
// son peticiones REST normales, y si fallan la web sigue con lo que trajo el sitio.
//
// El sitio manda mientras esté al día: si su versión del tema coincide con la publicada, se usan
// sus archivos, que van por CDN y pesan menos que las imágenes en base64 de la base.
import { cargarJSON } from "./comun.js";
import { firebaseConfig } from "./firebase-config.js";

const BASE = firebaseConfig.databaseURL;
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const USUARIO = /^[a-z0-9._-]+$/;
const IMAGEN = "data:image/jpeg;base64,";

async function leer(ruta) {
  try {
    const respuesta = await fetch(`${BASE}/${ruta}.json`, { cache: "no-store" });
    return respuesta.ok ? await respuesta.json() : null;
  } catch {
    return null; // sin red o base caída: no es un error, la web funciona igual
  }
}

const comoLista = (v) => (Array.isArray(v) ? v : Object.values(v || {}));

// Mismo criterio que sellar() en tools/traer_publicaciones: el sello vale si el radiólogo lo puso
// y el autor no tocó el caso después.
function selloVale(v, actualizados, casoId) {
  if (!v || v.decision !== "verificado" || !USUARIO.test(v.usuario || "")) return false;
  return !((actualizados || {})[casoId] > (v.base || 0));
}

function sellar(paquete, actualizados, verificacion) {
  const personas = { ...(paquete.personas || {}) };
  for (const caso of paquete.casos || []) {
    const v = (verificacion || {})[caso.id];
    caso.revisor = null;
    delete caso.fecha_revision;
    if (!selloVale(v, actualizados, caso.id)) continue;
    caso.revisor = v.usuario;
    caso.fecha_revision = new Date(v.fecha || 0).toISOString().slice(0, 10);
    if (!personas[v.usuario]) personas[v.usuario] = v.nombre || v.usuario;
  }
  if (Object.keys(personas).length) paquete.personas = personas;
}

// La lista de temas publicados, con el mismo formato que temas/indice.json.
// Un tema retirado viene con «retirado», para poder quitarlo de la lista del sitio.
export async function indiceEnVivo() {
  const [indice, verificacion] = await Promise.all([leer("indice_publicado"), leer("verificacion")]);
  if (!indice || typeof indice !== "object") return [];
  const salida = [];
  for (const [id, entrada] of Object.entries(indice)) {
    if (!ID.test(id) || !entrada || typeof entrada !== "object") continue;
    if (!/^[a-z-]+$/.test(entrada.segmento || "")) continue;
    const ruta = `${entrada.segmento}/${id}`;
    if (entrada.retirado) {
      salida.push({ ruta, id, retirado: true });
      continue;
    }
    const sellos = (verificacion || {})[id] || {};
    const publicado = Number(entrada.casos) || 0;
    let verificado = 0;
    for (const [casoId, v] of Object.entries(sellos)) {
      if (selloVale(v, entrada.actualizados, casoId)) verificado++;
    }
    salida.push({
      ruta,
      id,
      titulo: entrada.titulo,
      segmento: entrada.segmento,
      modalidades: comoLista(entrada.modalidades),
      version: entrada.version,
      casos: { borrador: 0, publicado, verificado: Math.min(verificado, publicado) },
      enVivo: true,
    });
  }
  return salida;
}

// Junta la lista del sitio con la del estudio. Gana el estudio cuando la versión no coincide;
// si coincide, se queda la del sitio pero con la cuenta de sellos al día.
export function fusionarIndice(estatico, vivo) {
  const porRuta = new Map((estatico || []).map((p) => [p.ruta, p]));
  for (const p of vivo || []) {
    if (p.retirado) {
      porRuta.delete(p.ruta);
    } else if (!porRuta.has(p.ruta) || porRuta.get(p.ruta).version !== p.version) {
      porRuta.set(p.ruta, p);
    } else {
      const previo = porRuta.get(p.ruta);
      porRuta.set(p.ruta, { ...previo, casos: { ...previo.casos, ...p.casos } });
    }
  }
  return [...porRuta.values()];
}

async function temaEnVivo(ruta, versionDelSitio) {
  const id = ruta.split("/").pop();
  if (!ID.test(id)) return null;
  const entrada = await leer(`indice_publicado/${id}`);
  if (!entrada || entrada.retirado) return null;
  if (versionDelSitio && entrada.version === versionDelSitio) return null; // el sitio ya está al día

  const [publicacion, imagenes, verificacion] = await Promise.all([
    leer(`publicacion/${id}`), leer(`publicacion_img/${id}`), leer(`verificacion/${id}`),
  ]);
  if (!publicacion || !publicacion.paquete_json) return null;
  let paquete, fuentes;
  try {
    paquete = JSON.parse(publicacion.paquete_json);
    fuentes = JSON.parse(publicacion.fuentes_json || "{}");
  } catch {
    return null; // paquete ilegible: mejor lo del sitio que una pantalla rota
  }
  if (!Array.isArray(paquete.casos)) return null;
  paquete.version = publicacion.version || paquete.version;
  sellar(paquete, publicacion.actualizados, verificacion);
  const datos = imagenes || {};
  return {
    paquete,
    fuentes,
    // Las imágenes vienen en base64 desde la base; solo se aceptan JPEG, como exigen las reglas.
    imagen: (ref) => (String(datos[ref] || "").startsWith(IMAGEN) ? datos[ref] : ""),
  };
}

// Carga un tema para practicar o para la sala, del sitio o del estudio, lo que esté más al día.
// Devuelve { paquete, fuentes, imagen(ref) }.
export async function cargarPaquete(ruta) {
  const carpeta = `temas/${ruta}`;
  let delSitio = null;
  try {
    const [paquete, fuentes] = await Promise.all([
      cargarJSON(`${carpeta}/paquete.json`),
      cargarJSON(`${carpeta}/fuentes.json`),
    ]);
    delSitio = {
      paquete,
      fuentes,
      imagen: (ref) => {
        const ficha = (paquete.imagenes || {})[ref];
        return ficha ? `${carpeta}/img/${encodeURIComponent(ficha.archivo)}` : "";
      },
    };
  } catch {
    // El tema puede ser tan nuevo que el sitio todavía no lo tiene: se intenta con el estudio.
  }
  const vivo = await temaEnVivo(ruta, delSitio?.paquete?.version);
  if (vivo) return vivo;
  if (delSitio) return delSitio;
  throw new Error("No se pudo cargar el tema");
}
