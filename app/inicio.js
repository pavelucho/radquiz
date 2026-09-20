// RadQuiz — pantalla de inicio: lista los temas por segmento. La lista sale de temas/indice.json,
// que arma el sitio, más lo que se acaba de publicar en el estudio y el sitio todavía no trae.
import { $, esc, cargarJSON, SEGMENTOS } from "./comun.js";
import { indiceEnVivo, fusionarIndice } from "./publicado.js";

const app = $("#app");

function tarjeta(paquete) {
  const { publicado = 0, revisado = 0, borrador = 0 } = paquete.casos || {};
  const ruta = encodeURIComponent(paquete.ruta).replace("%2F", "/");
  const practicar = publicado
    ? `<a class="boton primary" href="practica.html?tema=${ruta}">Practicar · ${publicado} casos</a>`
    : `<button disabled>Sin publicar</button>`;
  const pendientes = borrador + revisado;
  const revisar = pendientes
    ? `<a class="src" href="practica.html?tema=${ruta}&amp;revision=1">Ver ${pendientes} casos sin publicar (revisores)</a>`
    : "";
  return `<article class="panel tema-card">
    <h3>${esc(paquete.titulo)}</h3>
    <p class="meta">${esc((paquete.modalidades || []).join(", "))} · versión ${esc(paquete.version)}</p>
    <div class="row">${practicar}</div>
    ${revisar}
  </article>`;
}

async function iniciar() {
  const [indice, vivo] = await Promise.all([
    cargarJSON("temas/indice.json").catch(() => null),
    indiceEnVivo(),
  ]);
  if (!indice && !vivo.length) {
    app.innerHTML = `<section class="panel"><h2>No encontré la lista de temas</h2>
      <p class="muted" style="margin-top:8px">Falta <code>temas/indice.json</code>. Se genera con <code>tools/validar --indice</code>.</p></section>`;
    return;
  }
  const porSegmento = new Map();
  for (const paquete of fusionarIndice(indice?.paquetes || [], vivo)) {
    if (!porSegmento.has(paquete.segmento)) porSegmento.set(paquete.segmento, []);
    porSegmento.get(paquete.segmento).push(paquete);
  }
  if (!porSegmento.size) {
    app.innerHTML = `<p class="muted">Todavía no hay temas.</p>`;
    return;
  }
  const orden = Object.keys(SEGMENTOS).filter((s) => porSegmento.has(s));
  app.innerHTML = `<div style="display:grid;gap:22px">${orden.map((s) => `
    <section class="segmento">
      <h2>${esc(SEGMENTOS[s])}</h2>
      <div class="temas">${porSegmento.get(s).map(tarjeta).join("")}</div>
    </section>`).join("")}</div>`;
}

iniciar();
