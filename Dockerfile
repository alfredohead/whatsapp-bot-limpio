FROM node:18

# Create a non-root user and group
RUN groupadd -r nodeuser && useradd -r -g nodeuser -m -s /bin/bash nodeuser

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
# We need to switch back to root temporarily to chown.
USER root
COPY --chown=nodeuser:nodeuser . .

# Switch back to nodeuser for running the application
USER nodeuser

# Expose the port for Fly.io
EXPOSE 3000

# Comando para iniciar el bot
CMD ["node", "index.js"]
