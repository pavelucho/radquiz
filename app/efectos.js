// RadQuiz — sonido, vibración y confeti para la sala en vivo. Los sonidos se sintetizan con WebAudio: notas suaves de
// seno y triángulo, como una marimba o una campanita, a volumen bajo (los primeros, de onda cuadrada y con un redoble
// de ruido, resultaban estruendosos). No hay archivos que descargar por la red del hospital. Suenan en el
// proyector; el celular vibra (solo en Android: iPhone no deja). Con «reducir movimiento», no hay confeti.

const CLAVE = "radquiz.sonido";
let ctx = null;
let maestro = null;

function leer() {
  try { return localStorage.getItem(CLAVE) !== "no"; } catch { return true; }
}
let activo = leer();

export const sonidoActivo = () => activo;
export function alternarSonido() {
  activo = !activo;
  try { localStorage.setItem(CLAVE, activo ? "si" : "no"); } catch { /* sin almacenamiento: dura hasta recargar */ }
  if (activo) sonar("ok");
  return activo;
}

// El navegador solo deja sonar después de un toque: se llama en el primer clic del presentador.
export function prepararAudio() {
  try {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      maestro = ctx.createGain();
      maestro.gain.value = 0.12;   // suave: se oye en el aula sin sobresaltar
      maestro.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
  } catch { ctx = null; }
}

// Una nota suave, como de marimba o campanita: seno (o triángulo), ataque corto pero no seco y una caída larga.
// Con `brillo`, una octava encima muy baja, que la hace sonar a campana sin volverla chillona.
function nota(frecuencia, desde, dura, { tipo = "sine", vol = 0.5, brillo = 0 } = {}) {
  const t = ctx.currentTime + desde;
  const voces = [[frecuencia, vol], ...(brillo ? [[frecuencia * 2, vol * brillo]] : [])];
  for (const [f, v] of voces) {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = tipo;
    osc.frequency.setValueAtTime(f, t);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(v, t + 0.025);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dura);
    osc.connect(env).connect(maestro);
    osc.start(t);
    osc.stop(t + dura + 0.05);
  }
}

// Notas de una escala pentatónica (no desafinan entre sí, suenan amables en cualquier orden).
const C5 = 523.25, D5 = 587.33, E5 = 659.25, G5 = 783.99, A5 = 880, C6 = 1046.5, G4 = 392, A4 = 440, E4 = 329.63;
const SUBIDA = [C5, D5, E5, G5, A5, C6];

const SONIDOS = {
  ok: () => nota(C6, 0, 0.25, { vol: 0.35 }),
  tic: () => nota(1046.5, 0, 0.09, { vol: 0.18 }),
  ultimoTic: () => nota(1318.5, 0, 0.14, { vol: 0.24 }),
  // Mientras suben las barras: una nota suave por barra, cada vez más aguda.
  redoble: (dura = 1.6) => {
    const pasos = Math.max(1, Math.round((dura - 0.3) / 0.3));
    for (let i = 0; i < pasos; i++) nota(SUBIDA[Math.min(i, SUBIDA.length - 1)], i * 0.3, 0.35, { tipo: "triangle", vol: 0.22 });
  },
  // Al marcar la correcta: una campanita.
  golpe: () => nota(C6, 0, 0.9, { vol: 0.35, brillo: 0.15 }),
  acierto: () => [C5, E5, G5].forEach((f, i) => nota(f, i * 0.1, 0.45, { vol: 0.3 })),
  corazon: () => { nota(E5, 0, 0.3, { tipo: "triangle", vol: 0.3 }); nota(C5, 0.16, 0.45, { tipo: "triangle", vol: 0.28 }); },
  caida: () => [G5, E5, C5, A4].forEach((f, i) => nota(f, i * 0.16, 0.4, { tipo: "triangle", vol: 0.26 })),
  rescate: () => [G4, C5, E5, G5].forEach((f, i) => nota(f, i * 0.09, 0.4, { vol: 0.3, brillo: 0.1 })),
  racha: () => [E5, G5, C6].forEach((f, i) => nota(f, i * 0.08, 0.3, { vol: 0.26 })),
  puesto: () => nota(A4, 0, 0.5, { tipo: "triangle", vol: 0.32 }),
  fanfarria: () => [[C5, 0], [E5, 0.14], [G5, 0.28], [C6, 0.42]]
    .forEach(([f, d]) => { nota(f, d, 0.9, { vol: 0.28, brillo: 0.1 }); nota(f / 2, d, 0.9, { tipo: "triangle", vol: 0.12 }); }),
  salvados: () => [D5, G5, A5].forEach((f, i) => nota(f, i * 0.11, 0.4, { vol: 0.28 })),
};

export function sonar(nombre, ...args) {
  if (!activo || !SONIDOS[nombre]) return;
  prepararAudio();
  if (!ctx) return;
  try { SONIDOS[nombre](...args); } catch { /* un navegador sin algo de WebAudio: se sigue sin sonido */ }
}

export function vibrar(patron) {
  try { if (navigator.vibrate) navigator.vibrate(patron); } catch { /* sin vibración */ }
}

const sinMovimiento = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Confeti en un canvas encima de todo, que se borra solo. Los colores son los de las letras A–E y el de la marca.
export function confeti({ duracion = 4500, cantidad = 160 } = {}) {
  if (sinMovimiento()) return;
  const lienzo = document.createElement("canvas");
  lienzo.className = "confeti";
  lienzo.setAttribute("aria-hidden", "true");
  document.body.append(lienzo);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const ajustar = () => {
    lienzo.width = innerWidth * dpr;
    lienzo.height = innerHeight * dpr;
  };
  ajustar();
  const g = lienzo.getContext("2d");
  const colores = ["#5b9dff", "#f5a24f", "#3fcab6", "#b48cff", "#ff7d93", "#f2c14e"];
  const piezas = Array.from({ length: cantidad }, () => ({
    x: Math.random() * innerWidth,
    y: -20 - Math.random() * innerHeight * 0.6,
    vx: (Math.random() - 0.5) * 2.4,
    vy: 1.5 + Math.random() * 3,
    giro: Math.random() * Math.PI,
    vgiro: (Math.random() - 0.5) * 0.25,
    lado: 5 + Math.random() * 6,
    color: colores[Math.floor(Math.random() * colores.length)],
  }));
  const inicio = performance.now();
  const cuadro = (ahora) => {
    const t = ahora - inicio;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, innerWidth, innerHeight);
    g.globalAlpha = t > duracion - 800 ? Math.max(0, (duracion - t) / 800) : 1;
    for (const p of piezas) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.03;
      p.giro += p.vgiro;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.giro);
      g.fillStyle = p.color;
      g.fillRect(-p.lado / 2, -p.lado / 4, p.lado, p.lado / 2);
      g.restore();
    }
    if (t < duracion) requestAnimationFrame(cuadro);
    else lienzo.remove();
  };
  requestAnimationFrame(cuadro);
}
