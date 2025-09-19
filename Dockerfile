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
# Se crea el grupo y usuario con GID y UID 1001 para que coincida con el volumen montado en Fly.io
RUN groupadd -g 1001 nodeuser && useradd --create-home --shell /bin/bash -u 1001 -g 1001 nodeuser

# Copia explícitamente package.json y package-lock.json para asegurar que ambos estén presentes
# Esto se hace primero para aprovechar el cache de Docker y acelerar builds futuros.
COPY package.json package-lock.json ./

# Instalar dependencias de producción.
RUN npm install --omit=dev

# Copiar el resto del código de la aplicación
COPY . .


# Asegura que el script de inicio sea ejecutable
RUN chmod +x /app/start.sh

# Cambiar el propietario de los archivos de la aplicación al usuario no-root
RUN chown -R nodeuser:nodeuser /app

# Cambiar al usuario no-root
USER nodeuser

# Exponer el puerto que Fly.io usará internamente
EXPOSE 3000

# Comando para iniciar la aplicación
CMD ["/app/start.sh"]