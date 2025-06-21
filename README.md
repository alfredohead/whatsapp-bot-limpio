# Asistente WhatsApp + GPT

Este proyecto tiene:
- Bot de WhatsApp minimalista
- Integración con OpenAI GPT para respuestas inteligentes

## Instrucciones

1. Ejecutá `npm install`
2. Configurá tu variable de entorno `OPENAI_API_KEY` (puedes usar Fly.io secrets o un archivo `.env`)
3. Corré `node index.js` para probarlo localmente

### Uso con Docker/Fly.io

Para desplegar el bot en un contenedor (por ejemplo Fly.io) se utiliza el archivo `start.sh`, que ajusta los permisos del volumen de sesión antes de iniciar `node index.js`.

1. `docker build -t asistente-whatsapp .`
2. `docker run -e OPENAI_API_KEY=tu_clave -p 3000:3000 asistente-whatsapp`

El bot mantiene la sesión de WhatsApp usando volúmenes persistentes y responde usando GPT.
