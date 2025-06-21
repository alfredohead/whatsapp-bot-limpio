
// index.js – Versión final del bot de WhatsApp con funciones completas

const express = require('express');
require("dotenv").config();
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const { OpenAI } = require("openai");
const puppeteer = require('puppeteer');
const { getWeather, getEfemeride, getCurrentTime } = require("./functions-handler");
const fs = require('fs');
const path = require('path');

const SESSION_DATA_PATH = "./session/wwebjs_auth_data";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const POLLING_INTERVAL_MS = 2000;
const MAX_POLLING_ATTEMPTS = 30;
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  let readyTimeout;

  try {
    console.log(`[INFO] Verificando el directorio de sesión: ${SESSION_DATA_PATH}`);
    try {
      if (!fs.existsSync(SESSION_DATA_PATH)) {
        fs.mkdirSync(SESSION_DATA_PATH, { recursive: true });
        console.log(`[INFO] Directorio ${SESSION_DATA_PATH} creado.`);
      }
    } catch (err) {
      console.error(`[ERROR] No se pudo preparar el directorio ${SESSION_DATA_PATH}:`, err);
    }

    const executablePath = await puppeteer.executablePath();
    console.log("🚀 Usando Chromium de Puppeteer en:", executablePath);

    const puppeteerSessionPath = path.join(SESSION_DATA_PATH, 'session');
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

    try {
      if (!fs.existsSync(puppeteerSessionPath)) {
        fs.mkdirSync(puppeteerSessionPath, { recursive: true });
        console.log(`[INFO] Se creó el directorio para la sesión de Puppeteer en: ${puppeteerSessionPath}`);
      }
    } catch (err) {
      console.warn(`[WARN] No se pudo crear el directorio para la sesión de Puppeteer en ${puppeteerSessionPath}:`, err.message);
    }

    const singletonLockPath = path.join(puppeteerSessionPath, 'SingletonLock');
    try {
      if (!fs.existsSync(puppeteerSessionPath)) {
        fs.mkdirSync(puppeteerSessionPath, { recursive: true });
      }
      if (fs.existsSync(singletonLockPath)) {
        fs.unlinkSync(singletonLockPath);
        console.log(`[INFO] Se eliminó el archivo SingletonLock existente en: ${singletonLockPath}`);
      }
    } catch (err) {
      console.warn(`[WARN] No se pudo eliminar el archivo SingletonLock o crear el directorio del perfil en ${singletonLockPath}:`, err.message);
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
      console.log("🔵 Evento QR recibido. Contenido del QR:", qr);
      qrcode.generate(qr, { small: true });
      console.log("🔹 Escanea este QR para iniciar sesión (o re-iniciar si la sesión se perdió).");
    });

    client.on("ready", () => {
      if (readyTimeout) clearTimeout(readyTimeout);
      console.log("🚀 Evento 'ready' de client disparado. Bot listo y conectado.");
    });

    client.on("message", async (msg) => {
      const { from, body, isStatus } = msg;
      if (isStatus || from.endsWith("@g.us")) return;
      console.log(`[📩] Mensaje de ${from}:`, body);

      try {
        const texto = body.toLowerCase();

        if (texto.includes("clima")) {
          return msg.reply(await getWeather());
        }

        if (texto.includes("efeméride") || texto.includes("efemeride") || texto.includes("pasó un día como hoy")) {
          return msg.reply(getEfemeride());
        }

        let assistantResponse = "🤖 Lo siento, no tengo una respuesta clara en este momento.";

        try {
          let run = await openai.beta.threads.createAndRun({
            assistant_id: ASSISTANT_ID,
            thread: { messages: [{ role: "user", content: body }] },
          });

          let attempts = 0;
          while (attempts < MAX_POLLING_ATTEMPTS) {
            if (run.status === 'completed') {
              const messages = await openai.beta.threads.messages.list(run.thread_id, { limit: 5, order: 'desc' });
              const latest = messages.data.find(m => m.role === 'assistant');
              if (latest?.content?.[0]?.type === 'text') {
                assistantResponse = latest.content[0].text.value;
              } else {
                assistantResponse = "🤖 He procesado tu solicitud y tengo una respuesta compleja.";
              }
              break;
            } else if (run.status === 'failed') {
              assistantResponse = "⚠️ El asistente no pudo procesar tu solicitud. Intenta más tarde.";
              break;
            } else if (run.status === 'requires_action') {
              const tools = run.required_action?.submit_tool_outputs?.tool_calls || [];
              const outputs = [];
              for (const tool of tools) {
                let output = "Error: función desconocida.";
                try {
                  if (tool.function.name === 'get_clima_actual') output = await getWeather();
                  else if (tool.function.name === 'fetchEfemeride') output = getEfemeride();
                  else if (tool.function.name === 'get_current_time') output = getCurrentTime();
                } catch (e) {
                  output = `Error al ejecutar ${tool.function.name}`;
                }
                outputs.push({ tool_call_id: tool.id, output });
              }
              if (outputs.length > 0) {
                run = await openai.beta.threads.runs.submitToolOutputs(run.thread_id, run.id, { tool_outputs: outputs });
              }
            } else if (['queued', 'in_progress'].includes(run.status)) {
              await delay(POLLING_INTERVAL_MS);
              run = await openai.beta.threads.runs.retrieve(run.thread_id, run.id);
            } else {
              break;
            }
            attempts++;
          }

          if (attempts >= MAX_POLLING_ATTEMPTS) {
            assistantResponse = "⚠️ El asistente tardó demasiado en responder. Intenta nuevamente.";
          }

        } catch (err) {
          console.error("❌ Error con OpenAI:", err);
          assistantResponse = "⚠️ Error al consultar el asistente. Intenta más tarde.";
        }

        msg.reply(`${assistantResponse}

🤖 Asistente IA
Municipalidad de General San Martín.`);

      } catch (error) {
        console.error("❌ Error en el manejador de mensajes:", error);
        if (!msg.hasReplied) msg.reply("⚠️ Hubo un error al procesar tu mensaje. Intenta nuevamente.");
      }
    });

    client.on('authenticated', () => {
      console.log('✅ Cliente AUTENTICADO');
      if (readyTimeout) clearTimeout(readyTimeout);
      readyTimeout = setTimeout(() => {
        console.error('❌ TIMEOUT: El evento "ready" no se disparó después de 2 minutos.');
      }, 120000);
    });

    client.on('disconnected', reason => console.log('❌ Cliente DESCONECTADO:', reason));
    client.on('auth_failure', msg => console.error('❌ FALLO DE AUTENTICACIÓN:', msg));

    const app = express();
    const PORT = process.env.PORT || 3000;

    app.get('/health', (req, res) => res.status(200).send('OK'));

    app.listen(PORT, () => {
      console.log(`Servidor de Health Check escuchando en el puerto ${PORT}`);
    });

    console.log("🚀 Inicializando cliente de WhatsApp...");
    await client.initialize();
    console.log("✅ Cliente de WhatsApp inicializado.");

  } catch (error) {
    console.error("❌ Error durante la inicialización del bot:", error);
    process.exit(1);
  }
})();
