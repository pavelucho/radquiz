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
  `app/areas.js` (lo que sigue a `AREAS =` es JSON estricto: `tools/validar` lee ese archivo). Hay áreas para neuro,
  cabeza y cuello, tórax, abdomen, genitourinario y MSK; los otros cinco segmentos todavía no tienen, y se agregan
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
  hospital puede no dejar salir— modo byte, corrección M, versiones 1 a 10.
- En línea: repositorio público `pavelucho/radquiz` y **una sola web, en Firebase Hosting**:
  https://radquiz-shpn2.web.app (también `radquiz-shpn2.firebaseapp.com`). Solo los casos `publicado` salen a la
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
  artículo: el estudio acredita todas las figuras a una sola fuente). La web todavía no usa la clasificación.
- DOI opcional (2026-09-30): el paso 1 del estudio pide el tipo de fuente (artículo, página web o sitio educativo,
  caso de un banco, libro; `TIPOS_FUENTE` en `app/validacion.js`) y el DOI «si tiene». Un DOI escrito tiene que ser
  válido; un artículo sin DOI da aviso, nunca error (estudio, `tools/validar` y comprobador del .zip). Sin DOI, la web
  enlaza a `url`. Antes, `dePaquete()` y `guardarFuente()` dejaban toda fuente como `articulo` y exigían DOI, y
  páginas como The Radiology Assistant no se podían publicar.
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
  Ideas siguientes, ya planeadas con el autor: Supervivencia y Supervivencia con rescate en la sala en vivo (una vida;
  si fallan todos no cae nadie; rescate cada 3 casos, uno por persona y no en el último tercio; responden todos), que
  piden cambiar las reglas de `salas/`.
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
   2026-09-23 y la web a 2026-10-02 (desplegada con el código de `bdc51db`, el Tabú). Ojo: `tools/desplegar web` arma el sitio desde la carpeta de trabajo, con lo que haya
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
   falta abrir https://radquiz-shpn2.web.app en la **PC que proyecta** y entrar a una sala desde un celular en el
   wifi del hospital. Con las figuras en Drive hay que comprobar también que pasan `lh3.googleusercontent.com` (la web
   pide ahí cada figura) y `www.googleapis.com` (el respaldo).
4. Decidir la licencia del código y la de los textos propios.
5. Clasificar los tres temas publicados con el panel «Clasificación» y volver a publicarlos (hoy dan el aviso «sin
   área»): ATM → cabeza-cuello/atm; meniscos → musculoesqueletico/rodilla; tobillo → musculoesqueletico/tobillo-pie,
   más lo que corresponda caso por caso.
6. Fase 2 de la clasificación: filtros por segmento y área en la práctica, salas por segmento que mezclen temas y
   conteos en la portada. Hace falta contar por segmento en `indice_publicado` e `indice.json`, y cambiar las reglas
   de `salas/` para que una sala tenga varios temas.
7. `meniscos-rm-nguyen2014` no pasa el validador (visto el 2026-09-24): dice CC BY-NC-ND 4.0, pero la frase de
   `verificacion.donde` es el aviso de RSNA «personal non-commercial use only», y sus 14 figuras están en `img/` de este
   repositorio público. Si la licencia es «Con copyright», hay que corregirla en el estudio y volver a publicar: las
   figuras pasan al Drive de quien publica y salen de `temas/`, aunque siguen en el historial de Git.
8. Tablero, etapa B: el tablero dentro de la sala en vivo, con todos respondiendo desde el celular. Hay que cambiar
   las reglas de `salas/` (fases `tablero` y `apuesta`, turno, casillas usadas, apuestas, puntajes negativos: hoy
   `puntajes` exige `>= 0`) y conviene hacerlo junto con las salas de varios temas del pendiente 6. La lógica de
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
