// RadQuiz — diapositivas de enseñanza de un caso, para proyectar después de revelar la respuesta.
//
// Salen solas de lo que el caso ya trae: la explicación en viñetas, la perla y la evidencia, y la ficha de cada
// figura (qué señala cada marca, los paneles). La figura del caso queda fija, en el mismo lugar, en «Respuesta» y
// en «Por qué», porque la explicación habla de sus flechas. Las figuras se muestran enteras (las ND no se pueden
// recortar ni anotar), así que lo que señala cada marca va escrito al lado.
//
// Orden: Respuesta → Por qué → otras figuras del caso → Compárelo (un caso parecido al lado) → Clave (la perla).
import { esc, md, credito, sello } from "./comun.js";

const mayuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);

function figura(datos, ref, clase = "") {
  const ficha = datos.paquete.imagenes[ref];
  const src = ficha ? datos.imagen(ref) : "";
  if (!src) return `<p class="nota">Falta la imagen ${esc(ficha ? ficha.figura : ref)}.</p>`;
  return `<figure class="diapo-fig ${clase}"><img src="${esc(src)}" alt="${esc(ficha.figura)}" data-zoom></figure>`;
}

function marcas(ficha) {
  const lista = (ficha.marcas || []).map((m) =>
    `<li><b>${esc(mayuscula(m.marca))}</b>${m.panel ? ` (${esc(m.panel)})` : ""}: ${esc(m.senala)}</li>`);
  return lista.length ? `<ul class="marcas">${lista.join("")}</ul>` : "";
}

function paneles(ficha) {
  const lineas = (ficha.paneles || []).map((p) => {
    const datos = [p.lado && `lado ${p.lado}`, p.plano, p.secuencia, p.condicion].filter(Boolean);
    if (!datos.length) return "";
    return `${/^[úu]nico$/i.test(p.id) ? "" : `<b>${esc(p.id)}</b>: `}${esc(datos.join(", "))}`;
  }).filter(Boolean);
  return lineas.length ? `<p class="diapo-paneles">${lineas.join("<br>")}</p>` : "";
}

// «López-Ramírez M, et al. Austral J Imaging. 2024: p. 141, leyenda de la Figura 6 · p. 145»
function evidencia(caso, fuentes) {
  const porFuente = new Map();
  for (const e of caso.evidencia || []) {
    if (!porFuente.has(e.fuente)) porFuente.set(e.fuente, new Set());
    porFuente.get(e.fuente).add(e.ubicacion);
  }
  return [...porFuente].map(([id, ubicaciones]) => {
    const fuente = fuentes[id] || {};
    return `${esc(fuente.credito || fuente.cita || id)}: ${esc([...ubicaciones].join(" · "))}`;
  }).join("<br>");
}

// Las figuras del caso que se pueden proyectar ahora, primero las de la pregunta. Una figura que otra casilla sin
// jugar también usa sale sin su lista de marcas; si además es de las que se muestran solo al responder, no sale:
// sería la pista de esa casilla.
function figurasDelCaso(caso, datos, reservas) {
  const orden = [...caso.imagenes].sort((a, b) => (a.mostrar_en === "pregunta" ? 0 : 1) - (b.mostrar_en === "pregunta" ? 0 : 1));
  return orden.flatMap((r) => {
    const ficha = datos.paquete.imagenes[r.ref];
    if (!ficha) return [];
    const reservada = reservas.figuras.has(`${datos.paquete.id}/${r.ref}`);
    if (reservada && r.mostrar_en === "respuesta") return [];
    return [{ ref: r.ref, ficha, conMarcas: !reservada }];
  });
}

const SIN_RESERVAS = { figuras: new Set(), respuestas: new Set() };

// caso y datos ({ paquete, fuentes, imagen(ref) }) del tema del caso; comparar: [{ caso, datos }], ya sin los que
// adelantarían una casilla; reservas: lo que las casillas sin jugar necesitan esconder (tablero.js, reservasDe).
// completas = false da una sola diapositiva, como el revelado de la sala.
// Devuelve [{ titulo, html, pie }]: el pie lleva el crédito de las figuras y la evidencia.
export function diapositivas({ caso, datos, comparar = [], reservas = SIN_RESERVAS, completas = true }) {
  const figs = figurasDelCaso(caso, datos, reservas);
  const principal = figs[0];
  const respuesta = esc(caso.opciones[caso.correcta]);
  const creditoDe = (d, f) => credito(f.ficha, d.fuentes[f.ficha.fuente]);
  const selloCaso = `<div class="row">${sello(caso, datos.paquete.personas)}</div>`;
  const pieEvidencia = `Evidencia: ${evidencia(caso, datos.fuentes)}`;

  if (!completas || !principal) {
    const perla = !completas && caso.perla ? `<div class="pearl md"><b>Perla:</b> ${md(caso.perla)}</div>` : "";
    const salida = [{
      titulo: "Respuesta",
      html: `<div class="${principal ? "diapo-dos" : "diapo-sola"}">${principal ? figura(datos, principal.ref) : ""}
        <div class="diapo-texto"><p class="eyebrow">Respuesta</p><p class="diapo-respuesta">${respuesta}</p>
          <div class="md diapo-md">${md(caso.explicacion)}</div>${perla}${selloCaso}</div></div>`,
      pie: principal ? `${creditoDe(datos, principal)}<br>${pieEvidencia}` : pieEvidencia,
    }];
    if (completas && caso.perla) salida.push(clave(caso, datos, null, selloCaso, pieEvidencia));
    return salida;
  }

  const fija = figura(datos, principal.ref);
  const marcasPrincipal = principal.conMarcas ? marcas(principal.ficha) : "";
  const salida = [
    {
      titulo: "Respuesta",
      html: `<div class="diapo-dos">${fija}<div class="diapo-texto">
        <p class="eyebrow">Respuesta</p><p class="diapo-respuesta">${respuesta}</p>
        ${marcasPrincipal ? `<p class="eyebrow">Qué señala la figura</p>${marcasPrincipal}` : ""}
        ${paneles(principal.ficha) ? `<p class="eyebrow">Paneles</p>${paneles(principal.ficha)}` : ""}
        ${selloCaso}</div></div>`,
      pie: creditoDe(datos, principal),
    },
    {
      titulo: "Por qué",
      html: `<div class="diapo-dos">${fija}<div class="diapo-texto">
        <p class="eyebrow">Por qué</p><div class="md diapo-md">${md(caso.explicacion)}</div></div></div>`,
      pie: `${creditoDe(datos, principal)}<br>${pieEvidencia}`,
    },
  ];
  for (const otra of figs.slice(1)) {
    salida.push({
      titulo: otra.ficha.figura,
      html: `<div class="diapo-dos">${figura(datos, otra.ref)}<div class="diapo-texto">
        <p class="eyebrow">También en la respuesta</p><p class="diapo-rotulo">${esc(otra.ficha.figura)}</p>
        ${otra.conMarcas ? marcas(otra.ficha) : ""}${paneles(otra.ficha)}</div></div>`,
      pie: creditoDe(datos, otra),
    });
  }
  for (const similar of comparar) {
    const suya = figurasDelCaso(similar.caso, similar.datos, reservas)[0];
    if (!suya) continue;
    salida.push({
      titulo: "Compárelo",
      html: `<p class="eyebrow">Compárelo con un caso similar</p>
        <div class="diapo-comparar">
          <div class="diapo-texto">${figura(datos, principal.ref)}
            <p class="diapo-rotulo este">${respuesta} · este caso</p>${marcasPrincipal}</div>
          <div class="diapo-texto">${figura(similar.datos, suya.ref)}
            <p class="diapo-rotulo">${esc(similar.caso.opciones[similar.caso.correcta])} · caso similar</p>
            ${suya.conMarcas ? marcas(suya.ficha) : ""}</div>
        </div>`,
      pie: `${creditoDe(datos, principal)}<br>${creditoDe(similar.datos, suya)}`,
    });
  }
  if (caso.perla) salida.push(clave(caso, datos, principal, selloCaso, pieEvidencia));
  return salida;
}

function clave(caso, datos, principal, selloCaso, pieEvidencia) {
  return {
    titulo: "Clave",
    html: `<div class="diapo-clave ${principal ? "" : "sola"}">${principal ? figura(datos, principal.ref, "chica") : ""}
      <div class="diapo-texto"><p class="eyebrow">Clave para llevarse</p>
        <div class="md diapo-perla">${md(caso.perla)}</div>${selloCaso}</div></div>`,
    pie: pieEvidencia,
  };
}
