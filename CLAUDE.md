# RadQuiz — plataforma de casos radiológicos en vivo

Plan completo (fuente de verdad): https://claude.ai/code/artifact/acd19a8f-ec5a-43e9-aff2-1f140586da61

## Qué es
Web tipo Kahoot, gratuita, para residentes de radiología (HNERM / UNMSM). El presentador proyecta; los
residentes entran desde el celular con un código de sala de 4 letras + nombre, sin cuentas ni app.
Modos v1: sesión en vivo, práctica individual y tablero por equipos (al estilo Jeopardy, sin celulares). Todos los
segmentos de la radiología.

## Arquitectura (decidida)
- Un repositorio en GitHub: app + temas (texto e ids de Drive; las figuras las aloja quien publica). La web está en
  Firebase Hosting; GitHub Pages ya no se usa, salvo para redirigir los enlaces viejos (decisión del 2026-09-23).
- Firebase Realtime Database (plan Spark, gratis, 100 conexiones simultáneas) solo para el estado de las salas en vivo.
- App estática HTML + JavaScript, sin servidor propio. La práctica individual NO depende de Firebase.

## Principios
1. La imagen es el caso: cada imagen lleva modalidad, secuencia, plano, condición, paneles y `marcas` (qué señalan flechas/círculos).
2. Contenido separado del código: un tema nuevo = una carpeta en `temas/<segmento>/<tema>/` con `paquete.json`, `fuentes.json`, `img/`.
3. Formato pensado para IA: JSON con JSON Schema; validador automático antes de la revisión humana.
4. Cualquier miembro publica lo suyo si pasa el validador; un radiólogo le pone el sello «verificado» después.
   Estados del caso: borrador → publicado; `revisor` presente = verificado. La sala en vivo usa verificados por defecto.
5. Toda imagen con fuente, licencia y DOI/enlace. Figuras CC BY-NC-ND: se permite comprimir/redimensionar, NO recortar ni anotar.

## Segmentos (carpetas)
neurorradiologia, cabeza-cuello, torax, cardiovascular, abdomen, genitourinario, musculoesqueletico, mama,
pediatria, intervencionismo, fisica-tecnica

## Imágenes
JPG, lado mayor ≤ 1600 px, ≤ 250 KB, sin datos de pacientes. v1: solo open access y bancos públicos
(Radiopaedia = CC BY-NC-SA 3.0: nombrar autor, enlazar caso y licencia, compartir igual). Nunca casos del PACS en v1.

## Formato (decidido en la fase 0; detalles en README.md y docs/guia-estilo-ia.md)
- Textos en Markdown limitado (**negrita**, *cursiva*, listas), nunca HTML.
- Catálogo `imagenes` por paquete con ficha (leyenda textual, paneles, marcas, modificaciones); los casos la citan por id.
  Clave ausente = pendiente; `null` = la fuente no lo indica.
- Cada caso lleva `evidencia` (ubicación + frase textual de la fuente). Nada de datos clínicos que no estén en la leyenda.
- La validación depende del estado: en borrador lo pendiente es aviso; en publicado es error.
- La app baraja las opciones; id global = `<paquete>/<caso>`.
- Clasificación (2026-09-24): el paquete tiene un segmento (carpeta y portada) y cada caso lleva `clasificacion`, una o
  más parejas segmento → área, la principal primero; un caso puede estar en varios segmentos (cadera pediátrica =
  MSK y pediatría). Sin la clave, hereda el segmento del paquete. Las áreas son una lista cerrada por segmento en
  `app/areas.js` (lo que sigue a `AREAS =` es JSON estricto: `tools/validar` lee ese archivo). Mama e intervencionismo todavía no tienen áreas (los demás sí, desde el 2026-10-07); se agregan
  con una línea. Área desconocida = error; pareja sin área en un segmento con áreas = aviso.

## Estado actual (2026-09-20)
- Fase 0 terminada: `schema/`, `tools/validar` (sin dependencias), `docs/guia-estilo-ia.md`, skill
  `.claude/skills/crear-casos-radquiz`, CI en `.github/workflows/validar.yml`.
- `temas/cabeza-cuello/atm-rm-lopezramirez2024/`: 27 casos y 17 imágenes, versión 0.2.0, pasa el validador sin
  errores ni avisos. Publicado y **verificado el 2026-09-20**: los 27 casos llevan el sello de `pluna` (Pavel Luna),
  que es además el autor —el modelo lo permite, y el manual recomienda que un segundo radiólogo lo mire—. Los otros
  dos temas de `temas/` (meniscos y tobillo-pie, de MSK) los trajo el estudio. `REVISION.md` guarda qué cambió al
  pasar al formato nuevo.
  Licencia verificada: CC BY-NC-ND 4.0 (PDF en español, p. 136). Respaldo del original en `referencia/piloto-original/`.
- App estática de práctica: `index.html` + `practica.html` (+ `?revision=1` = previsualizador para revisores).
  En la cabecera, «Casos» es un campo numérico (2026-09-25): cualquier número del 1 al total, que es con lo que
  empieza; vacío, 0 o más que el total = todos. Los toma al azar pero los deja en el orden del tema, y cambiarlo
  —o «Empezar de nuevo»— arma otra tanda.
  Probar con `python3 -m http.server`. Necesita `temas/indice.json` (`tools/validar --indice`).
- Al crear una sala se escribe también «Cuántos casos», con el mismo campo; con «Mezclar» la tanda sale al azar y sin
  mezclar son los primeros del tema. El campo y su nota se ajustan según el tema y los filtros (`leerTanda` y
  `totalTanda` en `app/comun.js`, compartidos con la práctica). Una sala tiene como mucho 200 casos, porque las reglas
  piden `estado/indice < 200`; Enter en el campo confirma el número y no crea la sala.
- Sala en vivo: `sala.html` + `app/sala.js`, Firebase Realtime Database (proyecto `radquiz-shpn2`, plan Spark,
  us-central1) con auth anónima y reglas en `database.rules.json`. Probada de punta a punta el 2026-09-19.
  El lobby del presentador muestra, junto al código, un QR del enlace `sala.html?c=<código>` (se escanea y se
  entra con el código puesto). Lo dibuja `app/qr.js`, generador propio sin dependencias ni CDN —la red del
  hospital puede no dejar salir— modo byte, corrección M, versiones 1 a 10. Con la sesión en marcha (pregunta,
  revelado y ranking; no en el lobby ni al final) el QR queda chico en la cabecera del presentador, con el código,
  para quien llega tarde: al tocarlo —o el grande del lobby— se amplía con el código y la dirección (`qrCabecera()`
  y `ampliarQR()`, 2026-10-05).
- En línea: repositorio público `pavelucho/radquiz` y **una sola web, en Firebase Hosting**:
  **https://radquiz-shpn2.firebaseapp.com, la dirección oficial desde el 2026-10-05** porque es la que el autor vio
  entrar en el hospital (`radquiz-shpn2.web.app` es el mismo sitio y sigue funcionando). El QR y la dirección del
  lobby apuntan siempre a ella (`URL_OFICIAL` y `origenPublico()` en `app/comun.js`), salvo en una copia de ensayo
  local; la redirección de GitHub Pages también. No se redirige `web.app` a `firebaseapp.com`: el avance de la práctica,
  el avatar y la partida del tablero viven en el navegador por dirección, y se verían perdidos. Solo los casos `publicado` salen a la
  web (decisión del autor: nunca borradores en la web). Se despliega con `tools/desplegar web`, que arma `_site`
  con `tools/construir_sitio` y lo sube; fuera de GitHub usa la sesión de la CLI si no hay credencial. Lo publicado
  en el estudio aparece al instante sin desplegar: redesplegar solo hace falta cuando cambia el código.
- **La red del hospital bloquea GitHub por IP** (github.com y github.io: el DNS resuelve, la conexión al 443 se
  corta; un dominio propio apuntado a GitHub Pages tampoco pasaría). Firebase sí pasa: base con WebSocket, gstatic,
  identitytoolkit y Hosting. Medido el 2026-09-21 desde el Mac del autor. Por eso, desde el 2026-09-23, GitHub
  Pages no sirve la web: `pavelucho.github.io/radquiz` solo tiene `redireccion/index.html` (como index y como 404),
  que manda a la misma ruta en Firebase con la consulta incluida. El QR y la dirección del lobby salen de
  `location`.
- `.github/workflows/publicar.yml` («Publicar»), en cada push a `main` y cada pocas horas: archiva en `temas/` lo
  publicado (`tools/traer_publicaciones` valida cada tema antes de guardarlo: el que no pasa queda fuera con un
  aviso y no frena nada; «Validar temas» informa sin bloquear), despliega la web en Firebase si hay secreto, y en
  cada push vuelve a dejar la redirección en Pages. Límite de Hosting en Spark: unos 360 MB al día de tráfico.
- Estudio web (`estudio.html` + `app/estudio.js`): quien entra con Google queda de alta como autor solo
  (`usuarios/`); «revisor» y «coordinador» los da el coordinador. Publicar es directo; verificar es posterior
  (`verificacion/`), lo hace cualquier revisor sobre cualquier caso publicado —incluidos los suyos, con el botón
  «Verificar casos»— y se retira solo si el autor edita y vuelve a publicar. Los reportes de error de la web (`reportes/`) ponen el caso primero en la cola. Los casos se generan con **cualquier IA** (el estudio arma el
  texto para copiar y lee la respuesta JSON); no depende de Claude ni de ningún proveedor.
  Publicar escribe `publicacion/` e `indice_publicado/`. Validación en el navegador:
  `app/validacion.js` (espejo de `tools/validar`).
- **Las figuras publicadas las aloja quien publica, en su Google Drive** (decisión del 2026-09-23: la
  responsabilidad de las figuras pasa al que sube, no al proyecto). Al publicar, el estudio pide el permiso
  `drive.file` con `reauthenticateWithPopup`, sube cada figura a la carpeta «RadQuiz · título» del autor, la
  comparte con «cualquiera con el enlace» y guarda en la ficha solo el id (`drive`, en el esquema). Reutiliza lo
  ya subido si la huella no cambió y manda a la papelera lo que el tema dejó de usar (`app/drive.js`). El autor
  marca una declaración (texto en `DECLARACION`, `app/estudio.js`) que queda en `publicacion/<tema>/declaracion`;
  las reglas la exigen. La web pide cada figura a `lh3.googleusercontent.com/d/<id>=s0` (mismo archivo, byte a
  byte) y, si falla, a `www.googleapis.com/drive/v3/files/<id>?alt=media` con `claveDrive` (`activarRespaldoDrive`
  en `app/drive.js`). Antes iba directo a la API, y el 2026-09-30 dejaron de cargar todas las figuras: Drive
  contestaba 403 «your computer or network may be sending automated queries» a las descargas con clave (los
  metadatos sí salían). Para el respaldo, la API de Drive sigue habilitada y permitida en esa clave.
  `publicacion_img/` es de antes: solo admite borrarse, y la web la lee solo para temas no vueltos a publicar.
  Los borradores siguen en `estudio_img/`. Borrar un tema propio manda su carpeta de Drive a la papelera.
- Licencia «Con copyright» (sin licencia abierta): la web muestra «© titular · alojada por <quien publicó>» y ningún
  enlace de licencia (`credito()` en `app/comun.js`); `alojada_por` va en la fuente. Una licencia CC solo pasa si
  la frase de `verificacion.donde` la menciona y no dice que se supuso (mismas pruebas en `app/validacion.js` y
  `tools/validar`: salieron de seis temas con la licencia CC inventada por la IA). Figuras con copyright en `img/`
  del repositorio son error: solo pueden estar en el Drive de quien publica. Al publicar, la verificación de la
  licencia se completa con quien publica si vino vacía, y `doi`/`licencia_url` vacíos van como `null`.
- La sala y los reportes usan una instancia de Firebase aparte (`APP_ANONIMA`): su sesión anónima no pisa la de
  Google del estudio en el mismo navegador (antes, abrir la sala cerraba la sesión del estudio, y entrar al
  estudio le quitaba el control de la sala al presentador).
- Un cuestionario entero cabe en un `.zip` con la forma de una carpeta de `temas/` (`paquete.json`, `fuentes.json`,
  `img/`): «Subir un .zip» en la portada del estudio y «Descargar .zip» en el paso 4. `app/zip.js` lo lee y lo arma
  sin librerías (`DecompressionStream`; al escribir, guardado sin comprimir), `app/importar.js` lo convierte con
  `dePaquete()` —el inverso de `aPaquete()`— y `instruccionesPaquete()` da el texto para que una IA con ejecución
  de código lo arme desde el PDF. Lo importado entra siempre como borrador y se enseñan las figuras antes de crear
  nada: una IA puede partir una figura en paneles, y las licencias ND no lo permiten.
- Prompts para la IA (2026-09-30): lo principal es la pregunta de imagen, al estilo de los bancos de casos tipo
  RadPrimer (solo el formato). El del .zip va en orden de trabajo —sacar las figuras, **mirarlas**, escribir,
  empaquetar, comprobar—: la IA busca rótulos, esquemas y fotos que delaten la respuesta, el enunciado dice dónde
  mirar y no qué hay, y cada caso pasa la prueba de la imagen tapada y la de las opciones solas. Salió de meniscos y
  tobillo, donde la mayoría de los casos de imagen copiaban de la leyenda la descripción del hallazgo, y de la Fig. 17
  de meniscos, con «HANDLE FRAGMENT» escrito, en la pregunta de «¿qué tipo de rotura?». Los bloques
  (`PREGUNTA_IMAGEN`, `PRUEBAS`, `ERRORES_REALES` en `app/instrucciones-ia.js`) los comparte el prompt del estudio. El
  comprobador del .zip ahora también bloquea paneles y marcas del enunciado que la ficha no tiene, menos del 70 % de
  casos de imagen o de dos casos de imagen por figura, dos preguntas de una figura con la misma respuesta y pistas
  comparadas por las 5 primeras letras; y avisa (⚠, no bloquea) de enunciados que describen lo que se ve o pasan de
  250 caracteres. Probado contra los tres temas: en ATM no da ninguna pista falsa.
- Hallazgos al revelar (2026-10-01): en los siete RadCases, unos 750 de 852 enunciados de imagen contaban lo que se
  ve («la RM muestra…», copiado de la sección de hallazgos del libro) y la imagen sobraba. Se reescribieron en el
  estudio: el enunciado dice qué estudio es y dónde mirar, y la descripción pasó a la primera viñeta de la
  explicación, «**Hallazgos:** …»; también salieron los antecedentes que daban la respuesta solos (bifosfonatos,
  prótesis metal-metal, mutación PLP1…). Los prompts piden ahora esa viñeta, prohíben los verbos que cuentan la imagen
  venga de donde venga la descripción, y el comprobador del .zip lo bloquea (✗; «se muestra la RM» y «que se ve» no
  cuentan). Los niveles de dificultad no se revisaron tras quitar la descripción.
- Carga masiva (2026-09-24): no hay tope de casos. En el paso 3, el panel «Clasificación» resume cuántos casos hay en
  cada segmento → área y agrega o quita una pareja a los casos marcados de una vez; cambiar la clasificación (ahí o
  en el formulario) no toca `actualizado` del caso y no retira el sello. Una respuesta de IA cortada se rescata
  (`rescatar()` en `app/instrucciones-ia.js`): se cargan los casos enteros y el estudio da el pedido para que siga;
  las instrucciones piden `"faltan": true` si no caben todos. Un `.zip` con más de una fuente se rechaza (uno por
  artículo: el estudio acredita todas las figuras a una sola fuente). La web la usa desde el 2026-10-07 (buscador, abajo).
- DOI opcional (2026-09-30): el paso 1 del estudio pide el tipo de fuente (artículo, página web o sitio educativo,
  caso de un banco, libro; `TIPOS_FUENTE` en `app/validacion.js`) y el DOI «si tiene». Un DOI escrito tiene que ser
  válido; un artículo sin DOI da aviso, nunca error (estudio, `tools/validar` y comprobador del .zip). Sin DOI, la web
  enlaza a `url`. Antes, `dePaquete()` y `guardarFuente()` dejaban toda fuente como `articulo` y exigían DOI, y
  páginas como The Radiology Assistant no se podían publicar.
- Temas ocultos (2026-10-05): publicados pero fuera de la web, para estrenarlos en una clase. `oculto: true` en
  `indice_publicado/<tema>` (lo que lee la web) y en `estudio/<tema>/meta` (lo que ve el estudio), escritos juntos;
  casilla «Publicar oculto» y botones «Ocultar de la web» / «Mostrar en la web» en el paso 4 (autor o coordinador).
  `fusionarIndice` los quita de la portada, la práctica, el tablero y el Tabú; `cargarPaquete` los rechaza salvo con
  `{ ocultos: true }`, que pasa la sala (el código de la sala hace de llave). «Presentar en una sala» abre
  `sala.html?crear=1&tema=<ruta>`, que lo deja elegido y lo muestra con «(oculto)». Publicar (estudio y MCP) conserva
  la marca; `tools/traer_publicaciones` no archiva los ocultos y quita del repositorio los que ya estaban. Oculto no es
  secreto: `publicacion/` es de lectura pública y las figuras están compartidas por enlace.
- Borrar un cuestionario se hace desde el estudio (botón en la tarjeta y en el paso 4), escribiendo `BORRAR` en un
  aviso que dice qué se pierde. El orden de borrado importa: `publicacion`, `publicacion_img`, `verificacion`,
  `reportes`, `estudio_img` y por último `estudio`, porque las reglas dan permiso mirando
  `estudio/<tema>/meta/autor_uid`. Deja `indice_publicado/<tema>` como `retirado`.
- **Probado de punta a punta en producción el 2026-09-20** con el tema `sindrome-psicoticos`: se publicó desde el
  estudio y se retiró desde el estudio. Con las reglas ya desplegadas, `indice_publicado` se escribió por primera
  vez (antes estaba vacío, y por eso los temas tardaban en salir), la web ocultó el tema al instante por la marca
  `retirado`, y `tools/traer_publicaciones` borró su carpeta de `temas/` en el workflow siguiente. Desde fuera no
  se distingue «Borrar» de «Quitar de la web»: dejan el mismo rastro público.
- Publicar es instantáneo: `app/publicado.js` lee por REST los nodos públicos `indice_publicado`, `publicacion`
  y `verificacion` (y `publicacion_img` solo para temas de antes de Drive), y la portada, la práctica y la sala los
  fusionan con `temas/indice.json`. Gana el estudio cuando su versión no coincide con la del sitio; si coinciden,
  se usan los archivos del sitio. Si la base no responde, la web sigue con lo del sitio.
  `tools/traer_publicaciones` baja lo mismo al repositorio por su cuenta, desde el workflow, sin copiar las figuras
  que están en Drive.
- Diseño (2026-09-25): `app/estilos.css` es el sistema de diseño de toda la web. Las fichas (colores, tipografía,
  radios, íconos) van al principio, en `:root`; debajo, los componentes, por pantalla. La idea es una sala de
  lectura: fondo oscuro y neutro, y el amarillo de las anotaciones como color de la marca y de lo que se toca; cada
  letra A–E tiene su color, y ✓/✗ acompañan al verde y al rojo. Los tres colores de texto pasan 4,5:1 sobre todas
  las superficies. Las tipografías se alojan en el sitio, no en Google Fonts (la red del hospital): IBM Plex Sans
  variable —la misma da la versión condensada de los números grandes, con `font-stretch: 85%`— e IBM Plex Mono,
  licencia OFL en `app/fuentes/OFL.txt`. Logo y favicon: `app/marca.svg`, la retícula con que se marca un hallazgo.
  Solo se usa lo que ya tenía Chrome 109 (el último de Windows 7): revisado función por función, no probado en ese
  navegador. `text-wrap`, y `:has()` en Firefox anteriores al 121, solo mejoran. La portada trae una
  casilla para entrar a una sala con el código (formulario GET a `sala.html?c=`), y «Presentar una sesión» abre
  `sala.html?crear=1`, que va directo a crear la sala.
- Fondo animado de la portada (2026-09-28): `.fondo-vivo` en `index.html`, sus estilos en la sección «inicio» de
  `app/estilos.css` y `centrarMira()` en `app/inicio.js`. En escritorio, una mira como la del logo rodea la casilla
  del código: anillos finos, una escala de gantry que gira despacio y un punto que da la vuelta, sobre una rejilla de
  puntos y dos luces. Se desvanece antes de la columna de texto, la cabecera y la fila de «Temas» (dos máscaras que
  se intersecan). Con la portada en una columna no hay mira: bajan una banda de luz tenue y dos luces frías que
  vienen de arriba. Solo se animan `transform` y `opacity`; con «reducir movimiento» queda quieto. El contraste se
  midió con capturas de cada animación en sus extremos (375, 1024, 1280, 1440 y 1920 px): ningún texto baja de
  4,5:1; el peor es el gris de `--mute`, 4,95:1 en el celular.
- Tablero por equipos (2026-09-27): `tablero.html` + `app/tablero-local.js`, al estilo Jeopardy, para proyectar sin
  celulares ni sala en vivo. Decidido por etapas: primero este («A»), después el tablero dentro de la sala con todos
  respondiendo desde el celular («B»), y el pulsador («C») solo si el grupo lo pide y tras medir el wifi. En pantalla
  se llama «Tablero»: Jeopardy! es marca registrada. Los equipos responden en voz alta y el presentador marca
  Acertó/Falló (teclas 1–6 y Mayús + número): la app suma o resta, pasa el turno, tiene casilla doble, ronda final con
  apuestas escritas en papel, «Deshacer» por paso, y guarda la partida en `localStorage`. La lógica, sin pantalla ni
  Firebase para reusarla en la sala, está en `app/tablero.js`: columnas por área de `clasificacion` (varios temas
  clasificados), si no por lo que va antes de « · » en `tema` juntando grupos chicos, si no un tema por columna. El
  valor no mide dificultad: el orden sale al azar y el presentador lo cambia. Tras cada casilla, `app/diapositivas.js`
  arma la enseñanza con lo que el caso ya trae: Respuesta (figura y `marcas`), Por qué (la misma figura, fija),
  Compárelo (hasta dos casos parecidos que quedaron fuera del tablero, propuestos por palabras en común y confirmados
  por el presentador) y Clave (la perla). Para no adelantar respuestas, una figura que usa otra casilla sin jugar sale
  sin la lista de marcas, o no sale si es de «respuesta»; y nunca se compara con un caso que comparta figura o
  respuesta con una casilla. Probado de punta a punta en el navegador con ATM 4 × 4, no en un aula.
- Tabú radiológico (2026-10-02): `tabu.html` + `app/tabu.js`, lógica sin pantalla en `app/tabu-logica.js`. Por equipos
  y con un solo aparato que pasa de mano en mano: quien describe ve la figura y el diagnóstico y su equipo lo adivina
  sin oír las prohibidas (las palabras de la respuesta y, hasta cinco, las de `etiquetas` y `tema`). Adivinaron +1,
  Tabú −1, Pasar 0 (2 pases por turno por defecto). Entre turnos, una pantalla sin carta para cambiar de manos; al
  sonar, un repaso con la figura y la primera viñeta de la explicación («Así lo describe la fuente»), donde se corrige
  lo marcado. Carta = caso de imagen con respuesta corta (407 de 498 en `temas/`). Wake Lock y un pitido con WebAudio;
  la partida va en `localStorage` y una recarga en pleno turno vuelve en pausa. La carga de temas del tablero pasó a
  `app/catalogo.js`, compartido. Probado en el navegador (escritorio y 375 px) con ATM + RadCases MSK, no en un aula.
- Supervivencia (2026-10-02): modo de la sala en vivo, «Supervivencia» o «Supervivencia con rescate» al crearla
  (`info.modo`); lógica sin pantalla en `app/supervivencia.js`. Una vida: quien falla o no responde cae
  (`eliminados/<uid>`); si fallan todos los que seguían en pie no cae nadie; gana el último en pie. Casos al azar y
  ordenados por `dificultad`. Con rescate, cada 3 casos uno fácil (`info.rescates`, `estado.rescate`) en que responden
  todos y el eliminado que acierta vuelve (`rescatados/<uid>`, una vez por persona); no hay rescates en el último
  tercio, se salta el que no tiene a quién rescatar y la partida no se da por ganada mientras quede un rescate con
  alguien que pueda volver. Quien entra tras Empezar (`info.empezo`) entra eliminado. Las reglas impiden que un
  eliminado responda fuera de un rescate; se desplegaron el 2026-10-02 y son compatibles con las salas clásicas.
  Probado de punta a punta contra producción con presentador y tres jugadores (caídas, «se salvan todos», rescate,
  entrada tardía, ganador, rechazo de la base) y una sala clásica, no en un aula.
  Vidas (2026-10-05): en Supervivencia con rescate se eligen de 1 a 3 corazones de pixel art (`info.vidas`,
  `fallos/<uid>`, `tocados/<uid>`); cada fallo quita uno y se cae al perder el último; el rescatado vuelve con uno.
  Reglas desplegadas ese día. Probado con dos jugadores y 2 vidas: pierde un corazón, cae, vuelve con uno.
- Ampliar figuras (2026-10-07): `app/ampliar.js` (`activarAmpliacion()`), compartido por práctica, sala, tablero, Tabú y
  estudio; reemplaza el `#zoom` que cada página tenía. Toda imagen con `data-zoom` se abre en negro a pantalla completa:
  un toque o clic acerca 2,5× en ese punto y otro la ajusta (en un doble toque el segundo no cuenta, así que también
  acerca); rueda o pellizco hasta 4× (o el doble de la resolución real); arrastrar la mueve sin despegarla de los
  bordes, con inercia al soltar; barra −/+/Ajustar/✕. Cierran ✕, Esc, un toque en el fondo (acercada, ese toque solo
  la ajusta), deslizarla hacia abajo cuando está ajustada y el botón «atrás» del celular (abre con `pushState`: en la
  sala, «atrás» ya no saca de la sala). En el celular (`pointer: coarse`) va a todo el ancho con botones de 48 px, y de
  costado la barra pasa al borde derecho. Abierta, se queda con el teclado en fase de captura (+, −, 0, flechas), así
  que las teclas del tablero o del Tabú no actúan detrás. Probado en el navegador (escritorio, 375 × 812 y 740 × 360;
  gestos táctiles con eventos simulados), no en un celular real.
  «Ventana» (mismo día): botón de la barra (tecla V) que convierte el arrastre de un dedo en ventana/nivel, como en
  Horos: a los lados el ancho (contraste), arriba y abajo el centro (abajo, más oscura), en grises de 0 a 255 del JPG,
  con «Invertir» (I) y «Restablecer» (R) y la lectura «A · C». El pellizco sigue acercando y, con el modo activo,
  deslizar no cierra. En escritorio el botón derecho ajusta la ventana sin activar el modo. Es un filtro SVG
  (`feComponentTransfer`, en sRGB) y no un canvas, porque las figuras de Drive son de otro dominio y sus píxeles no se
  pueden leer; por lo mismo no hay ventana automática por histograma. Solo reparte los 256 grises del archivo: no
  recupera lo que la ventana original dejó fuera, y no hay ventanas en UH. Cada figura se abre siempre como es (no se
  guarda nada), y en la sala lo que ajusta el presentador solo se ve en el proyector. Es un ajuste de visualización en
  la pantalla de cada uno, no una figura modificada: compatible con las licencias ND. En el celular, − y + no están
  (sobran con pellizco y doble toque) para que quepa la barra.
- Buscador y cuestionarios armados (2026-10-07): la portada busca por texto (diagnóstico, signo, título; sin tildes
  vale) y filtra por segmento y área con cuántos casos hay en cada botón; lo que coincide se practica junto
  (`practica.html?segmento=…&area=…&q=…`, y `&tema=` para un solo tema), se presenta en una sala («Casos de: un
  segmento, un área o una búsqueda» al crearla) o se juega en el tablero (filtro «Solo casos de»). Regla única en
  `app/cuestionario.js` (`coincide()`): el segmento y el área valen en cualquier pareja; las palabras, en etiquetas,
  subtema, respuesta, título y nombres de segmento y área. Decisión del autor: los resultados nunca muestran
  enunciados ni respuestas, solo cuántos casos y en qué temas. Para no bajar todo, cada publicación (estudio y MCP)
  escribe `indice_casos/<tema>` (lectura pública; ~110 KB los 14 temas) y `tools/construir_sitio` lo mismo en
  `temas/indice_casos.json`; vale el de la versión del tema y un tema sin índice se carga entero. En la práctica
  armada cada caso guarda el avance en la clave de su tema (la portada lo cuenta), la tanda va en
  `radquiz.avance.v1:mezcla:<criterio>` y sale mezclada. La sala de varios temas lleva `info.temas` e ids
  `<tema>:<caso>` (`info.casos` hasta 120 caracteres); `info.tema` sigue siendo el primero. Reglas desplegadas el
  2026-10-07. Probado en el navegador (portada, práctica armada con retomar, sala de Tórax con casos de dos temas,
  presentador y un jugador, contra producción; tablero filtrado), no en un aula.
  Clasificación de todos los casos el mismo día: ocho agentes con `INSTRUCCIONES` (pareja principal = segmento del
  tema; en pediatría, `pediatria/<área>` y después el órgano; emergencias por órgano), 1114 casos guardados en el
  estudio con la herramienta MCP nueva `casos_clasificar` (no toca `actualizado`: ATM conserva sus sellos). Se
  agregaron áreas a cardiovascular, pediatría y física y técnica, y `torax/congenitas` y
  `musculoesqueletico/displasias`; mama e intervencionismo siguen sin áreas. Hasta volver a publicar cada tema, la
  web filtra con la clasificación vieja (lo publicado) aunque el índice de casos ya esté al día.
- Puntaje (2026-10-05): 900 por acierto + hasta 100 por rapidez (antes 500 + 500): pesa acertar, no el reflejo.
- Ambiente, rachas, avatares y equipos en la sala (2026-10-05), decididos con el autor como capas 1, 2 y 5 de una lista
  de ideas (las otras: eventos sorpresa como caso relámpago, duelo final y caso jefe; y comodines 50:50, escudo y doble
  o nada, para cuando el grupo pida más). Sonido suave en el proyector (`app/efectos.js`, botón «Sonido»: notas de seno y
  triángulo a volumen bajo; la primera versión, de onda cuadrada y con redoble de ruido, al autor le pareció
  estruendosa), revelado con suspenso, podio con confeti; racha ×1,5 desde el 3.º acierto, 200 a quien acierta solo, datos al revelar y
  títulos al final (`app/premios.js`; `stats/`, `premio/`, `titulos/`); avatares de pixel art de radiología, 10 × 10 (`app/avatares.js`; el
  trébol de radiación se descartó porque a esa resolución parecía una cara; el 2026-10-07 se sumó un segundo grupo,
  «Para reírse», con 12 más: signos con nombre de comida o animal —perrito escocés, panda, colibrí, muñeco de nieve,
  palomitas, hamburguesa, cono de helado, huevo colgado de un hilo— y la guardia —café, artefacto fantasma,
  incidentaloma, residente posguardia—; el lobby los muestra por grupo, `GRUPOS_AVATAR`). Quien no elige avatar
  recibe uno al azar, y quien entra sin nombre, un apodo radiológico al azar que nadie de la sala tenga (`APODOS` y
  `apodoAleatorio()` en `app/avatares.js`, 24 apodos de hasta 24 letras, como piden las reglas); al volver a entrar
  conserva los suyos. Y
  equipos por año o por color con promedio por persona. Reglas desplegadas ese día. Probado contra producción con
  presentador y tres jugadores en una sala clásica por equipos y en una supervivencia, no en un aula.
- Humor y reacciones en la sala (2026-10-07), siete ideas pedidas por el autor de una vez:
  - Frases del proyector al revelar según cómo le fue al grupo (nadie, todos, solo uno, trampa, pocos, muchos,
    dividido; «Correlacionar con la clínica», «kappa = 1»…), mensajes del celular mientras se espera («Midiendo en
    UH…», cambia cada 3 s) y nombres de los equipos por color («Los Hipointensos», «Gadolinio FC»…): listas en
    `app/frases.js`, elegidas de forma estable con una semilla (el número del caso; para los equipos, `info.creada`,
    así todas las pantallas coinciden sin guardar nada). Con una sola respuesta acertada no hay frase.
  - Botón «Otro apodo» en el lobby del celular.
  - Tres títulos más (`app/premios.js`): El Incidentaloma (acertó solo), Segunda lectura (≥ 2 aciertos más en la
    segunda mitad) y Técnicamente limitado (≥ 2 sin responder), con las cuentas nuevas `n`, `h` y `o` en `stats/`.
    Prioridad: los raros y chistosos antes que Ojo de halcón y Constante.
  - El avatar brilla con racha y se ve en gris al caer en supervivencia (`avatarDe()` en `app/sala.js`).
  - Reacciones en vivo (`app/reacciones.js`): seis de pixel art en el celular al revelar, en el ranking y en el final;
    suben flotando por el proyector con el nombre (como mucho 24 a la vez). `reacciones/<uid> = { e, t }`, una por
    persona que se pisa; las reglas piden 1,5 s entre una y otra, que la persona esté en la sala y la fase sea
    revelar, ranking o fin, y solo el presentador las lee. `pixelSrc()` de `app/avatares.js` dibuja avatares y
    reacciones.
  Reglas desplegadas ese día. Probado contra producción con presentador y dos jugadores (sala clásica de 3 equipos y
  6 casos, y una supervivencia), no en un aula.
- Servidor MCP (2026-10-01): `tools/mcp/servidor.mjs`, registrado en `.mcp.json`, para que Claude maneje el estudio en
  línea. Entra con Google como el autor (página en `localhost`, autorizado en Firebase Auth; sin cuenta de servicio),
  así que valen las mismas reglas. Reusa `app/validacion.js`, `app/instrucciones-ia.js` y `app/drive.js`; el ayudante
  `tools/mcp/imagen.swift` (OCR de Vision, tapar y comprimir; solo macOS) se compila solo. Lo que escribe simula por
  defecto; publicar pide que la persona acepte la declaración en el chat; no borra ni verifica. Sesión en
  `~/.config/radquiz-mcp/sesion.json`. Probado contra producción el mismo día, solo lectura y simulaciones. Detalle en
  README.md.
- Avance, dificultad y modo sin alternativas (2026-10-01), para los cuestionarios de 100 casos o más:
  - **Avance de la práctica, solo local** (`app/avance.js`, `localStorage`): una clave por tema con cada respuesta
    —la huella del texto de la opción, no su posición, así que se recalifica si el autor corrige la clave— y la tanda en
    curso, que se retoma al volver. «Cuáles»: los que me faltan (por defecto), todos, los que fallé. La portada muestra
    cuánto lleva cada tema y «Seguir donde lo dejaste». No se exporta ni se sincroniza: decisión del autor. En revisión
    (`?revision=1`) no se guarda.
  - **Modo sin alternativas**: se piensa (o escribe) la respuesta, se revela y uno mismo marca Acerté/Fallé (teclas 1 y
    2). En la práctica y en el tablero («Alternativas»: a pedido —lo de antes—, nunca, siempre); no en la sala en vivo.
    `requiere_opciones: true` marca los enunciados que no se contestan con las opciones tapadas (regla del NBME): salen
    con sus opciones, y el tablero en «nunca» los evita.
  - **Dificultad interna** `dificultad: { nivel 1–4, motivo, por }`, solo por el contenido y la bibliografía —nunca por
    cuántos aciertan: el autor descartó calibrar con datos—, anclada al ETC de la ESR (1 R1, 2 R2, 3 R3/egreso,
    4 subespecialidad; rúbrica en `docs/guia-estilo-ia.md`). El residente no la ve. El tablero ordena con ella las filas
    (`NIVELES_FILA` en `app/tablero.js`), la casilla doble prefiere 3–4 y la final el nivel más alto. Metadato como la
    clasificación: no entra en `contenido()` y no quita el sello. Sin ella cuenta como 2 y el validador solo avisa (y
    avisa si más del 70 % cae en un nivel). Panel «Dificultad y modo sin alternativas» en el paso 3 del estudio;
    herramienta MCP `casos_dificultad`; las instrucciones para la IA la piden siempre.
  - El 2026-10-01 se asignó a los 1016 casos de los 13 temas del autor (siete agentes con la rúbrica), y ese mismo día
    se desplegó la web (`38ae714`) y se volvieron a publicar 11 temas; ATM conservó sus 27 sellos. Notas de casos
    dudosos y errores de contenido en `referencia/revision-dificultad-2026-10-01.md` (local).
- Manual de uso por papel: `manual.html`, en línea. Camino con Git (alternativo):
  `tools/aprobar <carpeta> --revisor <usuario> --todos|--casos a,b [--estado publicado]`.
- `referencia/` y `PROMPT_INICIO.md` están en `.gitignore`: solo locales (el respaldo del piloto tiene recortes ND).
- Herramientas: `gh` está en `~/.local/bin/gh` (no en el PATH); `firebase` global vía npm.

## Pendiente
1. **Poner el secreto de Firebase en GitHub.** Sin él, `reglas.yml` y `publicar.yml` terminan en verde pero solo
   avisan: ni las reglas ni la web se despliegan solas, y hay que hacerlo a mano (`tools/desplegar reglas`,
   `tools/desplegar web`) desde una terminal con la sesión de la CLI iniciada. Las reglas en línea están al día a
   2026-10-07 (`indice_casos` y salas de varios temas) y la web a 2026-10-07 (desplegada con el código de `47ba2f8`: buscador y cuestionarios por segmento, área o búsqueda). Ojo: `tools/desplegar web` arma el sitio desde la carpeta de trabajo, con lo que haya
   sin commit; hay que desplegar con la carpeta limpia o desde una copia de `main` (`git worktree add … origin/main`).
   `tools/desplegar` es el mismo comando que corren los workflows. Necesita, en variables de entorno o en
   secretos: `FIREBASE_SERVICE_ACCOUNT` (JSON —tal cual o en base64— de una cuenta de servicio con los papeles
   «Firebase Realtime Database Admin» y «Firebase Hosting Admin»; **no** «Firebase Rules Admin», que es de
   Firestore y Storage) o `FIREBASE_TOKEN` (de `firebase login:ci`). Caminos:
   - Sin nada de eso: `tools/desplegar reglas|web` en una terminal con sesión iniciada, o pegar
     `database.rules.json` en la consola de Firebase.
   - En GitHub: el secreto en Settings → Secrets and variables → Actions. `reglas.yml` despliega las reglas en
     cada cambio de `database.rules.json`; `publicar.yml`, la web en cada push a `main`.
   - Desde una sesión de Claude Code en la web: además del secreto como variable de entorno del entorno,
     **la política de red tiene que permitir `*.firebaseio.com`**. Las reglas se escriben en
     `<instancia>.firebaseio.com/.settings/rules.json`, no en `googleapis.com`, así que sin ese dominio
     no hay despliegue por mucha credencial que haya. `tools/desplegar reglas --ver` lo diagnostica.
2. Que un segundo radiólogo mire el tema ATM. Ya está verificado, pero por su propio autor, y el sello dice quién
   lo puso. De paso quedan cuatro fichas con `plano`/`secuencia` en `null` porque la leyenda no lo dice, y sus
   `notas` piden confirmarlo mirando la imagen: Fig. 8 (¿T2 con supresión grasa?), Fig. 12 (¿sagital oblicuo?),
   Fig. 13 (¿coronal o sagital?) y Fig. 14. Dejarlas en `null` es correcto mientras nadie las confirme: el
   validador no se queja.
3. Probar la red de HNERM antes del ensayo con 3 colegas. Desde el Mac del autor ya pasa Firebase (ver arriba);
   falta abrir https://radquiz-shpn2.firebaseapp.com en la **PC que proyecta** y entrar a una sala desde un celular en el
   wifi del hospital. El 2026-10-06, desde el Mac del autor en la red de EsSalud, pasó todo: portada, práctica con
   figuras de Drive (`lh3.googleusercontent.com` y el respaldo de `www.googleapis.com`), auth anónima y una sala por
   WebSocket con un jugador que entró y se vio al instante. **`radquiz-shpn2.web.app` está bloqueado** (conecta y el
   filtro corta el TLS: va por nombre, no por IP); `firebaseapp.com`, la dirección oficial, pasa. GitHub sigue cortado.
4. Decidir la licencia del código y la de los textos propios.
5. Volver a publicar los temas para que la web use la clasificación del 2026-10-07 y tengan `indice_casos` (hecha en el
   estudio, no publicada). `iip-hrct-dixon2010` e `ila-radiographics-hata2022` esperan al pendiente 11. Que un
   radiólogo mire los casos dudosos de la clasificación (las notas de los agentes quedaron fuera del repositorio):
   criterio de pediatría por edad o por entidad, y casos sin área exacta (pares craneales en neuro, tumores torácicos
   no pulmonares, pierna en MSK).
6. Clasificación, lo que falta: áreas para mama e intervencionismo cuando haya casos.
7. `meniscos-rm-nguyen2014` no pasa el validador (visto el 2026-09-24): dice CC BY-NC-ND 4.0, pero la frase de
   `verificacion.donde` es el aviso de RSNA «personal non-commercial use only», y sus 14 figuras están en `img/` de este
   repositorio público. Si la licencia es «Con copyright», hay que corregirla en el estudio y volver a publicar: las
   figuras pasan al Drive de quien publica y salen de `temas/`, aunque siguen en el historial de Git.
8. Tablero, etapa B: el tablero dentro de la sala en vivo, con todos respondiendo desde el celular. Hay que cambiar
   las reglas de `salas/` (fases `tablero` y `apuesta`, turno, casillas usadas, apuestas, puntajes negativos: hoy
   `puntajes` exige `>= 0`); las salas ya admiten varios temas (`info.temas`). La lógica de
   `app/tablero.js` y `app/diapositivas.js` ya sirve para la sala. Etapa C (pulsador): solo tras medir la latencia de
   4 o 5 celulares en el wifi de HNERM.
9. Perlas: 43 de los 67 casos publicados no tienen (ATM 23 de 27, tobillo 20 de 20), y sin perla el tablero no
   muestra la diapositiva «Clave». Desde el 2026-09-27 las instrucciones para la IA la piden siempre; el esquema la
   sigue dejando opcional y el validador no la exige (un error dejaría fuera temas enteros en `traer_publicaciones`).
   Completarlas en ATM le quita el sello a esos casos (editar y volver a publicar lo retira): mejor junto con la
   revisión del segundo radiólogo (pendiente 2).
10. En la sala clásica, una figura de «respuesta» que comparten varios casos se ve al revelar el primero: la Tabla 1
    de Protocolo muestra la orientación de los cortes que pregunta Planificación. El tablero ya lo evita; la sala no.
    Desde el 2026-09-30 los prompts piden que una figura vaya en la respuesta de un solo caso y el comprobador del
    .zip lo avisa, pero los temas ya publicados siguen igual.

11. `iip-hrct-dixon2010` e `ila-radiographics-hata2022` tienen la dificultad en el estudio pero no publicada: no se
    pueden volver a publicar hasta corregir su licencia (dicen CC BY-NC-ND y la frase de la verificación no lo dice;
    mismo caso que el pendiente 7). Revisar también los errores de contenido de la nota de dificultad (cadera sobre
    todo).
12. Ids definitivos para los siete RadCases (`book-id`, `book-id-2-2-…`): el avance guardado usa el id del tema, así que
    renombrarlos después borra el avance de todos. Renombrar es crear el tema con el id nuevo y borrar el viejo.

## Preferencias del autor (Pavel, residente de radiología)
- Interfaz y contenido en español.
- Referencias reales y verificadas una por una, con DOI cuando lo tienen (desde el 2026-09-30 el DOI es opcional:
  hay fuentes buenas sin él, y un artículo sin DOI solo da aviso).
- Revisión autocrítica: señalar cada vacío con su corrección concreta.
