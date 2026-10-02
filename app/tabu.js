// RadQuiz — Tabú radiológico: un residente describe la figura sin decir las palabras prohibidas y su equipo
// adivina el diagnóstico. Se juega pasando un solo aparato (celular o laptop), sin sala en vivo ni red una vez
// cargados los casos.
//
// Cada turno dura lo que se eligió; quien describe marca Adivinaron, Tabú (dijo una prohibida: lo canta el otro
// equipo) o Pasar. Al sonar, el repaso muestra cada carta con la descripción de la fuente, y ahí se corrige lo que
// se marcó mal. La lógica (qué casos son carta, qué palabras se prohíben) está en app/tabu-logica.js.
// La partida se guarda solo en este navegador, para aguantar una recarga.
import { $, esc, md, credito, barajar, NIVELES, nivelDe } from "./comun.js";
import { cargarIndice, cargarTemas, armarCatalogo } from "./catalogo.js";
import { reportar } from "./reportar.js";
import {
  PUNTOS, TIEMPOS, PASES, SIN_LIMITE, respuesta, figurasCarta, prohibidas, armarMazo, descripcion, sacar,
  pasesLibres, turnoEn,
} from "./tabu-logica.js";

const GUARDADO = "radquiz.tabu";
const MAX_EQUIPOS = 6;
const MAX_VUELTAS = 5;
const RESULTADOS = {
  acierto: { texto: "Adivinaron", clase: "si" },
  tabu: { texto: "Tabú", clase: "no" },
  paso: { texto: "Pasó", clase: "" },
  sono: { texto: "Sonó el tiempo", clase: "" },
};
const app = $("#app");

let indice = [];
const datosDe = new Map();       // ruta → { paquete, fuentes, imagen(ref) }
let catalogo = new Map();        // clave «<paquete>/<caso>» → { clave, ruta, paquete, caso, grupo }
let config = null;
let juego = null;
let reloj = null;
let bloqueo = null;              // la pantalla encendida durante el turno (Wake Lock), si el navegador lo permite
let audio = null;
const precargadas = new Set();

// ------------------------------------------------------------------ guardado local
function guardar() {
  try { localStorage.setItem(GUARDADO, JSON.stringify({ config, juego })); } catch { /* sin almacenamiento: se juega igual */ }
}
function leerGuardado() {
  try {
    const g = JSON.parse(localStorage.getItem(GUARDADO) || "null");
    return g && g.config && g.config.v === 1 && g.juego && Array.isArray(g.juego.mazo) ? g : null;
  } catch {
    return null;
  }
}
function borrarGuardado() {
  try { localStorage.removeItem(GUARDADO); } catch { /* idem */ }
}

// ------------------------------------------------------------------ utilidades
const fmt = (n) => (n < 0 ? `−${Math.abs(n)}` : String(n));
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const totalTurnos = () => config.equipos.length * config.vueltas;
const equipoDelTurno = () => turnoEn(juego.n, config.equipos.length).equipo;
const casoDe = (clave) => catalogo.get(clave)?.caso;
const datosDeClave = (clave) => datosDe.get(catalogo.get(clave)?.ruta);

function aviso(texto) {
  const nodo = document.createElement("div");
  nodo.className = "chip toast";
  nodo.textContent = texto;
  document.body.append(nodo);
  setTimeout(() => nodo.remove(), 4000);
}

function panel(titulo, texto, extra = "") {
  return `<section class="panel stack angosto"><h2>${esc(titulo)}</h2><p class="muted">${esc(texto)}</p>${extra}</section>`;
}

function cabecera() {
  $("#subtitulo").textContent = config ? config.titulo : "Tabú radiológico";
  const chip = $("#turno");
  chip.hidden = !config || !juego || juego.fase === "resultado";
  if (!chip.hidden) chip.textContent = `Describe: ${config.equipos[equipoDelTurno()]}`;
}

// ------------------------------------------------------------------ sonido y pantalla encendida
function sonar(tipo) {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
    const tonos = { fin: [[880, 0, .18], [660, .22, .18], [440, .44, .4]], tabu: [[160, 0, .35]], ok: [[1040, 0, .09]] }[tipo];
    for (const [frecuencia, desde, dura] of tonos) {
      const osc = audio.createOscillator();
      const vol = audio.createGain();
      osc.type = tipo === "tabu" ? "sawtooth" : "sine";
      osc.frequency.value = frecuencia;
      const t = audio.currentTime + desde;
      vol.gain.setValueAtTime(.0001, t);
      vol.gain.exponentialRampToValueAtTime(.25, t + .02);
      vol.gain.exponentialRampToValueAtTime(.0001, t + dura);
      osc.connect(vol).connect(audio.destination);
      osc.start(t);
      osc.stop(t + dura + .05);
    }
  } catch { /* sin audio: el reloj se ve igual */ }
}

async function mantenerEncendida(encender) {
  try {
    if (encender && !bloqueo && navigator.wakeLock) {
      bloqueo = await navigator.wakeLock.request("screen");
      bloqueo.addEventListener("release", () => { bloqueo = null; });
    } else if (!encender && bloqueo) {
      await bloqueo.release();
      bloqueo = null;
    }
  } catch { bloqueo = null; }
}
// El navegador suelta el bloqueo al cambiar de pestaña: se pide otra vez al volver, si sigue el turno.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && juego?.fase === "turno" && !juego.pausa) mantenerEncendida(true);
});

// ------------------------------------------------------------------ armado
const PREDETERMINADO = {
  temas: [], sinVerificar: false, niveles: [1, 2, 3, 4], equipos: ["Equipo 1", "Equipo 2"], tiempo: 60, vueltas: 3, pases: 2,
};

async function pantallaArmado(previo = null) {
  config = juego = null;
  cabecera();
  app.innerHTML = `<p class="muted">Cargando temas…</p>`;
  if (!indice.length) indice = await cargarIndice();
  if (!indice.length) {
    app.innerHTML = panel("Todavía no hay casos publicados",
      "El Tabú usa los casos publicados. Cuando se publique el primer tema, aparecerá aquí.",
      `<div class="row"><a class="boton" href="./">Volver</a></div>`);
    return;
  }
  const b = { ...PREDETERMINADO, ...(previo || {}) };
  if (!b.temas.length) b.temas = [(indice.find((p) => p.casos.verificado) || indice[0]).ruta];
  const opciones = (lista, elegido, texto = (n) => n) => lista
    .map((n) => `<option value="${n}" ${n === elegido ? "selected" : ""}>${texto(n)}</option>`).join("");
  const rango = (desde, hasta) => Array.from({ length: hasta - desde + 1 }, (_, i) => desde + i);
  app.innerHTML = `<form class="panel stack angosto" id="armado" novalidate>
    <p class="eyebrow">Por equipos</p>
    <h2>Tabú radiológico</h2>
    <p class="muted">Alguien de un equipo toma el aparato: ve la figura y el diagnóstico, y lo describe sin decir las
      palabras prohibidas. Su equipo tiene que adivinarlo antes de que suene. El otro equipo vigila y grita «¡tabú!».</p>
    <div class="grid-label" role="group" aria-labelledby="titulo-temas"><span id="titulo-temas">Temas</span>
      <div class="casillas">${indice.map((p) => `<label class="row tb-opcion"><input type="checkbox" name="tema" value="${esc(p.ruta)}"
        ${b.temas.includes(p.ruta) ? "checked" : ""}> <span>${esc(p.titulo)}
        <span class="src">· ${p.casos.verificado || 0} verificados de ${p.casos.publicado}</span></span></label>`).join("")}</div>
    </div>
    <label class="row"><input type="checkbox" id="sin-verificar" ${b.sinVerificar ? "checked" : ""}> Incluir casos sin verificar</label>
    <div class="grid-label" role="group" aria-labelledby="titulo-niveles"><span id="titulo-niveles">Dificultad</span>
      <div class="row">${Object.entries(NIVELES).map(([n, nivel]) => `<label class="row"><input type="checkbox" name="nivel" value="${n}"
        ${b.niveles.includes(Number(n)) ? "checked" : ""}> ${n} · ${esc(nivel.nombre)}</label>`).join("")}</div>
      <span class="src">Un caso sin dificultad cuenta como 2.</span>
    </div>
    <div class="campos">
      <label class="grid-label">Equipos <select id="n-equipos">${opciones(rango(2, MAX_EQUIPOS), b.equipos.length)}</select></label>
      <label class="grid-label">Tiempo por turno <select id="tiempo">${opciones(TIEMPOS, b.tiempo, (s) => `${s} s`)}</select></label>
      <label class="grid-label">Turnos por equipo <select id="vueltas">${opciones(rango(1, MAX_VUELTAS), b.vueltas)}</select></label>
      <label class="grid-label">Pases por turno <select id="pases">${opciones(PASES, b.pases, (n) => (n >= SIN_LIMITE ? "Sin límite" : n))}</select></label>
    </div>
    <div class="campos" id="nombres"></div>
    <p class="src">Adivinaron: +${PUNTOS.acierto} · Tabú: ${fmt(PUNTOS.tabu)} · Pasar: ${PUNTOS.paso}.</p>
    <div class="row"><button class="primary lg" type="submit">Armar el mazo</button><a class="boton lg" href="./">Cancelar</a></div>
  </form>`;

  const nombres = () => [...app.querySelectorAll("[data-equipo]")].map((input) => input.value);
  const pintarNombres = (lista) => {
    $("#nombres").innerHTML = Array.from({ length: Number($("#n-equipos").value) }, (_, i) => `<label class="grid-label">Equipo ${i + 1}
      <input type="text" id="equipo-${i}" data-equipo="${i}" maxlength="24" value="${esc(lista[i] ?? `Equipo ${i + 1}`)}"></label>`).join("");
  };
  pintarNombres(b.equipos);
  $("#n-equipos").onchange = () => pintarNombres(nombres());
  $("#armado").onsubmit = (e) => {
    e.preventDefault();
    const temas = [...app.querySelectorAll('input[name="tema"]:checked')].map((input) => input.value);
    const niveles = [...app.querySelectorAll('input[name="nivel"]:checked')].map((input) => Number(input.value));
    if (!temas.length) return aviso("Elige al menos un tema.");
    if (!niveles.length) return aviso("Elige al menos un nivel de dificultad.");
    armar({
      temas,
      niveles,
      sinVerificar: $("#sin-verificar").checked,
      equipos: nombres().map((n, i) => n.trim().replace(/\s+/g, " ") || `Equipo ${i + 1}`),
      tiempo: Number($("#tiempo").value),
      vueltas: Number($("#vueltas").value),
      pases: Number($("#pases").value),
    });
  };
}

async function armar(b) {
  app.innerHTML = `<p class="muted">Cargando los casos…</p>`;
  await cargarTemas(b.temas, datosDe);
  const rutas = b.temas.filter((ruta) => datosDe.has(ruta));
  catalogo = armarCatalogo(rutas, datosDe, b.sinVerificar);
  const mazo = armarMazo([...catalogo.values()], { niveles: b.niveles, nivelDe, barajar });
  const volver = `<div class="row"><button id="volver">Volver</button></div>`;
  if (!mazo.length) {
    app.innerHTML = !rutas.length
      ? panel("No se pudieron cargar los temas", "Revisa la conexión y vuelve a intentarlo.", volver)
      : panel("No hay cartas con ese filtro",
        "Las cartas salen de los casos de imagen con un diagnóstico corto. Prueba con otros temas, más niveles o «Incluir casos sin verificar».", volver);
    $("#volver").onclick = () => pantallaArmado(b);
    return;
  }
  config = {
    v: 1,
    titulo: rutas.length === 1 ? datosDe.get(rutas[0]).paquete.titulo : `Tabú · ${rutas.length} temas`,
    temas: rutas, sinVerificar: b.sinVerificar, niveles: b.niveles, equipos: b.equipos,
    tiempo: b.tiempo, vueltas: b.vueltas, pases: b.pases,
  };
  juego = { fase: "listo", n: 0, mazo, puntos: b.equipos.map(() => 0), cartas: [], pases: 0, fin: 0, pausa: 0 };
  guardar();
  mostrar();
}

// ------------------------------------------------------------------ la partida
function mostrar() {
  clearInterval(reloj);
  cabecera();
  const vistas = { listo: vistaListo, turno: vistaTurno, repaso: vistaRepaso, resultado: vistaResultado };
  (vistas[juego.fase] || vistaListo)();
  mantenerEncendida(juego.fase === "turno" && !juego.pausa);
  window.scrollTo({ top: 0 });
}

function marcador() {
  const actual = equipoDelTurno();
  return `<div class="tb-equipos">${config.equipos.map((nombre, i) => `<div class="tb-equipo ${i === actual && juego.fase !== "resultado" ? "turno" : ""}">
    <div class="tb-nombre"><span>${esc(nombre)}</span></div>
    <span class="tb-puntos ${juego.puntos[i] < 0 ? "negativo" : ""}">${fmt(juego.puntos[i])}</span></div>`).join("")}</div>`;
}

// Antes de cada turno: el aparato cambia de manos sin que nadie vea la primera carta.
function vistaListo() {
  const { vuelta } = turnoEn(juego.n, config.equipos.length);
  const equipo = config.equipos[equipoDelTurno()];
  app.innerHTML = `<section class="stack tb-anuncio">
    <p class="eyebrow">Turno ${juego.n + 1} de ${totalTurnos()} · vuelta ${vuelta + 1} de ${config.vueltas}</p>
    <h1>Describe ${esc(equipo)}</h1>
    <p class="lead">Que alguien de ${esc(equipo)} tome el aparato. Su equipo no mira la pantalla; el otro equipo, sí: vigila
      las palabras prohibidas. ${config.tiempo} segundos${config.pases >= SIN_LIMITE ? ", con pases sin límite"
        : config.pases ? ` y ${plural(config.pases, "pase", "pases")}` : " y sin pases"}.</p>
    ${marcador()}
    <p class="src">Quedan ${plural(juego.mazo.length, "carta", "cartas")} en el mazo.</p>
    <div class="row"><button class="primary lg" id="empezar">Empezar el turno <kbd>Espacio</kbd></button></div>
    <div class="ctrl"><span class="spacer"></span><button id="terminar">Terminar la partida</button><button id="nueva">Nueva partida</button></div>
  </section>`;
  $("#empezar").onclick = empezarTurno;
  $("#terminar").onclick = () => {
    if (!confirm("¿Terminar la partida y ver el resultado?")) return;
    juego.fase = "resultado";
    guardar();
    mostrar();
  };
  $("#nueva").onclick = nuevaPartida;
  juego.mazo.slice(0, 3).forEach(precargar);
}

function empezarTurno() {
  if (juego.fase !== "listo") return;
  sonar("ok");   // de paso, el primer toque habilita el audio del navegador
  Object.assign(juego, { fase: "turno", cartas: [], pases: 0, fin: Date.now() + config.tiempo * 1000, pausa: 0 });
  guardar();
  mostrar();
}

const restante = () => (juego.pausa ? juego.pausa : Math.max(0, juego.fin - Date.now()));

function figuras(clave, { una = false } = {}) {
  const datos = datosDeClave(clave);
  const caso = casoDe(clave);
  const html = figurasCarta(caso).slice(0, una ? 1 : undefined).map((r) => {
    const ficha = datos?.paquete.imagenes[r.ref];
    if (!ficha) return "";
    return `<figure><img src="${esc(datos.imagen(r.ref))}" alt="${esc(ficha.figura)}" data-zoom>
      <figcaption class="cap"><span>${credito(ficha, datos.fuentes[ficha.fuente])}</span><span>Toca para ampliar</span></figcaption></figure>`;
  }).join("");
  return html ? `<div class="viewer">${html}</div>` : "";
}

function vistaTurno() {
  const clave = juego.mazo[0];
  const caso = casoDe(clave);
  if (!caso) return terminarTurno();   // el mazo se acabó, o la carta ya no está publicada
  const libres = pasesLibres(config.pases, juego.pases);
  const delTurno = juego.cartas.reduce((n, c) => n + PUNTOS[c.resultado], 0);
  app.innerHTML = `
    <div class="qhead"><span class="qnum">${esc(config.equipos[equipoDelTurno()])}</span>
      <span class="chip">Este turno: ${fmt(delTurno)}</span><span class="spacer"></span>
      <button id="pausa">${juego.pausa ? "Seguir" : "Pausa"} <kbd>P</kbd></button></div>
    <section class="tabu-juego">
      <div class="tabu-lado">
        <div class="reloj" id="reloj"><span class="clock" id="clock"></span><div class="timer"><i id="bar"></i></div></div>
        <div class="tabu-carta">
          <p class="eyebrow">Que adivinen</p>
          <p class="tabu-respuesta">${esc(respuesta(caso))}</p>
          <p class="eyebrow">No puedes decir</p>
          <ul class="tabu-prohibidas">${prohibidas(caso).map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
        </div>
      </div>
      ${figuras(clave)}
      <div class="tabu-botones">
        <button class="si" id="acierto" ${juego.pausa ? "disabled" : ""}>Adivinaron <kbd>1</kbd></button>
        <button class="no" id="tabu" ${juego.pausa ? "disabled" : ""}>Tabú <kbd>2</kbd></button>
        <button id="pasar" ${juego.pausa || !libres ? "disabled" : ""}>Pasar${libres === Infinity ? "" : ` · ${libres}`} <kbd>3</kbd></button>
        <button id="deshacer" class="tabu-deshacer" ${juego.cartas.length ? "" : "disabled"}>Deshacer <kbd>Z</kbd></button>
      </div>
    </section>`;
  $("#acierto").onclick = () => marcar("acierto");
  $("#tabu").onclick = () => marcar("tabu");
  $("#pasar").onclick = () => marcar("paso");
  $("#deshacer").onclick = deshacer;
  $("#pausa").onclick = pausar;
  juego.mazo.slice(1, 3).forEach(precargar);
  const tic = () => {
    const ms = restante();
    const segundos = Math.ceil(ms / 1000);
    const clock = $("#clock");
    if (clock) clock.textContent = segundos;
    const bar = $("#bar");
    if (bar) bar.style.width = `${(100 * ms) / (config.tiempo * 1000)}%`;
    const caja = $("#reloj");
    if (caja) caja.classList.toggle("poco", ms <= Math.min(10, config.tiempo / 4) * 1000);
    if (ms <= 0) {
      clearInterval(reloj);
      sonar("fin");
      terminarTurno("sono");
    }
  };
  tic();
  if (!juego.pausa) reloj = setInterval(tic, 200);
}

function marcar(resultado) {
  if (juego.fase !== "turno" || juego.pausa || restante() <= 0) return;
  if (resultado === "paso" && !pasesLibres(config.pases, juego.pases)) return;
  const clave = juego.mazo[0];
  if (!clave) return;
  juego.cartas.push({ clave, resultado });
  juego.puntos[equipoDelTurno()] += PUNTOS[resultado];
  juego.mazo = sacar(juego.mazo, clave, resultado);
  if (resultado === "paso") juego.pases += 1;
  sonar(resultado === "tabu" ? "tabu" : "ok");
  guardar();
  if (!juego.mazo.length) return terminarTurno();
  mostrar();
}

// Deshace la última marca del turno (un toque equivocado): la carta vuelve arriba del mazo.
function deshacer() {
  if (juego.fase !== "turno" || !juego.cartas.length) return;
  const { clave, resultado } = juego.cartas.pop();
  juego.puntos[equipoDelTurno()] -= PUNTOS[resultado];
  juego.mazo = [clave, ...juego.mazo.filter((k) => k !== clave)];
  if (resultado === "paso") juego.pases -= 1;
  guardar();
  mostrar();
}

function pausar() {
  if (juego.fase !== "turno") return;
  if (juego.pausa) {
    juego.fin = Date.now() + juego.pausa;
    juego.pausa = 0;
  } else {
    juego.pausa = Math.max(1, juego.fin - Date.now());
  }
  guardar();
  mostrar();
}

// Al sonar, la carta que estaba en juego va al repaso como «Sonó el tiempo» (por si la adivinaron justo) y al fondo
// del mazo: el equipo siguiente ya oyó cómo se describía.
function terminarTurno(motivo) {
  if (juego.fase !== "turno") return;
  const enJuego = juego.mazo[0];
  if (motivo === "sono" && enJuego && casoDe(enJuego)) {
    juego.cartas.push({ clave: enJuego, resultado: "sono" });
    juego.mazo = sacar(juego.mazo, enJuego, "paso");
  }
  Object.assign(juego, { fase: "repaso", fin: 0, pausa: 0 });
  guardar();
  mostrar();
}

// Lo que se jugó en el turno, con la descripción de la fuente: aquí se aprende. Cada carta se puede corregir.
function vistaRepaso() {
  const equipo = equipoDelTurno();
  const delTurno = juego.cartas.reduce((n, c) => n + PUNTOS[c.resultado], 0);
  const ultimo = juego.n + 1 >= totalTurnos() || !juego.mazo.length;
  const filas = juego.cartas.map((c, i) => {
    const caso = casoDe(c.clave);
    if (!caso) return "";
    const texto = descripcion(caso);
    return `<article class="tabu-fila ${RESULTADOS[c.resultado].clase}">
      <div class="tabu-fila-cabeza"><b>${esc(respuesta(caso))}</b><span class="spacer"></span>
        <div class="tabu-corregir" role="group" aria-label="Resultado de ${esc(respuesta(caso))}">
          ${["acierto", "tabu", "paso"].map((r) => `<button type="button" class="${RESULTADOS[r].clase} ${c.resultado === r ? "elegido" : ""}"
            data-carta="${i}" data-resultado="${r}" aria-pressed="${c.resultado === r}">${RESULTADOS[r].texto}</button>`).join("")}
        </div></div>
      ${c.resultado === "sono" ? `<p class="src">Estaba en juego cuando sonó. Si la adivinaron a tiempo, marca «Adivinaron».</p>` : ""}
      <div class="tabu-fila-cuerpo">${figuras(c.clave, { una: true })}
        ${texto ? `<div class="md tabu-fuente"><span class="eyebrow">Así lo describe la fuente</span>${md(texto)}</div>` : ""}</div>
      <div class="row"><span class="src">${esc(caso.tema)}</span><span class="spacer"></span>
        <button class="reportar" data-reportar="${i}">Reportar un error</button></div>
    </article>`;
  }).join("");
  app.innerHTML = `<section class="stack">
    <div class="row"><h2>${esc(config.equipos[equipo])}: ${fmt(delTurno)} en este turno</h2></div>
    ${filas || `<p class="muted">No se jugó ninguna carta.</p>`}
    ${marcador()}
    <div class="ctrl"><span class="spacer"></span>
      <button class="primary lg" id="seguir">${ultimo ? "Ver el resultado" : "Siguiente turno"} <kbd>Espacio</kbd></button></div>
  </section>`;
  app.querySelectorAll("[data-resultado]").forEach((b) => {
    b.onclick = () => corregir(Number(b.dataset.carta), b.dataset.resultado);
  });
  app.querySelectorAll("[data-reportar]").forEach((b) => {
    const e = catalogo.get(juego.cartas[Number(b.dataset.reportar)].clave);
    b.onclick = () => reportar(e.ruta, e.caso.id, b);
  });
  $("#seguir").onclick = siguienteTurno;
}

// Cambia el resultado de una carta del turno: corrige el puntaje y deja la carta dentro o fuera del mazo.
function corregir(i, nuevo) {
  const carta = juego.cartas[i];
  if (!carta || carta.resultado === nuevo) return;
  juego.puntos[equipoDelTurno()] += PUNTOS[nuevo] - PUNTOS[carta.resultado];
  const enMazo = juego.mazo.includes(carta.clave);
  if ((nuevo === "acierto" || nuevo === "tabu") && enMazo) juego.mazo = juego.mazo.filter((k) => k !== carta.clave);
  if (nuevo === "paso" && !enMazo) juego.mazo = [...juego.mazo, carta.clave];
  carta.resultado = nuevo;
  guardar();
  const y = window.scrollY;
  vistaRepaso();
  window.scrollTo({ top: y });
}

function siguienteTurno() {
  if (juego.fase !== "repaso") return;
  const fin = juego.n + 1 >= totalTurnos() || !juego.mazo.length;
  Object.assign(juego, fin ? { fase: "resultado" } : { fase: "listo", n: juego.n + 1, cartas: [], pases: 0 });
  guardar();
  mostrar();
}

function vistaResultado() {
  const filas = config.equipos.map((nombre, i) => ({ nombre, puntos: juego.puntos[i] })).sort((a, b) => b.puntos - a.puntos);
  app.innerHTML = `<section class="stack angosto">
    <p class="eyebrow">${esc(config.titulo)}</p>
    <h1>Resultado final</h1>
    <div class="rank">${filas.map((f) => `<div class="rk"><span class="pos">${1 + filas.filter((x) => x.puntos > f.puntos).length}</span>
      <span>${esc(f.nombre)}</span><span class="pts">${fmt(f.puntos)}</span></div>`).join("")}</div>
    <div class="ctrl"><span class="spacer"></span><button class="primary" id="nueva">Nueva partida</button></div>
  </section>`;
  $("#nueva").onclick = nuevaPartida;
}

function nuevaPartida() {
  if (juego && juego.fase !== "resultado" && !confirm("¿Terminar esta partida y armar otra? Se borran los puntajes.")) return;
  const previo = config && {
    temas: config.temas, sinVerificar: config.sinVerificar, niveles: config.niveles, equipos: config.equipos,
    tiempo: config.tiempo, vueltas: config.vueltas, pases: config.pases,
  };
  borrarGuardado();
  pantallaArmado(previo);
}

// ------------------------------------------------------------------ imágenes
function precargar(clave) {
  const datos = datosDeClave(clave);
  const caso = casoDe(clave);
  if (!datos || !caso) return;
  for (const r of figurasCarta(caso)) {
    const src = datos.imagen(r.ref);
    if (src && !precargadas.has(src)) {
      precargadas.add(src);
      new Image().src = src;
    }
  }
}

document.addEventListener("click", (e) => {
  const imagen = e.target.closest("[data-zoom]");
  if (imagen) {
    $("#zoomImg").src = imagen.src;
    $("#zoomImg").alt = imagen.alt;
    $("#zoom").hidden = false;
  }
});
$("#zoom").onclick = () => { $("#zoom").hidden = true; };

// ------------------------------------------------------------------ teclado
// En el turno: 1 adivinaron, 2 tabú, 3 pasar, Z deshacer, P pausa. Espacio empieza el turno y pasa al siguiente.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#zoom").hidden) { $("#zoom").hidden = true; return; }
  if (!config || !juego || e.ctrlKey || e.metaKey || e.altKey) return;
  const destino = e.target instanceof Element ? e.target : document.body;
  if (destino.closest("input, select, textarea")) return;
  if ((e.key === " " || e.key === "Enter") && destino.closest("button, a")) return;   // el botón enfocado ya responde
  const tecla = e.key.toLowerCase();
  const numero = /^(?:Digit|Numpad)([1-3])$/.exec(e.code);
  if (juego.fase === "turno" && numero) {
    e.preventDefault();
    marcar(["acierto", "tabu", "paso"][Number(numero[1]) - 1]);
  } else if (juego.fase === "turno" && tecla === "z") {
    deshacer();
  } else if (juego.fase === "turno" && tecla === "p") {
    pausar();
  } else if (e.key === " " && juego.fase === "listo") {
    e.preventDefault();
    empezarTurno();
  } else if (e.key === " " && juego.fase === "repaso") {
    e.preventDefault();
    siguienteTurno();
  }
});

// ------------------------------------------------------------------ arranque
// Una partida que se recargó en pleno turno vuelve en pausa, con el tiempo que le quedaba.
async function seguir(guardado) {
  app.innerHTML = `<p class="muted">Cargando los casos…</p>`;
  config = guardado.config;
  juego = guardado.juego;
  await cargarTemas(config.temas, datosDe);
  catalogo = armarCatalogo(config.temas, datosDe, config.sinVerificar);
  juego.mazo = juego.mazo.filter((k) => catalogo.has(k));
  if (juego.fase === "turno" && !juego.pausa) juego.pausa = Math.max(1, juego.fin - Date.now());
  mostrar();
}

function iniciar() {
  const guardado = leerGuardado();
  if (!guardado) return pantallaArmado();
  const { config: c, juego: j } = guardado;
  app.innerHTML = `<section class="panel stack angosto">
    <p class="eyebrow">Tabú radiológico</p>
    <h2>Hay una partida guardada en este navegador</h2>
    <p class="muted">${esc(c.titulo)} · turno ${Math.min(j.n + 1, c.equipos.length * c.vueltas)} de ${c.equipos.length * c.vueltas}
      · ${esc(c.equipos.join(", "))}</p>
    <div class="row"><button class="primary lg" id="seguir">Seguir la partida</button><button class="lg" id="otra">Armar otra</button></div>
    <p class="src">«Armar otra» borra esta partida.</p>
  </section>`;
  $("#seguir").onclick = () => seguir(guardado);
  $("#otra").onclick = () => {
    borrarGuardado();
    pantallaArmado();
  };
}

iniciar();
