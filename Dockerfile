FROM ghcr.io/puppeteer/puppeteer:19.7.5

WORKDIR /app

# Copiar archivos de dependencias como pptruser
COPY --chown=pptruser:pptruser package*.json ./

USER pptruser

# Instalar dependencias como pptruser
RUN npm install

# Copiar el resto del código fuente como pptruser
COPY --chown=pptruser:pptruser . .

# Configurar variable de entorno para Puppeteer
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Forzar ejecución como pptruser (evita que Fly.io lo ejecute como root)
USER pptruser

# Comando para iniciar la aplicación como pptruser, incluso si Fly.io ejecuta como root
CMD ["node", "index.js"]
