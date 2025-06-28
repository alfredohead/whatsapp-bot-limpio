# Asistente WhatsApp + GPT

Este proyecto tiene:
- Bot de WhatsApp minimalista
- Integración con OpenAI GPT para respuestas inteligentes

## Instrucciones

1. Ejecutá `npm install`

2. Configurá las variables de entorno `OPENAI_API_KEY`, `OPENAI_ASSISTANT_ID` y `OPENWEATHER_KEY`. Podés copiarlas desde el archivo `.env.example` y completarlas o definirlas como secretos en Fly.io.

3. Corré `node index.js` para probarlo localmente

### Uso con Docker/Fly.io

Para desplegar el bot en un contenedor (por ejemplo Fly.io) se utiliza el archivo `start.sh`. Este script prepara la carpeta de sesión (crea el directorio, corrige los permisos y elimina archivos de bloqueo que puedan quedar de sesiones previas) antes de iniciar `node index.js`. El contenedor ejecuta automáticamente `/app/start.sh`, por lo que no es necesario invocarlo manualmente en Windows.


Si al ejecutar localmente se produce un error `ProtocolError: Target closed`, el bot intentará limpiar la carpeta de sesión y reintentar la inicialización una vez de forma automática.

1. `docker build -t asistente-whatsapp .`
2. `docker run -e OPENAI_API_KEY=tu_clave -p 3000:3000 asistente-whatsapp`

El bot mantiene la sesión de WhatsApp usando volúmenes persistentes y responde usando GPT.

La lógica de interacción con la API de OpenAI se encuentra en `openaiAssistant.js`,
que se encarga de crear los hilos y manejar las llamadas a herramientas.

### Módulo de Voz

El proyecto incluye `speech-utils.js` para convertir texto en audio y viceversa sin depender de OpenAI.

1. Ejecuta `npm install` para instalar las dependencias.
2. Define `WITAI_TOKEN` en tu entorno para usar la transcripción de audio con la API de Wit.ai.

Ejemplo de uso:

```javascript
const { textToSpeech, speechToText } = require('./speech-utils');

// Texto a audio
await textToSpeech('Hola mundo', 'es', 'salida.mp3');

// Audio a texto
const texto = await speechToText('grabacion.mp3');
console.log(texto);
```

Este módulo es independiente del bot principal y puede utilizarse de forma separada para manejar voz.
