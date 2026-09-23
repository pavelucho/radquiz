# RadQuiz — plataforma de casos radiológicos en vivo

Plan completo (fuente de verdad): https://claude.ai/code/artifact/acd19a8f-ec5a-43e9-aff2-1f140586da61

## Qué es
Web tipo Kahoot, gratuita, para residentes de radiología (HNERM / UNMSM). El presentador proyecta; los
residentes entran desde el celular con un código de sala de 4 letras + nombre, sin cuentas ni app.
Modos v1: sesión en vivo y práctica individual. Todos los segmentos de la radiología.

## Arquitectura (decidida)
- Un repositorio en GitHub: app + temas + imágenes. Publicado con GitHub Pages.
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

## Estado actual (2026-09-20)
- Fase 0 terminada: `schema/`, `tools/validar` (sin dependencias), `docs/guia-estilo-ia.md`, skill
  `.claude/skills/crear-casos-radquiz`, CI en `.github/workflows/validar.yml`.
- `temas/cabeza-cuello/atm-rm-lopezramirez2024/`: 27 casos y 17 imágenes, versión 0.2.0, pasa el validador sin
  errores ni avisos. Publicado y **verificado el 2026-09-20**: los 27 casos llevan el sello de `pluna` (Pavel Luna),
  que es además el autor —el modelo lo permite, y el manual recomienda que un segundo radiólogo lo mire—. Es el
  único tema del repositorio. `REVISION.md` guarda qué cambió al pasar al formato nuevo.
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
- En línea: repositorio público `pavelucho/radquiz`, web en https://pavelucho.github.io/radquiz/ (GitHub Pages).
  `tools/construir_sitio` + `.github/workflows/publicar.yml`: solo los casos `publicado` salen a la web (decisión del
  autor: nunca borradores en la web).
- **La red del hospital bloquea GitHub por IP** (github.com y github.io: el DNS resuelve, la conexión al 443 se
  corta; un dominio propio apuntado a GitHub Pages tampoco pasaría). Firebase sí pasa: base con WebSocket, gstatic,
  identitytoolkit y Hosting. Medido el 2026-09-21 desde el Mac del autor, sin acceso a GitHub en ese momento.
  Por eso hay una copia del sitio en **Firebase Hosting**: https://radquiz-shpn2.web.app (también
  `radquiz-shpn2.firebaseapp.com`), el mismo `_site`, para proyectar desde las PC del hospital. Se despliega **a
  mano** con `tools/construir_sitio && firebase deploy --only hosting` (primera vez el 2026-09-21; portada,
  práctica, sala y estudio probados ahí). El QR y la dirección del lobby salen de `location`, así que los
  residentes entran por el mismo dominio que el presentador. Lo publicado en el estudio aparece al instante en
  las dos webs; redesplegar solo hace falta cuando cambian el código o los temas del repositorio.
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
- La sala y los reportes usan una instancia de Firebase aparte (`APP_ANONIMA`): su sesión anónima no pisa la de
  Google del estudio en el mismo navegador (antes, abrir la sala cerraba la sesión del estudio, y entrar al
  estudio le quitaba el control de la sala al presentador).
- Un cuestionario entero cabe en un `.zip` con la forma de una carpeta de `temas/` (`paquete.json`, `fuentes.json`,
  `img/`): «Subir un .zip» en la portada del estudio y «Descargar .zip» en el paso 4. `app/zip.js` lo lee y lo arma
  sin librerías (`DecompressionStream`; al escribir, guardado sin comprimir), `app/importar.js` lo convierte con
  `dePaquete()` —el inverso de `aPaquete()`— y `instruccionesPaquete()` da el texto para que una IA con ejecución
  de código lo arme desde el PDF. Lo importado entra siempre como borrador y se enseñan las figuras antes de crear
  nada: una IA puede partir una figura en paneles, y las licencias ND no lo permiten.
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
1. **Poner el secreto de Firebase en GitHub.** Las reglas están desplegadas: el 2026-09-20 se corrió
   `firebase deploy --only database` a mano desde la máquina del autor, con la sesión de la CLI ya iniciada, e
   incluyen ya lo que hace falta para borrar un tema publicado. Pero el workflow `reglas.yml` sigue **sin
   credencial**: termina en verde y solo avisa, así que el próximo cambio de `database.rules.json` tampoco se
   desplegará solo y habrá que repetir el comando a mano.
   Comprobado tras el despliegue: `indice_publicado`, `publicacion` y `verificacion` se leen sin sesión (HTTP
   200) y `estudio` sigue cerrado (401). `indice_publicado` está vacío porque el estudio nunca pudo escribirlo;
   se llenará en la próxima publicación, y hasta entonces la web se apaña con `temas/indice.json`.
   `tools/desplegar_reglas` lo hace sin sesión
   interactiva, y es el mismo comando que corre el workflow. Necesita, en variables de entorno o en secretos:
   `FIREBASE_SERVICE_ACCOUNT` (JSON —tal cual o en base64— de una cuenta de servicio con el papel «Firebase
   Realtime Database Admin»; **no** «Firebase Rules Admin», que es de Firestore y Storage) o `FIREBASE_TOKEN`
   (de `firebase login:ci`). Caminos:
   - Sin nada de eso: pegar `database.rules.json` en la consola de Firebase y publicar; o
     `firebase deploy --only database` en una terminal con sesión iniciada.
   - En GitHub: el secreto en Settings → Secrets and variables → Actions. `.github/workflows/reglas.yml`
     despliega en cada cambio de `database.rules.json`; sin secreto solo avisa, no falla.
   - Con el secreto puesto conviene que `publicar.yml` despliegue también Firebase Hosting (hoy es a mano); la
     cuenta de servicio necesitaría además el papel «Firebase Hosting Admin».
   - Desde una sesión de Claude Code en la web: además del secreto como variable de entorno del entorno,
     **la política de red tiene que permitir `*.firebaseio.com`**. Las reglas se escriben en
     `<instancia>.firebaseio.com/.settings/rules.json`, no en `googleapis.com`, así que sin ese dominio
     no hay despliegue por mucha credencial que haya. `tools/desplegar_reglas --ver` lo diagnostica.
2. Que un segundo radiólogo mire el tema ATM. Ya está verificado, pero por su propio autor, y el sello dice quién
   lo puso. De paso quedan cuatro fichas con `plano`/`secuencia` en `null` porque la leyenda no lo dice, y sus
   `notas` piden confirmarlo mirando la imagen: Fig. 8 (¿T2 con supresión grasa?), Fig. 12 (¿sagital oblicuo?),
   Fig. 13 (¿coronal o sagital?) y Fig. 14. Dejarlas en `null` es correcto mientras nadie las confirme: el
   validador no se queja.
3. Probar la red de HNERM antes del ensayo con 3 colegas. Desde el Mac del autor ya pasa Firebase (ver arriba);
   falta abrir https://radquiz-shpn2.web.app en la **PC que proyecta** y entrar a una sala desde un celular en el
   wifi del hospital. Con las figuras en Drive hay que comprobar también que pasa `www.googleapis.com` (la web
   pide ahí cada figura). Si la copia de Firebase Hosting se queda atrás del repositorio, los temas que falten
   salen igual desde la base: redesplegarla tras cada `git pull`.
4. Decidir la licencia del código y la de los textos propios.

## Preferencias del autor (Pavel, residente de radiología)
- Interfaz y contenido en español.
- Referencias reales y verificadas una por una, siempre con DOI.
- Revisión autocrítica: señalar cada vacío con su corrección concreta.
