FROM node:18

# Create a non-root user and group
RUN groupadd -r nodeuser && useradd -r -g nodeuser -m -s /bin/bash nodeuser

# Install Chromium and dependencias necesarias
# (Ensure this section doesn't conflict with user permissions later)
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
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Create the app directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Change ownership of /app to nodeuser before npm install, then switch user
# This ensures node_modules are owned by nodeuser if any native modules are built
RUN chown -R nodeuser:nodeuser /app
USER nodeuser

# Install dependencies as nodeuser
RUN npm install

# Copy the rest of the application files and ensure they are owned by nodeuser
# We need to switch back to root temporarily to chown, then back to nodeuser
USER root
COPY --chown=nodeuser:nodeuser . .
USER nodeuser

# Expose the port for Fly.io
EXPOSE 3000

# Comando para iniciar el bot
CMD ["node", "index.js"]
