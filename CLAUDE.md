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
4. Nada se publica sin revisión de un radiólogo. Estados: borrador → revisado → publicado. La app solo muestra publicados.
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
- La validación depende del estado: en borrador lo pendiente es aviso; en revisado/publicado es error.
- La app baraja las opciones; id global = `<paquete>/<caso>`.

## Estado actual (2026-09-19)
- Fase 0 terminada: `schema/`, `tools/validar` (sin dependencias), `docs/guia-estilo-ia.md`, skill
  `.claude/skills/crear-casos-radquiz`, CI en `.github/workflows/validar.yml`.
- `temas/cabeza-cuello/atm-rm-lopezramirez2024/`: 27 casos y 17 imágenes, pasa el validador sin errores ni avisos.
  Todos en borrador. `REVISION.md` lista los cambios y lo que el revisor debe confirmar (Fig. 8, 12, 13, 14).
  Licencia verificada: CC BY-NC-ND 4.0 (PDF en español, p. 136). Respaldo del original en `referencia/piloto-original/`.
- App estática de práctica: `index.html` + `practica.html` (+ `?revision=1` = previsualizador para revisores).
  Probar con `python3 -m http.server`. Necesita `temas/indice.json` (`tools/validar --indice`).
- Sala en vivo: `sala.html` + `app/sala.js`, Firebase Realtime Database (proyecto `radquiz-shpn2`, plan Spark,
  us-central1) con auth anónima y reglas en `database.rules.json`. Probada de punta a punta el 2026-09-19.
- En línea: repositorio público `pavelucho/radquiz`, web en https://pavelucho.github.io/radquiz/ (GitHub Pages).
  `tools/construir_sitio` + `.github/workflows/publicar.yml`: solo los casos `publicado` salen a la web (decisión del
  autor: nunca borradores en la web).
- Estudio web (`estudio.html` + `app/estudio.js`): autores, revisores y coordinador trabajan desde el navegador,
  con cuenta de Google y papeles en `usuarios/`. Los casos se generan con **cualquier IA** (el estudio arma el
  texto para copiar y lee la respuesta JSON); no depende de Claude ni de ningún proveedor.
  Publicar = el coordinador escribe en `publicacion/`; `tools/traer_publicaciones` lo baja al repositorio cada 15
  minutos desde el workflow. Validación en el navegador: `app/validacion.js` (espejo de `tools/validar`).
- Manual de uso por papel: `manual.html`, en línea. Camino con Git (alternativo):
  `tools/aprobar <carpeta> --revisor <usuario> --todos|--casos a,b [--estado publicado]`.
- `referencia/` y `PROMPT_INICIO.md` están en `.gitignore`: solo locales (el respaldo del piloto tiene recortes ND).
- Herramientas: `gh` está en `~/.local/bin/gh` (no en el PATH); `firebase` global vía npm.

## Pendiente
1. Nombrar al radiólogo revisor del tema ATM. Hasta que publique casos, la web muestra el tema «En revisión» y la
   sala en vivo no tiene casos en línea.
2. Probar la red de HNERM (WebSocket a Firebase) antes del ensayo con 3 colegas.
3. Decidir la licencia del código y la de los textos propios.

## Preferencias del autor (Pavel, residente de radiología)
- Interfaz y contenido en español.
- Referencias reales y verificadas una por una, siempre con DOI.
- Revisión autocrítica: señalar cada vacío con su corrección concreta.
