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

## Estado actual (2026-09-19)
- Fase 0 terminada: `schema/`, `tools/validar` (sin dependencias), `docs/guia-estilo-ia.md`, skill
  `.claude/skills/crear-casos-radquiz`, CI en `.github/workflows/validar.yml`.
- `temas/cabeza-cuello/atm-rm-lopezramirez2024/`: 27 casos y 17 imágenes, pasa el validador sin errores ni avisos.
  Publicados el 2026-09-20 (sin sello de verificado). `REVISION.md` lista los cambios y lo que el revisor debe
  confirmar antes del sello (Fig. 8, 12, 13, 14).
  Licencia verificada: CC BY-NC-ND 4.0 (PDF en español, p. 136). Respaldo del original en `referencia/piloto-original/`.
- App estática de práctica: `index.html` + `practica.html` (+ `?revision=1` = previsualizador para revisores).
  Probar con `python3 -m http.server`. Necesita `temas/indice.json` (`tools/validar --indice`).
- Sala en vivo: `sala.html` + `app/sala.js`, Firebase Realtime Database (proyecto `radquiz-shpn2`, plan Spark,
  us-central1) con auth anónima y reglas en `database.rules.json`. Probada de punta a punta el 2026-09-19.
  El lobby del presentador muestra, junto al código, un QR del enlace `sala.html?c=<código>` (se escanea y se
  entra con el código puesto). Lo dibuja `app/qr.js`, generador propio sin dependencias ni CDN —la red del
  hospital puede no dejar salir— modo byte, corrección M, versiones 1 a 10.
- En línea: repositorio público `pavelucho/radquiz`, web en https://pavelucho.github.io/radquiz/ (GitHub Pages).
  `tools/construir_sitio` + `.github/workflows/publicar.yml`: solo los casos `publicado` salen a la web (decisión del
  autor: nunca borradores en la web).
- Estudio web (`estudio.html` + `app/estudio.js`): quien entra con Google queda de alta como autor solo
  (`usuarios/`); «revisor» y «coordinador» los da el coordinador. Publicar es directo; verificar es posterior
  (`verificacion/`), lo hace cualquier revisor sobre cualquier caso publicado —incluidos los suyos, con el botón
  «Verificar casos»— y se retira solo si el autor edita y vuelve a publicar. Los reportes de error de la web (`reportes/`) ponen el caso primero en la cola. Los casos se generan con **cualquier IA** (el estudio arma el
  texto para copiar y lee la respuesta JSON); no depende de Claude ni de ningún proveedor.
  Publicar escribe `publicacion/`, `publicacion_img/` e `indice_publicado/`. Validación en el navegador:
  `app/validacion.js` (espejo de `tools/validar`).
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
- Publicar es instantáneo: `app/publicado.js` lee por REST los nodos públicos `indice_publicado`, `publicacion`,
  `publicacion_img` y `verificacion`, y la portada, la práctica y la sala los fusionan con `temas/indice.json`.
  Gana el estudio cuando su versión no coincide con la del sitio; si coinciden, se usan los archivos del sitio
  (CDN, más ligeros que las imágenes en base64). Si la base no responde, la web sigue con lo del sitio.
  `tools/traer_publicaciones` baja lo mismo al repositorio por su cuenta, desde el workflow.
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
   - Desde una sesión de Claude Code en la web: además del secreto como variable de entorno del entorno,
     **la política de red tiene que permitir `*.firebaseio.com`**. Las reglas se escriben en
     `<instancia>.firebaseio.com/.settings/rules.json`, no en `googleapis.com`, así que sin ese dominio
     no hay despliegue por mucha credencial que haya. `tools/desplegar_reglas --ver` lo diagnostica.
2. Ponerle el sello de verificado al tema ATM: confirmar Fig. 8, 12, 13 y 14 contra el PDF y correr
   `tools/aprobar temas/cabeza-cuello/atm-rm-lopezramirez2024 --revisor <usuario> --nombre "<nombre>" --todos`.
   Mientras tanto los 27 casos se practican en la web y salen como «Sin verificar».
3. Probar la red de HNERM (WebSocket a Firebase) antes del ensayo con 3 colegas.
4. Decidir la licencia del código y la de los textos propios.

## Preferencias del autor (Pavel, residente de radiología)
- Interfaz y contenido en español.
- Referencias reales y verificadas una por una, siempre con DOI.
- Revisión autocrítica: señalar cada vacío con su corrección concreta.
