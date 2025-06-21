
// index.js – Versión estable para WhatsApp bot con puppeteer completo

const express = require('express');
require("dotenv").config();
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const SESSION_DATA_PATH = "./session/wwebjs_auth_data";

(async () => {
  try {
    // Verificar y crear carpeta de sesión si no existe
    if (!fs.existsSync(SESSION_DATA_PATH)) {
      fs.mkdirSync(SESSION_DATA_PATH, { recursive: true });
      console.log("[INFO] Carpeta de sesión creada:", SESSION_DATA_PATH);
    }

    const executablePath = await puppeteer.executablePath();
    console.log("🧭 Usando Chromium en:", executablePath);

    const client = new Client({
      authStrategy: new LocalAuth({ dataPath: SESSION_DATA_PATH }),
      puppeteer: {
        headless: true,
        executablePath: executablePath,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      }
    });

    client.on("qr", (qr) => {
      console.log("🔷 Escaneá este QR para conectar:");
      qrcode.generate(qr, { small: true });
    });

    client.on("ready", () => {
      console.log("✅ Bot listo y funcionando.");
    });

    client.on("message", async msg => {
      console.log("📨 Mensaje recibido:", msg.body);
      if (msg.body.toLowerCase() === "hola") {
        msg.reply("¡Hola! Soy el asistente virtual 🤖");
      }
    });

    const app = express();
    const PORT = process.env.PORT || 3000;

    app.get("/health", (_, res) => res.send("OK"));
    app.listen(PORT, () => console.log(`🌐 Health check escuchando en puerto ${PORT}`));

    await client.initialize();
  } catch (err) {
    console.error("❌ Error durante la inicialización del bot:", err);
    process.exit(1);
  }
})();
