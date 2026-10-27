# Habla Agéntica

Dictado por voz para Windows. Hablas, la app limpia lo que dijiste (quita muletillas y repeticiones), lo ordena en párrafos y listas, y lo pega donde estés escribiendo.

<!-- Captura de pantalla pendiente: guárdala en docs/captura.png y descomenta la línea de abajo -->
<!-- ![Habla Agéntica](docs/captura.png) -->

## Qué hace

- **Dictas en cualquier programa.** Mantienes un atajo, hablas, sueltas, y el texto aparece en el cursor.
- **Historial.** Guarda lo que dictaste, tanto el texto original como el limpio.
- **Diccionario y snippets.** Enséñale nombres y palabras propias, y crea atajos de texto ("mi correo" escribe tu correo completo).
- **Estilos por app.** El texto sale distinto según dónde escribes: informal en un chat, formal en Word, claro y ordenado cuando le hablas a una IA. Los puedes editar a tu gusto.
- **Comandos de voz.** Sobre un texto seleccionado: hacerlo más formal, resumirlo, organizar las ideas o traducirlo al inglés.
- **Importar desde Wispr Flow.** Si ya usabas Wispr Flow, trae tu diccionario, tus snippets y tu historial. Solo lee tus datos locales y no modifica nada de Wispr.
- **Estadísticas.** Cuánto has dictado y cuánto tiempo te ahorra.

## Descargar

Baja el instalador desde la última versión:

**https://github.com/danielanchicoque-cpu/habla-agentica/releases/latest**

Es una versión temprana, puede tener errores. El instalador no está firmado, así que Windows SmartScreen mostrará un aviso ("Windows protegió su PC"). Si confías en la fuente, pulsa **Más información** y luego **Ejecutar de todas formas**.

## Requisito: una API key de Groq

Hoy la app necesita una API key de Groq para transcribir y limpiar el texto. Es gratis:

1. Crea una cuenta en [console.groq.com](https://console.groq.com) y genera una key en **API Keys** (empieza con `gsk_`).
2. Abre Habla Agéntica y entra a **Ajustes**.
3. Pega la key en el campo **Key de Groq** y pulsa **Guardar**.

La key se guarda cifrada en tu computador. Tu audio se envía a Groq para procesarlo, y no pasa por ningún otro servidor.

## Compilar desde el código

Necesitas Node.js en Windows.

```
npm install
npm start       # abre la app en modo desarrollo
npm test        # corre las pruebas
npm run dist    # genera el instalador en dist/
```

## Licencia

MIT. Mira el archivo [LICENSE](LICENSE). Wispr Flow es software de sus dueños; este proyecto no incluye nada de su código ni de sus recursos.
