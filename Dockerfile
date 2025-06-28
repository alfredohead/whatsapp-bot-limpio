# Etapa 1: Instalar dependencias del sistema para Puppeteer
FROM node:18-bullseye-slim AS dependencies
RUN apt-get update && apt-get install -y \
    # Dependencias de Chromium/Puppeteer
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Etapa 2: Construir la aplicación final
FROM node:18-bullseye-slim
WORKDIR /app

# Copiar las dependencias de la etapa anterior
COPY --from=dependencies / /

# Crear un usuario no-root para mayor seguridad
RUN useradd --create-home --shell /bin/bash appuser

# Copiar archivos de la aplicación y establecer permisos
# Copia explícitamente package.json y package-lock.json para asegurar que ambos estén presentes
COPY package.json package-lock.json ./

# Usamos 'npm install' como alternativa a 'npm ci'. Aunque 'ci' es preferible para builds
# reproducibles, 'install' es más flexible si 'package-lock.json' no se encuentra
# en el contexto de build (posiblemente por un archivo .dockerignore).
# --omit=dev asegura que solo se instalen las dependencias de producción.
RUN npm install --omit=dev

COPY --chown=appuser:appuser . .

# El volumen se montará en /app/session. Nos aseguramos de que el directorio exista
# y que el usuario 'appuser' tenga permisos sobre él.
# También creamos el directorio para audios temporales y le damos permisos.
RUN mkdir -p /app/session /app/temp_audio && \
    chown -R appuser:appuser /app/session /app/temp_audio

# Cambiar al usuario no-root
USER appuser

# Exponer el puerto que Fly.io usará internamente
EXPOSE 3000

# Comando para iniciar la aplicación
CMD ["node", "index.js"]
