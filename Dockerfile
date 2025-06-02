FROM ghcr.io/puppeteer/puppeteer:19.7.5

WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias
RUN npm install

# Copiar código fuente
COPY . .

# Configurar variable de entorno para Puppeteer
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Usar el usuario no root de Puppeteer para evitar problemas de permisos
USER pptruser

# Comando para iniciar la aplicación
CMD ["node", "index.js"]
