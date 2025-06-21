
// index.js – Versión estable para WhatsApp bot con puppeteer completo

const express = require('express');
require("dotenv").config();
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const puppeteer = require('puppeteer');
const { getWeather, getEfemeride, getCurrentTime } = require('./functions-handler');
const { runAssistant } = require('./openaiAssistant');
const fs = require('fs');
const path = require('path');
const SESSION_PATH = "./session/wwebjs_auth_data"; // Modificado: Ruta más específica para LocalAuth
// Las claves OPENAI se manejan dentro de openaiAssistant.js
const SESSION_DATA_PATH = "./session/wwebjs_auth_data";

(async () => {
  try {
    // Asegurar que SESSION_PATH exista con los permisos correctos
    console.log(`[INFO] Verificando el directorio de sesión: ${SESSION_PATH}`);
    try {
      if (!fs.existsSync(SESSION_PATH)) {
        fs.mkdirSync(SESSION_PATH, { recursive: true });
        console.log(`[INFO] Directorio ${SESSION_PATH} creado.`);
      }
    } catch (err) {
      console.error(`[ERROR] No se pudo preparar el directorio ${SESSION_PATH}:`, err);
    }

    const executablePath = await puppeteer.executablePath();
    console.log("🚀 Usando Chromium de Puppeteer en:", executablePath);

    // Intentar eliminar el archivo SingletonLock para prevenir errores de perfil en uso
    const puppeteerSessionPath = path.join(SESSION_PATH, 'session'); // Este es el user-data-dir que Puppeteer usa según los logs
    const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
    lockFiles.forEach(file => {
      const filePath = path.join(puppeteerSessionPath, file);
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`[INFO] Se eliminó el archivo ${file} existente en: ${filePath}`);
        }
      } catch (err) {
        console.warn(`[WARN] No se pudo eliminar ${filePath}:`, err.message);
      }
    });

    // Adicionalmente, asegúrate de que el directorio base de la sesión de puppeteer exista,
    // ya que LocalAuth podría esperarlo.
    try {
      if (!fs.existsSync(puppeteerSessionPath)) {
        fs.mkdirSync(puppeteerSessionPath, { recursive: true });
        console.log(`[INFO] Se creó el directorio para la sesión de Puppeteer en: ${puppeteerSessionPath}`);
      }
    } catch (err) {
      console.warn(`[WARN] No se pudo crear el directorio para la sesión de Puppeteer en ${puppeteerSessionPath}:`, err.message);
    }

    const client = new Client({
      authStrategy: new LocalAuth({ dataPath: SESSION_DATA_PATH }),
      puppeteer: {
        headless: true,
        executablePath: executablePath,
        ignoreHTTPSErrors: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-zygote',
          '--single-process',
          '--disable-features=ProcessSingleton',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-breakpad',
          '--disable-crash-reporter',
          '--ignore-certificate-errors',
        ],
      },

    });

    client.on("qr", (qr) => {
      console.log("🔷 Escaneá este QR para conectar:");
      qrcode.generate(qr, { small: true });
    });

    client.on("ready", () => {
      console.log("✅ Bot listo y funcionando.");
    });
    client.on("message", async (msg) => {
      const { from, body, type, isStatus, isGroupMsg } = msg;

      if (isStatus || from.endsWith("@g.us")) return;

      console.log(`[📩] Mensaje de ${from}:`, body);

      try {
        const texto = body.toLowerCase();

        if (texto.includes("clima")) {
          const clima = await getWeather();
          return msg.reply(clima);
        }

        if (texto.includes("efeméride") || texto.includes("efemeride") || texto.includes("pasó un día como hoy")) {
          const info = getEfemeride();
          return msg.reply(info);
        }

        try {
          const assistantResponseForUser = await runAssistant(body);
          return msg.reply(`${assistantResponseForUser}\n\n🤖 Asistente IA\nMunicipalidad de General San Martín.`);
        } catch (error) {
          console.error("❌ Error en el asistente de OpenAI:", error.stack);
          return msg.reply("⚠️ Hubo un error general procesando tu mensaje. Intenta nuevamente más tarde.");
        }
      } catch (error) {
        console.error("❌ Error en el manejador de mensajes (fuera de OpenAI):", error.stack);
        if (!msg.hasReplied) {
             msg.reply("⚠️ Hubo un error general procesando tu mensaje. Intenta nuevamente más tarde.");
        }
      }
    });

    console.log("🚀 Configurando manejador de evento 'authenticated'...");
    client.on('authenticated', () => {
      console.log('✅ Cliente AUTENTICADO');
      if (readyTimeout) { // Limpiar timeout anterior si existe
        clearTimeout(readyTimeout);
      }
    });

    const app = express();
    const PORT = process.env.PORT || 3000;

    app.get("/health", (_, res) => res.send("OK"));
    app.listen(PORT, () => console.log(`🌐 Health check escuchando en puerto ${PORT}`));

    console.log("🚀 Inicializando cliente de WhatsApp...");
    try {
      await client.initialize();
    } catch(initErr) {
      console.error("❌ Error al inicializar el cliente:", initErr.message);
      if (initErr.message && initErr.message.includes("Target closed")) {
        console.warn(`[WARN] Posible sesi\u00f3n corrupta. Borrando ${SESSION_PATH} y reintentando...`);
        try {
          fs.rmSync(SESSION_PATH, { recursive: true, force: true });
          fs.mkdirSync(SESSION_PATH, { recursive: true });
        } catch (rmErr) {
          console.error(`[ERROR] No se pudo reiniciar el directorio de sesi\u00f3n:`, rmErr.message);
        }
        await client.initialize();
      } else {
        throw initErr;
      }
    }
    console.log("🚀 Cliente de WhatsApp inicializado.");
    console.log("🚀🚀🚀 Final de la configuración del cliente y handlers. Esperando eventos...");

  } catch (error) {
    console.error("❌ Error durante la inicialización del bot:", error.stack);
    process.exit(1);
  }
})();
