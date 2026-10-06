// RadQuiz — avatares de pixel art para la sala en vivo, dibujados aquí mismo como SVG (sin emojis: Chrome en Windows 7,
// el de muchas PC de hospital, no los muestra; y sin archivos que descargar). Cada uno es una cuadrícula de 10 × 10
// en la que cada letra es un color y el punto es transparente.

const COLORES = {
  w: "#e9eef4", c: "#c9d3de", g: "#8f9cad", G: "#5a6b82", k: "#0b0f14", d: "#1b2633",
  r: "#f47385", R: "#b8475a", p: "#f4a3b8", P: "#c96a86", y: "#f2c14e", b: "#5b9dff", t: "#3fcab6", T: "#24917f",
};

// Todos de radiología: anatomía que se mira, los equipos con que se mira, el contraste y la mano de Röntgen (la primera
// radiografía). El trébol de radiación quedó fuera: a 10 × 10 parecía una cara triste.
export const AVATARES = [
  { id: "craneo", nombre: "Cráneo", mapa: [
    "..wwwwww..", ".wwwwwwww.", "wwwwwwwwww", "wwkkwwkkww", "wwkkwwkkww",
    "wwwwkkwwww", ".wwwwwwww.", "..wkwkwk..", "..wwwwww..", ".........."] },
  { id: "hueso", nombre: "Hueso", mapa: [
    "..........", "..........", ".ww....ww.", "wwww..wwww", ".wwwwwwww.",
    ".wwwwwwww.", "wwww..wwww", ".ww....ww.", "..........", ".........."] },
  { id: "cerebro", nombre: "Cerebro", mapa: [
    "..........", "...pppp...", ".ppPppPpp.", "pPppPppPpp", "ppPpppPppp",
    "pppPpPpppp", ".ppppppPp.", "..pp.ppp..", ".....pp...", ".....p...."] },
  { id: "pulmones", nombre: "Pulmones", mapa: [
    "....gg....", "....gg....", "..ppggpp..", ".pppggppp.", ".ppp..ppp.",
    "pppp..pppp", "pPpp..ppPp", "pppp..pppp", ".ppp..ppp.", "..pp..pp.."] },
  { id: "columna", nombre: "Columna", mapa: [
    "...wwww...", "..wwwwwwg.", "....tt....", "...wwww...", "..wwwwwwg.",
    "....tt....", "...wwww...", "..wwwwwwg.", "....tt....", "...wwww..."] },
  { id: "rinon", nombre: "Riñón", mapa: [
    "..RRRR....", ".RrrrrR...", "RrrrrrR...", "Rrrrrr....", "Rrrrryyy..",
    "Rrrrrr..y.", "RrrrrrR.y.", ".RrrrrR.y.", "..RRRR..y.", "........y."] },
  { id: "torax", nombre: "Placa de tórax", mapa: [
    "dddddddddd", "dccccccccd", "ddddccdddd", "dccccccccd", "ddddccdddd",
    "dccccccccd", "ddddccggdd", "dcccccggcd", "ddddccgggd", "dddddddddd"] },
  { id: "iman", nombre: "Imán de RM", mapa: [
    "gg......gg", "gg......gg", "rr......rr", "rr......rr", "rr......rr",
    "rrr....rrr", ".rrr..rrr.", "..rrrrrr..", "...rrrr...", ".........."] },
  { id: "tomografo", nombre: "Tomógrafo", mapa: [
    "..wwbbww..", ".wwwwwwww.", "wwwkkkkwww", "wwkkkkkkww", "wwkkkkkkww",
    "tttttttttt", "wwkkkkkkww", "wwwkkkkwww", ".wwwwwwww.", "..wwwwww.."] },
  { id: "ecografo", nombre: "Ecógrafo", mapa: [
    "....gg....", "....gg....", "...GggG...", "...gggg...", "..GggggG..",
    "..kkkkkk..", "...tttt...", "..tTTTTt..", ".tttttttt.", "tTTTTTTTTt"] },
  { id: "contraste", nombre: "Contraste", mapa: [
    "..........", "..........", ".wwwwwww..", "gwyyyyyw..", "gwyyyyywgg",
    "gwyyyyyw..", ".wwwwwww..", "..........", "..........", ".........."] },
  { id: "mano", nombre: "Mano de Röntgen", mapa: [
    "dddddcdddd", "dddcdcdcdd", "dddcdcdcdc", "dddcdcdcdc", "dddddddddd",
    "cddcdcdcdc", "dcdcdcdcdc", "ddcccccccd", "ddcccccccd", "dddccccddd"] },
];
const POR_ID = new Map(AVATARES.map((a) => [a.id, a]));
const cache = new Map();

export const esAvatar = (id) => POR_ID.has(id);
export const nombreAvatar = (id) => POR_ID.get(id)?.nombre || "";
export const avatarAleatorio = () => AVATARES[Math.floor(Math.random() * AVATARES.length)].id;

// El SVG como data URI. Cada fila se dibuja en tramos del mismo color, para que pese poco.
export function avatarSrc(id) {
  const avatar = POR_ID.get(id);
  if (!avatar) return "";
  if (cache.has(id)) return cache.get(id);
  const rects = [];
  avatar.mapa.forEach((fila, y) => {
    let x = 0;
    while (x < fila.length) {
      const c = fila[x];
      let fin = x + 1;
      while (fin < fila.length && fila[fin] === c) fin++;
      if (c !== "." && COLORES[c]) rects.push(`<rect x='${x}' y='${y}' width='${fin - x}' height='1' fill='${COLORES[c]}'/>`);
      x = fin;
    }
  });
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${avatar.mapa[0].length} ${avatar.mapa.length}' shape-rendering='crispEdges'>${rects.join("")}</svg>`;
  const src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  cache.set(id, src);
  return src;
}

// La etiqueta <img> lista para insertar; vacía si no hay avatar.
export const avatarImg = (id, clase = "avatar") => (esAvatar(id) ? `<img class="${clase}" src="${avatarSrc(id)}" alt="" width="24" height="24">` : "");
