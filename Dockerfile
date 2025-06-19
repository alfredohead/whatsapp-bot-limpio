# Dockerfile para bot WhatsApp con Puppeteer en Fly.io

FROM node:20-slim

# Instala Chromium y dependencias necesarias
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-symbola \
    fonts-noto-color-emoji \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Establece variables de entorno
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Crea el directorio de sesión con los permisos correctos
RUN mkdir -p /app/session && \
    chown -R node:node /app

# Copia package.json y package-lock.json
COPY package*.json ./
RUN npm install --production

# Copia el resto de los archivos del proyecto
COPY . .

# Establece permisos
RUN chown -R node:node /app

# Cambia a usuario no-root
USER node

# Expone el puerto para Fly.io
EXPOSE 3000

# Comando para iniciar el bot
CMD ["node", "index.js"]


