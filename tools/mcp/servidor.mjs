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
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, chmod, stat, rm, mkdtemp } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { firebaseConfig } from "../../app/firebase-config.js";
import {
  validarTema, validarFuente, aPaquete, casosOrdenados, imagenesOrdenadas, lista, LICENCIAS, TIPOS_FUENTE,
  normalizarDificultad,
} from "../../app/validacion.js";
import { leerRespuestaIA, planDeCarga } from "../../app/instrucciones-ia.js";
import {
  ALCANCE_DRIVE, ID_DRIVE, carpetaDelTema, subirFigura, existeEnDrive, archivosDeCarpeta, aLaPapelera,
  comprobarLectura, huella, urlDrive,
} from "../../app/drive.js";
import { bytesDeDataURL } from "../../app/zip.js";

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

async function db(metodo, ruta, cuerpo) {
  const t = await token();
  const r = await fetch(`${DB}/${ruta}.json?auth=${t}`, {
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
function normalizarTema(id, bruto) {   // el mismo que app/estudio.js
  const t = JSON.parse(JSON.stringify(bruto || {}));
  t.id = id;
  t.meta = t.meta || {};
  t.fuente = t.fuente || {};
  t.imagenes = t.imagenes || {};
  t.casos = t.casos || {};
  t.revision = t.revision || {};
  for (const c of Object.values(t.casos)) {
    c.opciones = lista(c.opciones);
    c.imagenes = lista(c.imagenes);
    c.evidencia = lista(c.evidencia);
    c.etiquetas = lista(c.etiquetas);
    c.clasificacion = lista(c.clasificacion);
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

function resumenValidacion(v, t) {
  const lineas = [];
  const poner = (donde, problemas) => {
    for (const p of problemas || []) lineas.push(`${p.tipo === "error" ? "ERROR" : "aviso"} · ${donde}: ${p.texto || p.mensaje || JSON.stringify(p)}`);
  };
  poner("fuente", v.fuente);
  poner("tema", v.tema);
  for (const [id, p] of Object.entries(v.imagenes)) poner(`imagen ${id} (${t.imagenes[id]?.figura || ""})`, p);
  for (const [id, p] of Object.entries(v.casos)) poner(`caso ${id}`, p);
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
let ayudante = null;
async function rutaAyudante() {
  if (ayudante) return ayudante;
  if (process.platform !== "darwin") throw new Error("Las herramientas de figuras usan Vision y CoreGraphics: solo funcionan en macOS.");
  const fuente = join(AQUI, "imagen.swift");
  const binario = join(CACHE, "imagen");
  const fecha = async (r) => (await stat(r).catch(() => null))?.mtimeMs || 0;
  if ((await fecha(binario)) < (await fecha(fuente))) {
    await mkdir(CACHE, { recursive: true });
    log("compilando el ayudante de imágenes…");
    await ejecutar("swiftc", ["-O", fuente, "-o", binario], { timeout: 300_000 });
  }
  return (ayudante = binario);
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

herramienta("temas_listar", "Lista los cuestionarios del estudio: id, título, autor, estado, versión y cuántos casos y figuras tienen.", {}, [],
  async () => {
    await miPerfil();
    const todos = (await leer("estudio")) || {};
    const filas = Object.entries(todos).map(([id, b]) => {
      const m = b.meta || {};
      return { id, titulo: m.titulo, segmento: m.segmento, autor: m.autor_nombre, mio: m.autor_uid === sesion.uid,
        estado: m.estado, version: m.version, casos: Object.keys(b.casos || {}).length, imagenes: Object.keys(b.imagenes || {}).length };
    });
    return JSON.stringify(filas, null, 1);
  });

herramienta("tema_leer",
  "Lee un cuestionario del estudio: datos, fuente, resumen del validador y la lista de casos (id, subtema, enunciado abreviado). Con «completo» trae los casos enteros.",
  { tema: TEMA, completo: { type: "boolean", default: false } }, ["tema"],
  async ({ tema, completo = false }) => {
    await miPerfil();
    const t = await leerTema(tema);
    const v = resumenValidacion(validarTema(t), t);
    const casos = casosOrdenados(t).map((c) => completo ? casoParaEditar(t, c)
      : { id: c.id, tema: c.tema, enunciado: (c.enunciado || "").slice(0, 110), figuras: lista(c.imagenes).map((r) => r.ref) });
    return JSON.stringify({
      id: t.id, meta: { titulo: t.meta.titulo, segmento: t.meta.segmento, estado: t.meta.estado, version: t.meta.version,
        autor: t.meta.autor_nombre, editable: esMio(t), carpeta_drive: t.meta.drive_carpeta || null },
      fuente: t.fuente, validacion: { errores: v.errores, avisos: v.avisos }, imagenes: Object.keys(t.imagenes).length, casos,
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

herramienta("casos_dificultad",
  "Pone la dificultad (nivel 1 a 4 con su motivo, por el contenido y la bibliografía: docs/guia-estilo-ia.md) y si el caso necesita las opciones a la vista, como el panel «Dificultad» del paso 3. No toca el texto del caso, así que no le quita el sello de verificado. Recibe {\"<id del caso>\": {\"nivel\": 2, \"motivo\": \"…\", \"requiere_opciones\": false}} directamente o en un archivo JSON local con esa forma. Por defecto solo simula.",
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
    const desconocidos = Object.keys(datos).filter((id) => !t.casos[id]);
    if (desconocidos.length) throw new Error(`Estos casos no existen en «${tema}»: ${desconocidos.join(", ")}.`);
    const cambios = {};
    const malos = [];
    let niveles = 0, opciones = 0;
    for (const [id, v] of Object.entries(datos)) {
      const caso = t.casos[id];
      if (v.nivel !== undefined) {
        const d = normalizarDificultad({ ...v, por });
        if (!d) { malos.push(id); continue; }
        if (JSON.stringify(caso.dificultad ?? null) !== JSON.stringify(d)) {
          cambios[`estudio/${tema}/casos/${id}/dificultad`] = d;
          caso.dificultad = d;
          niveles += 1;
        }
      }
      if (typeof v.requiere_opciones === "boolean" && Boolean(caso.requiere_opciones) !== v.requiere_opciones) {
        cambios[`estudio/${tema}/casos/${id}/requiere_opciones`] = v.requiere_opciones || null;
        caso.requiere_opciones = v.requiere_opciones || undefined;
        opciones += 1;
      }
    }
    if (malos.length) throw new Error(`Nivel inválido (tiene que ser 1 a 4) en: ${malos.join(", ")}.`);
    const reparto = [1, 2, 3, 4].map((n) => `${n}: ${Object.values(t.casos).filter((c) => c.dificultad?.nivel === n).length}`).join(" · ");
    const sin = Object.values(t.casos).filter((c) => !c.dificultad?.nivel).length;
    const v = validarTema(t);
    const informe = [
      `Cambia la dificultad de ${niveles} casos y «necesita las opciones» de ${opciones}.`,
      `Reparto: ${reparto}${sin ? ` · sin dificultad: ${sin}` : ""}. Necesitan las opciones: ${Object.values(t.casos).filter((c) => c.requiere_opciones).length}.`,
      `Validador después: ${v.errores} errores y ${v.avisos} avisos.`,
    ];
    if (simular || !Object.keys(cambios).length) return [simular ? "SIMULACIÓN (no se guardó nada):" : "No había nada que cambiar.", ...informe].join("\n");
    await actualizar({ ...cambios, [`estudio/${tema}/meta/actualizado`]: AHORA });
    return ["Guardado en el estudio, sin quitar sellos. Falta publicar para que salga en la web («tema_publicar»).", ...informe].join("\n");
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

    const { paquete, fuentes, actualizados } = aPaquete(t, version, { drive: ids, publicador: { nombre: p.nombre, fecha: hoy() } });
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
        titulo: paquete.titulo, segmento: paquete.segmento, modalidades: paquete.modalidades || [], version,
        casos: paquete.casos.length, actualizados, fecha: AHORA, ...(t.meta.oculto ? { oculto: true } : {}),
      });
    } catch (e) {
      indice = `no se pudo anotar (${e.message}); el tema saldrá cuando el repositorio se ponga al día`;
    }
    return `Publicado «${t.meta.titulo}» versión ${version}: ${paquete.casos.length} casos. Figuras: ${subidas} subidas, ${reutilizadas} sin cambios, ${papelera} a la papelera de Drive. Índice: ${indice}. Usa «publicacion_comprobar» para revisarlo.`;
  });

herramienta("publicacion_comprobar",
  "Compara lo publicado con el estudio y prueba que la web puede leer cada figura desde Drive. Dice qué casos tienen cambios sin publicar, si el índice está al día y qué figuras fallan.",
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
