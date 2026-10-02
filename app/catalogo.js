// RadQuiz — los temas publicados y sus casos, para los juegos que se arman con varios temas (tablero y Tabú).
// Solo lee lo publicado: el sitio (temas/indice.json) y el estudio (app/publicado.js), fusionados.
import { cargarJSON, SEGMENTOS } from "./comun.js";
import { cargarPaquete, indiceEnVivo, fusionarIndice } from "./publicado.js";
import { claveDe, grupoDe } from "./tablero.js";

// Los temas con algún caso publicado, ordenados por segmento y por título.
export async function cargarIndice() {
  const [estatico, vivo] = await Promise.all([cargarJSON("temas/indice.json").catch(() => null), indiceEnVivo()]);
  const orden = Object.keys(SEGMENTOS);
  return fusionarIndice(estatico?.paquetes || [], vivo)
    .filter((p) => (p.casos?.publicado || 0) > 0)
    .sort((a, b) => orden.indexOf(a.segmento) - orden.indexOf(b.segmento) || a.titulo.localeCompare(b.titulo));
}

// Carga en `datosDe` (ruta → { paquete, fuentes, imagen(ref) }) los temas que falten. Un tema que no carga se omite.
export async function cargarTemas(rutas, datosDe) {
  const faltan = rutas.filter((ruta) => !datosDe.has(ruta));
  const cargados = await Promise.all(faltan.map((ruta) => cargarPaquete(ruta).then((d) => [ruta, d], () => [ruta, null])));
  for (const [ruta, datos] of cargados) if (datos) datosDe.set(ruta, datos);
}

// Solo casos publicados; sin «Incluir casos sin verificar», solo los que tienen el sello de un radiólogo.
// Devuelve clave «<paquete>/<caso>» → { clave, ruta, paquete, caso, grupo }.
export function armarCatalogo(rutas, datosDe, sinVerificar) {
  const catalogo = new Map();
  for (const ruta of rutas) {
    const datos = datosDe.get(ruta);
    for (const caso of datos?.paquete.casos || []) {
      if (caso.estado !== "publicado" || (!sinVerificar && !caso.revisor)) continue;
      const clave = claveDe(datos.paquete.id, caso.id);
      catalogo.set(clave, { clave, ruta, paquete: datos.paquete.id, caso, grupo: grupoDe(caso) });
    }
  }
  return catalogo;
}
