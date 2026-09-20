# Revisión del paquete ATM (versión 0.2.0)

Este paquete pasó al formato nuevo el 2026-09-19 y se publicó el 2026-09-20. **Los 27 casos están verificados**
desde ese mismo día, con el sello de `pluna` (Pavel Luna), que es también su autor: el modelo lo permite y el sello
siempre dice quién lo puso, pero conviene que un segundo radiólogo lo mire. El original quedó en
`referencia/piloto-original/` para comparar.

Publicar y verificar son pasos distintos. Si alguien edita un caso y lo vuelve a publicar, su sello se retira solo y
vuelve a la cola de revisión.

Cada respuesta correcta se contrastó con el PDF en español del artículo. Las 27 claves eran correctas; los cambios son
de redacción, de datos no sustentados y de formato. Cada frase de `evidencia` y cada `leyenda_original` se comprobó
automáticamente contra el texto del PDF.

## Qué cambió en todo el paquete

- **Licencia confirmada:** CC BY-NC-ND 4.0, © 2024 Sociedad Chilena de Radiología / Permanyer (PDF en español, p. 136).
- **Tabla 1 entera** (`img/tabla1.jpg`) en lugar de dos recortes, porque la licencia ND no permite recortar. Como su
  texto contiene las respuestas de atm-01 a atm-03, se muestra solo en la respuesta.
- **Fichas técnicas en un catálogo:** 17 fichas (antes, 29 copias). Cada una con la leyenda textual. Lo que la leyenda
  no dice quedó en `null`, y las dudas, en `notas`.
- **`evidencia` en cada caso:** página y frase textual del artículo.
- **Markdown en vez de HTML** en enunciados, explicaciones y perlas.
- **Opciones reequilibradas:** la correcta era la opción más larga en 18 de 27 casos; ahora en ninguno.

## Cambios por caso

| Caso | Cambio | Por qué |
| --- | --- | --- |
| atm-01 | Tipo concepto; Tabla 1 en la respuesta; opciones reescritas; perla sin «no desde la encía» | La tabla daba la respuesta; la perla agregaba algo que la fuente no dice |
| atm-02 | Tipo concepto; se quitó la frase sobre la convergencia de los cóndilos | No está en la fuente |
| atm-03 | Tipo concepto; opción correcta acortada | Era la más larga |
| atm-04 | Se quitó «la más gruesa» de la banda posterior | La fuente dice triangular y centrada en el ápex |
| atm-05 | Términos de la leyenda (capa retrodiscal superior e inferior); «rotura» en vez de «rotura/fibrosis» | La fuente habla de rotura como signo de TTM |
| atm-06 | Enunciado sin «se relaciona con la banda anterior»; «contribuye» en vez de «inicia» la apertura | El enunciado daba una pista; la fuente dice «contribuye» |
| atm-07 | Opciones reequilibradas | La correcta era la más larga |
| atm-08 | Se quitó rotación y traslación por compartimento; opciones reequilibradas | No está en la fuente |
| atm-09 | Se quitó «mujer de 34 años con chasquido y dolor»; «típicamente lateral» cambiado por «anterolateral» | La leyenda no trae datos clínicos; la fuente dice anterolateral |
| atm-10 | Redacción de opciones | Estructura homogénea |
| atm-11 | Enunciado sin «medial a la cabeza condilar»; se quitó «pasan desapercibidos en sagital» | Delataba la respuesta; no está en la fuente |
| atm-12 | Enunciado sin «lateral a la cabeza condilar» | Delataba la respuesta |
| atm-13 | Se quitó «paciente con click de apertura» | No está en la leyenda |
| atm-14 | Se quitó «paciente con limitación de apertura» | No está en la leyenda |
| atm-15 | Tipo concepto, sin imagen; opciones reequilibradas (la correcta tenía 160 caracteres) | Imagen decorativa; la correcta era evidente por su largo |
| atm-16 | Se quitaron «T2 con saturación grasa» y «dolor articular» del enunciado | La leyenda no indica secuencia ni síntomas |
| atm-17 | Opciones reequilibradas | La correcta era la más larga |
| atm-18 | Se quitó «68 años»; la perla sobre CPPD sigue la frase de la fuente | La leyenda no trae edad; la fuente dice «compromiso erosivo del disco», no «o con afectación erosiva» |
| atm-19 | Tipo concepto, sin imagen; se quitó «42 años»; enunciado según la fuente | La imagen era de otro paciente y la edad era inventada |
| atm-20 | Tipo concepto, sin imagen | Mostraba una RM para una pregunta sobre TC |
| atm-21 | Opciones reequilibradas (la correcta tenía 142 caracteres) | La correcta era evidente por su largo |
| atm-22 | Enunciado sin la leyenda copiada; opciones nuevas | El enunciado contaba casi todo el diagnóstico |
| atm-23 | Se quitó «asimetría facial progresiva» del enunciado | La fuente la describe en general, no para este paciente |
| atm-24 | Se quitó «corte sagital» del enunciado | La leyenda no dice el plano y la imagen parece coronal |
| atm-25 | Se quitó «dolor unilateral inespecífico» del enunciado | La fuente lo describe en general, no para este paciente |
| atm-26 | Opciones reequilibradas (la correcta tenía 102 caracteres) | La correcta era evidente por su largo |
| atm-27 | Tipo concepto, sin imágenes; opciones con las mismas cuatro etapas | Las imágenes eran decorativas; la correcta era la más larga |

## Lo que sigue abierto

El sello ya está puesto, pero estas fichas siguen con `plano` o `secuencia` en `null` porque la leyenda del artículo
no lo dice. Dejarlas así es correcto —el validador no se queja— y sus `notas` guardan la duda; solo se completan si
un radiólogo lo puede afirmar mirando la imagen:

- **Fig. 8:** ¿es T2 con supresión grasa? Si sí, completar `secuencia` en la ficha y, si sirve, en el enunciado de atm-16.
- **Fig. 12:** ¿el plano es sagital oblicuo? ¿Se puede diagnosticar hipoplasia viendo una sola ATM (atm-23)?
- **Fig. 13:** ¿es coronal o sagital? Completar `plano`.
- **Fig. 14 y Fig. 1:** plano o secuencia si se pueden afirmar con seguridad.

Y lo que conviene que mire ese segundo radiólogo, caso por caso: que la imagen y las marcas coincidan con lo que
dice la pregunta, que los distractores sean plausibles, que la explicación no afirme más que la fuente y que la
atribución esté completa.

El sello se pone desde el estudio, con el botón **Verificar casos**. Por el camino de Git es
`tools/aprobar <carpeta> --revisor <usuario> --nombre "<nombre>" --todos`.
