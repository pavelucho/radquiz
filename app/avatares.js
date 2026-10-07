// RadQuiz — avatares de pixel art para la sala en vivo, dibujados aquí mismo como SVG (sin emojis: Chrome en Windows 7,
// el de muchas PC de hospital, no los muestra; y sin archivos que descargar). Cada uno es una cuadrícula de 10 × 10
// en la que cada letra es un color y el punto es transparente.

const COLORES = {
  w: "#e9eef4", c: "#c9d3de", g: "#8f9cad", G: "#5a6b82", k: "#0b0f14", d: "#1b2633",
  r: "#f47385", R: "#b8475a", p: "#f4a3b8", P: "#c96a86", y: "#f2c14e", b: "#5b9dff", t: "#3fcab6", T: "#24917f",
  n: "#c8894a", N: "#7a4a26", o: "#f28c38", v: "#7cc46a", s: "#e8b48a",
};

// Todos de radiología, en dos grupos. «Clásicos»: anatomía que se mira, los equipos con que se mira, el contraste y la
// mano de Röntgen (la primera radiografía); el trébol de radiación quedó fuera: a 10 × 10 parecía una cara triste.
// «Para reírse»: signos con nombre de comida o de animal y la vida del residente de guardia.
export const GRUPOS_AVATAR = [{ id: "clasicos", nombre: "Clásicos" }, { id: "chistosos", nombre: "Para reírse" }];

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

  { id: "perrito", grupo: "chistosos", nombre: "Perrito escocés", mapa: [
    ".w.w......", ".www.....w", ".wkw.....w", "kwwrwwwwww", "wwwrwwwwww",
    ".wwrwwwwww", "..wwwwwwww", "..ww...ww.", "..ww...ww.", ".........."] },
  { id: "panda", grupo: "chistosos", nombre: "Oso panda", mapa: [
    ".GG....GG.", "GGGwwwwGGG", ".Gwwwwwwg.", ".wwwwwwww.", "wkkwwwwkkw",
    "wkwkwwkwkw", "wkkwwwwkkw", "wwwwkkwwww", ".wwwgwgww.", "..wwwwww.."] },
  { id: "colibri", grupo: "chistosos", nombre: "Colibrí", mapa: [
    "......T...", ".....TT...", "...ttTT...", "..tktTt...", "ggtttttt..",
    "...rrtttt.", "....rtttTt", ".....ttTTT", "........TT", ".........T"] },
  { id: "nieve", grupo: "chistosos", nombre: "Muñeco de nieve", mapa: [
    "...GGGG...", "..GGGGGG..", "..wkwwkw..", "..wwwooo..", "..rrrrrr..",
    ".wwwrwwww.", "wwwwkwwwww", "wwwwwwwwww", "wwwwkwwwww", ".wwwwwwww."] },
  { id: "palomitas", grupo: "chistosos", nombre: "Palomitas de maíz", mapa: [
    "...w..w...", ".wywwcywy.", "wcwywywcww", ".rwrwrwrw.", ".rwrwrwrw.",
    ".rwrwrwrw.", "..wrwrwr..", "..wrwrwr..", "..wrwrwr..", ".........."] },
  { id: "hamburguesa", grupo: "chistosos", nombre: "Hamburguesa", mapa: [
    "..........", "..nnnnnn..", ".nwnnnwnn.", "nnnnwnnnnn", "vvvvvvvvvv",
    "rrrrrrrrrr", "NNNNNNNNNN", "yyyyyyyy..", "nnnnnnnnnn", ".nnnnnnnn."] },
  { id: "helado", grupo: "chistosos", nombre: "Cono de helado", mapa: [
    "...pppp...", "..pwpppp..", ".pppppppp.", ".pPpPpPpP.", ".nNnnNnnN.",
    "..nnNnnn..", "..nNnnNn..", "...nnNn...", "...nNnn...", "....nn...."] },
  { id: "huevo", grupo: "chistosos", nombre: "Huevo colgado de un hilo", mapa: [
    "....g.....", "....g.....", "...wwwc...", "..wwwwwc..", ".wwwwwwwc.",
    ".wkwwwkwc.", "wpwwwwwpwc", "wwkwwwkwwc", ".wwkkkwwc.", "..wwwwwc.."] },
  { id: "cafe", grupo: "chistosos", nombre: "Café de guardia", mapa: [
    "..g..g....", "...g..g...", "..g..g....", "wwwwwww...", "wNNNNNw...",
    "wwwwwwwww.", "bbbbbbb.w.", "wwwwwwwww.", ".wwwwww...", ".........."] },
  { id: "fantasma", grupo: "chistosos", nombre: "Artefacto fantasma", mapa: [
    "...wwww...", "..wwwwww..", ".wwwwwwww.", ".wkkwwkkw.", ".wkkwwkkw.",
    ".wwwwwwww.", ".wwwkkwww.", ".wwwkkwww.", ".wwwwwwww.", ".ww.ww.ww."] },
  { id: "incidentaloma", grupo: "chistosos", nombre: "Incidentaloma", mapa: [
    "..........", "....tt....", "...tttt...", "..tttttt..", ".twwttwwt.",
    ".twkttwkt.", "tttttttttt", "ttttkktttt", "tttttttttt", ".TTTTTTTT."] },
  { id: "posguardia", grupo: "chistosos", nombre: "Residente posguardia", mapa: [
    ".G.GG.G.G.", ".GGGGGGGG.", ".GssssssG.", ".ssssssss.", ".sGGssGGs.",
    ".sPPssPPs.", ".ssssssss.", ".sssggsss.", "..ssssss..", "..wwbbww.."] },
];
const POR_ID = new Map(AVATARES.map((a) => [a.id, a]));
const cache = new Map();

export const esAvatar = (id) => POR_ID.has(id);
export const avataresDe = (grupo) => AVATARES.filter((a) => (a.grupo || "clasicos") === grupo);
export const nombreAvatar = (id) => POR_ID.get(id)?.nombre || "";
export const avatarAleatorio = () => AVATARES[Math.floor(Math.random() * AVATARES.length)].id;

// Apodos para quien entra sin escribir nombre: humor de sala de lectura, cortos (las reglas aceptan hasta 24 letras) y sin
// género cuando se puede. No se repiten dentro de una sala mientras queden libres.
export const APODOS = [
  "Dr. Artefacto", "Incidentaloma andante", "Señor Gadolinio", "Capitán Kilovoltio", "Lord Voxel", "Barón de Röntgen",
  "Fantasma de Gibbs", "Ninja del PACS", "Hipodenso feliz", "Hiperintenso en T2", "Isodenso misterioso",
  "Sombra sospechosa", "No concluyente", "Sin cambios relevantes", "Correlacione con clínica",
  "Estudio subóptimo", "Rey del píxel", "Zombi de guardia", "Perrito escocés", "Panda del mesencéfalo",
  "Doble contraste", "Cono de helado", "Hallazgo incidental", "Lady Tesla",
];

// Un apodo que nadie de la sala tenga; si ya están todos, uno con número.
export function apodoAleatorio(usados = []) {
  const tomados = new Set(usados.map((n) => String(n).toLowerCase()));
  const libres = APODOS.filter((n) => !tomados.has(n.toLowerCase()));
  if (libres.length) return libres[Math.floor(Math.random() * libres.length)];
  const cortos = APODOS.filter((n) => n.length <= 20);  // que quepa « 123»
  const base = cortos[Math.floor(Math.random() * cortos.length)];
  for (let i = 2; ; i++) if (!tomados.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

// Cualquier dibujo de pixel art (una lista de filas con las letras de COLORES) como SVG en data URI. Cada fila se dibuja
// en tramos del mismo color, para que pese poco. Lo usan también las reacciones de la sala.
export function pixelSrc(mapa) {
  const rects = [];
  mapa.forEach((fila, y) => {
    let x = 0;
    while (x < fila.length) {
      const c = fila[x];
      let fin = x + 1;
      while (fin < fila.length && fila[fin] === c) fin++;
      if (c !== "." && COLORES[c]) rects.push(`<rect x='${x}' y='${y}' width='${fin - x}' height='1' fill='${COLORES[c]}'/>`);
      x = fin;
    }
  });
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${mapa[0].length} ${mapa.length}' shape-rendering='crispEdges'>${rects.join("")}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function avatarSrc(id) {
  const avatar = POR_ID.get(id);
  if (!avatar) return "";
  if (!cache.has(id)) cache.set(id, pixelSrc(avatar.mapa));
  return cache.get(id);
}

// La etiqueta <img> lista para insertar; vacía si no hay avatar.
export const avatarImg = (id, clase = "avatar") => (esAvatar(id) ? `<img class="${clase}" src="${avatarSrc(id)}" alt="" width="24" height="24">` : "");
