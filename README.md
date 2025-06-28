# Asistente WhatsApp + GPT

Este proyecto tiene:
- Bot de WhatsApp minimalista
- Integración con OpenAI GPT para respuestas inteligentes

## Instrucciones

1. Ejecutá `npm install`

2. Configurá tus variables de entorno `OPENAI_API_KEY`, `OPENAI_ASSISTANT_ID` y `OPENWEATHER_KEY` (puedes usar Fly.io secrets o un archivo `.env`). Consulta `./.env.example` para ver un ejemplo de configuración. También puedes ajustar `TEMP_AUDIO_DIR` si deseas cambiar la ubicación de archivos temporales.

3. Corré `node index.js` para probarlo localmente

### Uso con Docker/Fly.io

Para desplegar el bot en un contenedor (por ejemplo Fly.io) se utiliza el archivo `start.sh`. Este script prepara la carpeta de sesión (crea el directorio, corrige los permisos y elimina archivos de bloqueo que puedan quedar de sesiones previas) antes de iniciar `node index.js`. El contenedor ejecuta automáticamente `/app/start.sh`, por lo que no es necesario invocarlo manualmente en Windows.

El script también crea un directorio temporal para audio definido por `TEMP_AUDIO_DIR` (por defecto `/app/temp_audio`), garantizando que el proceso tenga permisos de escritura.


Si al ejecutar localmente se produce un error `ProtocolError: Target closed`, el bot intentará limpiar la carpeta de sesión y reintentar la inicialización una vez de forma automática.

1. `docker build -t asistente-whatsapp .`
2. `docker run --env-file .env -p 3000:3000 asistente-whatsapp`

El bot mantiene la sesión de WhatsApp usando volúmenes persistentes y responde usando GPT.

La lógica de interacción con la API de OpenAI se encuentra en `openaiAssistant.js`,
que se encarga de crear los hilos y manejar las llamadas a herramientas.


Si el contenedor no puede encontrar Chromium automáticamente, define `PUPPETEER_EXECUTABLE_PATH` en tu `.env` apuntando a la ruta del binario.

