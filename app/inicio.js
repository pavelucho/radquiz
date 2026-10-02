// RadQuiz — pantalla de inicio: lista los temas por segmento. La lista sale de temas/indice.json,
// que arma el sitio, más lo que se acaba de publicar en el estudio y el sitio todavía no trae.
import { $, esc, cargarJSON, SEGMENTOS } from "./comun.js";
import { indiceEnVivo, fusionarIndice } from "./publicado.js";
import { resumenes } from "./avance.js";

const app = $("#app");
// Lo que el residente respondió en este dispositivo, por tema (app/avance.js). No se pide nada a la red.
const mios = new Map(resumenes().map((r) => [r.ruta, r]));

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

// Cuántos casos del tema llevan el sello de un radiólogo.
function medidor(publicado, verificado) {
  if (!publicado) return "";
  const texto = !verificado ? "Ninguno verificado por un radiólogo todavía"
    : verificado === publicado ? `${publicado === 1 ? "Verificado" : `Los ${publicado} verificados`} por un radiólogo`
    : `${verificado} de ${publicado} verificados por un radiólogo`;
  return `<div class="medidor"><div class="barra"><i style="width:${Math.round((100 * verificado) / publicado)}%"></i></div>
    <span>${texto}</span></div>`;
}

// Cuánto del tema respondió el residente en este dispositivo. El total es el de hoy: si el tema creció, baja.
function miAvance(paquete) {
  const r = mios.get(paquete.ruta);
  const total = paquete.casos?.publicado || 0;
  if (!r || !r.vistos || !total) return "";
  const vistos = Math.min(r.vistos, total);
  const texto = vistos >= total ? "Lo respondiste entero" : `Llevas ${vistos} de ${total}`;
  return `<div class="medidor mio"><div class="barra"><i style="width:${Math.round((100 * vistos) / total)}%"></i></div>
    <span>${texto} · ${Math.round((100 * r.bien) / r.vistos)} % de aciertos</span></div>`;
}

function tarjeta(paquete) {
  const { publicado = 0, verificado = 0, revisado = 0, borrador = 0 } = paquete.casos || {};
  const ruta = encodeURIComponent(paquete.ruta).replace("%2F", "/");
  const mio = mios.get(paquete.ruta);
  const empezado = mio && mio.vistos > 0 && mio.vistos < publicado;
  const practicar = publicado
    ? `<a class="boton primary" href="practica.html?tema=${ruta}">${empezado ? "Continuar" : "Practicar"} · ${plural(publicado, "caso", "casos")}</a>`
    : `<button disabled>Sin publicar</button>`;
  const pendientes = borrador + revisado;
  const revisar = pendientes
    ? `<a class="src" href="practica.html?tema=${ruta}&amp;revision=1">Ver ${pendientes} casos sin publicar (revisores)</a>`
    : "";
  const modalidades = (paquete.modalidades || []).map((m) => `<span class="etiqueta">${esc(m)}</span>`).join("");
  return `<article class="panel tema-card">
    <div class="etiquetas">${modalidades}${paquete.version ? `<span class="src">versión ${esc(paquete.version)}</span>` : ""}</div>
    <h4>${esc(paquete.titulo)}</h4>
    ${medidor(publicado, Math.min(verificado, publicado))}
    ${miAvance(paquete)}
    <div class="row acciones">${practicar}</div>
    ${revisar}
  </article>`;
}

// El último tema que el residente dejó a medias, arriba de todo: para terminarlo hay que encontrarlo.
function continuar(paquetes) {
  const porRuta = new Map(paquetes.map((p) => [p.ruta, p]));
  const ultimo = [...mios.values()]
    .filter((r) => porRuta.has(r.ruta) && r.vistos < (porRuta.get(r.ruta).casos?.publicado || 0))
    .sort((a, b) => (b.t || 0) - (a.t || 0))[0];
  if (!ultimo) return "";
  const p = porRuta.get(ultimo.ruta);
  const total = p.casos.publicado;
  const ruta = encodeURIComponent(p.ruta).replace("%2F", "/");
  return `<section class="panel continuar" aria-label="Seguir practicando">
    <div class="crece"><span class="src">Seguir donde lo dejaste</span><b>${esc(p.titulo)}</b>
      <div class="medidor mio"><div class="barra"><i style="width:${Math.round((100 * ultimo.vistos) / total)}%"></i></div>
        <span>Te faltan ${plural(total - ultimo.vistos, "caso", "casos")} de ${total}</span></div></div>
    <a class="boton primary" href="practica.html?tema=${ruta}">Continuar</a>
  </section>`;
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
  const paquetes = fusionarIndice(indice?.paquetes || [], vivo);
  for (const paquete of paquetes) {
    if (!porSegmento.has(paquete.segmento)) porSegmento.set(paquete.segmento, []);
    porSegmento.get(paquete.segmento).push(paquete);
  }
  if (!porSegmento.size) {
    app.innerHTML = `<p class="muted">Todavía no hay temas.</p>`;
    return;
  }
  const casos = paquetes.reduce((n, p) => n + (p.casos?.publicado || 0), 0);
  const verificados = paquetes.reduce((n, p) => n + Math.min(p.casos?.verificado || 0, p.casos?.publicado || 0), 0);
  $("#resumen").textContent = `${plural(paquetes.length, "tema", "temas")} · ${plural(casos, "caso", "casos")} · ${verificados} verificados`;
  const orden = Object.keys(SEGMENTOS).filter((s) => porSegmento.has(s));
  app.innerHTML = `${continuar(paquetes)}<div class="stack segmentos">${orden.map((s) => `
    <section class="segmento">
      <h3 class="segmento-titulo">${esc(SEGMENTOS[s])} <span class="n">${porSegmento.get(s).length}</span></h3>
      <div class="temas">${porSegmento.get(s).map(tarjeta).join("")}</div>
    </section>`).join("")}</div>`;
}

// Fondo animado: la mira se centra en la casilla del código y el fondo baja un poco más que ella, sin pasar del
// final de la página. Se vuelve a medir cuando cambia el diseño: llega la tipografía, cambia el ancho, aparecen
// los temas.
function centrarMira() {
  const fondo = $(".fondo-vivo");
  const caja = $(".unirse").getBoundingClientRect();
  const texto = $(".portada-texto").getBoundingClientRect();
  const cabecera = $("header.bar").getBoundingClientRect();
  const temas = $("#temas").getBoundingClientRect();
  const x = caja.left + scrollX + caja.width / 2;
  const y = caja.top + scrollY + caja.height / 2;
  const radio = Math.hypot(caja.width, caja.height) / 2;
  fondo.style.setProperty("--mx", `${Math.round(x)}px`);
  fondo.style.setProperty("--my", `${Math.round(y)}px`);
  fondo.style.setProperty("--mr", `${Math.round(radio)}px`);
  fondo.style.setProperty("--mt", `${Math.round(caja.left + caja.width / 2 - texto.right)}px`);
  fondo.style.setProperty("--mh", `${Math.round(caja.top + caja.height / 2 - cabecera.bottom)}px`);
  fondo.style.setProperty("--mb", `${Math.round(temas.top - caja.top - caja.height / 2)}px`);
  fondo.style.height = `${Math.round(Math.min(y + 2.2 * radio, $(".wrap").offsetHeight))}px`;
  fondo.classList.add("listo");
}

new ResizeObserver(centrarMira).observe($(".wrap"));
addEventListener("resize", centrarMira);
iniciar();
