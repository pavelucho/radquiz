# Guía de estilo para generar casos con IA

Esta guía es la referencia completa de cómo se escriben los casos. Sirve para cualquier segmento y con **cualquier
IA** (ChatGPT, Gemini, Copilot, Claude, DeepSeek…). El estudio web (`estudio.html`) arma solo el texto de
instrucciones a partir de estas reglas, así que un autor normal no necesita leer este documento: lo copia y lo pega
en la IA que use. El resultado siempre sale como **borrador** y pasa por el
validador (`tools/validar`) y por un radiólogo revisor antes de publicarse.

Formato exacto: `schema/paquete.schema.json`, `schema/caso.schema.json` y `schema/fuentes.schema.json`.

## 1. Reglas que no se negocian

1. **Solo la fuente cargada.** Todo lo que diga un caso (hallazgo, cifra, clasificación, secuencia, conducta) tiene que
   estar en la fuente. Si no está, no se escribe. No se agregan conocimientos «de cultura general», aunque sean ciertos.
2. **Nada de datos clínicos inventados.** Edad, sexo, síntomas o antecedentes van en el enunciado solo si la leyenda
   de *esa* figura los dice. Que el artículo describa un síntoma en general no autoriza a atribuírselo a ese paciente.
3. **Cada caso lleva `evidencia`:** la ubicación (página, figura o tabla) y la frase textual de la fuente que sostiene
   la respuesta y la explicación. Si no se encuentra la frase, el caso no se escribe.
4. **Las leyendas se copian tal cual**, en el idioma de la fuente, en `leyenda_original`. Traducir una leyenda es
   adaptarla, y las licencias ND lo prohíben.
5. **Figuras con licencia ND (sin derivadas):** se permite comprimir y redimensionar. No se recortan paneles, no se
   separa una tabla en pedazos y no se dibujan flechas. La figura o tabla se usa entera; si da la respuesta, se muestra
   en la respuesta (`"mostrar_en": "respuesta"`).
6. **Sin HTML.** Los textos van en Markdown limitado: `**negrita**`, `*cursiva*`, listas con `- ` o `1. ` y párrafos.
   Los símbolos se escriben tal cual: `<`, `≥`, `%`.

## 2. Tipo de caso

- **`imagen`**: la respuesta depende de mirar la imagen. Es el tipo principal: la imagen es el caso.
- **`concepto`**: se responde sin mirar (protocolo, epidemiología, diferencial). Va sin imagen o con la imagen solo en la
  respuesta. Nunca se pone una imagen decorativa en la pregunta (por ejemplo, una RM para una pregunta sobre TC).
- Meta por paquete: al menos 70 % de casos tipo `imagen`.

## 3. Enunciado

- Describe la imagen como la leyenda: lado, plano, secuencia, condición (boca cerrada, apertura, poscontraste) y qué
  panel es cuál. Si la leyenda no dice la secuencia, no se menciona.
- **No delata la respuesta.** No nombra el diagnóstico ni la palabra que lo define. Ejemplo: si la leyenda dice
  «sagital oblicuo medial a la cabeza condilar» y la respuesta es «desplazamiento discal medial», el enunciado dice solo
  «sagital oblicuo».
- Nombra las marcas que hay que mirar (flecha blanca, círculo, asterisco, número) sin decir qué señalan.
- Una sola pregunta, clara, que termina en `?`. Nada de «todas las anteriores», «ninguna» ni preguntas en negativo
  («¿cuál NO…?»).

## 4. Opciones

- **Cinco opciones**, una sola correcta, mutuamente excluyentes.
- **Distractores plausibles:** diagnósticos diferenciales reales de la misma región y modalidad, o errores típicos del
  residente. Nada absurdo ni gracioso.
- **Homogéneas en forma, contenido y largo.** La correcta no debe ser la más larga: es la pista más conocida para
  adivinar ([Haladyna 2002](https://doi.org/10.1207/S15324818AME1503_5)). Si la correcta necesita más palabras,
  alargue los distractores con detalles plausibles o acorte la correcta.
- Misma estructura gramatical en las cinco («Diagnóstico; riesgo», «X, Y y Z»).
- La app baraja las opciones. Si el orden importa (por ejemplo, grados de una escala), poner `"barajar": false`.
- `correcta` cuenta desde 0: 0 = A, 1 = B, … 4 = E.

## 5. Explicación y perla

- **Explicación:** 2 a 4 viñetas. Primero por qué la correcta es correcta (lo que se ve y cómo se llama), después el
  concepto clave de la fuente. Si la fuente lo permite, una viñeta que diferencie el distractor más tentador.
- Usa el vocabulario de la fuente y no afirma más que ella («contribuye» no se convierte en «inicia»; «puede sugerir»
  no se convierte en «es diagnóstico de»).
- **Perla** (opcional): una frase práctica, también sacada de la fuente.
- Nunca se inventan citas, cifras ni referencias.

## 6. Ficha de cada imagen

Va una sola vez, en el catálogo `imagenes` del paquete, y los casos la citan por su id.

- `leyenda_original`: textual.
- `paneles`: uno por letra (`"A"`, `"B"`…) o `"único"`. En cada uno: `plano`, `secuencia`, `condicion` y, si la
  leyenda lo dice, `lado`.
- **Clave ausente = pendiente.** **`null` = la fuente no lo indica.** Nunca se rellena con una suposición: lo que se
  ve pero la leyenda no dice va en `notas`, para que el revisor lo confirme.
- `marcas`: qué señala cada flecha, círculo, asterisco o número, según la leyenda.
- `modificaciones`: lista de cambios hechos a la figura (`redimensionada`, `comprimida`…). Con licencias ND solo se
  admiten esos dos.

## 7. Antiejemplos (errores reales del piloto ATM)

| Error | Cómo estaba | Cómo quedó |
| --- | --- | --- |
| Datos clínicos inventados | «Mujer de 34 años con chasquido y dolor en ATM derecha…» (la leyenda de la Fig. 2 no trae edad, sexo ni síntomas) | «ATM derecha. Cortes sagitales oblicuos en máxima intercuspidación, lateral (A) y medial (B). ¿Qué muestra la flecha blanca?» |
| Pista en el enunciado | «…sagital oblicuo medial a la cabeza condilar. ¿Qué muestra la flecha?» → desplazamiento medial | «Corte coronal (A) y sagital oblicuo (B). ¿Qué muestra la flecha blanca?» |
| Correcta mucho más larga | Correcta de 160 caracteres; la siguiente, de 69 | Cinco opciones de 50 a 66 caracteres |
| Afirmar más que la fuente | «El pterigoideo lateral **inicia** la apertura» | «**contribuye** a la apertura», como dice la fuente |
| Imagen decorativa | RM de artrosis para preguntar cuándo se indica TC | Caso tipo `concepto`, sin imagen |
| Figura ND modificada | Tabla 1 recortada en dos imágenes | Tabla 1 entera, mostrada en la respuesta |
| HTML en los textos | `<b>1</b>`, `&lt;5%` | `**1**`, `< 5 %` |

## 8. Casos modelo

### Caso de imagen

Enunciado con la descripción técnica de la leyenda, sin delatar el diagnóstico; distractores del mismo grupo; la
evidencia es la leyenda y la frase del texto que define «parcial».

```json
{
  "id": "atm-10",
  "tema": "Desplazamiento discal · Parcial",
  "etiquetas": ["ATM", "RM", "desplazamiento discal"],
  "tipo": "imagen",
  "enunciado": "ATM izquierda. Cortes sagitales oblicuos en máxima intercuspidación, lateral (A) y medial (B). ¿Diagnóstico?",
  "imagenes": [{ "ref": "fig03", "mostrar_en": "pregunta" }],
  "opciones": [
    "Desplazamiento discal medial",
    "Desplazamiento discal anterior completo",
    "Desplazamiento discal posterior",
    "Desplazamiento discal anterior parcial",
    "ATM normal"
  ],
  "correcta": 3,
  "explicacion": "- En el corte lateral (A) el disco está por delante del cóndilo; en el medial (B) está en posición normal.\n- Si solo un segmento del disco está por delante del cóndilo, el desplazamiento es **parcial**.\n- Se reconoce comparando los cortes laterales con los mediales.",
  "evidencia": [
    {
      "fuente": "lopezramirez2024",
      "ubicacion": "p. 140, leyenda de la Figura 3",
      "cita": "Desplazamiento discal anterior parcial. Cortes sagitales oblicuos en máxima intercuspidación en la articulación temporomandibular izquierda que demuestran desplazamiento discal anterior en cortes laterales (A), con normal posición en cortes mediales (B) (flecha blanca)."
    },
    {
      "fuente": "lopezramirez2024",
      "ubicacion": "p. 145",
      "cita": "en el desplazamiento anterior completo todo el disco se encuentra delante del cóndilo mandibular, en los desplazamientos parciales solo un segmento es anterior al cóndilo"
    }
  ],
  "estado": "borrador",
  "autor": "pluna",
  "revisor": null
}
```

Y su ficha en el catálogo del paquete:

```json
"fig03": {
  "archivo": "fig03.jpg",
  "fuente": "lopezramirez2024",
  "figura": "Figura 3",
  "leyenda_original": "Desplazamiento discal anterior parcial. Cortes sagitales oblicuos en máxima intercuspidación en la articulación temporomandibular izquierda que demuestran desplazamiento discal anterior en cortes laterales (A), con normal posición en cortes mediales (B) (flecha blanca).",
  "modalidad": "RM",
  "paneles": [
    { "id": "A", "lado": "izquierdo", "plano": "sagital oblicuo, corte lateral", "secuencia": null, "condicion": "máxima intercuspidación" },
    { "id": "B", "lado": "izquierdo", "plano": "sagital oblicuo, corte medial", "secuencia": null, "condicion": "máxima intercuspidación" }
  ],
  "marcas": [
    { "marca": "flecha blanca", "panel": "A y B", "senala": "disco: desplazado hacia anterior en A, en posición normal en B" }
  ],
  "modificaciones": []
}
```

### Caso de concepto

Sin imagen; opciones de largo parecido y con la misma forma; cada cifra de la explicación tiene su frase en la evidencia.

```json
{
  "id": "atm-15",
  "tema": "Desplazamiento discal · Relevancia clínica",
  "etiquetas": ["ATM", "RM", "desplazamiento discal", "epidemiología"],
  "tipo": "concepto",
  "enunciado": "Una RM de ATM muestra un desplazamiento discal anterior. Según la revisión, ¿qué afirmación es correcta?",
  "imagenes": [],
  "opciones": [
    "Se evalúa mejor con TC que con resonancia magnética",
    "Es raro: menos del 5 % de los pacientes con TTM tiene lesión discal",
    "Solo tiene relevancia si coexiste con artrosis de la ATM",
    "Siempre es patológico y explica los síntomas del paciente",
    "Puede verse en asintomáticos; hay que buscar otros signos de TTM"
  ],
  "correcta": 4,
  "explicacion": "- Las lesiones del disco son la causa más frecuente de TTM y el hallazgo más común en RM: hasta un **70 %** de los pacientes.\n- Sin embargo, hasta un **34 % de la población asintomática** tiene un disco desplazado.\n- Por eso hay que buscar otros signos de TTM: **derrame articular, rotura de las capas retrodiscales o aumento del grosor de la inserción del pterigoideo lateral**.\n- Los TTM afectan al 5-12 % de la población, con mayor prevalencia en mujeres.",
  "evidencia": [
    { "fuente": "lopezramirez2024", "ubicacion": "p. 143", "cita": "se ha reportado que hasta un 34% de la población asintomática poseen como hallazgo imagenológico un desplazamiento del disco articular." },
    { "fuente": "lopezramirez2024", "ubicacion": "p. 143", "cita": "se debe prestar especial atención a otros signos que pueden sugerir TTM, tales como derrame articular, rotura de capas retrodiscales o aumento del grosor de la inserción del musculo pterigoideo lateral." },
    { "fuente": "lopezramirez2024", "ubicacion": "p. 143", "cita": "Las lesiones del disco articular son la causa más frecuente de los TTM, siendo el hallazgo más común en la RM, encontrándose en hasta un 70% de los pacientes." },
    { "fuente": "lopezramirez2024", "ubicacion": "p. 143", "cita": "Se estima que afectan entre un 5-12% de la población, con una prevalencia mayor en mujeres." }
  ],
  "estado": "borrador",
  "autor": "pluna",
  "revisor": null
}
```

## 9. Cómo pedírselo a la IA

> Con la guía de estilo de RadQuiz cargada y el PDF adjunto, arma el paquete `temas/<segmento>/<id>/`:
> `fuentes.json` con licencia verificada en el PDF (cita la frase de la licencia), catálogo de imágenes con la leyenda
> textual de cada figura, y entre 15 y 30 casos en estado borrador. Cada caso con su evidencia textual.
> Si una figura tiene licencia ND, no la recortes. Al terminar corre `tools/validar` y corrige todo lo que marque.

## 10. Antes de entregar

- [ ] `tools/validar` sin errores; los avisos, leídos uno por uno.
- [ ] Ningún dato clínico que no esté en la leyenda.
- [ ] Ningún enunciado que contenga la palabra clave de la respuesta.
- [ ] La correcta no es la opción más larga en más de un tercio de los casos (el validador lo cuenta).
- [ ] Cada afirmación de la explicación tiene su frase en `evidencia`.
- [ ] Leyendas textuales; campos que la fuente no dice, en `null`; lo que no se pudo confirmar, en `notas`.
