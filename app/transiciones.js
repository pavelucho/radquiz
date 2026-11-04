// RadQuiz — transiciones dentro de una página: de un caso al siguiente, de una página de la lectura a la otra, de la
// casilla del tablero a su caso. Entre páginas de la web no hace falta este módulo: lo hace el navegador con
// @view-transition (app/estilos.css) y el <head> de cada página.
//
// Cada transición dice qué cambió con un movimiento que se parece a lo que pasa (Tversky et al., 2002): avanzar de caso
// es pasar al corte siguiente de una serie (lo de antes se aleja, lo nuevo se acerca); pasar la página se desliza de
// lado; la casilla del tablero crece hasta ser el caso y vuelve a su lugar. Todas duran menos de 0,4 s y terminan
// antes de que se empiece a leer: mientras se lee un caso no se mueve nada (ver la nota de diseño en CLAUDE.md).
//
// Dos caminos:
// - transicion(): con View Transitions (Chrome 111+, Safari 18+), el navegador fotografía la vista vieja, se dibuja la
//   nueva y se anima entre las dos. Se usa donde el cambio lo pide quien usa la página (la práctica, la lectura, el
//   tablero), porque el dibujo nuevo llega un cuadro después. Sin esa API (Chrome 109 de Windows 7, Firefox), dibuja
//   igual y anima solo la entrada de lo nuevo.
// - entrada(): solo la entrada, siempre en el momento. Para la sala en vivo, el Tabú y el estudio, que se redibujan
//   por su cuenta (la base de datos, el reloj) y no pueden esperar un cuadro.
// Con «Animaciones: no» (app/movimiento.js) ninguna de las dos anima: el cambio es inmediato.

import { movimientoActivo } from "./movimiento.js";

const raiz = document.documentElement;
let vigente = 0;

// tipo: "caso" (corte siguiente), "lamina" (página o diapositiva, de lado), "casilla" (crece desde un elemento),
// "fase" (un barrido, como un apartado nuevo). sentido: "adelante" o "atras".
// antes(): marca la vista vieja antes de la foto (por ejemplo, la casilla que crece); despues(): marca la nueva.
export function transicion(cambiar, { tipo = "fase", sentido = "adelante", antes = null, despues = null, contenedor = null } = {}) {
  if (!movimientoActivo()) { cambiar(); despues?.(); limpiarNombres(); return null; }
  if (typeof document.startViewTransition !== "function" || document.hidden) {
    cambiar();
    entrada(contenedor || document.getElementById("app"), { tipo, sentido });
    return null;
  }
  const n = ++vigente;
  raiz.dataset.transicion = tipo;
  raiz.dataset.sentido = sentido;
  antes?.();
  let t;
  try {
    t = document.startViewTransition(() => { limpiarNombres(); cambiar(); despues?.(); });
  } catch {
    delete raiz.dataset.transicion; delete raiz.dataset.sentido;
    limpiarNombres(); cambiar(); return null;
  }
  // Si otra transición la interrumpe (flechas seguidas), las promesas se rechazan: no es un error.
  t.ready.catch(() => {});
  t.updateCallbackDone.catch(() => {});
  t.finished.catch(() => {}).finally(() => {
    if (n !== vigente) return;   // ya empezó otra: los atributos son de ella
    delete raiz.dataset.transicion;
    delete raiz.dataset.sentido;
    limpiarNombres();
  });
  return t;
}

// Nombres puestos a mano para una transición (la casilla del tablero): se quitan al terminar, porque dos elementos con
// el mismo nombre en la misma vista cancelan la transición.
const nombrados = new Set();
export function nombrar(el, nombre) {
  if (!el) return;
  el.style.viewTransitionName = nombre;
  nombrados.add(el);
}
function limpiarNombres() {
  nombrados.forEach((el) => { el.style.viewTransitionName = ""; });
  nombrados.clear();
}

// Solo la entrada de lo nuevo, en el momento, con una clase que reinicia una animación de CSS.
export function entrada(el, { tipo = "fase", sentido = "adelante" } = {}) {
  if (!el || !movimientoActivo()) return;
  const clases = ["entra-fase", "entra-caso", "entra-lamina", "entra-casilla", "atras"];
  el.classList.remove(...clases);
  void el.offsetWidth;   // fuerza el reinicio de la animación aunque la clase sea la misma que la vez anterior
  el.classList.add(`entra-${tipo}`);
  if (sentido === "atras") el.classList.add("atras");
  // animationend sube desde los hijos (el suspenso de la sala, el trazo): solo cuenta el del contenedor
  const quitar = (e) => {
    if (e.target !== el) return;
    el.classList.remove(...clases);
    el.removeEventListener("animationend", quitar);
  };
  el.addEventListener("animationend", quitar);
}

// El contenido de casi todas las páginas se arma después de cargar los datos: primero se ve «Cargando…» y luego llega
// lo de verdad. La transición entre páginas solo alcanza a la primera vista, así que lo que llega después entra con
// el mismo barrido, si llega pronto (si tarda, aparece sin más: ya no se lee como parte del paso de una página a otra).
function primeraEntrada() {
  const app = typeof document !== "undefined" && document.getElementById("app");
  if (!app || !movimientoActivo()) return;
  const inicio = performance.now();
  const observador = new MutationObserver(() => {
    observador.disconnect();
    if (performance.now() - inicio < 2500) entrada(app, { tipo: "fase" });
  });
  observador.observe(app, { childList: true });
}
primeraEntrada();
