// RadQuiz — códigos QR sin dependencias: modo byte, corrección de errores M, versiones 1 a 10.
// Alcanza de sobra para el enlace de una sala (hasta 216 bytes) y evita cargar una librería externa,
// que en la red del hospital puede no llegar. Implementa ISO/IEC 18004 en lo que hace falta.

// Por versión: [palabras de corrección por bloque, [[cuántos bloques, palabras de datos por bloque], …]]
const BLOQUES = {
  1: [10, [[1, 16]]],
  2: [16, [[1, 28]]],
  3: [26, [[1, 44]]],
  4: [18, [[2, 32]]],
  5: [24, [[2, 43]]],
  6: [16, [[4, 27]]],
  7: [18, [[4, 31]]],
  8: [22, [[2, 38], [2, 39]]],
  9: [22, [[3, 36], [2, 37]]],
  10: [26, [[4, 43], [1, 44]]],
};

// Centros de los patrones de alineación.
const ALINEACION = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

const palabrasDeDatos = (version) => BLOQUES[version][1].reduce((suma, [n, d]) => suma + n * d, 0);

// ------------------------------------------------------------------ campo de Galois GF(256)
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x = (x << 1) ^ (x & 0x80 ? 0x11d : 0);
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function generador(grado) {
  let p = [1];
  for (let i = 0; i < grado; i++) {
    const q = new Array(p.length + 1).fill(0);
    for (let j = 0; j < p.length; j++) {
      q[j] ^= p[j];
      q[j + 1] ^= mul(p[j], EXP[i]);
    }
    p = q;
  }
  return p;
}

// Resto de Reed-Solomon: las palabras de corrección de un bloque.
function correccion(datos, grado) {
  const g = generador(grado);
  const resto = new Uint8Array(datos.length + grado);
  resto.set(datos);
  for (let i = 0; i < datos.length; i++) {
    const factor = resto[i];
    if (!factor) continue;
    for (let j = 0; j < g.length; j++) resto[i + j] ^= mul(g[j], factor);
  }
  return [...resto.slice(datos.length)];
}

// ------------------------------------------------------------------ datos
function elegirVersion(largo) {
  for (let v = 1; v <= 10; v++) {
    const cuenta = v < 10 ? 8 : 16;
    if (4 + cuenta + 8 * largo <= palabrasDeDatos(v) * 8) return v;
  }
  throw new Error("el texto es demasiado largo para un QR de versión 10");
}

function codificar(bytes, version) {
  const total = palabrasDeDatos(version);
  const bits = [];
  const escribir = (valor, cuantos) => {
    for (let i = cuantos - 1; i >= 0; i--) bits.push((valor >>> i) & 1);
  };
  escribir(0b0100, 4);                              // modo byte
  escribir(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) escribir(b, 8);
  escribir(0, Math.min(4, total * 8 - bits.length)); // terminador
  while (bits.length % 8) bits.push(0);
  const palabras = [];
  for (let i = 0; i < bits.length; i += 8) {
    palabras.push(bits.slice(i, i + 8).reduce((v, bit) => (v << 1) | bit, 0));
  }
  for (let i = 0; palabras.length < total; i++) palabras.push(i % 2 ? 0x11 : 0xec); // relleno
  return palabras;
}

// Reparte en bloques, calcula la corrección y los entrelaza como manda la norma.
function entrelazar(palabras, version) {
  const [grado, grupos] = BLOQUES[version];
  const datos = [];
  const ec = [];
  let desde = 0;
  for (const [cuantos, largo] of grupos) {
    for (let i = 0; i < cuantos; i++) {
      const bloque = palabras.slice(desde, desde + largo);
      desde += largo;
      datos.push(bloque);
      ec.push(correccion(bloque, grado));
    }
  }
  const salida = [];
  const maximo = Math.max(...datos.map((b) => b.length));
  for (let i = 0; i < maximo; i++) for (const bloque of datos) if (i < bloque.length) salida.push(bloque[i]);
  for (let i = 0; i < grado; i++) for (const bloque of ec) salida.push(bloque[i]);
  return salida;
}

// ------------------------------------------------------------------ matriz
function lienzo(version) {
  const n = version * 4 + 17;
  const modulos = Array.from({ length: n }, () => new Array(n).fill(0));
  const funcion = Array.from({ length: n }, () => new Array(n).fill(false));
  const poner = (y, x, v) => {
    if (y < 0 || x < 0 || y >= n || x >= n) return;
    modulos[y][x] = v;
    funcion[y][x] = true;
  };

  // Buscadores (las tres esquinas) con su separador.
  for (const [fy, fx] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    for (let y = -1; y <= 7; y++) {
      for (let x = -1; x <= 7; x++) {
        const borde = y === -1 || y === 7 || x === -1 || x === 7;
        const anillo = y === 0 || y === 6 || x === 0 || x === 6;
        const centro = y >= 2 && y <= 4 && x >= 2 && x <= 4;
        poner(fy + y, fx + x, !borde && (anillo || centro) ? 1 : 0);
      }
    }
  }

  // Patrones de alineación, salvo los que caerían sobre un buscador.
  const centros = ALINEACION[version];
  for (const cy of centros) {
    for (const cx of centros) {
      if (funcion[cy][cx]) continue;
      for (let y = -2; y <= 2; y++) {
        for (let x = -2; x <= 2; x++) poner(cy + y, cx + x, Math.max(Math.abs(y), Math.abs(x)) === 1 ? 0 : 1);
      }
    }
  }

  // Líneas de tiempo.
  for (let i = 8; i < n - 8; i++) {
    if (!funcion[6][i]) poner(6, i, i % 2 === 0 ? 1 : 0);
    if (!funcion[i][6]) poner(i, 6, i % 2 === 0 ? 1 : 0);
  }

  // Información de versión (solo 7 en adelante).
  if (version >= 7) {
    let resto = version;
    for (let i = 0; i < 12; i++) resto = (resto << 1) ^ ((resto >>> 11) * 0x1f25);
    const bits = (version << 12) | resto;
    for (let i = 0; i < 18; i++) {
      const bit = (bits >>> i) & 1;
      const a = n - 11 + (i % 3);
      const b = Math.floor(i / 3);
      poner(b, a, bit);
      poner(a, b, bit);
    }
  }

  // El formato se reserva ahora y se escribe al final, cuando se sabe la máscara.
  dibujarFormato(modulos, 0, funcion);
  return { modulos, funcion, n };
}

function dibujarFormato(modulos, mascara, funcion = null) {
  const n = modulos.length;
  const datos = mascara; // nivel M = 00, así que solo quedan los tres bits de la máscara
  let resto = datos;
  for (let i = 0; i < 10; i++) resto = (resto << 1) ^ ((resto >>> 9) * 0x537);
  const bits = ((datos << 10) | resto) ^ 0x5412;
  const poner = (y, x, v) => {
    modulos[y][x] = v;
    if (funcion) funcion[y][x] = true;
  };
  const bit = (i) => (bits >>> i) & 1;
  for (let i = 0; i <= 5; i++) poner(i, 8, bit(i));
  poner(7, 8, bit(6));
  poner(8, 8, bit(7));
  poner(8, 7, bit(8));
  for (let i = 9; i < 15; i++) poner(8, 14 - i, bit(i));
  for (let i = 0; i < 8; i++) poner(8, n - 1 - i, bit(i));
  for (let i = 8; i < 15; i++) poner(n - 15 + i, 8, bit(i));
  poner(n - 8, 8, 1); // módulo siempre oscuro
}

// Recorrido en zigzag, de derecha a izquierda y de dos en dos columnas.
function colocarDatos(modulos, funcion, palabras) {
  const n = modulos.length;
  let i = 0;
  for (let derecha = n - 1; derecha >= 1; derecha -= 2) {
    if (derecha === 6) derecha = 5; // la columna 6 es la línea de tiempo
    for (let v = 0; v < n; v++) {
      for (let j = 0; j < 2; j++) {
        const x = derecha - j;
        const subiendo = ((derecha + 1) & 2) === 0;
        const y = subiendo ? n - 1 - v : v;
        if (funcion[y][x] || i >= palabras.length * 8) continue;
        modulos[y][x] = (palabras[i >>> 3] >>> (7 - (i & 7))) & 1;
        i++;
      }
    }
  }
}

const MASCARAS = [
  (y, x) => (y + x) % 2 === 0,
  (y) => y % 2 === 0,
  (y, x) => x % 3 === 0,
  (y, x) => (y + x) % 3 === 0,
  (y, x) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (y, x) => ((y * x) % 2) + ((y * x) % 3) === 0,
  (y, x) => (((y * x) % 2) + ((y * x) % 3)) % 2 === 0,
  (y, x) => (((y + x) % 2) + ((y * x) % 3)) % 2 === 0,
];

// XOR: llamarla dos veces con la misma máscara deja la matriz como estaba.
function aplicarMascara(modulos, funcion, mascara) {
  const n = modulos.length;
  const regla = MASCARAS[mascara];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) if (!funcion[y][x] && regla(y, x)) modulos[y][x] ^= 1;
  }
}

// Las cuatro reglas de penalización de la norma: gana la máscara con menos puntos.
function penalizacion(modulos) {
  const n = modulos.length;
  const lineas = [];
  for (let y = 0; y < n; y++) lineas.push(modulos[y].join(""));
  for (let x = 0; x < n; x++) {
    let columna = "";
    for (let y = 0; y < n; y++) columna += modulos[y][x];
    lineas.push(columna);
  }
  let total = 0;
  for (const linea of lineas) {
    for (const tirada of linea.match(/0{5,}|1{5,}/g) || []) total += 3 + tirada.length - 5;
    const conBorde = `0000${linea}0000`;
    for (const patron of ["10111010000", "00001011101"]) {
      let desde = conBorde.indexOf(patron);
      while (desde !== -1) {
        total += 40;
        desde = conBorde.indexOf(patron, desde + 1);
      }
    }
  }
  let oscuros = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      oscuros += modulos[y][x];
      if (y && x && modulos[y][x] === modulos[y - 1][x] && modulos[y][x] === modulos[y][x - 1]
        && modulos[y][x] === modulos[y - 1][x - 1]) total += 3;
    }
  }
  return total + 10 * Math.floor(Math.abs((100 * oscuros) / (n * n) - 50) / 5);
}

// Matriz de 0 y 1 con el QR del texto.
export function qr(texto) {
  const bytes = new TextEncoder().encode(texto);
  const version = elegirVersion(bytes.length);
  const palabras = entrelazar(codificar(bytes, version), version);
  const { modulos, funcion } = lienzo(version);
  colocarDatos(modulos, funcion, palabras);
  let elegida = 0;
  let mejor = Infinity;
  for (let mascara = 0; mascara < 8; mascara++) {
    aplicarMascara(modulos, funcion, mascara);
    dibujarFormato(modulos, mascara);
    const puntos = penalizacion(modulos);
    if (puntos < mejor) {
      mejor = puntos;
      elegida = mascara;
    }
    aplicarMascara(modulos, funcion, mascara);
  }
  aplicarMascara(modulos, funcion, elegida);
  dibujarFormato(modulos, elegida);
  return modulos;
}

// SVG con fondo blanco y margen de 4 módulos: los lectores necesitan ambas cosas.
export function qrSVG(texto, { lado = 1000, margen = 4 } = {}) {
  const modulos = qr(texto);
  const n = modulos.length;
  const caja = n + margen * 2;
  const camino = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) if (modulos[y][x]) camino.push(`M${x + margen} ${y + margen}h1v1h-1z`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${caja} ${caja}" width="${lado}" height="${lado}" shape-rendering="crispEdges">`
    + `<rect width="${caja}" height="${caja}" fill="#fff"/><path d="${camino.join("")}" fill="#000"/></svg>`;
}

export function qrDataURI(texto, opciones) {
  return `data:image/svg+xml,${encodeURIComponent(qrSVG(texto, opciones))}`;
}
