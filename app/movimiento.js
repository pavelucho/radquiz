// RadQuiz — el interruptor de las animaciones. Es de cada aparato, como el sonido: el proyector, cada celular y cada
// computadora eligen por su cuenta, y la elección vale para todas las páginas (localStorage, «radquiz.movimiento»).
// Sin elección, manda lo que diga el sistema («reducir movimiento» en el celular o la computadora); una elección
// hecha aquí gana sobre el sistema, en los dos sentidos.
//
// Se aplica como <html data-movimiento="si|no">: app/estilos.css apaga todo con «no», y el código que anima con
// JavaScript (la captación del final, la inercia de la ampliación) pregunta movimientoActivo(). Cada página pone el
// atributo en el <head>, antes de pintar, con el mismo criterio que leer() de aquí, para que nada empiece a moverse y
// se corte; este módulo lo mantiene al día y conecta los botones con data-movimiento.
//
// Qué se anima y qué no (ver la nota de diseño en CLAUDE.md): mientras se lee un caso no se mueve nada que sobre; las
// animaciones van en las transiciones y en el revelado, el ranking y el final.

const CLAVE = "radquiz.movimiento";
const sistema = () => {
  try { return globalThis.matchMedia("(prefers-reduced-motion: reduce)"); } catch { return null; }
};

function eleccion() {
  try {
    const v = localStorage.getItem(CLAVE);
    return v === "si" || v === "no" ? v : null;
  } catch { return null; }
}

function leer() {
  const v = eleccion();
  if (v) return v === "si";
  return !sistema()?.matches;
}

let activo = leer();
export const movimientoActivo = () => activo;

const botones = new Set();
function pintarBoton(boton) {
  boton.textContent = activo ? "Animaciones: sí" : "Animaciones: no";
  boton.setAttribute("aria-pressed", String(activo));
  boton.title = activo
    ? "Apagar las animaciones en este aparato"
    : "Encender las animaciones en este aparato";
}

const hayPagina = typeof document !== "undefined";   // fuera del navegador (Node) no hay nada que pintar

function aplicar() {
  if (!hayPagina) return;
  document.documentElement.dataset.movimiento = activo ? "si" : "no";
  botones.forEach((b) => (b.isConnected ? pintarBoton(b) : botones.delete(b)));   // los de una vista que ya se fue, fuera
}

export function alternarMovimiento() {
  activo = !activo;
  try { localStorage.setItem(CLAVE, activo ? "si" : "no"); } catch { /* sin almacenamiento: dura hasta recargar */ }
  aplicar();
  return activo;
}

// Un botón con data-movimiento queda conectado al cargar la página: muestra el estado y lo cambia al tocarlo. Los que
// se dibujan después (el lobby del celular) o los que se muestran según el papel (la cabecera de la sala) se conectan
// a mano; con { mostrar: false } su visibilidad la decide quien lo llama.
export function conectarBoton(boton, { mostrar = true } = {}) {
  if (!boton || botones.has(boton)) return;
  botones.add(boton);
  boton.type = "button";
  if (mostrar) boton.hidden = false;
  boton.addEventListener("click", alternarMovimiento);
  pintarBoton(boton);
}

aplicar();
if (hayPagina) document.querySelectorAll("button[data-movimiento]").forEach(conectarBoton);
// Si la persona no eligió aquí y cambia «reducir movimiento» en el sistema, se sigue al sistema sin recargar.
const consulta = sistema();
consulta?.addEventListener?.("change", () => {
  if (eleccion()) return;
  activo = leer();
  aplicar();
});
