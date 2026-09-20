// RadQuiz — lo que entra de fuera: figuras sueltas y cuestionarios enteros en un .zip.
//
// El .zip es la misma carpeta que en el repositorio: paquete.json, fuentes.json e img/. Así el mismo
// archivo sirve para traer un tema de otra copia de RadQuiz, de temas/ o de una IA que lo armó desde
// el PDF, y el que se descarga del estudio se puede mandar tal cual a Git.
import { leerZip } from "./zip.js";
import { dePaquete, lista } from "./validacion.js";

const TEXTO = new TextDecoder("utf-8");

// Deja la figura por debajo de 250 KB y 1600 px de lado mayor, que es lo que pide el formato.
// Redimensionar y comprimir son las dos únicas modificaciones que permiten las licencias ND.
export async function comprimir(archivo) {
  const bitmap = await createImageBitmap(archivo);
  let escala = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  let calidad = 0.88;
  for (let intento = 0; intento < 10; intento++) {
    const ancho = Math.round(bitmap.width * escala);
    const alto = Math.round(bitmap.height * escala);
    const lienzo = document.createElement("canvas");
    lienzo.width = ancho;
    lienzo.height = alto;
    const ctx = lienzo.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, ancho, alto);
    ctx.drawImage(bitmap, 0, 0, ancho, alto);
    const datos = lienzo.toDataURL("image/jpeg", calidad);
    if (datos.length < 330000) {
      return { datos, modificaciones: ["comprimida", ...(escala < 1 ? ["redimensionada"] : [])] };
    }
    if (calidad > 0.6) calidad -= 0.08;
    else escala *= 0.85;
  }
  throw new Error("No pude comprimir esta imagen por debajo de 250 KB.");
}

// Devuelve el cuestionario listo para enseñárselo al autor, sin escribir nada todavía:
// { meta, fuente, imagenes, casos, datos, faltan, nombre }. «datos» son las figuras en dataURL.
export async function abrirZip(archivo) {
  if (archivo.size > 80 * 1024 * 1024) throw new Error("El .zip pesa más de 80 MB. Debe traer imágenes sin comprimir.");
  const bruto = await leerZip(archivo);
  const util = new Map();
  for (const [nombre, datos] of bruto) {
    if (nombre.startsWith("__MACOSX/") || nombre.split("/").pop().startsWith(".")) continue;
    util.set(nombre, datos);
  }
  // Comprimir una carpeta en el Finder o en Windows mete todo dentro de «mi-tema/»: se ignora ese nivel.
  const clave = [...util.keys()].find((n) => n === "paquete.json" || n.endsWith("/paquete.json"));
  if (!clave) throw new Error("El .zip no trae «paquete.json». Tiene que llevar paquete.json, fuentes.json y la carpeta img/.");
  const raiz = clave.slice(0, clave.length - "paquete.json".length);
  const de = (nombre) => util.get(raiz + nombre);

  let paquete, fuentes;
  try {
    paquete = JSON.parse(TEXTO.decode(de("paquete.json")));
  } catch {
    throw new Error("«paquete.json» no es un JSON válido. Pídele a tu IA que lo devuelva entero.");
  }
  try {
    fuentes = de("fuentes.json") ? JSON.parse(TEXTO.decode(de("fuentes.json"))) : {};
  } catch {
    throw new Error("«fuentes.json» no es un JSON válido.");
  }
  if (!lista(paquete.casos).length) throw new Error("«paquete.json» no trae ningún caso.");

  const { meta, fuente, imagenes, casos } = dePaquete(paquete, fuentes);
  if (!meta.titulo) throw new Error("«paquete.json» no trae título.");
  const datos = {};
  const faltan = [];
  for (const [id, img] of Object.entries(imagenes)) {
    const bytes = de(`img/${img.archivo}`);
    if (!bytes) { faltan.push(img.archivo); continue; }
    try {
      // Se vuelve a comprimir aquí: el límite lo pone el estudio, no quien armó el .zip.
      const { datos: url, modificaciones } = await comprimir(new Blob([bytes], { type: "image/jpeg" }));
      datos[id] = url;
      img.modificaciones = [...new Set([...img.modificaciones, ...modificaciones])];
    } catch {
      faltan.push(img.archivo);
    }
  }
  return { meta, fuente, imagenes, casos, datos, faltan, nombre: archivo.name };
}
