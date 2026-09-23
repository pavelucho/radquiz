// RadQuiz — las figuras publicadas viven en el Google Drive de quien publica el tema.
//
// Al publicar, el estudio sube cada figura a una carpeta del Drive del autor y la comparte con «cualquiera
// con el enlace». RadQuiz guarda solo el identificador de cada archivo: no aloja la copia, y el autor la
// retira borrándola de su Drive. El permiso que se pide es «drive.file»: la app solo ve los archivos que ella
// misma creó, nunca el resto del Drive.
//
// Este módulo no carga el SDK de Firebase: la web lo usa solo para armar las URL de las figuras, y el
// estudio, que es quien consigue el permiso, le pasa el token de acceso a cada función.
import { claveDrive } from "./firebase-config.js";

export const ALCANCE_DRIVE = "https://www.googleapis.com/auth/drive.file";
const API = "https://www.googleapis.com/drive/v3";
const SUBIDA = "https://www.googleapis.com/upload/drive/v3";
const CARPETA = "application/vnd.google-apps.folder";

// Los identificadores de Drive son letras, números, «-» y «_». Solo eso entra en una URL de la web.
export const ID_DRIVE = /^[A-Za-z0-9_-]{20,100}$/;

// La figura tal como la ve cualquiera, sin sesión: la API documentada de Drive con la clave del sitio.
export function urlDrive(id) {
  return ID_DRIVE.test(id || "") ? `${API}/files/${id}?alt=media&key=${encodeURIComponent(claveDrive)}` : "";
}

// Para que el autor abra su carpeta en Drive.
export function enlaceCarpeta(id) {
  return ID_DRIVE.test(id || "") ? `https://drive.google.com/drive/folders/${id}` : "";
}

async function leerError(respuesta) {
  try {
    const { error = {} } = await respuesta.json();
    const razon = error.errors?.[0]?.reason || error.details?.find((d) => d.reason)?.reason || error.status || "";
    return { razon, detalle: error.message || "" };
  } catch {
    return { razon: "", detalle: "" };
  }
}

// Un error con un mensaje que el autor pueda entender, y el código de Drive para quien lo necesite.
function errorDrive(status, razon, detalle, accion) {
  const texto = `${razon} ${detalle}`;
  let mensaje;
  if (status === 401) mensaje = "El permiso de Google Drive venció. Vuelve a intentarlo.";
  else if (/accessNotConfigured|SERVICE_DISABLED|has not been used/i.test(texto)) {
    mensaje = "La API de Google Drive no está habilitada en el proyecto de RadQuiz. Avisa al coordinador.";
  } else if (/insufficient|SCOPE/i.test(texto)) {
    mensaje = "Google no dio permiso para usar tu Drive. Vuelve a publicar y, en la ventana de Google, marca la casilla de Google Drive.";
  } else if (/storageQuotaExceeded/i.test(texto)) mensaje = "Tu Google Drive está lleno.";
  else if (status === 403 && accion === "compartir") {
    mensaje = "Tu cuenta no deja compartir archivos con «cualquiera con el enlace» (pasa con algunas cuentas institucionales). Publica con una cuenta de Gmail personal.";
  } else mensaje = `Google Drive respondió ${status}${detalle ? `: ${detalle}` : ""}`;
  const error = new Error(mensaje);
  error.status = status;
  error.razon = razon;
  return error;
}

// Una llamada a la API con el token del autor. Lo pasajero (límites de ritmo, errores del servidor) se
// reintenta con esperas crecientes; lo demás se convierte en un error legible.
async function llamar(token, url, opciones = {}, accion = "") {
  for (let intento = 0; ; intento++) {
    const respuesta = await fetch(url, { ...opciones, headers: { ...(opciones.headers || {}), Authorization: `Bearer ${token}` } });
    if (respuesta.ok) return respuesta.status === 204 ? null : respuesta.json();
    const { razon, detalle } = await leerError(respuesta);
    const pasajero = respuesta.status === 429 || respuesta.status >= 500 || /rateLimitExceeded/i.test(razon);
    if (!pasajero || intento >= 3) throw errorDrive(respuesta.status, razon, detalle, accion);
    await new Promise((listo) => setTimeout(listo, 800 * 2 ** intento));
  }
}

const JSON_UTF8 = { "Content-Type": "application/json; charset=UTF-8" };

// ¿Sigue ese archivo (o carpeta) en el Drive, fuera de la papelera? Con drive.file solo se ven los que creó RadQuiz.
export async function existeEnDrive(token, id) {
  if (!ID_DRIVE.test(id || "")) return false;
  try {
    const archivo = await llamar(token, `${API}/files/${id}?fields=id,trashed`);
    return Boolean(archivo && !archivo.trashed);
  } catch (e) {
    if (e.status === 404) return false;
    throw e;
  }
}

// La carpeta del tema en el Drive del autor: la de la vez anterior si sigue ahí, o una nueva.
export async function carpetaDelTema(token, { anterior, nombre }) {
  if (await existeEnDrive(token, anterior)) return anterior;
  const carpeta = await llamar(token, `${API}/files?fields=id`, {
    method: "POST",
    headers: JSON_UTF8,
    body: JSON.stringify({
      name: nombre,
      mimeType: CARPETA,
      description: "Figuras publicadas en RadQuiz. Si borras esta carpeta, el tema se queda sin imágenes.",
    }),
  });
  return carpeta.id;
}

// Los archivos que RadQuiz dejó en la carpeta y siguen fuera de la papelera.
export async function archivosDeCarpeta(token, carpeta) {
  if (!ID_DRIVE.test(carpeta || "")) return [];
  const consulta = encodeURIComponent(`'${carpeta}' in parents and trashed = false`);
  const archivos = [];
  let pagina = "";
  do {
    const siguiente = pagina ? `&pageToken=${encodeURIComponent(pagina)}` : "";
    const lista = await llamar(token, `${API}/files?q=${consulta}&fields=nextPageToken,files(id)&pageSize=1000${siguiente}`);
    archivos.push(...(lista.files || []));
    pagina = lista.nextPageToken || "";
  } while (pagina);
  return archivos;
}

// Manda a la papelera un archivo, o una carpeta con todo lo que tiene. Solo puede con lo que creó RadQuiz.
// Si ya no está, no hay nada que hacer.
export async function aLaPapelera(token, id) {
  if (!ID_DRIVE.test(id || "")) return;
  try {
    await llamar(token, `${API}/files/${id}?fields=id`, {
      method: "PATCH",
      headers: JSON_UTF8,
      body: JSON.stringify({ trashed: true }),
    });
  } catch (e) {
    if (e.status !== 404) throw e;
  }
}

// Sube una figura a la carpeta y la comparte con «cualquiera con el enlace» (sin que aparezca en búsquedas).
// Si no se puede compartir, el archivo no se queda a medias: va a la papelera. Devuelve su id.
export async function subirFigura(token, { carpeta, nombre, bytes, descripcion = "" }) {
  const limite = `radquiz-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const meta = { name: nombre, parents: [carpeta], mimeType: "image/jpeg", description: descripcion };
  const cuerpo = new Blob([
    `--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
    `--${limite}\r\nContent-Type: image/jpeg\r\n\r\n`,
    bytes,
    `\r\n--${limite}--\r\n`,
  ]);
  const archivo = await llamar(token, `${SUBIDA}/files?uploadType=multipart&fields=id`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${limite}` },
    body: cuerpo,
  });
  try {
    await llamar(token, `${API}/files/${archivo.id}/permissions?fields=id`, {
      method: "POST",
      headers: JSON_UTF8,
      body: JSON.stringify({ role: "reader", type: "anyone", allowFileDiscovery: false }),
    }, "compartir");
  } catch (e) {
    await aLaPapelera(token, archivo.id).catch(() => {});
    throw e;
  }
  return archivo.id;
}

// Huella corta del contenido: si la figura no cambió, al volver a publicar se reutiliza el mismo archivo.
export async function huella(bytes) {
  const resumen = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...resumen.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
