# Habla Agéntica

Dictado por voz para Windows. Hablas, la app limpia lo que dijiste (quita muletillas y repeticiones), lo ordena en párrafos y listas, y lo pega donde estés escribiendo.

<!-- Captura de pantalla pendiente: guárdala en docs/captura.png y descomenta la línea de abajo -->
<!-- ![Habla Agéntica](docs/captura.png) -->

## Qué hace

- **Dictas en cualquier programa.** Mantienes un atajo, hablas, sueltas, y el texto aparece en el cursor. Con "Micrófono siempre listo" la grabación arranca sin esperar a que se abra el micrófono.
- **Listas y párrafos.** "Anótame leche, huevos, pan, café" sale como lista con viñetas; los pasos salen numerados y los dictados largos se separan en párrafos.
- **Aprende de tus correcciones.** Si después de pegar corriges una palabra, la agrega al diccionario y la próxima vez la escribe bien. También puedes corregir un dictado desde el Historial.
- **Historial.** Guarda lo que dictaste, tanto el texto original como el limpio, y cuánto tardó cada etapa.
- **Diccionario y snippets.** Enséñale nombres y palabras propias, y crea atajos de texto ("mi correo" escribe tu correo completo).
- **Estilos por app.** El texto sale distinto según dónde escribes: informal en un chat, formal en Word, claro y ordenado cuando le hablas a una IA. Los puedes editar a tu gusto.
- **Comandos de voz.** Sobre un texto seleccionado: hacerlo más formal, resumirlo, organizar las ideas o traducirlo al inglés.
- **Importar desde Wispr Flow.** Si ya usabas Wispr Flow, trae tu diccionario, tus snippets y tu historial. Solo lee tus datos locales y no modifica nada de Wispr.
- **Estadísticas.** Cuánto has dictado y cuánto tiempo te ahorra.
- **Modo local, sin internet.** Transcribe en tu propio computador con Whisper (whisper.cpp): el audio no sale de él. Con una tarjeta NVIDIA tarda menos de medio segundo; sin ella, unos 3 segundos.
- **Se actualiza sola.** Busca versiones nuevas, las descarga en segundo plano y te avisa para reiniciar.

## Descargar

Baja el instalador desde la última versión:

**https://github.com/danielanchicoque-cpu/habla-agentica/releases/latest**

El instalador no está firmado, así que Windows SmartScreen mostrará un aviso ("Windows protegió su PC"). Si confías en la fuente, pulsa **Más información** y luego **Ejecutar de todas formas**.

### Actualizar

- **Desde la 0.2.0:** la app se actualiza sola. Cuando haya una versión nueva verás un aviso en el panel (y una notificación de Windows); pulsa **Reiniciar y actualizar**. También puedes ir a **Ajustes → Actualizaciones → Buscar actualizaciones**. Si no reinicias, se instala al cerrar la app.
- **Si tienes la 0.1.0:** esa versión no sabe actualizarse. Descarga e instala la última desde el enlace de arriba (conserva tus datos); de ahí en adelante ya se actualiza sola.

## Una API key de Groq

Por defecto la app usa Groq para transcribir y para limpiar el texto. Con el [modo local](#modo-local-sin-internet) la key ya no es obligatoria: sin ella el texto se pega tal como sale de la transcripción. La key es gratis:

1. Crea una cuenta en [console.groq.com](https://console.groq.com) y genera una key en **API Keys** (empieza con `gsk_`).
2. Abre Habla Agéntica y entra a **Ajustes**.
3. Pega la key en el campo **Key de Groq** y pulsa **Guardar**.

La key se guarda cifrada en tu computador. Tu audio se envía a Groq para procesarlo, y no pasa por ningún otro servidor.

## Atajos

Se cambian en **Ajustes**. Puedes usar una combinación de teclas o una sola tecla que no estorbe al escribir: **Ctrl derecho**, **Insert**, **Bloq Despl** o **Pausa**. Si presionas otra tecla mientras mantienes un atajo de una sola tecla (por ejemplo Ctrl derecho + C), la app lo toma como un atajo normal y cancela el dictado en silencio.

**La tecla Fn no se puede usar:** en casi todos los portátiles la procesa el teclado por dentro y Windows nunca se entera de que la presionaste.

## Modo local (sin internet)

En **Ajustes → Transcripción** eliges dónde se transcribe tu voz:

- **En la nube (Groq):** lo de siempre. Muy rápido, necesita internet y tu key.
- **En este computador:** Whisper corre en tu PC. No necesita internet para transcribir y el audio no sale de él.
- **Automático:** usa Groq y, si no hay internet o Groq falla, transcribe en tu computador.

Para usarlo, entra a **Ajustes → Modo local** e instala un paquete (la app te recomienda uno según tu equipo):

| Paquete | Descarga | Velocidad por dictado |
| --- | --- | --- |
| Rápido (tarjeta NVIDIA) | 1,2 GB | Menos de medio segundo (medido en una RTX 4050) |
| Ligero (cualquier computador) | 198 MB | Unos 3 segundos (medido en un i7 de 13.ª generación) |

Notas:

- La primera vez que arranca el motor tarda unos segundos en cargar el modelo (más si el disco está frío); la app lo deja listo en segundo plano y lo libera tras 30 minutos sin dictar.
- Los archivos se bajan de GitHub (whisper.cpp 1.9.2) y de Hugging Face (modelos de Whisper), y la app **verifica su huella SHA-256 antes de usarlos**: si no coincide, no se ejecutan. Se guardan en la carpeta de datos de la app y se quitan con **Quitar modo local**.
- Necesita *Microsoft Visual C++ Redistributable*, que casi todos los Windows ya tienen. Si falta, la app te lo dice.
- El texto sigue puliéndose con la IA de Groq si tienes key (se envía solo el texto, nunca el audio). Si no tienes key, o apagas **Pulir el texto con la IA de Groq**, el texto se pega tal como sale de la transcripción (con tu diccionario aplicado). Los comandos de voz sobre texto seleccionado sí necesitan Groq.

## Privacidad

- La key de Groq se guarda cifrada con Windows.
- **En la nube:** el audio y el texto se envían a Groq para transcribir y limpiar; nada pasa por otro servidor. **En modo local:** el audio se queda en tu computador; solo el texto (no el audio) va a Groq si dejas activado el pulido.
- **Aprender de tus correcciones** lee el texto del campo donde pegó durante un minuto (por UI Automation de Windows). Ese texto solo se compara en tu computador: no se guarda ni se envía, y los campos de contraseña se omiten. Se apaga en Ajustes.
- **Micrófono siempre listo** deja el micrófono abierto, y Windows muestra su ícono, pero solo se graba mientras usas el atajo. Se apaga en Ajustes.

## Compilar desde el código

Necesitas Node.js en Windows.

```
npm install
npm start       # abre la app en modo desarrollo
npm test        # corre las pruebas
npm run dist    # genera el instalador en dist/
```

Si la ruta de la carpeta es muy larga, Windows puede fallar al cargar módulos nativos o al armar el instalador; trabaja en una ruta corta (por ejemplo `C:\habla`).

### Publicar una versión

Las actualizaciones automáticas leen las versiones (releases) de GitHub. Para publicar una:

1. Sube el número de `version` en `package.json` y anótalo en `CHANGELOG.md`.
2. `npm run dist`.
3. Crea la versión en GitHub con **los tres archivos** de `dist/`: el instalador `.exe`, su `.exe.blockmap` y `latest.yml`. Sin `latest.yml` las apps instaladas no ven la versión nueva.

```
gh release create vX.Y.Z dist/HablaAgentica-Instalador-X.Y.Z.exe dist/HablaAgentica-Instalador-X.Y.Z.exe.blockmap dist/latest.yml --title "Habla Agéntica X.Y.Z" --notes-file notas.md
```

## Licencia

MIT. Mira el archivo [LICENSE](LICENSE). Wispr Flow es software de sus dueños; este proyecto no incluye nada de su código ni de sus recursos.
