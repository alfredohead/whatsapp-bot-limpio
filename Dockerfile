# Usa Node 18 como base
FROM node:18

# Evita prompts interactivos
ENV DEBIAN_FRONTEND=noninteractive

# Logs de Puppeteer para debugging
ENV DEBUG="puppeteer:*"

# Instala Chromium y dependencias necesarias
RUN apt-get update && apt-get install -y \
    wget \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgdk-pixbuf2.0-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libxshmfence1 \
    libxss1 \
    xdg-utils \
    chromium \
    --no-install-recommends && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Define el path del ejecutable de Puppeteer
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Crea el directorio de trabajo
WORKDIR /app

# Copia archivos de dependencias
COPY package*.json ./

# Instala dependencias
RUN npm install --production

# Agrega usuario no root
RUN addgroup --system nodejs && adduser --system --ingroup nodejs nodeuser

# Crea directorios necesarios y asigna permisos
RUN mkdir -p /app/session && chown -R node:node /app/session

# Copia el resto del proyecto con permisos para nodeuser
COPY --chown=nodeuser:nodejs . .

# Asegura que el script de inicio sea ejecutable y cópialo a la raíz
RUN chmod +x start.sh

# Ejecuta como root para poder ajustar permisos de volumen en tiempo de ejecución
USER root

# Expone el puerto que usa tu app (aunque WhatsApp no necesita puerto HTTP)
EXPOSE 3000

# Comando principal
CMD ["./start.sh"]

