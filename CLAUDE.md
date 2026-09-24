# RadQuiz — plataforma de casos radiológicos en vivo

Plan completo (fuente de verdad): https://claude.ai/code/artifact/acd19a8f-ec5a-43e9-aff2-1f140586da61

## Qué es
Web tipo Kahoot, gratuita, para residentes de radiología (HNERM / UNMSM). El presentador proyecta; los
residentes entran desde el celular con un código de sala de 4 letras + nombre, sin cuentas ni app.
Modos v1: sesión en vivo y práctica individual. Todos los segmentos de la radiología.

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
  En la cabecera, «Casos» elige el tamaño de la tanda (todos, 5, 10, 15, 20, 30, 50): los toma al azar pero los deja
  en el orden del tema, y cambiarlo —o «Empezar de nuevo»— arma otra tanda.
  Probar con `python3 -m http.server`. Necesita `temas/indice.json` (`tools/validar --indice`).
- Al crear una sala se elige también «Cuántos casos»; con «Mezclar» la tanda sale al azar y sin mezclar son los
  primeros del tema. El desplegable y su nota se rehacen según el tema y los filtros (`opcionesTanda` en `app/comun.js`,
  compartido con la práctica).
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
  las reglas la exigen. La web pide cada figura a `www.googleapis.com/drive/v3/files/<id>?alt=media` con
  `claveDrive`: en Google Cloud la API de Drive tiene que estar habilitada y permitida en esa clave.
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
- Carga masiva (2026-09-24): no hay tope de casos. En el paso 3, el panel «Clasificación» resume cuántos casos hay en
  cada segmento → área y agrega o quita una pareja a los casos marcados de una vez; cambiar la clasificación (ahí o
  en el formulario) no toca `actualizado` del caso y no retira el sello. Una respuesta de IA cortada se rescata
  (`rescatar()` en `app/instrucciones-ia.js`): se cargan los casos enteros y el estudio da el pedido para que siga;
  las instrucciones piden `"faltan": true` si no caben todos. Un `.zip` con más de una fuente se rechaza (uno por
  artículo: el estudio acredita todas las figuras a una sola fuente). La web todavía no usa la clasificación.
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
- Manual de uso por papel: `manual.html`, en línea. Camino con Git (alternativo):
  `tools/aprobar <carpeta> --revisor <usuario> --todos|--casos a,b [--estado publicado]`.
- `referencia/` y `PROMPT_INICIO.md` están en `.gitignore`: solo locales (el respaldo del piloto tiene recortes ND).
- Herramientas: `gh` está en `~/.local/bin/gh` (no en el PATH); `firebase` global vía npm.

## Pendiente
1. **Poner el secreto de Firebase en GitHub.** Sin él, `reglas.yml` y `publicar.yml` terminan en verde pero solo
   avisan: ni las reglas ni la web se despliegan solas, y hay que hacerlo a mano (`tools/desplegar reglas`,
   `tools/desplegar web`) desde una terminal con la sesión de la CLI iniciada. Las reglas y la web en línea están
   al día a 2026-09-23 (desplegadas así).
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
   wifi del hospital. Con las figuras en Drive hay que comprobar también que pasa `www.googleapis.com` (la web
   pide ahí cada figura).
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

## Preferencias del autor (Pavel, residente de radiología)
- Interfaz y contenido en español.
- Referencias reales y verificadas una por una, siempre con DOI.
- Revisión autocrítica: señalar cada vacío con su corrección concreta.
