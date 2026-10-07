// RadQuiz — reacciones de la sala en vivo: al revelar (y en el ranking y el final) cada jugador toca una desde el
// celular y sube flotando por el proyector, con su nombre. En pixel art como los avatares (sin emojis: Chrome en
// Windows 7 no los muestra).
//
// En la base: reacciones/<uid> = { e: id de la reacción, t: hora del servidor }. Una por persona, que se pisa; las
// reglas piden 1,5 s entre una y otra y solo dejan leerlas al presentador.
import { AVATARES, pixelSrc } from "./avatares.js";

export const PAUSA_REACCION = 1500;   // ms entre dos reacciones de la misma persona (lo mismo piden las reglas)

export const REACCIONES = [
  { id: "sorpresa", nombre: "¡Wow!", mapa: [
    "...yyyy...", ".yyyyyyyy.", ".ykkyykky.", "yyyyyyyyyy", "yyykyykyyy",
    "yyyyyyyyyy", "yyyykkyyyy", ".yykkkkyy.", ".yyykkyyy.", "...yyyy..."] },
  { id: "risa", nombre: "Jajaja", mapa: [
    "...yyyy...", ".yyyyyyyy.", ".yykyykyy.", "yykykkykyy", "byyyyyyyyb",
    "byykkkkyyb", ".yykrrkyy.", ".yyykkyyy.", "..yyyyyy..", ".........."] },
  { id: "fuego", nombre: "¡Fuego!", mapa: [
    "....r.....", "...rr.....", "...rrr..r.", "..rrorr.r.", "..rroorrr.",
    ".rrooyorr.", ".rroyyoor.", ".roooyyor.", ".rrooyyor.", "..rrrrrr.."] },
  { id: "corazon", nombre: "Me encanta", mapa: [
    "..........", ".rrr..rrr.", "rrwrrrrrrr", "rwrrrrrrrr", "rrrrrrrrrr",
    ".rrrrrrrr.", "..rrrrrr..", "...rrrr...", "....rr....", ".........."] },
  { id: "bombilla", nombre: "¡Lo sabía!", mapa: [
    "...yyyy...", "..yyyyyy..", ".yywyyyyy.", ".ywyyyyyy.", ".yyyyyyyy.",
    "..yyyyyy..", "...yyyy...", "...gggg...", "...GGGG...", "....gg...."] },
  { id: "craneo", nombre: "Me morí", mapa: AVATARES.find((a) => a.id === "craneo").mapa },
];
const POR_ID = new Map(REACCIONES.map((r) => [r.id, r]));
const cache = new Map();

export const esReaccion = (id) => POR_ID.has(id);
export const nombreReaccion = (id) => POR_ID.get(id)?.nombre || "";
export function reaccionSrc(id) {
  if (!POR_ID.has(id)) return "";
  if (!cache.has(id)) cache.set(id, pixelSrc(POR_ID.get(id).mapa));
  return cache.get(id);
}

// La fila de botones del celular. `bloqueadas`: mientras corre la pausa entre reacciones.
export function barraReacciones(bloqueadas = false) {
  return `<div class="reacciones" role="group" aria-label="Reaccionar en el proyector">${REACCIONES.map((r) => `<button type="button"
    class="reaccion" data-reaccion="${r.id}" aria-label="${r.nombre}" title="${r.nombre}" ${bloqueadas ? "disabled" : ""}>
    <img src="${reaccionSrc(r.id)}" alt="" width="28" height="28"></button>`).join("")}</div>`;
}

// En el proyector: la reacción sube flotando desde abajo, en un lugar al azar, y se va. Si ya hay muchas en pantalla,
// las nuevas se descartan para no tapar la figura.
const MAX_EN_PANTALLA = 24;
const DURACION = 2800;
export function lanzarReaccion(id, nombre) {
  if (!POR_ID.has(id)) return;
  let capa = document.getElementById("lluvia");
  if (!capa) {
    capa = document.createElement("div");
    capa.id = "lluvia";
    capa.setAttribute("aria-hidden", "true");
    document.body.append(capa);
  }
  if (capa.childElementCount >= MAX_EN_PANTALLA) return;
  const nodo = document.createElement("div");
  nodo.className = "flota";
  nodo.style.setProperty("--x", `${Math.round(4 + Math.random() * 82)}vw`);
  nodo.style.setProperty("--deriva", `${Math.round(Math.random() * 60 - 30)}px`);
  const img = document.createElement("img");
  img.src = reaccionSrc(id);
  img.alt = "";
  const quien = document.createElement("span");
  quien.textContent = nombre;
  nodo.append(img, quien);
  capa.append(nodo);
  setTimeout(() => nodo.remove(), DURACION);
}
