---
name: crear-casos-radquiz
description: Arma o corrige un paquete de casos de RadQuiz (temas/<segmento>/<tema>/) a partir de un artículo open access o un caso de un banco público. Usar cuando pidan crear casos, preguntas o un tema nuevo para RadQuiz, o revisar un paquete existente.
---

# Crear casos de RadQuiz

1. Leer `docs/guia-estilo-ia.md` completa antes de escribir nada. Sus reglas de la sección 1 no se negocian.
2. Leer la fuente entera. Confirmar la licencia en la propia fuente y copiar la frase exacta en
   `fuentes.json` → `verificacion.donde`. Si la licencia no permite uso educativo sin fines de lucro, detenerse y avisar.
   Nunca usar StatDx, RadPrimer, IMAIOS ni material con copyright.
3. Armar el catálogo de imágenes: una ficha por figura, con la leyenda textual en el idioma de la fuente. Lo que la
   leyenda no dice va en `null`; las dudas, en `notas`. Figuras ND: no recortar ni anotar.
4. Escribir los casos en estado `borrador`, cada uno con `evidencia` textual. Sin datos clínicos que no estén en la
   leyenda. Opciones homogéneas: la correcta no debe ser la más larga.
   Cada caso con su `clasificacion`: una o más parejas segmento → área de `app/areas.js`, la principal primero
   (sección 3 de la guía). Si ninguna área encaja, la pareja va sin área y se avisa: no se inventan áreas.
5. Correr `tools/validar <carpeta>` y corregir hasta que no haya errores. Leer cada aviso.
6. Entregar un `REVISION.md` con lo que el revisor debe confirmar. No marcar casos como revisados ni publicados.
