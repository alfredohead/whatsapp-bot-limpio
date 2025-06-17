FROM node:18

# Instala Chromium y dependencias necesarias + gosu
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
  xdg-utils \
  chromium \
  gosu \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Crea un usuario no-root y grupo
RUN groupadd -r nodeuser && useradd -r -g nodeuser -m -s /bin/bash nodeuser

WORKDIR /app

# Copia package.json y package-lock.json primero para el cacheo de capas de Docker
COPY package*.json ./

# Cambia la propiedad de /app a nodeuser ANTES de npm install
# Esto asegura que node_modules y cualquier modulo nativo compilado pertenezcan a nodeuser
RUN chown -R nodeuser:nodeuser /app

# Cambia al usuario nodeuser para instalar dependencias
USER nodeuser
RUN npm install

# Vuelve a root temporalmente para copiar el resto de la aplicación
# usando --chown para asegurar que los archivos pertenezcan a nodeuser
USER root
COPY --chown=nodeuser:nodeuser . .

# Copia el entrypoint script y lo hace ejecutable
COPY --chown=root:root entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Establece el entrypoint. El CMD se pasará a este script.
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

# Expone el puerto (informativo para Fly.io, que usa internal_port de fly.toml)
EXPOSE 3000

# Comando por defecto para ejecutar la aplicación (será ejecutado por entrypoint.sh como nodeuser)
CMD ["node", "index.js"]
