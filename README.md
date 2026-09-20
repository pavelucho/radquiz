# RadQuiz

Casos radiológicos para residentes, en vivo (tipo Kahoot) y en práctica individual. Gratis, sin cuentas y en español.

**Manual de uso** (residentes, presentadores, autores, revisores y coordinador): [manual.html](manual.html), en línea en
https://pavelucho.github.io/radquiz/manual.html

El plan completo está en el documento del proyecto; este archivo explica el repositorio.

## Estructura

```
schema/                     JSON Schema del formato (paquete, caso, fuentes)
tools/validar               validador; no necesita instalar nada
tools/aprobar               publica y sella casos desde archivos (flujo con Git)
tools/traer_publicaciones   baja a temas/ lo que el coordinador publicó en el estudio
tools/config.json           límites de imagen, sitios bloqueados y umbrales
docs/guia-estilo-ia.md      cómo escribir casos (para personas y para la IA)
temas/<segmento>/<tema>/    un paquete por tema:
    paquete.json              metadatos, catálogo de imágenes y casos
    fuentes.json              artículos o casos citados, con licencia verificada
    img/                      imágenes JPG (lado mayor ≤ 1600 px, ≤ 250 KB)
    REVISION.md               cambios y pendientes para el revisor (opcional)
index.html, practica.html   app estática: lista de temas y práctica individual
manual.html                 manual de uso para cada papel
sala.html                   sala en vivo (presentador y jugadores)
estudio.html                estudio web: crear, revisar, aprobar y publicar cuestionarios
app/                        código de la app; app/firebase-config.js apunta al proyecto de Firebase
app/zip.js                  leer y armar .zip en el navegador, sin librerías
app/importar.js             comprimir figuras y abrir un cuestionario entero venido en un .zip
database.rules.json         reglas de seguridad de la sala en vivo (Firebase Realtime Database)
firebase.json, .firebaserc  despliegue de reglas y acceso anónimo con la CLI de Firebase
tools/construir_sitio       arma _site/ con solo los casos publicados
```

`referencia/` (prototipo y respaldo del piloto) queda solo en la computadora del autor: no se sube.

## En línea

- Web: https://pavelucho.github.io/radquiz/ (GitHub Pages, gratis, siempre disponible).
- Cada `git push` a `main` valida los temas, arma el sitio y lo publica (`.github/workflows/publicar.yml`).
- **A la web solo salen los casos en estado `publicado`.** Los borradores quedan en el repositorio, pero no en el sitio.
- La sala en vivo usa Firebase Realtime Database (plan Spark gratis, proyecto `radquiz-shpn2`, us-central1) solo para
  el estado de cada sala. Si se cambian las reglas: `firebase deploy --only database,auth`.

## Estudio web (camino normal)

`estudio.html` permite crear, revisar y publicar cuestionarios sin Git y sin terminal:

1. Cada persona entra con su cuenta de Google y queda de alta como autora. Ser **revisor** (poner el sello) lo
   concede el coordinador.
2. El autor completa fuente (con búsqueda por DOI), sube las imágenes (se comprimen en el navegador) y genera los
   casos **con la IA que prefiera**: el estudio arma un texto para copiar y pegar, y lee la respuesta en JSON.
   No se conecta a ningún proveedor de IA.
3. El autor publica cuando el validador no marca errores. Los casos salen **sin verificar**.
4. Cualquier radiólogo con papel de revisor verifica los casos que quiera, incluidos los suyos (en su tema, botón
   «Verificar casos»); el sello lleva su nombre y su fecha, y se retira solo si el autor cambia ese caso y vuelve a
   publicarlo.
5. El tema aparece en la web al instante: `app/publicado.js` lee de la base los nodos públicos `indice_publicado`,
   `publicacion` y `verificacion`, y la portada, la práctica y la sala los usan sin esperar a ningún proceso.
6. Por su cuenta, `.github/workflows/publicar.yml` ejecuta `tools/traer_publicaciones`, que baja lo mismo al
   repositorio, lo valida y arma el sitio. Desde ahí las imágenes van por CDN y no por la base, así que cuando el
   sitio alcanza a la versión publicada, la web vuelve a usar sus archivos. En práctica hay filtro «solo
   verificados»; la sala en vivo usa verificados por defecto. Cualquiera puede reportar un error desde la web
   (`reportes/`), y eso pone el caso al principio de la cola.

Los borradores viven en Firebase (`estudio/`, `estudio_img/`); lo publicado queda además en el repositorio, que es el
historial. Las reglas de `database.rules.json` definen qué puede hacer cada papel.

### Un cuestionario entero en un `.zip`

El estudio sube y baja un tema completo —texto e imágenes— en un solo archivo, con la misma forma que una carpeta de
`temas/`: `paquete.json`, `fuentes.json` e `img/`. Un `.zip` hecho en el Finder o en Windows lleva todo dentro de una
carpeta; ese nivel se ignora, igual que la basura de `__MACOSX`.

- **Subir un .zip** (portada del estudio): lo lee, lo valida y enseña las figuras antes de crear nada. El tema se
  crea siempre **en preparación** y a nombre de quien lo sube; las imágenes se vuelven a comprimir aquí, así que el
  límite de 1600 px y 250 KB lo pone el estudio y no quien armó el archivo.
- **Descargar .zip** (paso 4): lo mismo que se publica, listo para volver a subirlo, mandarlo a `temas/` por Git o
  guardarlo antes de borrar el tema.
- En «Nuevo cuestionario», **Copiar instrucciones para el .zip** da el texto para una IA que sepa ejecutar código:
  saca las figuras del PDF y devuelve el `.zip` armado. Hay que mirar las figuras una por una antes de crearlo: una
  IA puede partir una figura en paneles sueltos, y las licencias ND no permiten obras derivadas.
- Leer y escribir `.zip` es `app/zip.js`: usa `DecompressionStream` del navegador, sin dependencias. Al escribir
  guarda sin comprimir (un JPEG ya está comprimido), y el archivo lo abren `unzip`, el Finder y `zipfile` de Python.

### Borrar

El autor borra sus cuestionarios desde el estudio (botón **Borrar** de cada tarjeta, o el paso 4) y el coordinador
puede borrar cualquiera. Hay que escribir `BORRAR` en el aviso, que dice antes cuántos casos, imágenes, sellos y
reportes se pierden. El borrado quita `publicacion/`, `publicacion_img/`, `verificacion/`, `reportes/`,
`estudio_img/` y `estudio/` en ese orden —las reglas dan permiso mirando `estudio/<tema>/meta/autor_uid`, así que el
tema se quita al final— y deja `indice_publicado/<tema>` marcado como `retirado`, que es lo que hace que desaparezca
de la web al instante y que `tools/traer_publicaciones` borre su carpeta de `temas/`.

Para que deje de verse en la web sin perder nada está **Quitar de la web** (coordinador, paso 4): eso sí se deshace.

**Las reglas hay que desplegarlas** para que el estudio pueda escribir `indice_publicado`. Si no están,
publicar sigue funcionando: el tema aparece cuando el workflow lo baje.

`.github/workflows/reglas.yml` las despliega solo cuando cambia `database.rules.json`, si el repositorio tiene el
secreto `FIREBASE_SERVICE_ACCOUNT` (JSON de una cuenta de servicio con el papel «Firebase Realtime Database Admin»,
que es lo recomendado; **no** «Firebase Rules Admin», que es de Firestore y Storage) o `FIREBASE_TOKEN` (lo que
imprime `firebase login:ci`, más rápido pero vale por toda la cuenta).
Sin secreto el workflow avisa y no falla, y queda el camino de siempre: `firebase deploy --only database`.

## Sala en vivo

1. El presentador abre `sala.html`, pulsa «Crear sala», elige tema y tiempo, y proyecta el código de 4 letras.
2. Los residentes abren la web en el celular, escriben el código y su nombre. No hay cuentas: cada navegador recibe
   una identidad anónima de Firebase.
3. Puntaje: 500 por acierto + hasta 500 por rapidez, con la hora del servidor. Una respuesta por pregunta.
4. Al cerrar la sala se borran nombres, respuestas y puntajes. Las salas abandonadas se borran solas después de 24 h,
   cuando alguien crea una sala nueva.

Las reglas (`database.rules.json`) impiden que un jugador cambie el estado, toque puntajes, escriba por otro, responda
dos veces, responda fuera de tiempo o lea las respuestas ajenas antes de revelarlas.

Para ensayar con casos sin publicar: correr el sitio en la computadora y marcar «Incluir casos sin publicar» al crear
la sala. Los jugadores tienen que abrir esa misma dirección (misma red Wi-Fi: `python3 -m http.server 8000 --bind 0.0.0.0`
y la IP de la computadora).

## Validar

```bash
tools/validar
```

Con Python 3.9 o superior basta (viene en macOS). Otras opciones:

- `tools/validar temas/torax/mi-tema`: solo esa carpeta.
- `tools/validar --estricto`: los avisos también cuentan como errores.
- `tools/validar --indice`: si no hay errores, escribe `temas/indice.json`, que la app usa para listar los temas.

**Error** es algo roto o prohibido: formato, imagen que falta o pesa demasiado, respuesta fuera de rango, HTML en los
textos, fuente de un sitio bloqueado, figura ND modificada. **Aviso** es algo pendiente o
sospechoso: en un borrador lo pendiente es aviso, y en un caso publicado pasa a ser error. El sello de verificación no
es obligatorio para publicar: un caso publicado sin `revisor` sale como «sin verificar».

También avisa si la correcta es la opción más larga en más de un tercio de los casos, si las respuestas se concentran en
una letra, si una imagen trae metadatos EXIF o si un caso de concepto tiene una imagen decorativa en la pregunta.

## Decisiones de formato

1. **Markdown limitado, no HTML**, en enunciados, opciones, explicaciones y perlas: `**negrita**`, `*cursiva*` y listas.
   Es seguro de mostrar y se lee bien al revisar cambios en GitHub.
2. **Catálogo de imágenes por paquete.** Cada imagen tiene una ficha (leyenda textual, paneles, marcas,
   modificaciones) y los casos la citan por su id. En la ficha, una clave ausente significa «pendiente» y `null`
   significa «la fuente no lo indica».
3. **`evidencia` en cada caso:** página y frase textual de la fuente. Hace que revisar tome segundos y evita que la IA
   invente.
4. **La validación depende del estado.** En borrador se permite lo pendiente. En publicado se exigen ficha completa,
   evidencia y licencia verificada. El `revisor` es opcional: es el sello, y siempre queda registrado quién lo puso
   (puede ser el propio autor si también es radiólogo).
5. **La app baraja las opciones** (`"barajar": false` si el orden importa). Por eso el reparto de letras pesa menos
   que el largo de las opciones.
6. **Id único en todo el repositorio:** `<paquete>/<caso>`.

## Agregar un tema con Git (camino alternativo)

Para quien prefiera archivos; el camino normal es el estudio web.

1. Crear `temas/<segmento>/<id>/` con `paquete.json`, `fuentes.json` e `img/`, siguiendo `docs/guia-estilo-ia.md`.
2. Correr `tools/validar` hasta que no haya errores.
3. Proponer el cambio en GitHub. Para publicarlos y sellarlos:
   `tools/aprobar <carpeta> --revisor <usuario> --nombre "Dra. X" --todos` (o `--casos id1,id2`).
4. Al aceptar la propuesta en `main`, la web se actualiza sola. Paso a paso en el manual.

## Probar la app en la computadora

```bash
python3 -m http.server 8000
```

Luego abrir `http://localhost:8000`. Para ver los borradores, como en la revisión:
`http://localhost:8000/practica.html?tema=cabeza-cuello/atm-rm-lopezramirez2024&revision=1`.

## Licencias

Cada imagen conserva la licencia de su fuente, indicada en `fuentes.json` y en el crédito que muestra la app. Las
figuras con licencia ND no se recortan ni se anotan. La licencia del código y la de los textos propios aún no se decide.
