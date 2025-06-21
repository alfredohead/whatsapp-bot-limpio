// index.js – Versión final del bot de WhatsApp con funciones completas

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

// Ya no se define puppeteerUserDataPath aquí

(async () => { // Inicio de IIFE async
  let readyTimeout; // Declarar readyTimeout aquí para que sea accesible

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
      authStrategy: new LocalAuth({ dataPath: SESSION_PATH }), // LocalAuth gestiona la sesión de wwebjs
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
      console.log("🔵 Evento QR recibido. Contenido del QR:", qr);
      qrcode.generate(qr, { small: true });
      console.log("🔹 Escanea este QR para iniciar sesión (o re-iniciar si la sesión se perdió).");
    });

    client.on("ready", () => {
      if (readyTimeout) { // Robustez: limpiar solo si existe
        clearTimeout(readyTimeout);
      }
      console.log("🚀 Evento 'ready' de client disparado. Bot listo y conectado.");
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
      readyTimeout = setTimeout(() => {
        console.error('❌ TIMEOUT: El evento "ready" no se disparó después de 2 minutos de la autenticación.');
      }, 120000); // 120000 ms = 2 minutos
    });

    console.log("🚀 Configurando manejador de evento 'disconnected'...");
    client.on('disconnected', (reason) => {
      console.log('❌ Cliente DESCONECTADO:', reason);
    });

    console.log("🚀 Configurando manejador de evento 'auth_failure'...");
    client.on('auth_failure', msg_text => {
      console.error('❌ FALLO DE AUTENTICACIÓN:', msg_text);
    });

    // Configuración del servidor Express para Health Check
    const app = express();
    const PORT = process.env.PORT || 3000; // Fly.io puede setear PORT

    app.get('/health', (req, res) => {
      res.status(200).send('OK');
    });

    app.listen(PORT, () => {
      console.log(`Servidor de Health Check escuchando en el puerto ${PORT}`);
    });

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
