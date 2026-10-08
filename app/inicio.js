// RadQuiz — pantalla de inicio: lista los temas por segmento. La lista sale de temas/indice.json,
// que arma el sitio, más lo que se acaba de publicar en el estudio y el sitio todavía no trae.
//
// Arriba, el buscador: un texto (tema, diagnóstico, signo) y botones de segmento y de área con cuántos casos
// hay. Filtra las tarjetas y arma un cuestionario con los casos que coinciden, de todos los temas, para
// practicarlo, presentarlo en una sala o jugarlo en el tablero (app/cuestionario.js). Nunca enseña enunciados ni
// respuestas: solo cuántos casos hay y en qué temas. El criterio queda en la dirección (?segmento=…&q=…).
import { $, esc, cargarJSON, SEGMENTOS } from "./comun.js";
import { AREAS } from "./areas.js";
import { indiceEnVivo, fusionarIndice, indicesDeCasos } from "./publicado.js";
import { resumenes } from "./avance.js";
import {
  criterioDe, consultaDe, nombreCriterio, hayCriterio, contar, indicePorRuta, nombreArea, palabras, SIN_TILDES,
} from "./cuestionario.js";

const app = $("#app");
// Lo que el residente respondió en este dispositivo, por tema (app/avance.js). No se pide nada a la red.
const mios = new Map(resumenes().map((r) => [r.ruta, r]));

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

// Cuántos casos del tema llevan el sello de un radiólogo, en una línea corta: el verde solo si hay alguno.
function sello(publicado, verificado) {
  if (!publicado) return "";
  const titulo = ' title="El sello lo pone un radiólogo después de revisar el caso"';
  if (!verificado) return `<p class="verif"${titulo}>Sin verificar todavía</p>`;
  const texto = verificado === publicado ? (publicado === 1 ? "Verificado" : "Todos verificados")
    : `${verificado} de ${publicado} verificados`;
  return `<p class="verif ok"${titulo}>${texto}</p>`;
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

// Con un criterio, «coinciden» dice cuántos casos del tema entran: la tarjeta ofrece practicar solo esos. Toda la
// tarjeta abre la práctica (el botón se estira por encima); los enlaces de abajo quedan por encima de él.
function tarjeta(paquete, coinciden = null) {
  const { publicado = 0, verificado = 0, revisado = 0, borrador = 0 } = paquete.casos || {};
  const ruta = encodeURIComponent(paquete.ruta).replace("%2F", "/");
  const mio = mios.get(paquete.ruta);
  const empezado = mio && mio.vistos > 0 && mio.vistos < publicado;
  const practicar = publicado
    ? `<a class="boton primary abrir" href="practica.html?tema=${ruta}">${empezado ? "Continuar" : "Practicar"}</a>`
    : `<button disabled>Sin publicar</button>`;
  const parte = publicado && coinciden && coinciden < publicado
    ? `<a class="boton" href="${enlace("practica.html", criterio, `tema=${ruta}`)}">${coinciden === 1 ? "Solo el que coincide" : `Solo los ${coinciden} que coinciden`}</a>`
    : "";
  const pendientes = borrador + revisado;
  const revisar = pendientes
    ? `<a class="src" href="practica.html?tema=${ruta}&amp;revision=1">Ver ${pendientes} casos sin publicar (revisores)</a>`
    : "";
  const meta = [publicado ? plural(publicado, "caso", "casos") : "", (paquete.modalidades || []).join(" · ")].filter(Boolean);
  return `<article class="panel tema-card tema-portada${publicado ? " clicable" : ""}"${paquete.version ? ` title="Versión ${esc(paquete.version)}"` : ""}>
    <div class="tc-texto">
      <h4>${esc(paquete.titulo)}</h4>
      ${meta.length ? `<p class="meta">${meta.map(esc).join('<span aria-hidden="true"> · </span>')}</p>` : ""}
      ${sello(publicado, Math.min(verificado, publicado))}
    </div>
    ${practicar}
    ${miAvance(paquete)}
    ${parte || revisar ? `<div class="extra">${parte}${revisar}</div>` : ""}
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

let paquetes = [];
let indices = new Map();        // ruta → índice de casos del tema, o null si no tiene
let criterio = criterioDe(new URLSearchParams(location.search));
let conteo = null;

const enlace = (pagina, c, extra = "") => `${pagina}?${[extra, consultaDe(c)].filter(Boolean).join("&")}`;

// El buscador se dibuja una vez; los botones, el resumen y las tarjetas, cada vez que cambia algo. A la vista
// solo queda la barra, que se queda arriba al bajar por los temas: los segmentos y las áreas se despliegan al
// tocarla, y el filtro elegido queda como una etiqueta dentro de la barra, con su ✕.
function dibujarBuscador() {
  return `<section class="buscador" aria-label="Buscar y armar un cuestionario">
    <div class="buscar">
      <label class="visualmente-oculto" for="q">Buscar</label>
      <button type="button" class="filtro-activo" id="filtro-activo" hidden></button>
      <input type="search" id="q" placeholder="Diagnóstico o signo" value="${esc(criterio.q)}"
        autocomplete="off" spellcheck="false" enterkeyhint="search" aria-controls="desplegable" aria-expanded="false">
      <button type="button" class="abrir-filtros" id="abrir-filtros" aria-controls="desplegable" aria-expanded="false"
        title="Filtrar por segmento y área">Segmentos</button>
    </div>
    <div class="desplegable" id="desplegable" hidden>
      <p class="src">Segmento</p>
      <div class="filtros" id="segmentos" role="group" aria-label="Segmento"></div>
      <div id="bloque-areas" hidden><p class="src">Área</p>
        <div class="filtros" id="areas" role="group" aria-label="Área"></div></div>
    </div>
  </section>
  <div class="armado" id="armado" aria-live="polite" hidden></div>
  <div id="continuar"></div>
  <div class="stack segmentos" id="lista"></div>`;
}

function boton(valor, texto, n, activo, tipo) {
  return `<button type="button" class="filtro" data-${tipo}="${esc(valor)}" aria-pressed="${activo}">${esc(texto)}${
    n === null ? "" : ` <span class="n">${n}</span>`}</button>`;
}

function pintarFiltros() {
  conteo = contar(paquetes, indices, criterio);
  const orden = Object.keys(SEGMENTOS).filter((s) => conteo.porSegmento[s] || s === criterio.segmento);
  $("#segmentos").innerHTML = boton("", "Todos", null, !criterio.segmento, "segmento")
    + orden.map((s) => boton(s, SEGMENTOS[s], conteo.porSegmento[s] || 0, s === criterio.segmento, "segmento")).join("");
  const areas = criterio.segmento ? Object.keys(AREAS[criterio.segmento] || {})
    .filter((a) => conteo.porArea[`${criterio.segmento}/${a}`] || a === criterio.area) : [];
  $("#bloque-areas").hidden = !areas.length;
  $("#areas").innerHTML = areas.length ? boton("", `Todo ${SEGMENTOS[criterio.segmento]}`, null, !criterio.area, "area")
    + areas.map((a) => boton(a, nombreArea(criterio.segmento, a), conteo.porArea[`${criterio.segmento}/${a}`] || 0, a === criterio.area, "area")).join("") : "";
  app.querySelectorAll("[data-segmento]").forEach((b) => {
    b.onclick = () => cambiar({ segmento: b.dataset.segmento, area: "" });
  });
  app.querySelectorAll("[data-area]").forEach((b) => {
    b.onclick = () => { cambiar({ area: b.dataset.area }); desplegar(false); };
  });
  const etiqueta = $("#filtro-activo");
  etiqueta.hidden = !criterio.segmento;
  etiqueta.innerHTML = criterio.segmento
    ? `${esc(SEGMENTOS[criterio.segmento])}${criterio.area ? ` · ${esc(nombreArea(criterio.segmento, criterio.area))}` : ""} <span aria-hidden="true">✕</span>` : "";
  etiqueta.setAttribute("aria-label", criterio.segmento ? `Quitar el filtro ${nombreCriterio({ ...criterio, q: "" })}` : "");
}

// El desplegable de segmentos y áreas: se abre al tocar la barra y se cierra al tocar fuera o con Esc.
function desplegar(abierto) {
  $("#desplegable").hidden = !abierto;
  $("#q").setAttribute("aria-expanded", String(abierto));
  $("#abrir-filtros").setAttribute("aria-expanded", String(abierto));
}

// El cuestionario armado: cuántos casos y de cuántos temas, y adónde llevarlo.
function pintarArmado() {
  const caja = $("#armado");
  caja.hidden = !hayCriterio(criterio);
  if (caja.hidden) return;
  const porTema = Object.entries(conteo.porTema).filter(([, n]) => n > 0);
  const total = porTema.reduce((n, [, k]) => n + k, 0);
  const cargando = !indices.size;
  if (!total) {
    caja.innerHTML = `<p><b>${esc(nombreCriterio(criterio))}</b>: ${cargando ? "buscando…" : "ningún caso coincide."}</p>
      ${palabras(criterio.q).length && !cargando ? `<p class="src">Prueba con menos palabras o con otra forma de escribirlo (sin tildes también vale).</p>` : ""}`;
    return;
  }
  caja.innerHTML = `<div class="crece"><span class="src">Cuestionario armado</span>
      <p><b>${esc(nombreCriterio(criterio))}</b>: ${plural(total, "caso", "casos")} de ${plural(porTema.length, "tema", "temas")}</p></div>
    <div class="row">
      <a class="boton primary" href="${enlace("practica.html", criterio)}">Practicar</a>
      <a class="boton" href="${enlace("sala.html", criterio, "crear=1")}">Presentar en una sala</a>
      <a class="boton" href="${enlace("tablero.html", criterio)}">Tablero</a>
    </div>`;
}

function pintarTemas() {
  const filtrando = hayCriterio(criterio);
  const visibles = filtrando ? paquetes.filter((p) => conteo.porTema[p.ruta] > 0
    || (!criterio.segmento && palabras(criterio.q).every((w) => SIN_TILDES(p.titulo).includes(w)))) : paquetes;
  const porSegmento = new Map();
  for (const paquete of visibles) {
    if (!porSegmento.has(paquete.segmento)) porSegmento.set(paquete.segmento, []);
    porSegmento.get(paquete.segmento).push(paquete);
  }
  $("#continuar").innerHTML = filtrando ? "" : continuar(paquetes);
  if (!porSegmento.size) {
    $("#lista").innerHTML = filtrando ? "" : `<p class="muted">Todavía no hay temas.</p>`;
    return;
  }
  const orden = Object.keys(SEGMENTOS).filter((s) => porSegmento.has(s));
  $("#lista").innerHTML = orden.map((s) => `
    <section class="segmento">
      <h3 class="segmento-titulo">${esc(SEGMENTOS[s])} <span class="n">${porSegmento.get(s).length}</span></h3>
      <div class="temas">${porSegmento.get(s).map((p) => tarjeta(p, filtrando ? conteo.porTema[p.ruta] || 0 : null)).join("")}</div>
    </section>`).join("");
}

function pintar() {
  pintarFiltros();
  pintarArmado();
  pintarTemas();
  requestAnimationFrame(centrarMira);
}

function cambiar(cambios) {
  criterio = { ...criterio, ...cambios };
  if (!criterio.segmento) criterio.area = "";
  const consulta = consultaDe(criterio);
  history.replaceState(null, "", consulta ? `?${consulta}#temas` : location.pathname);
  pintar();
  // Con la barra pegada arriba, la lista nueva empieza bajo ella y no donde uno había bajado.
  if ($("#app").getBoundingClientRect().top < 0) $("#app").scrollIntoView({ block: "start" });
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
  paquetes = fusionarIndice(indice?.paquetes || [], vivo);
  if (!paquetes.length) {
    app.innerHTML = `<p class="muted">Todavía no hay temas.</p>`;
    return;
  }
  const casos = paquetes.reduce((n, p) => n + (p.casos?.publicado || 0), 0);
  const verificados = paquetes.reduce((n, p) => n + Math.min(p.casos?.verificado || 0, p.casos?.publicado || 0), 0);
  $("#resumen").textContent = `${plural(paquetes.length, "tema", "temas")} · ${plural(casos, "caso", "casos")} · ${verificados} verificados`;
  app.innerHTML = dibujarBuscador();
  let espera = 0;
  $("#q").oninput = (e) => {
    clearTimeout(espera);
    espera = setTimeout(() => cambiar({ q: e.target.value.trim().replace(/\s+/g, " ").slice(0, 80) }), 160);
  };
  $("#q").onkeydown = (e) => {
    if (e.key === "Enter") { desplegar(false); e.target.blur(); }
    if (e.key === "Escape") desplegar(false);
  };
  $("#q").onfocus = () => desplegar(true);
  $("#abrir-filtros").onclick = () => desplegar($("#desplegable").hidden);
  $("#filtro-activo").onclick = () => { cambiar({ segmento: "", area: "" }); $("#q").focus(); };
  document.addEventListener("pointerdown", (e) => { if (!e.target.closest(".buscador")) desplegar(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") desplegar(false); });
  pintar();
  // El índice de casos llega después: mientras, los conteos son los de cada tema entero.
  const { vivo: casosVivos, estatico } = await indicesDeCasos();
  const publicados = paquetes.filter((p) => p.casos?.publicado);
  indices = indicePorRuta(publicados, casosVivos, estatico);
  pintar();
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
