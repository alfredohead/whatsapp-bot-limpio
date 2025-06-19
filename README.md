# Asistente WhatsApp + GPT

Este proyecto tiene:
- Bot de WhatsApp minimalista
- Integración con OpenAI GPT para respuestas inteligentes

## Instrucciones

1. Ejecutá `npm install`
2. Configurá tu variable de entorno `OPENAI_API_KEY` (puedes usar Fly.io secrets o un archivo `.env`)
3. Corré `node index.js` para iniciar el bot

El bot mantiene la sesión de WhatsApp usando volúmenes persistentes y responde usando GPT.
