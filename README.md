# Asistente WhatsApp + GPT

Este proyecto tiene:
- Bot de WhatsApp minimalista
- Integración con OpenAI GPT para respuestas inteligentes

## Instrucciones

1. Ejecutá `npm install`.
2. Creá un archivo `.env` con las siguientes variables:
   - `OPENAI_API_KEY`: tu clave de API de OpenAI.
   - `OPENAI_ASSISTANT_ID`: ID del asistente de OpenAI a utilizar.
   - `PUPPETEER_EXECUTABLE_PATH`: ruta al ejecutable de Chromium/Chrome.
3. Corré `node index.js` para iniciar el bot.

El bot mantiene la sesión de WhatsApp usando volúmenes persistentes y responde usando GPT.

## Ejemplo de `.env`
```env
OPENAI_API_KEY=tu-clave
OPENAI_ASSISTANT_ID=asst_123456
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```
