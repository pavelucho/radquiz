// RadQuiz — abrir y armar archivos .zip en el navegador, sin librerías.
//
// Solo hace falta lo que usan «zip», el Finder, el Explorador de Windows, 7-Zip y el módulo
// zipfile de Python: entradas guardadas tal cual (método 0) o comprimidas con deflate (método 8).
// Descomprimir lo hace el propio navegador con DecompressionStream, así que este archivo son
// cabeceras y desplazamientos, nada de algoritmos.
//
// Al escribir se guarda sin comprimir: un JPEG ya está comprimido y no baja nada, y así el .zip
// se arma sin depender de CompressionStream. Sigue siendo un .zip normal, que abre cualquiera.

const TEXTO = new TextDecoder("utf-8");
const FIRMA_LOCAL = 0x04034b50;
const FIRMA_DIRECTORIO = 0x02014b50;
const FIRMA_FIN = 0x06054b50;

const u16 = (v, i) => v.getUint16(i, true);
const u32 = (v, i) => v.getUint32(i, true);

// El final del directorio está al final del archivo, pero puede llevar detrás un comentario
// de hasta 64 KB, así que se busca hacia atrás.
function finDelDirectorio(vista) {
  const hasta = Math.max(0, vista.byteLength - 65557);
  for (let i = vista.byteLength - 22; i >= hasta; i--) {
    if (u32(vista, i) === FIRMA_FIN) return i;
  }
  return -1;
}

async function extraer(buffer, vista, entrada, nombre) {
  const cabecera = entrada.desplazamiento;
  if (cabecera + 30 > vista.byteLength || u32(vista, cabecera) !== FIRMA_LOCAL) {
    throw new Error(`No pude leer «${nombre}»: el .zip está dañado.`);
  }
  // El nombre y los extras de la cabecera local pueden medir distinto que en el directorio.
  const inicio = cabecera + 30 + u16(vista, cabecera + 26) + u16(vista, cabecera + 28);
  if (inicio + entrada.comprimido > vista.byteLength) {
    throw new Error(`No pude leer «${nombre}»: el .zip está incompleto.`);
  }
  const trozo = new Uint8Array(buffer, inicio, entrada.comprimido);
  if (entrada.metodo === 0) return trozo.slice();
  if (entrada.metodo !== 8) throw new Error(`«${nombre}» viene con una compresión que no sé abrir.`);
  if (typeof DecompressionStream !== "function") {
    throw new Error("Este navegador no sabe abrir .zip. Actualízalo, o usa Chrome, Edge, Safari o Firefox al día.");
  }
  const flujo = new Blob([trozo]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(flujo).arrayBuffer());
}

// Devuelve un Map de «ruta dentro del zip» → Uint8Array. Las carpetas no salen.
export async function leerZip(archivo) {
  const buffer = await archivo.arrayBuffer();
  const vista = new DataView(buffer);
  const fin = finDelDirectorio(vista);
  if (fin === -1) throw new Error("Esto no parece un archivo .zip.");
  const cuantos = u16(vista, fin + 10);
  const inicio = u32(vista, fin + 16);
  if (cuantos === 0xffff || inicio === 0xffffffff) throw new Error("El .zip es demasiado grande (formato zip64).");

  const entradas = [];
  let p = inicio;
  for (let n = 0; n < cuantos; n++) {
    if (p + 46 > vista.byteLength || u32(vista, p) !== FIRMA_DIRECTORIO) throw new Error("El .zip está dañado.");
    const bandera = u16(vista, p + 8);
    const largoNombre = u16(vista, p + 28);
    const entrada = {
      metodo: u16(vista, p + 10),
      comprimido: u32(vista, p + 20),
      desplazamiento: u32(vista, p + 42),
      nombre: TEXTO.decode(new Uint8Array(buffer, p + 46, largoNombre)),
    };
    p += 46 + largoNombre + u16(vista, p + 30) + u16(vista, p + 32);
    if (bandera & 1) throw new Error("El .zip tiene contraseña.");
    if (!entrada.nombre.endsWith("/")) entradas.push(entrada);
  }

  const salida = new Map();
  for (const entrada of entradas) salida.set(entrada.nombre, await extraer(buffer, vista, entrada, entrada.nombre));
  return salida;
}

const TABLA_CRC = (() => {
  const tabla = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabla[n] = c >>> 0;
  }
  return tabla;
})();

function crc32(datos) {
  let c = 0xffffffff;
  for (let i = 0; i < datos.length; i++) c = TABLA_CRC[(c ^ datos[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// El .zip guarda la fecha como la guardaba MS-DOS: dos enteros de 16 bits.
function fechaDos(d) {
  const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const fecha = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return [hora, fecha];
}

// archivos: [{ nombre, datos }], donde datos es un texto o un Uint8Array. Devuelve un Blob.
export function crearZip(archivos) {
  const codificador = new TextEncoder();
  const [hora, fecha] = fechaDos(new Date());
  const cuerpo = [];
  const directorio = [];
  let desplazamiento = 0;
  let largoDirectorio = 0;

  for (const { nombre, datos } of archivos) {
    const bytes = typeof datos === "string" ? codificador.encode(datos) : datos;
    const nombreBytes = codificador.encode(nombre);
    const suma = crc32(bytes);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, FIRMA_LOCAL, true);
    local.setUint16(4, 20, true);      // versión mínima para abrirlo
    local.setUint16(6, 0x0800, true);  // los nombres van en UTF-8
    local.setUint16(8, 0, true);       // guardado, sin comprimir
    local.setUint16(10, hora, true);
    local.setUint16(12, fecha, true);
    local.setUint32(14, suma, true);
    local.setUint32(18, bytes.length, true);
    local.setUint32(22, bytes.length, true);
    local.setUint16(26, nombreBytes.length, true);
    cuerpo.push(new Uint8Array(local.buffer), nombreBytes, bytes);

    const ficha = new DataView(new ArrayBuffer(46));
    ficha.setUint32(0, FIRMA_DIRECTORIO, true);
    ficha.setUint16(4, 20, true);
    ficha.setUint16(6, 20, true);
    ficha.setUint16(8, 0x0800, true);
    ficha.setUint16(10, 0, true);
    ficha.setUint16(12, hora, true);
    ficha.setUint16(14, fecha, true);
    ficha.setUint32(16, suma, true);
    ficha.setUint32(20, bytes.length, true);
    ficha.setUint32(24, bytes.length, true);
    ficha.setUint16(28, nombreBytes.length, true);
    ficha.setUint32(42, desplazamiento, true);
    directorio.push(new Uint8Array(ficha.buffer), nombreBytes);

    desplazamiento += 30 + nombreBytes.length + bytes.length;
    largoDirectorio += 46 + nombreBytes.length;
  }

  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, FIRMA_FIN, true);
  fin.setUint16(8, archivos.length, true);
  fin.setUint16(10, archivos.length, true);
  fin.setUint32(12, largoDirectorio, true);
  fin.setUint32(16, desplazamiento, true);
  return new Blob([...cuerpo, ...directorio, new Uint8Array(fin.buffer)], { type: "application/zip" });
}

export function descargarArchivo(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombre;
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function bytesDeDataURL(url) {
  const base64 = String(url || "").split(",")[1] || "";
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}
