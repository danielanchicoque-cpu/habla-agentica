# Cambios

## 0.2.0

**Se actualiza sola.** Desde esta versión la app busca versiones nuevas en GitHub, las descarga en segundo plano y avisa para reiniciar. También hay un botón en Ajustes → Actualizaciones. Quien tenga la 0.1.0 debe instalar la 0.2.0 a mano una vez; de ahí en adelante se actualiza sola.

**Aprende de tus correcciones.**
- Si después de pegar corriges una palabra en el mismo campo, la app lo nota y la agrega al diccionario (aparece marcada como "Aprendida"). Lee el texto del campo durante un minuto con UI Automation de Windows; no lo guarda, no lo envía a ningún lado y no mira campos de contraseña. Se puede apagar en Ajustes.
- La palabra correcta entra enseguida. El reemplazo automático de "mal → bien" solo entra cuando la misma corrección se repite, para que un cambio suelto no dañe una palabra común.
- Nuevo botón **Corregir** en el Historial: editas el dictado y la app aprende de la diferencia.
- Las palabras del diccionario con reemplazo ahora le llegan a Whisper escritas como deben quedar.

**Atajos.**
- Se puede usar una sola tecla como atajo (Ctrl derecho, Insert, Bloq Despl o Pausa). Fn no se puede usar: Windows no la ve, la procesa el teclado por dentro.
- AltGr + Shift ya no corta la grabación. Windows reporta AltGr como Ctrl izquierdo + Alt derecho, y ese Ctrl falso a veces aparecía como "suelto".
- Si presionas otra tecla mientras mantienes el atajo (por ejemplo Ctrl derecho + C), se cancela en silencio: era un atajo normal, no un dictado.

**Más rápido.**
- **Micrófono siempre listo** (Ajustes): el micrófono queda abierto entre dictados y la grabación empieza al instante. Solo graba mientras usas el atajo. Si usas audífonos Bluetooth, apágalo.
- Cada dictado guarda cuánto tardó la voz, el pulido y el pegado (⏱ en el Historial) para saber dónde está la demora.

**Mejor texto.**
- Las listas salen con viñetas ("anótame leche, huevos, pan, café") y los pasos u órdenes con números.
- Los dictados largos se separan en párrafos cortos.
- Quien no había editado el prompt base recibe las reglas nuevas solo; quien lo editó conserva el suyo.

**Arreglos.**
- Suena un tono al cancelar. Los tonos de terminar y cancelar ahora suenan después de devolver el audio del sistema; antes a veces no se oían.
- La pastilla ya no se corre hacia abajo al arrastrarla en pantallas con escala distinta de 100 %.

## 0.1.0

Primera versión: dictado por voz con Groq, historial, diccionario y snippets, estilos por app, comandos de voz, importación desde Wispr Flow y estadísticas.
