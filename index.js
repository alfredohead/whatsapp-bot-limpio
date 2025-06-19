// index.js – Versión final del bot de WhatsApp con funciones completas

require("dotenv").config();
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const { OpenAI } = require("openai");
const puppeteer = require('puppeteer'); // Importar puppeteer
const { getWeather, getEfemeride } = require("./functions-handler");

const SESSION_PATH = "./session";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

(async () => { // Inicio de IIFE async
  try {
    const executablePath = await puppeteer.executablePath();
    console.log("🚀 Usando Chromium de Puppeteer en:", executablePath);

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: "whatsapp-bot",
        dataPath: '/app/session'
      }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-software-rasterizer'
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH
      },
    });

    client.on("qr", (qr) => {
      console.log("🔹 Escanea este QR para iniciar sesión:");
      qrcode.generate(qr, { small: true });
    });

    client.on("ready", () => {
      console.log("🚀 Evento 'ready' de client disparado. Bot listo y conectado.");
    });

    client.on("message", async (msg) => {
      const { from, body, type, isStatus, isGroupMsg } = msg;

      // Ignorar mensajes de estados o grupos
      if (isStatus || from.endsWith("@g.us")) return;

      // Log básico
      console.log(`[📩] Mensaje de ${from}:`, body);

      try {
        const texto = body.toLowerCase();

        // Comando especial: Clima
        if (texto.includes("clima")) {
          const clima = await getWeather();
          return msg.reply(clima);
        }

        // Comando especial: Efemérides
        if (texto.includes("efeméride") || texto.includes("efemeride") || texto.includes("pasó un día como hoy")) {
          const info = getEfemeride();
          return msg.reply(info);
        }

        // Respuesta general con asistente OpenAI
        const respuesta = await openai.beta.threads.createAndRun({
          assistant_id: ASSISTANT_ID,
          thread: { messages: [{ role: "user", content: body }] },
        });

        const partes = respuesta?.data?.latest_run?.step_details?.tool_calls;
        const content = partes?.[0]?.output?.text ?? "🤖 Lo siento, no tengo una respuesta clara en este momento.";

        return msg.reply(`${content}\n\n🤖 Asistente Virtual\nMunicipalidad de General San Martín.`);
      } catch (error) {
        console.error("❌ Error en el manejador de mensajes:", error.stack);
        return msg.reply("⚠️ Hubo un error procesando tu mensaje. Intenta nuevamente más tarde.");
      }
    });

    // Add error logging
    client.on('auth_failure', msg => {
      console.error('❌ Error de autenticación:', msg);
    });

    console.log("🚀 Inicializando cliente de WhatsApp...");
    await client.initialize(); // Usar await
    console.log("🚀 Cliente de WhatsApp inicializado.");

  } catch (error) {
    console.error("❌ Error durante la inicialización del bot:", error.stack);
    process.exit(1); // Salir si hay un error crítico en la inicialización
  }
})(); // Fin de IIFE


