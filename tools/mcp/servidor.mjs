#!/usr/bin/env node
// RadQuiz — servidor MCP para manejar el estudio en línea (Firebase) desde Claude Code u otro cliente MCP.
//
// Hace lo mismo que el estudio web, con la misma cuenta y las mismas reglas: entra con Google como el autor
// (nunca con una cuenta de servicio), así que la base solo le deja hacer lo que el autor puede hacer en el
// navegador. La lógica es la de la app: valida con app/validacion.js, carga correcciones con
// app/instrucciones-ia.js y sube las figuras con app/drive.js. Aquí solo hay transporte y pegamento.
//
// Sin dependencias: Node ≥ 20 (fetch, Blob, crypto.subtle) y, para las figuras, el ayudante tools/mcp/imagen.swift
// (Vision y CoreGraphics de macOS), que se compila solo la primera vez.
//
// La sesión: «sesion_iniciar» abre una página en localhost (dominio autorizado en Firebase Auth) donde el autor
// entra con Google. Se guarda el token de renovación de Firebase en ~/.config/radquiz-mcp/sesion.json (permiso
// 600); el permiso de Drive dura una hora y solo vive en memoria, como en el estudio.
//
// Protocolo: JSON-RPC 2.0 por la entrada y salida estándar, un mensaje por línea (MCP «stdio»). Los registros van
// a la salida de errores.

import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { mkdir, readFile, writeFile, chmod, stat, rm, mkdtemp } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { firebaseConfig } from "../../app/firebase-config.js";
import {
  validarTema, validarFuente, aPaquete, casosOrdenados, imagenesOrdenadas, lecturasOrdenadas, lista, LICENCIAS, TIPOS_FUENTE,
  normalizarDificultad, normalizarClasificacion, clasificacionDe, nombreClasificacion, deLectura, dePaquete, entradaIndice, slug,
} from "../../app/validacion.js";
import { leerRespuestaIA, planDeCarga } from "../../app/instrucciones-ia.js";
import {
  ALCANCE_DRIVE, ID_DRIVE, carpetaDelTema, subirFigura, existeEnDrive, archivosDeCarpeta, aLaPapelera,
  comprobarLectura, huella, urlDrive,
} from "../../app/drive.js";
import { bytesDeDataURL } from "../../app/zip.js";
import { indiceDePaquete, indicePorRuta, temasPara, coincide, resumenCaso, nombreCriterio } from "../../app/cuestionario.js";
import { cargarIndice, cargarTemas, armarCatalogo } from "../../app/catalogo.js";
import { indicesDeCasos } from "../../app/publicado.js";
import { normalizar, temasDe, codificar, lineaCandidato, REGLAS_IA, FORMATO_IA } from "../../app/plantilla-tablero.js";
import { respuestaDe } from "../../app/tablero.js";
import { SEGMENTOS, URL_OFICIAL } from "../../app/comun.js";
import { AREAS } from "../../app/areas.js";

const ejecutar = promisify(execFile);
const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, "../..");
const DB = firebaseConfig.databaseURL;
const CLAVE = firebaseConfig.apiKey;
const CONFIG = join(homedir(), ".config", "radquiz-mcp");
const ARCHIVO_SESION = join(CONFIG, "sesion.json");
const CACHE = join(homedir(), ".cache", "radquiz-mcp");
const AHORA = { ".sv": "timestamp" };   // serverTimestamp() de la API REST
const LIMITE_FIGURA = 245_000;           // bytes; el validador pide ≤ 250 KB
const hoy = () => new Date().toISOString().slice(0, 10);
const log = (...x) => process.stderr.write(`[radquiz-mcp] ${x.join(" ")}\n`);

// ------------------------------------------------------------------ la declaración, tal como la tiene el estudio
// Una sola fuente: se lee de app/estudio.js para que el texto y su versión no se separen nunca.
async function declaracion() {
  const fuente = await readFile(join(RAIZ, "app", "estudio.js"), "utf8");
  const m = fuente.match(/const DECLARACION = (\{[\s\S]*?\n\});/);
  if (!m) throw new Error("No encontré DECLARACION en app/estudio.js.");
  return new Function(`return ${m[1]}`)();
}

// ------------------------------------------------------------------ sesión
let sesion = null;          // { refreshToken, uid, email }
let idToken = null;         // { token, vence }
let drive = null;           // { token, vence }
let perfil = null;          // usuarios/<uid>: { nombre, usuario, rol }
let pendiente = null;       // inicio de sesión en curso: { url, promesa, cerrar }

async function cargarSesion() {
  if (sesion) return sesion;
  try {
    sesion = JSON.parse(await readFile(ARCHIVO_SESION, "utf8"));
  } catch {
    sesion = null;
  }
  return sesion;
}

async function guardarSesion(datos) {
  await mkdir(CONFIG, { recursive: true });
  await writeFile(ARCHIVO_SESION, JSON.stringify(datos), { mode: 0o600 });
  await chmod(ARCHIVO_SESION, 0o600);
  sesion = datos;
  idToken = null;
  perfil = null;
}

async function token() {
  if (idToken && idToken.vence > Date.now()) return idToken.token;
  const s = await cargarSesion();
  if (!s?.refreshToken) throw new Error("No hay sesión: usa «sesion_iniciar» y entra con tu cuenta de Google.");
  const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${CLAVE}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: s.refreshToken }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`La sesión ya no vale (${d.error?.message || r.status}): usa «sesion_iniciar» otra vez.`);
  idToken = { token: d.id_token, vence: Date.now() + (Number(d.expires_in) - 120) * 1000 };
  return idToken.token;
}

async function db(metodo, ruta, cuerpo, consulta = "") {
  const t = await token();
  const r = await fetch(`${DB}/${ruta}.json?auth=${t}${consulta}`, {
    method: metodo,
    headers: cuerpo === undefined ? {} : { "Content-Type": "application/json" },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await r.text();
  if (!r.ok) {
    let motivo = texto;
    try { motivo = JSON.parse(texto).error || texto; } catch {}
    throw new Error(`La base rechazó ${metodo} ${ruta || "/"}: ${motivo}`);
  }
  return texto ? JSON.parse(texto) : null;
}
const leer = (ruta) => db("GET", ruta);
const escribir = (ruta, valor) => db("PUT", ruta, valor);
const actualizar = (cambios) => db("PATCH", "", cambios);   // varias rutas de una vez, como update(ref(db), …)
const leerClaves = async (ruta) => Object.keys((await db("GET", ruta, undefined, "&shallow=true")) || {});   // solo los ids

async function miPerfil() {
  if (perfil) return perfil;
  await token();
  perfil = await leer(`usuarios/${sesion.uid}`);
  if (!perfil?.rol) throw new Error("Esta cuenta no está dada de alta en el estudio: entra una vez en el estudio web.");
  return perfil;
}

function tokenDrive() {
  if (drive && drive.vence > Date.now()) return drive.token;
  throw new Error("El permiso de Drive venció o no se pidió: usa «sesion_iniciar» (dura una hora, como en el estudio).");
}

// La página de entrada. Firebase Auth acepta «localhost»; el estado aleatorio impide que otra página local
// mande una sesión que no es la tuya.
function paginaEntrada(estado) {
  const config = JSON.stringify(firebaseConfig);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>RadQuiz · conectar Claude</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#16181c;color:#e8e6e1;display:grid;place-items:center;min-height:100vh;margin:0}
main{max-width:30rem;padding:2rem;background:#1f2228;border-radius:12px}button{font:inherit;padding:.6rem 1.2rem;border:0;border-radius:8px;background:#f2c94c;color:#16181c;font-weight:600;cursor:pointer}
.src{color:#a9a49a;font-size:.9rem}</style></head><body><main>
<h1>Conectar Claude con el estudio</h1>
<p>Entra con la misma cuenta de Google que usas en el estudio. Claude podrá leer y editar tus cuestionarios con tus
permisos, y subir figuras a la carpeta de RadQuiz en tu Drive durante una hora.</p>
<p><button id="entrar">Entrar con Google</button></p><p id="estado" class="src"></p></main>
<script type="module">
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
const auth = getAuth(initializeApp(${config}));
const salida = document.getElementById("estado");
document.getElementById("entrar").onclick = async () => {
  const proveedor = new GoogleAuthProvider();
  proveedor.addScope(${JSON.stringify(ALCANCE_DRIVE)});
  proveedor.setCustomParameters({ prompt: "select_account" });
  try {
    const r = await signInWithPopup(auth, proveedor);
    const acceso = GoogleAuthProvider.credentialFromResult(r)?.accessToken || "";
    const resp = await fetch("/listo", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado: ${JSON.stringify(estado)}, refreshToken: r.user.refreshToken, uid: r.user.uid,
        email: r.user.email, accessToken: acceso }) });
    salida.textContent = resp.ok ? "Listo. Ya puedes cerrar esta pestaña y volver a Claude." : "Claude no recibió la sesión: " + await resp.text();
  } catch (e) { salida.textContent = "No se pudo entrar: " + (e.code || e.message); }
};
</script></body></html>`;
}

function abrirEntrada() {
  if (pendiente) return pendiente;
  const estado = randomBytes(16).toString("hex");
  let resolver, rechazar;
  const promesa = new Promise((a, b) => { resolver = a; rechazar = b; });
  const servidores = [];
  const atender = async (req, res) => {
    try {
      if (req.method === "GET" && (req.url === "/" || req.url.startsWith("/?"))) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(paginaEntrada(estado));
      }
      if (req.method === "POST" && req.url === "/listo") {
        let cuerpo = "";
        for await (const parte of req) cuerpo += parte;
        const d = JSON.parse(cuerpo);
        if (d.estado !== estado || !d.refreshToken) { res.writeHead(400); return res.end("Pedido inválido."); }
        await guardarSesion({ refreshToken: d.refreshToken, uid: d.uid, email: d.email });
        drive = d.accessToken ? { token: d.accessToken, vence: Date.now() + 55 * 60 * 1000 } : null;
        await miPerfil();
        res.writeHead(200); res.end("ok");
        resolver();
        setTimeout(cerrar, 500);
        return;
      }
      res.writeHead(404); res.end();
    } catch (e) {
      res.writeHead(500); res.end(e.message);
      rechazar(e);
    }
  };
  const cerrar = () => { for (const s of servidores) s.close(); pendiente = null; };
  const escuchar = (host, puerto) => new Promise((ok, mal) => {
    const s = createServer(atender);
    s.once("error", mal);
    s.listen(puerto, host, () => { servidores.push(s); ok(s.address().port); });
  });
  pendiente = (async () => {
    const puerto = await escuchar("127.0.0.1", 0);
    await escuchar("::1", puerto).catch(() => {});   // «localhost» puede resolver a IPv6
    setTimeout(() => { if (pendiente) { cerrar(); rechazar(new Error("Pasaron 10 minutos sin entrar.")); } }, 10 * 60 * 1000);
    return { url: `http://localhost:${puerto}/`, promesa };
  })();
  return pendiente;
}

// ------------------------------------------------------------------ temas
function normalizarTema(id, bruto) {   // el mismo que app/estudio.js, más las lecturas
  const t = JSON.parse(JSON.stringify(bruto || {}));
  t.id = id;
  t.meta = t.meta || {};
  t.fuente = t.fuente || {};
  t.imagenes = t.imagenes || {};
  t.casos = t.casos || {};
  t.lecturas = t.lecturas || {};
  t.revision = t.revision || {};
  for (const c of Object.values(t.casos)) {
    c.opciones = lista(c.opciones);
    c.imagenes = lista(c.imagenes);
    c.evidencia = lista(c.evidencia);
    c.etiquetas = lista(c.etiquetas);
    c.clasificacion = lista(c.clasificacion);
  }
  // La base guarda las listas vacías como nada y, a veces, las listas como objetos: se dejan como listas.
  for (const l of Object.values(t.lecturas)) {
    for (const k of ["imagenes", "evidencia", "etiquetas", "clasificacion", "perlas"]) l[k] = lista(l[k]);
    l.preguntas = lista(l.preguntas).map((q) => ({ ...q, puntos_clave: lista(q?.puntos_clave), aceptadas: lista(q?.aceptadas) }));
  }
  for (const i of Object.values(t.imagenes)) {
    i.paneles = lista(i.paneles);
    i.marcas = lista(i.marcas);
    i.modificaciones = lista(i.modificaciones);
  }
  return t;
}

async function leerTema(id) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id || "")) throw new Error(`Id de tema inválido: «${id}».`);
  const bruto = await leer(`estudio/${id}`);
  if (!bruto) throw new Error(`No existe el tema «${id}» en el estudio. Usa «temas_listar».`);
  return normalizarTema(id, bruto);
}

function esMio(t) {
  return t.meta.autor_uid === sesion.uid || perfil?.rol === "coordinador";
}

function exigirMio(t) {
  if (!esMio(t)) throw new Error(`«${t.meta.titulo}» es de ${t.meta.autor_nombre || "otro autor"}: las reglas solo dejan editarlo a su autor o a un coordinador.`);
}

// Un caso en la forma de la corrección del estudio: se puede leer, editar y devolver tal cual a «casos_corregir».
function casoParaEditar(t, c) {
  return {
    id: c.id, tema: c.tema || "", tipo: c.tipo || "imagen", enunciado: c.enunciado || "",
    imagenes: lista(c.imagenes).map((r) => ({ figura: t.imagenes[r.ref]?.figura || r.ref, mostrar_en: r.mostrar_en })),
    opciones: lista(c.opciones), correcta: c.correcta, explicacion: c.explicacion || "", perla: c.perla || "",
    evidencia: lista(c.evidencia).map((e) => ({ ubicacion: e.ubicacion || "", cita: e.cita || "" })),
    etiquetas: lista(c.etiquetas), clasificacion: lista(c.clasificacion),
    ...(c.dificultad ? { dificultad: c.dificultad } : {}), ...(c.requiere_opciones ? { requiere_opciones: true } : {}),
  };
}

// Una lectura en la forma que recibe «lecturas_corregir»: la del estudio (deLectura) con su id. Las figuras van por
// su id («ref»); «figura» es solo para que se sepa cuál es, y se ignora al corregir si «ref» existe.
function lecturaParaEditar(t, l) {
  const d = deLectura(l, t.imagenes, [], "");
  return {
    id: l.id, tema: d.tema, presentacion: d.presentacion, clasificacion: d.clasificacion || [], etiquetas: d.etiquetas,
    imagenes: lista(l.imagenes).map((r) => ({
      ref: r.ref, figura: t.imagenes[r.ref]?.figura || "(no existe)", mostrar_en: r.mostrar_en === "respuesta" ? "respuesta" : "pregunta",
      ...(r.leyenda ? { leyenda: r.leyenda } : {}),
    })),
    preguntas: d.preguntas, explicacion: d.explicacion, perlas: d.perlas, evidencia: d.evidencia,
    ...(d.dificultad ? { dificultad: d.dificultad } : {}),
  };
}

// Qué cambia entre dos lecturas, comparadas en la forma del estudio. «contenido» es lo que retira el sello: todo
// menos la clasificación y la dificultad, que son metadatos (igual que en los casos).
const CAMPOS_LECTURA = ["tema", "presentacion", "etiquetas", "imagenes", "preguntas", "explicacion", "perlas", "evidencia"];
function cambiosDeLectura(antes, despues, imagenes) {
  const a = deLectura(antes || {}, imagenes, [], ""), b = deLectura(despues || {}, imagenes, [], "");
  const distinto = (x, y) => JSON.stringify(x ?? null) !== JSON.stringify(y ?? null);
  const contenido = CAMPOS_LECTURA.filter((k) => distinto(a[k], b[k]));
  const meta = [];
  if (distinto(normalizarClasificacion(antes?.clasificacion), normalizarClasificacion(despues?.clasificacion))) meta.push("clasificacion");
  if (distinto(normalizarDificultad(antes?.dificultad), normalizarDificultad(despues?.dificultad))) meta.push("dificultad");
  return { contenido, meta, todos: [...contenido, ...meta] };
}

// Los casos y las lecturas comparten ids (un id no se repite entre ellos): de qué grupo es cada uno.
function grupoDe(t, id) {
  if (t.casos[id]) return { grupo: "casos", item: t.casos[id] };
  if (t.lecturas[id]) return { grupo: "lecturas", item: t.lecturas[id] };
  return null;
}

function resumenValidacion(v, t) {
  const lineas = [];
  const poner = (donde, problemas) => {
    for (const p of problemas || []) lineas.push(`${p.tipo === "error" ? "ERROR" : "aviso"} · ${donde}: ${p.texto || p.mensaje || JSON.stringify(p)}`);
  };
  poner("fuente", v.fuente);
  poner("tema", v.tema);
  for (const [id, p] of Object.entries(v.imagenes)) poner(`imagen ${id} (${t.imagenes[id]?.figura || ""})`, p);
  for (const [id, p] of Object.entries(v.casos)) poner(`caso ${id}`, p);
  for (const [id, p] of Object.entries(v.lecturas || {})) poner(`lectura ${id}`, p);
  return { errores: v.errores, avisos: v.avisos, detalle: lineas };
}

const CAMPOS = ["tema", "tipo", "enunciado", "imagenes", "opciones", "correcta", "explicacion", "perla", "evidencia", "etiquetas", "clasificacion",
  "dificultad", "requiere_opciones"];
function cambiosDeCaso(antes, despues) {
  const iguales = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const norm = (c, k) => {
    const v = c?.[k];
    if (k === "imagenes") return lista(v).map((r) => ({ ref: r.ref, mostrar_en: r.mostrar_en }));
    if (k === "evidencia") return lista(v).map((e) => ({ ubicacion: e.ubicacion || "", cita: e.cita || "" }));
    if (["opciones", "etiquetas", "clasificacion"].includes(k)) return lista(v);
    return v ?? (k === "perla" || k === "explicacion" ? "" : v);
  };
  return CAMPOS.filter((k) => !iguales(norm(antes, k), norm(despues, k)));
}

// ------------------------------------------------------------------ ayudante de imágenes (macOS)
// Una sola promesa: con varias figuras a la vez (tema_importar), el ayudante se compila una vez y no en paralelo.
let ayudante = null;
function rutaAyudante() {
  if (!ayudante) ayudante = compilarAyudante().catch((e) => { ayudante = null; throw e; });
  return ayudante;
}
async function compilarAyudante() {
  if (process.platform !== "darwin") throw new Error("Las herramientas de figuras usan Vision y CoreGraphics: solo funcionan en macOS.");
  const fuente = join(AQUI, "imagen.swift");
  const binario = join(CACHE, "imagen");
  const fecha = async (r) => (await stat(r).catch(() => null))?.mtimeMs || 0;
  if ((await fecha(binario)) < (await fecha(fuente))) {
    await mkdir(CACHE, { recursive: true });
    log("compilando el ayudante de imágenes…");
    await ejecutar("swiftc", ["-O", fuente, "-o", binario], { timeout: 300_000 });
  }
  return binario;
}

async function ayuda(...args) {
  const { stdout } = await ejecutar(await rutaAyudante(), args, { maxBuffer: 20 * 1024 * 1024, timeout: 120_000 });
  return JSON.parse(stdout);
}

async function conTemporal(fn) {
  const dir = await mkdtemp(join(tmpdir(), "radquiz-mcp-"));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

async function datosDeFigura(temaId, imgId) {
  const url = await leer(`estudio_img/${temaId}/${imgId}`);
  if (!url) throw new Error(`La figura «${imgId}» no tiene archivo en el estudio.`);
  return url;
}

const aDataURL = (bytes) => `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`;
const contenidoImagen = (bytes) => ({ type: "image", data: Buffer.from(bytes).toString("base64"), mimeType: "image/jpeg" });

// Las líneas que no son pie de figura: rótulos del equipo y medidas que forman parte de la imagen. Tolera los
// errores del OCR («Stuoy Date»): basta una palabra o un patrón del rótulo.
const ROTULO_EQUIPO = /Stu.?y|Date|Time|Series|Slice|Image:|\bAcc\b|FOV|\bkVp?\b|\bmA\b|\bTR\b|\bTE\b|=|\bmm\b|\bms\b|CBF|CBV|MTT|\b(Se|Im|Ex):|\d+:\d+|Header|Info|Contrast|SENSE|flex|Page:/i;

function sugerirRectangulo(lineas, ancho, alto, minimo) {
  // Los rótulos del equipo son cortos y suelen ir en mayúsculas («MR SHOULDER WO CONTRAST»); una línea larga es
  // texto de la página aunque diga «Series» o «Time».
  const rotulo = (t) => t.length < 30 && (ROTULO_EQUIPO.test(t) || !/[a-záéíóúñ]/.test(t));
  const pie = lineas.filter((l) => l.texto.length >= minimo && !rotulo(l.texto));
  if (!pie.length) return null;
  const m = 8;
  const r = [
    Math.max(0, Math.min(...pie.map((l) => l.caja[0])) - m),
    Math.max(0, Math.min(...pie.map((l) => l.caja[1])) - m),
    Math.min(ancho, Math.max(...pie.map((l) => l.caja[2])) + m),
    Math.min(alto, Math.max(...pie.map((l) => l.caja[3])) + m),
  ];
  // Pegado al borde, el pie suele seguir en una línea corta que el OCR no lee («aneurysm.», «(continued on
  // page 302)»): se lleva el rectángulo hasta el borde. Así se limpiaron las 36 figuras de book-id.
  if (r[0] <= 30) r[0] = 0;
  if (r[1] <= 20) r[1] = 0;
  if (ancho - r[2] <= 20) r[2] = ancho;
  if (alto - r[3] <= 20) r[3] = alto;
  return r;
}

// ------------------------------------------------------------------ importar una carpeta con la forma de temas/
// Lo mismo que «Subir un .zip» del estudio (abrirZip en app/importar.js y crearImportado en app/estudio.js), desde
// una carpeta local: paquete.json, fuentes.json e img/.

// Lado mayor y tipo de un JPEG o un PNG, leyendo solo la cabecera. null si no es ninguno de los dos.
function medidasImagen(b) {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { tipo: "png", ancho: v.getUint32(16), alto: v.getUint32(20) };
  }
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i += 1; continue; }
    const marca = b[i + 1];
    if (marca === 0xff) { i += 1; continue; }
    if (marca === 0xd8 || marca === 0x01 || (marca >= 0xd0 && marca <= 0xd7)) { i += 2; continue; }
    const largo = (b[i + 2] << 8) | b[i + 3];
    // SOF0–SOF15 sin DHT (C4), JPG (C8) ni DAC (CC): ahí están las medidas.
    if (marca >= 0xc0 && marca <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marca)) {
      return { tipo: "jpeg", alto: (b[i + 5] << 8) | b[i + 6], ancho: (b[i + 7] << 8) | b[i + 8] };
    }
    if (marca === 0xda) break;   // empiezan los datos de la imagen sin haber visto el SOF
    i += 2 + largo;
  }
  return { tipo: "jpeg", ancho: 0, alto: 0 };
}

// La figura como la deja el estudio: JPEG, lado mayor ≤ 1600 px y ≤ 250 KB. Si ya cumple, pasa tal cual (sin
// marcarla como modificada); si no, la rehace el ayudante. Se guarda en memoria para que la simulación y la
// escritura no la preparen dos veces.
const LADO_MAX = 1600;
const figurasPreparadas = new Map();
async function figuraParaEstudio(ruta) {
  const info = await stat(ruta);
  const clave = `${ruta}:${info.mtimeMs}:${info.size}`;
  if (figurasPreparadas.has(clave)) return figurasPreparadas.get(clave);
  const bytes = new Uint8Array(await readFile(ruta));
  const m = medidasImagen(bytes);
  let r;
  if (m?.tipo === "jpeg" && m.ancho && bytes.length <= LIMITE_FIGURA && Math.max(m.ancho, m.alto) <= LADO_MAX) {
    r = { bytes, ancho: m.ancho, alto: m.alto, modificaciones: [] };
  } else {
    r = await conTemporal(async (dir) => {
      const salida = join(dir, "salida.jpg");
      const h = await ayuda("preparar", ruta, salida);
      const nuevos = new Uint8Array(await readFile(salida));
      if (nuevos.length > LIMITE_FIGURA) throw new Error("quedó por encima de 250 KB");
      const reducida = m?.ancho ? h.ancho < m.ancho : false;
      return { bytes: nuevos, ancho: h.ancho, alto: h.alto, modificaciones: ["comprimida", ...(reducida ? ["redimensionada"] : [])] };
    });
  }
  figurasPreparadas.set(clave, r);
  return r;
}

// Hace «fn» sobre cada elemento, «a la vez» como mucho al mismo tiempo.
async function enParalelo(elementos, aLaVez, fn) {
  let siguiente = 0;
  const trabajador = async () => { while (siguiente < elementos.length) { const i = siguiente++; await fn(elementos[i], i); } };
  await Promise.all(Array.from({ length: Math.min(aLaVez, elementos.length) }, trabajador));
}

// Reparte {ruta: valor} en tandas de como mucho «maximo» bytes de JSON: cada tanda es una escritura atómica.
function enTandas(entradas, maximo) {
  const tandas = [];
  let actual = {}, peso = 0;
  for (const [ruta, valor] of entradas) {
    const p = ruta.length + JSON.stringify(valor).length + 8;
    if (peso && peso + p > maximo) { tandas.push(actual); actual = {}; peso = 0; }
    actual[ruta] = valor;
    peso += p;
  }
  if (peso) tandas.push(actual);
  return tandas;
}
const TANDA_TEXTO = 1_000_000;    // casos y lecturas
const TANDA_FIGURAS = 4_000_000;  // ~12 figuras grandes o ~200 chicas por escritura
const CLAVE_BASE = /^[^.$#[\]/\x00-\x1f\x7f]{1,200}$/;   // lo que la base admite como nombre de un nodo

// Lee la carpeta y deja todo listo para escribir, sin tocar la base. Devuelve el tema como quedaría en el
// estudio, las figuras en dataURL y lo que no se pudo leer.
async function leerCarpetaTema(carpeta, idPedido) {
  const raiz = resolve(String(carpeta || ""));
  const texto = async (nombre) => readFile(join(raiz, nombre), "utf8").catch(() => null);
  const textoPaquete = await texto("paquete.json");
  if (textoPaquete === null) throw new Error(`No encontré «paquete.json» en ${raiz}. La carpeta tiene que llevar paquete.json, fuentes.json e img/.`);
  const textoFuentes = (await texto("fuentes.json")) ?? "{}";
  let paquete, fuentes;
  try { paquete = JSON.parse(textoPaquete); } catch (e) { throw new Error(`«paquete.json» no es un JSON válido (${e.message}).`); }
  try { fuentes = JSON.parse(textoFuentes); } catch (e) { throw new Error(`«fuentes.json» no es un JSON válido (${e.message}).`); }
  if (!lista(paquete.casos).length && !lista(paquete.lecturas).length) throw new Error("«paquete.json» no trae ningún caso ni ninguna lectura.");
  // Como en el .zip: una sola fuente por cuestionario, porque el estudio acredita todas las figuras a ella.
  const claves = Object.keys(fuentes || {}).filter((k) => k !== "$schema");
  if (claves.length > 1) throw new Error(`La carpeta trae ${claves.length} fuentes (${claves.join(", ")}). Cada cuestionario lleva una sola.`);

  const { meta, fuente, imagenes, casos, lecturas, desconocidas } = dePaquete(paquete, fuentes);
  if (!meta.titulo) throw new Error("«paquete.json» no trae título.");
  const id = idPedido ? String(idPedido) : slug(meta.id || meta.titulo).replace(/-+$/, "") || "cuestionario";
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) throw new Error(`Id de tema inválido: «${id}» (minúsculas, números y guiones).`);

  // Lo que la base rechazaría al crear: mejor decirlo antes de escribir nada.
  const bloqueos = [];
  if (!SEGMENTOS[meta.segmento]) bloqueos.push(`El segmento «${meta.segmento || "(vacío)"}» no existe: ${Object.keys(SEGMENTOS).join(", ")}.`);
  if (meta.titulo.length > 120) bloqueos.push(`El título pasa de 120 caracteres (${meta.titulo.length}).`);
  const idsMalos = Object.keys(imagenes).filter((k) => !CLAVE_BASE.test(k));
  if (idsMalos.length) bloqueos.push(`Ids de figura que la base no admite (sin . $ # [ ] /): ${idsMalos.slice(0, 10).join(", ")}.`);

  const datos = {}, faltan = [], preparadas = [];
  await enParalelo(Object.entries(imagenes).filter(([k]) => CLAVE_BASE.test(k)), 4, async ([imgId, img]) => {
    const nombre = img.archivo;
    // Solo archivos de img/: un «archivo» con carpetas («../») no sale de ahí.
    if (!/^[^/\\]+$/.test(nombre) || nombre.startsWith(".")) { faltan.push(`${nombre} (nombre inválido)`); return; }
    const ruta = join(raiz, "img", nombre);
    if (!(await stat(ruta).catch(() => null))) { faltan.push(nombre); return; }
    try {
      const r = await figuraParaEstudio(ruta);
      datos[imgId] = aDataURL(r.bytes);
      if (r.modificaciones.length) {
        preparadas.push(imgId);
        img.modificaciones = [...new Set([...img.modificaciones, ...r.modificaciones])];
      }
    } catch (e) {
      faltan.push(`${nombre} (${e.message})`);
    }
  });
  // La huella del paquete: si una importación se corta, el reintento con la misma carpeta sigue donde quedó.
  const huellaPaquete = createHash("sha256").update(textoPaquete).update("\n").update(textoFuentes).digest("hex").slice(0, 16);
  return { raiz, id, meta: { ...meta, id }, fuente, imagenes, casos, lecturas, desconocidas, datos, faltan: faltan.sort(), preparadas, bloqueos, huella: huellaPaquete };
}

// ------------------------------------------------------------------ herramientas
const herramientas = [];
function herramienta(nombre, descripcion, propiedades, requeridas, fn) {
  herramientas.push({
    nombre, fn,
    definicion: {
      name: nombre, description: descripcion,
      inputSchema: { type: "object", properties: propiedades, required: requeridas, additionalProperties: false },
    },
  });
}
const TEMA = { type: "string", description: "Id del tema en el estudio (p. ej. «book-id»). Lo da «temas_listar»." };
const SIMULAR = { type: "boolean", description: "Por defecto true: muestra lo que haría sin escribir nada. Pasa false para guardar.", default: true };

herramienta("sesion_iniciar",
  "Conecta con el estudio de RadQuiz con la cuenta de Google del autor. Abre una página en localhost donde la persona pulsa «Entrar con Google» (la ventana de Google la tiene que aceptar ella). Da además permiso para subir figuras a su Drive durante una hora; vuelve a llamarla para publicar si ese permiso venció. Espera hasta «espera_segundos» a que termine.",
  { espera_segundos: { type: "number", description: "Cuánto esperar a que la persona entre (por defecto 90, máximo 300).", default: 90 } },
  [],
  async ({ espera_segundos = 90 }) => {
    const { url, promesa } = await abrirEntrada();
    await ejecutar("open", [url]).catch(() => {});
    const limite = Math.min(300, Math.max(5, Number(espera_segundos) || 90)) * 1000;
    const listo = await Promise.race([promesa.then(() => true), new Promise((a) => setTimeout(() => a(false), limite))]);
    if (!listo) return `Abrí ${url} en el navegador. Cuando la persona entre con Google, llama a «sesion_estado». La página sigue abierta 10 minutos.`;
    const p = await miPerfil();
    return `Conectado como ${p.nombre} (${sesion.email}, ${p.rol}). Permiso de Drive: ${drive ? "sí, por una hora" : "no"}.`;
  });

herramienta("sesion_estado", "Dice con qué cuenta está conectado el servidor, su papel en el estudio y si el permiso de Drive sigue vigente.", {}, [],
  async () => {
    if (!(await cargarSesion())) return "Sin sesión. Usa «sesion_iniciar».";
    const p = await miPerfil();
    const minutos = drive ? Math.round((drive.vence - Date.now()) / 60000) : 0;
    return `Conectado como ${p.nombre} (@${p.usuario}, ${sesion.email}), papel: ${p.rol}. Drive: ${minutos > 0 ? `vigente ${minutos} min más` : "sin permiso (pídelo con «sesion_iniciar» antes de publicar)"}.`;
  });

herramienta("temas_listar", "Lista los cuestionarios del estudio: id, título, autor, estado, versión y cuántos casos, lecturas y figuras tienen.", {}, [],
  async () => {
    await miPerfil();
    const todos = (await leer("estudio")) || {};
    const filas = Object.entries(todos).map(([id, b]) => {
      const m = b.meta || {};
      return { id, titulo: m.titulo, segmento: m.segmento, autor: m.autor_nombre, mio: m.autor_uid === sesion.uid,
        estado: m.estado, version: m.version, casos: Object.keys(b.casos || {}).length, lecturas: Object.keys(b.lecturas || {}).length,
        imagenes: Object.keys(b.imagenes || {}).length, ...(m.importacion ? { importacion_sin_terminar: true } : {}) };
    });
    return JSON.stringify(filas, null, 1);
  });

herramienta("tema_leer",
  "Lee un cuestionario del estudio: datos, fuente, resumen del validador, la lista de casos (id, subtema, enunciado abreviado) y la de lecturas (id, diagnóstico, encabezado, cuántas preguntas, figuras). Con «completo» trae los casos y las lecturas enteros.",
  { tema: TEMA, completo: { type: "boolean", default: false } }, ["tema"],
  async ({ tema, completo = false }) => {
    await miPerfil();
    const t = await leerTema(tema);
    const v = resumenValidacion(validarTema(t), t);
    const casos = casosOrdenados(t).map((c) => completo ? casoParaEditar(t, c)
      : { id: c.id, tema: c.tema, enunciado: (c.enunciado || "").slice(0, 110), figuras: lista(c.imagenes).map((r) => r.ref) });
    const lecturas = lecturasOrdenadas(t).map((l) => completo ? lecturaParaEditar(t, l)
      : { id: l.id, tema: l.tema, presentacion: (l.presentacion || "").slice(0, 110), preguntas: lista(l.preguntas).length,
        figuras: lista(l.imagenes).map((r) => `${r.ref}${r.mostrar_en === "respuesta" ? " (respuesta)" : ""}`) });
    return JSON.stringify({
      id: t.id, meta: { titulo: t.meta.titulo, segmento: t.meta.segmento, estado: t.meta.estado, version: t.meta.version,
        autor: t.meta.autor_nombre, editable: esMio(t), carpeta_drive: t.meta.drive_carpeta || null },
      fuente: t.fuente, validacion: { errores: v.errores, avisos: v.avisos }, imagenes: Object.keys(t.imagenes).length, casos,
      ...(lecturas.length ? { lecturas } : {}),
    }, null, 1);
  });

herramienta("casos_leer",
  "Trae casos completos en el formato de corrección del estudio. Se pueden editar y devolver tal cual a «casos_corregir».",
  { tema: TEMA, ids: { type: "array", items: { type: "string" }, description: "Ids de los casos; si falta, todos." } }, ["tema"],
  async ({ tema, ids }) => {
    await miPerfil();
    const t = await leerTema(tema);
    const elegidos = casosOrdenados(t).filter((c) => !ids?.length || ids.includes(c.id));
    const faltan = (ids || []).filter((id) => !t.casos[id]);
    return JSON.stringify({ correccion: true, casos: elegidos.map((c) => casoParaEditar(t, c)), ...(faltan.length ? { no_existen: faltan } : {}) }, null, 1);
  });

herramienta("lecturas_leer",
  "Trae lecturas completas (casos abiertos al estilo de los libros de casos: encabezado, 1 a 8 preguntas abiertas, figuras limpias en la página 1 y anotadas en la 2) en el formato que recibe «lecturas_corregir». Se pueden editar y devolver tal cual.",
  { tema: TEMA, ids: { type: "array", items: { type: "string" }, description: "Ids de las lecturas; si falta, todas." } }, ["tema"],
  async ({ tema, ids }) => {
    await miPerfil();
    const t = await leerTema(tema);
    const elegidas = lecturasOrdenadas(t).filter((l) => !ids?.length || ids.includes(l.id));
    const faltan = (ids || []).filter((id) => !t.lecturas[id]);
    return JSON.stringify({ lecturas: elegidas.map((l) => lecturaParaEditar(t, l)), ...(faltan.length ? { no_existen: faltan } : {}) }, null, 1);
  });

herramienta("tema_validar", "Pasa el validador del estudio (app/validacion.js) por un cuestionario y devuelve cada error y aviso.", { tema: TEMA }, ["tema"],
  async ({ tema }) => {
    await miPerfil();
    const t = await leerTema(tema);
    return JSON.stringify(resumenValidacion(validarTema(t), t), null, 1);
  });

herramienta("casos_corregir",
  "Reemplaza casos existentes, cada uno por su id, como la corrección del paso 3 del estudio. Recibe {\"casos\": [...]} en el formato de «casos_leer» (los campos que falten quedan vacíos, salvo «clasificacion», que se conserva). Por defecto solo simula: dice qué campos cambian en cada caso y cómo queda el validador. Con simular=false lo guarda. Cambiar el texto de un caso le quita el sello de verificado (igual que en el estudio).",
  { tema: TEMA, correccion: { type: "object", description: "{\"casos\": [ {\"id\": …, \"enunciado\": …, …} ]}", properties: { casos: { type: "array", items: { type: "object" } } }, required: ["casos"] }, simular: SIMULAR },
  ["tema", "correccion"],
  async ({ tema, correccion, simular = true }) => {
    await miPerfil();
    const t = await leerTema(tema);
    exigirMio(t);
    const datos = leerRespuestaIA(JSON.stringify({ ...correccion, correccion: true }), t);
    const desconocidos = datos.casos.filter((c) => !c.id || !t.casos[c.id]).map((c) => c.id || "(sin id)");
    if (desconocidos.length) throw new Error(`Estos casos no existen en «${tema}»: ${desconocidos.join(", ")}. Aquí solo se corrigen casos que ya están.`);
    const sinFigura = datos.casos.flatMap((c) => c.imagenes.filter((r) => !r.ref).map((r) => `${c.id} → ${r.figura}`));
    if (sinFigura.length) throw new Error(`No encontré estas figuras en el tema: ${sinFigura.join(", ")}. Usa el nombre de «figura» que da «casos_leer».`);
    const plan = planDeCarga(t, datos, { marca: AHORA });
    const despues = JSON.parse(JSON.stringify(t));
    const detalle = [];
    for (const [ruta, valor] of Object.entries(plan.cambios)) {
      const m = ruta.match(/^estudio\/[^/]+\/casos\/([^/]+)$/);
      if (!m) continue;
      despues.casos[m[1]] = normalizarTema(tema, { casos: { [m[1]]: valor } }).casos[m[1]];
      detalle.push(`${m[1]}: ${cambiosDeCaso(t.casos[m[1]], despues.casos[m[1]]).join(", ") || "sin cambios"}`);
    }
    const antes = validarTema(t), luego = validarTema(despues);
    const informe = [
      plan.resumen,
      `Validador: ${antes.errores} errores y ${antes.avisos} avisos → ${luego.errores} errores y ${luego.avisos} avisos.`,
      ...detalle,
    ];
    if (simular) return ["SIMULACIÓN (no se guardó nada):", ...informe].join("\n");
    await actualizar({ ...plan.cambios, [`estudio/${tema}/meta/actualizado`]: AHORA });
    return ["Guardado en el estudio. Falta publicar para que salga en la web («tema_publicar»).", ...informe].join("\n");
  });

herramienta("lecturas_corregir",
  "Reemplaza lecturas existentes, cada una por su id. Recibe {\"lecturas\": [...]} en el formato de «lecturas_leer» (los campos que falten quedan vacíos, salvo «clasificacion» y «dificultad», que se conservan si no vienen). Las figuras se citan por «ref» (id de la figura del tema) o, si no, por el nombre de «figura». Por defecto solo simula: dice qué campos cambian en cada lectura y cómo queda el validador. Con simular=false lo guarda. Cambiar el contenido actualiza «actualizado» y le quita el sello de verificado; cambiar solo la clasificación o la dificultad, no.",
  { tema: TEMA, correccion: { type: "object", description: "{\"lecturas\": [ {\"id\": …, \"presentacion\": …, \"preguntas\": […], …} ]}", properties: { lecturas: { type: "array", items: { type: "object" } } }, required: ["lecturas"] }, simular: SIMULAR },
  ["tema", "correccion"],
  async ({ tema, correccion, simular = true }) => {
    await miPerfil();
    const t = await leerTema(tema);
    exigirMio(t);
    const entrada = lista(correccion?.lecturas);
    if (!entrada.length) throw new Error("Pasa {\"lecturas\": [...]} con al menos una lectura.");
    const desconocidas = entrada.filter((l) => !l?.id || !t.lecturas[l.id]).map((l) => l?.id || "(sin id)");
    if (desconocidas.length) throw new Error(`Estas lecturas no existen en «${tema}»: ${desconocidas.join(", ")}. Aquí solo se corrigen lecturas que ya están.`);
    const repetidas = entrada.map((l) => l.id).filter((id, i, a) => a.indexOf(id) !== i);
    if (repetidas.length) throw new Error(`Lecturas repetidas en la corrección: ${[...new Set(repetidas)].join(", ")}.`);
    // Las figuras: por id; si no, por el nombre de la figura en la fuente («Caso 1362 (p. 1)…»).
    const porFigura = new Map(Object.entries(t.imagenes).map(([id, i]) => [i.figura, id]));
    const perdidas = [];
    const despues = JSON.parse(JSON.stringify(t));
    const cambios = {};
    const detalle = [];
    let selloRetirado = 0;
    for (const bruta of entrada) {
      const anterior = t.lecturas[bruta.id];
      const imagenes = lista(bruta.imagenes).map((r) => {
        const ref = t.imagenes[r?.ref] ? r.ref : porFigura.get(r?.figura) || porFigura.get(r?.ref);
        if (!ref) perdidas.push(`${bruta.id} → ${r?.ref || r?.figura || "(vacía)"}`);
        return { ...r, ref };
      });
      const malas = [];
      const nueva = deLectura({
        ...bruta, imagenes,
        clasificacion: "clasificacion" in bruta ? bruta.clasificacion : anterior.clasificacion,
        dificultad: "dificultad" in bruta ? bruta.dificultad : anterior.dificultad,
      }, t.imagenes, malas, "ia");
      if (malas.length) throw new Error(`Clasificación inválida en ${bruta.id}: ${malas.join(", ")}. Las áreas están en app/areas.js.`);
      const c = cambiosDeLectura(anterior, nueva, t.imagenes);
      if (!c.todos.length) { detalle.push(`${bruta.id}: sin cambios`); continue; }
      const guardada = { ...nueva, orden: anterior.orden ?? 0 };
      if (c.contenido.length) { guardada.actualizado = AHORA; selloRetirado += 1; }
      else if (anterior.actualizado !== undefined) guardada.actualizado = anterior.actualizado;
      cambios[`estudio/${tema}/lecturas/${bruta.id}`] = guardada;
      despues.lecturas[bruta.id] = normalizarTema(tema, { lecturas: { [bruta.id]: { ...guardada, actualizado: Date.now() } } }).lecturas[bruta.id];
      detalle.push(`${bruta.id}: ${c.todos.join(", ")}${c.contenido.length ? "" : " (solo metadatos: conserva el sello)"}`);
    }
    if (perdidas.length) throw new Error(`No encontré estas figuras en el tema: ${perdidas.join(", ")}. Usa el «ref» que da «lecturas_leer».`);
    const antes = validarTema(t), luego = validarTema(despues);
    const problemas = Object.keys(cambios).map((ruta) => ruta.split("/").pop())
      .flatMap((id) => (luego.lecturas[id] || []).map((p) => `  ${p.tipo === "error" ? "ERROR" : "aviso"} · ${id}: ${p.texto}`));
    const informe = [
      `Cambian ${Object.keys(cambios).length} de ${entrada.length} lecturas${selloRetirado ? `; ${selloRetirado} con cambios de contenido (pierden el sello de verificado si lo tenían)` : ""}.`,
      `Validador: ${antes.errores} errores y ${antes.avisos} avisos → ${luego.errores} errores y ${luego.avisos} avisos.`,
      ...detalle,
      ...(problemas.length ? ["Problemas que quedan en las lecturas cambiadas:", ...problemas] : []),
    ];
    if (simular || !Object.keys(cambios).length) return [simular ? "SIMULACIÓN (no se guardó nada):" : "No había nada que cambiar.", ...informe].join("\n");
    await actualizar({ ...cambios, [`estudio/${tema}/meta/actualizado`]: AHORA });
    return ["Guardado en el estudio. Falta publicar para que salga en la web («tema_publicar»).", ...informe].join("\n");
  });

herramienta("casos_dificultad",
  "Pone la dificultad (nivel 1 a 4 con su motivo, por el contenido y la bibliografía: docs/guia-estilo-ia.md) y si el caso necesita las opciones a la vista, como el panel «Dificultad» del paso 3. Vale también para lecturas, por su id (en ellas no hay «requiere_opciones»). No toca el texto ni «actualizado», así que no quita el sello de verificado. Recibe {\"<id del caso o lectura>\": {\"nivel\": 2, \"motivo\": \"…\", \"requiere_opciones\": false}} directamente o en un archivo JSON local con esa forma. Por defecto solo simula.",
  {
    tema: TEMA,
    casos: { type: "object", description: "{\"caso-01\": {\"nivel\": 2, \"motivo\": \"…\", \"requiere_opciones\": false}, …}" },
    archivo: { type: "string", description: "Ruta a un JSON con la misma forma que «casos», en vez de pasarlos aquí." },
    por: { type: "string", enum: ["ia", "autor", "revisor"], description: "Quién la asigna; por defecto «ia»." },
    simular: SIMULAR,
  },
  ["tema"],
  async ({ tema, casos, archivo, por = "ia", simular = true }) => {
    await miPerfil();
    const t = await leerTema(tema);
    exigirMio(t);
    const datos = archivo ? JSON.parse(await readFile(resolve(archivo), "utf8")) : casos;
    if (!datos || typeof datos !== "object") throw new Error("Pasa «casos» o «archivo».");
    const desconocidos = Object.keys(datos).filter((id) => !grupoDe(t, id));
    if (desconocidos.length) throw new Error(`Estos casos o lecturas no existen en «${tema}»: ${desconocidos.join(", ")}.`);
    const cambios = {};
    const malos = [];
    const sinOpciones = [];
    let niveles = 0, opciones = 0;
    for (const [id, v] of Object.entries(datos)) {
      const { grupo, item } = grupoDe(t, id);
      if (v.nivel !== undefined) {
        const d = normalizarDificultad({ ...v, por });
        if (!d) { malos.push(id); continue; }
        if (JSON.stringify(item.dificultad ?? null) !== JSON.stringify(d)) {
          cambios[`estudio/${tema}/${grupo}/${id}/dificultad`] = d;
          item.dificultad = d;
          niveles += 1;
        }
      }
      if (typeof v.requiere_opciones === "boolean" && grupo === "lecturas") { if (v.requiere_opciones) sinOpciones.push(id); continue; }
      if (typeof v.requiere_opciones === "boolean" && Boolean(item.requiere_opciones) !== v.requiere_opciones) {
        cambios[`estudio/${tema}/casos/${id}/requiere_opciones`] = v.requiere_opciones || null;
        item.requiere_opciones = v.requiere_opciones || undefined;
        opciones += 1;
      }
    }
    if (malos.length) throw new Error(`Nivel inválido (tiene que ser 1 a 4) en: ${malos.join(", ")}.`);
    if (sinOpciones.length) throw new Error(`Las lecturas no tienen opciones: «requiere_opciones» no vale en ${sinOpciones.join(", ")}.`);
    const reparto = (items) => `${[1, 2, 3, 4].map((n) => `${n}: ${items.filter((c) => c.dificultad?.nivel === n).length}`).join(" · ")}`
      + `${items.some((c) => !c.dificultad?.nivel) ? ` · sin dificultad: ${items.filter((c) => !c.dificultad?.nivel).length}` : ""}`;
    const todosCasos = Object.values(t.casos), todasLecturas = Object.values(t.lecturas);
    const v = validarTema(t);
    const informe = [
      `Cambia la dificultad de ${niveles} casos o lecturas y «necesita las opciones» de ${opciones} casos.`,
      ...(todosCasos.length ? [`Casos: ${reparto(todosCasos)}. Necesitan las opciones: ${todosCasos.filter((c) => c.requiere_opciones).length}.`] : []),
      ...(todasLecturas.length ? [`Lecturas: ${reparto(todasLecturas)}.`] : []),
      `Validador después: ${v.errores} errores y ${v.avisos} avisos.`,
    ];
    if (simular || !Object.keys(cambios).length) return [simular ? "SIMULACIÓN (no se guardó nada):" : "No había nada que cambiar.", ...informe].join("\n");
    await actualizar({ ...cambios, [`estudio/${tema}/meta/actualizado`]: AHORA });
    return ["Guardado en el estudio, sin quitar sellos. Falta publicar para que salga en la web («tema_publicar»).", ...informe].join("\n");
  });

herramienta("casos_clasificar",
  "Pone la clasificación de cada caso (una o más parejas segmento → área de app/areas.js; la primera, la principal), como el panel «Clasificación» del paso 3. Vale también para lecturas, por su id. No toca el texto ni «actualizado», así que no quita el sello de verificado. Recibe {\"<id del caso o lectura>\": [{\"segmento\": \"torax\", \"area\": \"pleura\"}, …]} directamente o en un archivo JSON local con esa forma. Una pareja con un área que no está en la lista se rechaza. Por defecto solo simula.",
  {
    tema: TEMA,
    casos: { type: "object", description: "{\"caso-01\": [{\"segmento\": \"torax\", \"area\": \"pleura\"}], …}" },
    archivo: { type: "string", description: "Ruta a un JSON con la misma forma que «casos», en vez de pasarlos aquí." },
    simular: SIMULAR,
  },
  ["tema"],
  async ({ tema, casos, archivo, simular = true }) => {
    await miPerfil();
    const t = await leerTema(tema);
    exigirMio(t);
    const datos = archivo ? JSON.parse(await readFile(resolve(archivo), "utf8")) : casos;
    if (!datos || typeof datos !== "object") throw new Error("Pasa «casos» o «archivo».");
    const desconocidos = Object.keys(datos).filter((id) => !grupoDe(t, id));
    if (desconocidos.length) throw new Error(`Estos casos o lecturas no existen en «${tema}»: ${desconocidos.join(", ")}.`);
    const cambios = {};
    const malas = [];
    for (const [id, valor] of Object.entries(datos)) {
      const { grupo, item } = grupoDe(t, id);
      const desconocidas = [];
      const pares = normalizarClasificacion(valor, desconocidas);
      if (desconocidas.length || !pares.length) { malas.push(`${id} (${desconocidas.join(", ") || "vacía"})`); continue; }
      if (JSON.stringify(clasificacionDe(item, t.meta.segmento)) === JSON.stringify(pares)) continue;
      cambios[`estudio/${tema}/${grupo}/${id}/clasificacion`] = pares;
      item.clasificacion = pares;
    }
    if (malas.length) throw new Error(`Clasificación inválida en: ${malas.join("; ")}. Las áreas están en app/areas.js.`);
    const reparto = new Map();
    for (const c of [...Object.values(t.casos), ...Object.values(t.lecturas)]) {
      for (const p of clasificacionDe(c, t.meta.segmento)) {
        const k = nombreClasificacion(p);
        reparto.set(k, (reparto.get(k) || 0) + 1);
      }
    }
    const v = validarTema(t);
    const informe = [
      `Cambia la clasificación de ${Object.keys(cambios).length} casos o lecturas.`,
      `Reparto: ${[...reparto].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}: ${n}`).join(" · ")}.`,
      `Validador después: ${v.errores} errores y ${v.avisos} avisos.`,
    ];
    if (simular || !Object.keys(cambios).length) return [simular ? "SIMULACIÓN (no se guardó nada):" : "No había nada que cambiar.", ...informe].join("\n");
    await actualizar({ ...cambios, [`estudio/${tema}/meta/actualizado`]: AHORA });
    return ["Guardado en el estudio, sin quitar sellos. Falta publicar para que salga en la web («tema_publicar»).", ...informe].join("\n");
  });

// ------------------------------------------------------------------ tableros por equipos
// Lo mismo que el armado con IA del tablero (app/plantilla-tablero.js), sin copiar y pegar: aquí la IA es quien
// usa estas herramientas. Lee solo lo publicado, como la web.
const nombrePareja = ({ segmento, area }) => (area ? `${SEGMENTOS[segmento]} · ${(AREAS[segmento] || {})[area] || area}` : SEGMENTOS[segmento] || segmento);

async function catalogoPublicado(rutas, { sinVerificar = true } = {}) {
  const datos = new Map();
  await cargarTemas(rutas, datos);
  const cargadas = rutas.filter((r) => datos.has(r));
  return { catalogo: armarCatalogo(cargadas, datos, sinVerificar), datos, cargadas };
}

herramienta("tablero_casos",
  "Para armar un tablero por equipos (al estilo Jeopardy): lista los casos publicados que se pueden usar, uno por línea (clave | área | subtema | respuesta | nivel | marcas), con las reglas y el formato JSON que espera «tablero_guardar». Filtra por segmento, área, texto y/o temas. No escribe nada.",
  {
    segmento: { type: "string", description: `Segmento: ${Object.keys(SEGMENTOS).join(", ")}.` },
    area: { type: "string", description: "Área dentro del segmento (ids de app/areas.js)." },
    q: { type: "string", description: "Palabras a buscar (diagnóstico, signo, título); sin tildes vale." },
    temas: { type: "array", items: { type: "string" }, description: "Ids o rutas de temas («book-id» o «neurorradiologia/book-id»). Sin esto, todos los publicados que tengan casos del criterio." },
    solo_verificados: { type: "boolean", default: false, description: "Solo casos con el sello de un radiólogo." },
  },
  [],
  async ({ segmento = "", area = "", q = "", temas = [], solo_verificados = false }) => {
    if (segmento && !SEGMENTOS[segmento]) throw new Error(`Segmento desconocido: «${segmento}».`);
    if (area && !(AREAS[segmento] || {})[area]) throw new Error(`«${area}» no es un área de ${segmento || "ningún segmento elegido"}.`);
    const criterio = { segmento, area: segmento ? area : "", q: String(q || "").trim() };
    const publicados = await cargarIndice();
    const pedidos = (temas || []).map((t) => publicados.find((p) => p.ruta === t || p.id === t || p.ruta.endsWith(`/${t}`))?.ruta || null);
    if (pedidos.includes(null)) throw new Error(`No están publicados: ${(temas || []).filter((_, i) => !pedidos[i]).join(", ")}. Usa «temas_listar».`);
    let rutas = pedidos;
    if (!rutas.length) {
      const indices = await indicesDeCasos();
      rutas = criterio.segmento || criterio.q ? temasPara(publicados, indicePorRuta(publicados, indices.vivo, indices.estatico), criterio) : publicados.map((p) => p.ruta);
    }
    const { catalogo, datos, cargadas } = await catalogoPublicado(rutas, { sinVerificar: !solo_verificados });
    const entradas = [...catalogo.values()].filter((e) => {
      const paquete = datos.get(e.ruta).paquete;
      return coincide(resumenCaso(e.caso, paquete.segmento), criterio, paquete.titulo);
    });
    if (!entradas.length) return `Ningún caso publicado cumple «${nombreCriterio(criterio)}» en ${cargadas.length} temas.`;
    const TOPE = 700;
    const lineas = entradas.slice(0, TOPE).map((e) => lineaCandidato(e, nombrePareja));
    return [
      `${entradas.length} casos de ${new Set(entradas.map((e) => e.ruta)).size} temas para «${nombreCriterio(criterio)}»${solo_verificados ? ", solo verificados" : ""}.${entradas.length > TOPE ? ` Muestro ${TOPE}: afina con segmento, área o texto.` : ""}`,
      "",
      "Reglas para armar el tablero:",
      REGLAS_IA,
      "",
      "Formato que recibe «tablero_guardar» (en «tablero»):",
      FORMATO_IA,
      "",
      "Casos (clave | área | subtema | respuesta | nivel 1 a 4 | marcas):",
      ...lineas,
    ].join("\n");
  });

herramienta("tablero_guardar",
  "Comprueba un tablero por equipos (el JSON de «tablero_casos»: nombre, filas, columnas con claves «paquete/caso» de 100 hacia arriba, dobles, final, categoria_final, comparar) contra lo publicado y lo guarda para el grupo: aparece en «Tableros guardados · Del grupo» de tablero.html en cualquier computadora. Devuelve además un enlace que abre el tablero directamente. Por defecto solo simula: dice cómo queda y qué se corrigió.",
  {
    tablero: { type: "object", description: "El tablero en el formato de «tablero_casos»." },
    archivo: { type: "string", description: "Ruta a un JSON con el tablero, en vez de pasarlo aquí." },
    equipos: { type: "array", items: { type: "string" }, description: "Nombres de los equipos (2 a 6). Por defecto, Equipo 1 a 3." },
    id: { type: "string", description: "Id de un tablero del grupo para reemplazarlo (uno tuyo, o cualquiera si eres coordinador)." },
    simular: SIMULAR,
  },
  [],
  async ({ tablero, archivo, equipos, id, simular = true }) => {
    const bruto = archivo ? JSON.parse(await readFile(resolve(archivo), "utf8")) : tablero;
    if (!bruto || typeof bruto !== "object") throw new Error("Pasa «tablero» o «archivo».");
    if (equipos?.length) bruto.equipos = equipos;
    const publicados = await cargarIndice();
    const rutas = temasDe(bruto, publicados);
    if (!rutas.length) throw new Error("Ninguna clave del tablero es de un tema publicado. Las claves son «<id del tema>/<id del caso>», como las da «tablero_casos».");
    const { catalogo } = await catalogoPublicado(rutas);
    const { plantilla, problemas, errores, casillas } = normalizar(bruto, catalogo);
    if (errores) throw new Error(`El tablero no tiene ninguna casilla con un caso publicado.${problemas.length ? ` ${problemas.join(" ")}` : ""}`);
    const fila = (k) => {
      const e = k && catalogo.get(k);
      return e ? `${e.caso.tema || "—"} → ${respuestaDe(e.caso)} (nivel ${e.caso.dificultad?.nivel || "—"})` : "(vacía)";
    };
    const vista = plantilla.columnas.map((col) => [`■ ${col.nombre}`, ...col.casos.map((k, r) =>
      `  ${(r + 1) * 100}${plantilla.dobles.includes(k) ? " ×2" : ""}: ${fila(k)}`)].join("\n"));
    if (plantilla.final) vista.push(`■ Final «${plantilla.categoria_final}»: ${fila(plantilla.final)}`);
    const enlace = `${URL_OFICIAL}/tablero.html#t=${await codificar(plantilla)}`;
    const informe = [
      `«${plantilla.nombre}»: ${casillas} casillas en ${plantilla.columnas.length} columnas × ${plantilla.filas} filas${plantilla.final ? " y ronda final" : ""}. Equipos: ${plantilla.equipos.join(", ")}.`,
      ...(problemas.length ? ["Corregido al comprobar:", ...problemas.map((p) => `- ${p}`)] : ["Sin correcciones."]),
      "",
      ...vista,
      "",
      `Enlace (abre el tablero en la revisión, listo para jugar): ${enlace}`,
    ];
    if (simular) return ["SIMULACIÓN (no se guardó nada):", ...informe].join("\n");
    const p = await miPerfil();
    if (!p?.rol) throw new Error("Tu cuenta no tiene papel en el estudio: no puede guardar tableros para el grupo.");
    const clave = id || `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
    if (!/^[a-z0-9]{6,40}$/.test(clave)) throw new Error(`Id de tablero inválido: «${clave}».`);
    await escribir(`tableros/${clave}`, {
      nombre: plantilla.nombre, autor_uid: sesion.uid, autor_nombre: p.nombre || "", fecha: AHORA, plantilla_json: JSON.stringify(plantilla),
    });
    return [`Guardado para el grupo (id ${clave}): sale en tablero.html, «Tableros guardados · Del grupo».`, ...informe].join("\n");
  });

herramienta("tableros_listar", "Lista los tableros guardados para el grupo: id, nombre, autor, fecha y tamaño.", {}, [],
  async () => {
    const todos = (await leer("tableros")) || {};
    const filas = Object.entries(todos).map(([id, t]) => {
      let p = {};
      try { p = JSON.parse(t.plantilla_json); } catch { /* ilegible */ }
      const casillas = (p.columnas || []).reduce((n, col) => n + (col.casos || []).filter(Boolean).length, 0);
      return { id, nombre: t.nombre, autor: t.autor_nombre, fecha: new Date(t.fecha || 0).toISOString().slice(0, 10), casillas, final: Boolean(p.final) };
    }).sort((a, b) => b.fecha.localeCompare(a.fecha));
    return filas.length ? JSON.stringify(filas, null, 1) : "Todavía no hay tableros guardados para el grupo.";
  });

herramienta("fuente_guardar",
  "Corrige la fuente de un cuestionario (paso 1 del estudio). Solo cambia los campos que pases; la verificación de la licencia queda a nombre de quien está conectado y con la fecha de hoy.",
  {
    tema: TEMA,
    cambios: {
      type: "object", additionalProperties: false,
      properties: {
        tipo: { type: "string", enum: TIPOS_FUENTE.map((x) => x.valor ?? x) },
        doi: { type: "string" }, cita: { type: "string" }, credito: { type: "string" }, url: { type: "string" },
        titular: { type: "string" }, licencia: { type: "string", enum: LICENCIAS.map((l) => l.valor) },
        frase: { type: "string", description: "Dónde dice la licencia la fuente (verificacion.donde)." },
      },
    },
    simular: SIMULAR,
  },
  ["tema", "cambios"],
  async ({ tema, cambios, simular = true }) => {
    const p = await miPerfil();
    const t = await leerTema(tema);
    exigirMio(t);
    const f = { ...t.fuente };
    for (const k of ["tipo", "cita", "credito", "url", "titular", "licencia"]) if (cambios[k] !== undefined) f[k] = String(cambios[k]).trim();
    if (cambios.doi !== undefined) f.doi = String(cambios.doi).trim().replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
    const datos = LICENCIAS.find((l) => l.valor === f.licencia);
    f.licencia_url = datos?.url || null;
    f.modificaciones_permitidas = !datos?.nd;
    f.clave = t.fuente.clave || f.clave;
    f.verificacion = { fecha: hoy(), por: p.nombre, donde: cambios.frase !== undefined ? String(cambios.frase).trim() : t.fuente.verificacion?.donde || "" };
    const problemas = validarFuente(f).map((x) => `${x.tipo}: ${x.texto || x.mensaje || JSON.stringify(x)}`);
    const texto = JSON.stringify({ fuente: f, problemas }, null, 1);
    if (simular) return `SIMULACIÓN (no se guardó nada):\n${texto}`;
    await escribir(`estudio/${tema}/fuente`, f);
    await actualizar({ [`estudio/${tema}/meta/actualizado`]: AHORA });
    return `Fuente guardada.\n${texto}`;
  });

herramienta("tema_titulo",
  "Cambia el título de un cuestionario (el que sale en la portada de la web). Si ya está publicado, el título nuevo sale en la web al volver a publicarlo con «tema_publicar».",
  { tema: TEMA, titulo: { type: "string", description: "Título nuevo, de 1 a 120 caracteres." }, simular: SIMULAR },
  ["tema", "titulo"],
  async ({ tema, titulo, simular = true }) => {
    await miPerfil();
    const t = await leerTema(tema);
    exigirMio(t);
    const nuevo = String(titulo).replace(/\s+/g, " ").trim();
    if (!nuevo || nuevo.length > 120) throw new Error("El título tiene que tener de 1 a 120 caracteres.");
    const texto = `«${t.meta.titulo}» → «${nuevo}»${t.meta.estado === "publicado" ? " (sale en la web al volver a publicar)" : ""}`;
    if (simular) return `SIMULACIÓN (no se guardó nada): ${texto}`;
    await actualizar({ [`estudio/${tema}/meta/titulo`]: nuevo, [`estudio/${tema}/meta/actualizado`]: AHORA });
    return `Título guardado: ${texto}`;
  });

herramienta("imagen_ver",
  "Muestra una figura del estudio (la que se publicaría) junto con su ficha. Con «publicada» trae la versión que sirve hoy la web desde Drive.",
  { tema: TEMA, imagen: { type: "string", description: "Id de la figura (p. ej. «case098»)." }, publicada: { type: "boolean", default: false } },
  ["tema", "imagen"],
  async ({ tema, imagen, publicada = false }) => {
    await miPerfil();
    const t = await leerTema(tema);
    const ficha = t.imagenes[imagen];
    if (!ficha) throw new Error(`No existe la figura «${imagen}» en «${tema}».`);
    let bytes;
    if (publicada) {
      const id = ficha.drive?.id;
      if (!ID_DRIVE.test(id || "")) throw new Error("Esa figura todavía no se publicó en Drive.");
      const r = await fetch(urlDrive(id));
      if (!r.ok) throw new Error(`Drive respondió ${r.status} para ${id}.`);
      bytes = new Uint8Array(await r.arrayBuffer());
    } else {
      bytes = bytesDeDataURL(await datosDeFigura(tema, imagen));
    }
    const { drive: _d, ...resto } = ficha;
    return [{ type: "text", text: JSON.stringify({ id: imagen, bytes: bytes.length, ...resto }, null, 1) }, contenidoImagen(bytes)];
  });

herramienta("imagenes_buscar_texto",
  "Busca texto dentro de las figuras con el OCR de macOS (Vision): pies de figura pegados, rótulos, nombres. Para cada figura con texto devuelve las líneas con su caja en píxeles [x0,y0,x1,y1] y, si parecen pie de figura, un rectángulo sugerido para «imagen_tapar». Los rótulos del equipo (W=, mm, Study Date…) no entran en la sugerencia. Revisa siempre la sugerencia con «imagen_tapar» en simulación antes de guardar.",
  {
    tema: TEMA,
    imagenes: { type: "array", items: { type: "string" }, description: "Ids de figuras; si falta, todas." },
    min_caracteres: { type: "number", default: 12, description: "Largo mínimo de una línea para contarla como pie de figura." },
  },
  ["tema"],
  async ({ tema, imagenes, min_caracteres = 12 }) => {
    await miPerfil();
    const t = await leerTema(tema);
    const ids = imagenes?.length ? imagenes : imagenesOrdenadas(t).map((i) => i.id);
    const resultado = [];
    await conTemporal(async (dir) => {
      for (const id of ids) {
        const archivo = join(dir, `${id}.jpg`);
        await writeFile(archivo, bytesDeDataURL(await datosDeFigura(tema, id)));
        const o = await ayuda("ocr", archivo);
        if (!o.lineas.length) continue;
        resultado.push({ imagen: id, figura: t.imagenes[id]?.figura, ancho: o.ancho, alto: o.alto,
          rectangulo_sugerido: sugerirRectangulo(o.lineas, o.ancho, o.alto, min_caracteres), lineas: o.lineas });
      }
    });
    const conPie = resultado.filter((r) => r.rectangulo_sugerido).length;
    return JSON.stringify({ revisadas: ids.length, con_texto: resultado.length, con_pie_sugerido: conPie, figuras: resultado }, null, 1);
  });

herramienta("imagen_tapar",
  "Pinta de blanco uno o varios rectángulos [x0,y0,x1,y1] (en píxeles) de una figura del estudio, para quitar texto pegado como el pie de figura. Vuelve a guardar el JPEG por debajo de 250 KB. Por defecto simula y devuelve la figura resultante para mirarla; con simular=false la guarda (después hay que publicar). No marca la figura como modificada: úsalo para texto de la página, no para recortar ni anotar la imagen.",
  {
    tema: TEMA, imagen: { type: "string" },
    rectangulos: { type: "array", minItems: 1, items: { type: "array", items: { type: "integer" }, minItems: 4, maxItems: 4 } },
    simular: SIMULAR,
  },
  ["tema", "imagen", "rectangulos"],
  async ({ tema, imagen, rectangulos, simular = true }) => {
    await miPerfil();
    const t = await leerTema(tema);
    exigirMio(t);
    if (!t.imagenes[imagen]) throw new Error(`No existe la figura «${imagen}» en «${tema}».`);
    return conTemporal(async (dir) => {
      const entrada = join(dir, "entrada.jpg"), salida = join(dir, "salida.jpg");
      await writeFile(entrada, bytesDeDataURL(await datosDeFigura(tema, imagen)));
      const r = await ayuda("tapar", entrada, salida, ...rectangulos.map((x) => x.join(",")));
      const bytes = new Uint8Array(await readFile(salida));
      const quedan = (await ayuda("ocr", salida)).lineas.map((l) => l.texto);
      const info = { imagen, bytes: r.bytes, calidad: Math.round(r.calidad * 100) / 100, ancho: r.ancho, alto: r.alto, texto_que_queda: quedan };
      if (bytes.length > LIMITE_FIGURA) throw new Error("La figura quedó por encima de 250 KB.");
      if (!simular) await escribir(`estudio_img/${tema}/${imagen}`, aDataURL(bytes));
      return [{ type: "text", text: `${simular ? "SIMULACIÓN (no se guardó nada)" : "Guardada en el estudio. Falta publicar."}\n${JSON.stringify(info, null, 1)}` }, contenidoImagen(bytes)];
    });
  });

herramienta("imagen_reemplazar",
  "Reemplaza el archivo de una figura que ya existe en el tema por un archivo local (JPG, PNG, HEIC…). Lo deja como el estudio: lado mayor ≤ 1600 px y ≤ 250 KB. Por defecto simula y devuelve cómo queda.",
  { tema: TEMA, imagen: { type: "string" }, archivo: { type: "string", description: "Ruta absoluta del archivo local." }, simular: SIMULAR },
  ["tema", "imagen", "archivo"],
  async ({ tema, imagen, archivo, simular = true }) => {
    await miPerfil();
    const t = await leerTema(tema);
    exigirMio(t);
    if (!t.imagenes[imagen]) throw new Error(`No existe la figura «${imagen}» en «${tema}».`);
    return conTemporal(async (dir) => {
      const salida = join(dir, "salida.jpg");
      const r = await ayuda("preparar", resolve(archivo), salida);
      const bytes = new Uint8Array(await readFile(salida));
      if (!simular) await escribir(`estudio_img/${tema}/${imagen}`, aDataURL(bytes));
      const info = { imagen, bytes: r.bytes, ancho: r.ancho, alto: r.alto, calidad: Math.round(r.calidad * 100) / 100 };
      return [{ type: "text", text: `${simular ? "SIMULACIÓN (no se guardó nada)" : "Guardada en el estudio. Falta publicar."}\n${JSON.stringify(info, null, 1)}` }, contenidoImagen(bytes)];
    });
  });

herramienta("tema_importar",
  "Crea un cuestionario nuevo en el estudio desde una carpeta local con la forma de temas/ (paquete.json, fuentes.json, img/), como «Subir un .zip» del estudio web: casos, lecturas, fichas y figuras, a nombre de quien está conectado y en preparación (borrador). Las figuras quedan en JPEG, lado mayor ≤ 1600 px y ≤ 250 KB (las que ya cumplen pasan tal cual). Por defecto solo simula: dice qué crearía (id, título, casos, lecturas y figuras, problemas del validador, peso) sin escribir. Con simular=false escribe por tandas; nunca sobrescribe un tema que ya existe, pero si una importación de la misma carpeta se cortó a mitad, volver a llamarla con el mismo id sigue donde quedó.",
  {
    carpeta: { type: "string", description: "Ruta de la carpeta que lleva paquete.json, fuentes.json e img/." },
    id: { type: "string", description: "Id del tema en el estudio. Por defecto, el «id» de paquete.json (o el título hecho slug)." },
    simular: SIMULAR,
  },
  ["carpeta"],
  async ({ carpeta, id: idPedido, simular = true }) => {
    const plan = await leerCarpetaTema(carpeta, idPedido);
    const { id, meta } = plan;
    const t = normalizarTema(id, { meta: plan.meta, fuente: plan.fuente, imagenes: plan.imagenes, casos: plan.casos, lecturas: plan.lecturas });
    const v = resumenValidacion(validarTema(t), t);
    const casos = Object.keys(plan.casos).length, lecturas = Object.keys(plan.lecturas).length;
    const figuras = Object.keys(plan.datos).length;
    const pesoTexto = JSON.stringify({ fuente: plan.fuente, imagenes: plan.imagenes, casos: plan.casos, lecturas: plan.lecturas }).length;
    const pesoFiguras = Object.values(plan.datos).reduce((n, d) => n + d.length, 0);
    const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;
    const rutasTexto = [
      ...Object.entries(plan.casos).map(([k, c]) => [`estudio/${id}/casos/${k}`, { ...c, actualizado: AHORA }]),
      ...Object.entries(plan.lecturas).map(([k, l]) => [`estudio/${id}/lecturas/${k}`, { ...l, actualizado: AHORA }]),
    ];
    const rutasFiguras = Object.entries(plan.datos).map(([k, d]) => [`estudio_img/${id}/${k}`, d]);
    const tandas = 1 + enTandas(rutasTexto, TANDA_TEXTO).length + enTandas(rutasFiguras, TANDA_FIGURAS).length + 1;

    // ¿Ya existe? Sin sesión, la simulación sigue y lo dice.
    let existente = null, conSesion = true;
    try {
      await miPerfil();
      existente = await leer(`estudio/${id}/meta`);
    } catch (e) {
      if (!simular) throw e;
      conSesion = false;
    }
    const reanuda = Boolean(existente && existente.importacion?.huella === plan.huella && existente.autor_uid === sesion?.uid);
    const informe = [
      `Tema «${id}»: «${meta.titulo}» (${SEGMENTOS[meta.segmento] || meta.segmento || "sin segmento"}), de ${plan.raiz}.`,
      `${casos} casos, ${lecturas} lecturas y ${Object.keys(plan.imagenes).length} fichas de figura; ${figuras} figuras con archivo`
        + `${plan.preparadas.length ? ` (${plan.preparadas.length} recomprimidas o reducidas para el estudio)` : ""}.`,
      ...(plan.faltan.length ? [`Sin archivo (${plan.faltan.length}): ${plan.faltan.slice(0, 15).join(", ")}${plan.faltan.length > 15 ? "…" : ""}. Se crea igual; se suben después con «imagen_reemplazar».`] : []),
      ...(plan.desconocidas.length ? [`Clasificaciones que no están en la lista de áreas y quedan fuera: ${plan.desconocidas.join(", ")}.`] : []),
      `Peso: ${mb(pesoTexto)} de texto y fichas + ${mb(pesoFiguras)} de figuras, en ${tandas} escrituras.`,
      `Validador: ${v.errores} errores y ${v.avisos} avisos (se crea igual, en preparación; se corrigen antes de publicar).`,
      ...v.detalle.slice(0, 40).map((x) => `  ${x}`),
      ...(v.detalle.length > 40 ? [`  … y ${v.detalle.length - 40} más («tema_validar» después de crearlo).`] : []),
      ...plan.bloqueos.map((x) => `NO SE PUEDE CREAR: ${x}`),
      !conSesion ? "Sin sesión: no comprobé si el id ya existe en el estudio."
        : reanuda ? "Ya hay una importación de esta misma carpeta que se cortó a mitad: con simular=false sigue donde quedó."
          : existente ? `YA EXISTE un tema «${id}» en el estudio («${existente.titulo}»): no lo sobrescribo. Elige otro «id».`
            : "El id está libre.",
    ];
    if (simular) return ["SIMULACIÓN (no se guardó nada):", ...informe].join("\n");
    if (plan.bloqueos.length) throw new Error(plan.bloqueos.join(" "));
    if (existente && !reanuda) throw new Error(`Ya existe un tema «${id}» en el estudio («${existente.titulo}»): no lo sobrescribo. Pasa otro «id».`);

    // 1. El tema con meta, fuente y fichas, de una sola vez: las reglas solo dejan crearlo mirando meta/autor_uid.
    //    «importacion» marca que falta el resto; se borra al terminar.
    const p = await miPerfil();
    let escritas = 0;
    const hechas = { casos: 0, lecturas: 0, figuras: 0 };
    try {
      if (!reanuda) {
        await escribir(`estudio/${id}`, {
          meta: {
            id, titulo: meta.titulo, segmento: meta.segmento, descripcion: meta.descripcion,
            modalidades: meta.modalidades.length ? meta.modalidades : ["RM"],
            autor_uid: sesion.uid, autor_nombre: p.nombre, autor_usuario: p.usuario,
            estado: "borrador", version: meta.version, creado: AHORA, actualizado: AHORA,
            importacion: { huella: plan.huella, casos, lecturas, figuras },
          },
          fuente: plan.fuente,
          imagenes: plan.imagenes,
        });
        escritas += 1;
      }
      // 2. Casos y lecturas por tandas (cada tanda es atómica); al reanudar, solo lo que falta.
      const yaTexto = reanuda
        ? new Set([...(await leerClaves(`estudio/${id}/casos`)).map((k) => `estudio/${id}/casos/${k}`),
          ...(await leerClaves(`estudio/${id}/lecturas`)).map((k) => `estudio/${id}/lecturas/${k}`)])
        : new Set();
      for (const tanda of enTandas(rutasTexto.filter(([r]) => !yaTexto.has(r)), TANDA_TEXTO)) {
        await actualizar(tanda);
        escritas += 1;
        for (const r of Object.keys(tanda)) hechas[r.includes("/casos/") ? "casos" : "lecturas"] += 1;
      }
      // 3. Las figuras, por tandas.
      const yaFiguras = reanuda ? new Set((await leerClaves(`estudio_img/${id}`)).map((k) => `estudio_img/${id}/${k}`)) : new Set();
      for (const tanda of enTandas(rutasFiguras.filter(([r]) => !yaFiguras.has(r)), TANDA_FIGURAS)) {
        await actualizar(tanda);
        escritas += 1;
        hechas.figuras += Object.keys(tanda).length;
      }
      await actualizar({ [`estudio/${id}/meta/importacion`]: null, [`estudio/${id}/meta/actualizado`]: AHORA });
    } catch (e) {
      throw new Error(`La importación se cortó (${e.message}). Quedaron escritos ${hechas.casos} casos, ${hechas.lecturas} lecturas y ${hechas.figuras} figuras en esta llamada`
        + `${escritas ? "" : " (nada)"}. Vuelve a llamar a «tema_importar» con la misma carpeta, el mismo id y simular=false: sigue donde quedó.`);
    }
    return [
      `${reanuda ? "Importación terminada" : "Creado en el estudio"}, en preparación: «${meta.titulo}» (id ${id}). En esta llamada: ${hechas.casos} casos, ${hechas.lecturas} lecturas y ${hechas.figuras} figuras en ${escritas + 1} escrituras.`,
      "Nada sale a la web hasta publicarlo («tema_validar», luego «tema_publicar»).",
      ...informe.slice(1, 5),
    ].join("\n");
  });

herramienta("tema_publicar",
  "Publica (o vuelve a publicar) un cuestionario, exactamente como el botón del paso 4: sube a la carpeta de RadQuiz en el Drive del autor solo las figuras que cambiaron, manda a la papelera las que sobran, escribe la publicación y el índice. Necesita el permiso de Drive de «sesion_iniciar» (dura una hora). La declaración es de la persona, no tuya: antes de llamar, muéstrale el texto que da «tema_publicar» con declaracion_aceptada=false y pásala en true solo si ella la acepta en esta conversación para esta publicación. No publica si el validador da errores.",
  { tema: TEMA, declaracion_aceptada: { type: "boolean", description: "true solo si la persona aceptó la declaración en el chat para esta publicación." } },
  ["tema", "declaracion_aceptada"],
  async ({ tema, declaracion_aceptada }) => {
    const p = await miPerfil();
    const t = await leerTema(tema);
    exigirMio(t);
    const DECLARACION = await declaracion();
    const v = validarTema(t);
    const partes = (t.meta.version || "0.1.0").split(".").map(Number);
    const version = t.meta.estado === "publicado" ? `${partes[0]}.${partes[1] + 1}.0` : t.meta.version || "0.1.0";
    if (declaracion_aceptada !== true) {
      return `Para publicar «${t.meta.titulo}» como versión ${version}, la persona tiene que aceptar esta declaración (versión ${DECLARACION.version}):\n\n«${DECLARACION.texto}»\n\nValidador: ${v.errores} errores, ${v.avisos} avisos.`;
    }
    if (v.errores) throw new Error(`El validador da ${v.errores} errores: corrígelos antes de publicar («tema_validar»).`);
    const tokenD = tokenDrive();
    const { imagenesUsadas } = aPaquete(t, version);
    const datos = imagenesUsadas.length ? (await leer(`estudio_img/${tema}`)) || {} : {};
    const sinArchivo = imagenesUsadas.filter((id) => !datos[id]);
    if (sinArchivo.length) throw new Error(`Faltan los archivos de: ${sinArchivo.join(", ")}.`);

    // Las figuras, como subirAlDrive() del estudio.
    const ids = {};
    const cambiosDrive = {};
    let subidas = 0, reutilizadas = 0, papelera = 0;
    if (imagenesUsadas.length) {
      const anterior = ID_DRIVE.test(t.meta.drive_carpeta || "") && t.meta.drive_uid === sesion.uid ? t.meta.drive_carpeta : "";
      const carpeta = await carpetaDelTema(tokenD, { anterior, nombre: `RadQuiz · ${t.meta.titulo}` });
      if (carpeta !== anterior) {
        await actualizar({ [`estudio/${tema}/meta/drive_carpeta`]: carpeta, [`estudio/${tema}/meta/drive_uid`]: sesion.uid, [`estudio/${tema}/meta/drive_nombre`]: p.nombre });
      }
      for (const id of imagenesUsadas) {
        const bytes = bytesDeDataURL(datos[id]);
        const firma = await huella(bytes);
        const previo = t.imagenes[id]?.drive;
        if (previo?.carpeta === carpeta && previo.huella === firma && (await existeEnDrive(tokenD, previo.id))) {
          ids[id] = previo.id;
          reutilizadas += 1;
          continue;
        }
        const ficha = t.imagenes[id] || {};
        ids[id] = await subirFigura(tokenD, { carpeta, nombre: `${id}.jpg`, bytes, descripcion: `${ficha.figura || id} · ${t.meta.titulo}` });
        await escribir(`estudio/${tema}/imagenes/${id}/drive`, { id: ids[id], huella: firma, carpeta });
        subidas += 1;
      }
      for (const [id, ficha] of Object.entries(t.imagenes)) {
        if (ficha.drive && !ids[id]) cambiosDrive[`estudio/${tema}/imagenes/${id}/drive`] = null;
      }
      const vigentes = new Set(Object.values(ids));
      for (const archivo of await archivosDeCarpeta(tokenD, carpeta)) {
        if (!vigentes.has(archivo.id)) { await aLaPapelera(tokenD, archivo.id).catch(() => {}); papelera += 1; }
      }
      await comprobarLectura(Object.values(ids)[0]);
    }

    // «actualizados» lleva casos y lecturas (publicacion/), y el índice los cuenta por separado (entradaIndice).
    const { paquete, fuentes, actualizados, actualizadosLecturas } = aPaquete(t, version, { drive: ids, publicador: { nombre: p.nombre, fecha: hoy() } });
    await actualizar({
      [`publicacion/${tema}`]: {
        paquete_json: JSON.stringify(paquete),
        fuentes_json: JSON.stringify(fuentes),
        actualizados,
        segmento: paquete.segmento,
        version,
        fecha: AHORA,
        por: p.nombre,
        declaracion: { version: DECLARACION.version, uid: sesion.uid, fecha: AHORA },
      },
      [`publicacion_img/${tema}`]: null,
      [`estudio/${tema}/meta/estado`]: "publicado",
      [`estudio/${tema}/meta/version`]: version,
      [`estudio/${tema}/meta/publicado_en`]: AHORA,
      ...cambiosDrive,
    });
    let indice = "anotado";
    try {
      await escribir(`indice_publicado/${tema}`, {
        ...entradaIndice(paquete, version, actualizados, actualizadosLecturas, { oculto: Boolean(t.meta.oculto) }), fecha: AHORA,
      });
    } catch (e) {
      indice = `no se pudo anotar (${e.message}); el tema saldrá cuando el repositorio se ponga al día`;
    }
    // El buscador de la portada es solo de casos: las lecturas no entran en indice_casos. Un tema sin casos lo borra
    // (las reglas no admiten uno vacío), como el estudio.
    await (paquete.casos.length ? escribir(`indice_casos/${tema}`, indiceDePaquete({ ...paquete, version }))
      : db("DELETE", `indice_casos/${tema}`)).catch((e) => log("indice_casos", e.message));
    const lecturas = lista(paquete.lecturas).length;
    return `Publicado «${t.meta.titulo}» versión ${version}: ${paquete.casos.length} casos${lecturas ? ` y ${lecturas} lecturas` : ""}. Figuras: ${subidas} subidas, ${reutilizadas} sin cambios, ${papelera} a la papelera de Drive. Índice: ${indice}. Usa «publicacion_comprobar» para revisarlo.`;
  });

herramienta("publicacion_comprobar",
  "Compara lo publicado con el estudio y prueba que la web puede leer cada figura desde Drive. Dice qué casos y lecturas tienen cambios sin publicar, si el índice está al día y qué figuras fallan.",
  { tema: TEMA }, ["tema"],
  async ({ tema }) => {
    await miPerfil();
    const t = await leerTema(tema);
    const pub = await leer(`publicacion/${tema}`);
    if (!pub) return `«${tema}» no está publicado.`;
    const publicado = JSON.parse(pub.paquete_json);
    const indice = await leer(`indice_publicado/${tema}`);
    const ids = Object.fromEntries(Object.entries(t.imagenes).filter(([, i]) => i.drive?.id).map(([id, i]) => [id, i.drive.id]));
    const { paquete } = aPaquete(t, pub.version, { drive: ids });
    const porId = (p) => Object.fromEntries(p.casos.map((c) => [c.id, c]));
    const a = porId(publicado), b = porId(paquete);
    const texto = ["tema", "enunciado", "opciones", "correcta", "explicacion", "perla", "etiquetas", "imagenes", "evidencia"];
    const sinPublicar = Object.keys(b).filter((id) => !a[id] || texto.some((k) => JSON.stringify(a[id][k] ?? null) !== JSON.stringify(b[id][k] ?? null)));
    const quitados = Object.keys(a).filter((id) => !b[id]);
    // Las lecturas, por su contenido (la clasificación y la dificultad no cuentan, como en los casos).
    const porIdL = (p) => Object.fromEntries(lista(p.lecturas).map((l) => [l.id, l]));
    const la = porIdL(publicado), lb = porIdL(paquete);
    const textoL = ["tema", "presentacion", "etiquetas", "imagenes", "preguntas", "explicacion", "perlas", "evidencia"];
    const lecturasSinPublicar = Object.keys(lb).filter((id) => !la[id] || textoL.some((k) => JSON.stringify(la[id][k] ?? null) !== JSON.stringify(lb[id][k] ?? null)));
    const lecturasQuitadas = Object.keys(la).filter((id) => !lb[id]);
    const figurasDistintas = Object.keys(publicado.imagenes || {}).filter((id) => publicado.imagenes[id].drive !== ids[id]);
    const fallan = [];
    const lista_ = Object.entries(publicado.imagenes || {});
    for (let i = 0; i < lista_.length; i += 8) {
      await Promise.all(lista_.slice(i, i + 8).map(async ([id, img]) => {
        const r = await fetch(urlDrive(img.drive), { method: "GET" }).catch(() => null);
        if (!r?.ok) fallan.push(`${id} (${r?.status || "sin respuesta"})`);
        await r?.body?.cancel().catch(() => {});
      }));
    }
    return JSON.stringify({
      version_publicada: pub.version, fecha: new Date(pub.fecha).toISOString(), por: pub.por,
      indice: indice ? (indice.version === pub.version ? "al día" : `desfasado (${indice.version})`) : "sin entrada",
      casos_publicados: publicado.casos.length,
      casos_con_cambios_sin_publicar: sinPublicar, casos_quitados_del_estudio: quitados,
      ...(Object.keys(la).length || Object.keys(lb).length ? {
        lecturas_publicadas: Object.keys(la).length, lecturas_en_el_estudio: Object.keys(lb).length,
        lecturas_con_cambios_sin_publicar: lecturasSinPublicar, lecturas_quitadas_del_estudio: lecturasQuitadas,
        indice_lecturas: indice ? (Number(indice.lecturas || 0) === Object.keys(la).length ? "al día" : `cuenta ${indice.lecturas || 0}`) : "sin entrada",
      } : {}),
      figuras_que_cambiaron_desde_la_publicacion: figurasDistintas,
      figuras_que_la_web_no_puede_leer: fallan, figuras_probadas: lista_.length,
    }, null, 1);
  });

// ------------------------------------------------------------------ MCP por stdio
const VERSIONES = ["2025-06-18", "2025-03-26", "2024-11-05"];
const enviar = (m) => process.stdout.write(JSON.stringify(m) + "\n");

async function atender(m) {
  const { id, method, params } = m;
  if (method === "initialize") {
    const pedida = params?.protocolVersion;
    return enviar({ jsonrpc: "2.0", id, result: {
      protocolVersion: VERSIONES.includes(pedida) ? pedida : VERSIONES[0],
      capabilities: { tools: {} },
      serverInfo: { name: "radquiz", version: "1.0.0" },
      instructions: "Maneja el estudio en línea de RadQuiz con la cuenta del autor. Las herramientas que escriben simulan por defecto: muestra el resultado antes de guardar. Publicar exige que la persona acepte la declaración en el chat.",
    } });
  }
  if (method === "ping") return enviar({ jsonrpc: "2.0", id, result: {} });
  if (method === "tools/list") return enviar({ jsonrpc: "2.0", id, result: { tools: herramientas.map((h) => h.definicion) } });
  if (method === "tools/call") {
    const h = herramientas.find((x) => x.nombre === params?.name);
    if (!h) return enviar({ jsonrpc: "2.0", id, error: { code: -32602, message: `Herramienta desconocida: ${params?.name}` } });
    try {
      const r = await h.fn(params.arguments || {});
      const content = typeof r === "string" ? [{ type: "text", text: r }] : r;
      return enviar({ jsonrpc: "2.0", id, result: { content } });
    } catch (e) {
      log(params.name, e.stack || e.message);
      return enviar({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: e.message }], isError: true } });
    }
  }
  if (id !== undefined && method) return enviar({ jsonrpc: "2.0", id, error: { code: -32601, message: `Método no soportado: ${method}` } });
}

let resto = "";
let enCurso = 0;
let cerrado = false;
const quizasSalir = () => { if (cerrado && !enCurso) process.exit(0); };
process.stdin.setEncoding("utf8");
process.stdin.on("data", (trozo) => {
  resto += trozo;
  let fin;
  while ((fin = resto.indexOf("\n")) >= 0) {
    const linea = resto.slice(0, fin).trim();
    resto = resto.slice(fin + 1);
    if (!linea) continue;
    let mensaje;
    try { mensaje = JSON.parse(linea); } catch { log("línea que no es JSON"); continue; }
    enCurso += 1;
    atender(mensaje).catch((e) => log(e.stack || e.message)).finally(() => { enCurso -= 1; quizasSalir(); });
  }
});
process.stdin.on("end", () => { cerrado = true; quizasSalir(); });   // termina cuando acaba lo pendiente
log(`listo · ${herramientas.length} herramientas · base ${DB}`);
