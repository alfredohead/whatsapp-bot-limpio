# Dockerfile para bot WhatsApp con Puppeteer en Fly.io

FROM node:18

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
  libgdk-pixbuf2.0-dev \
  libnspr4 \
  libnss3 \
  libx11-xcb1 \
  libxcomposite1 \
  libxdamage1 \
  libxrandr2 \
  xdg-utils \
  chromium \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Crea el directorio de la app
WORKDIR /app

# Copia package.json y package-lock.json
COPY package*.json ./

# Instala dependencias como root
RUN npm install

# Crea un usuario no-root y cambia a él
RUN addgroup --system nodejs && adduser --system --ingroup nodejs nodeuser

# Asegura que el usuario nodeuser tenga permisos de escritura en el directorio de sesión
RUN mkdir -p /app/session && chown -R nodeuser:nodejs /app/session

USER nodeuser

# Copia el resto de los archivos del proyecto
COPY . .

# Expone el puerto para Fly.io
EXPOSE 3000

# Comando para iniciar el bot
CMD ["node", "index.js"]


