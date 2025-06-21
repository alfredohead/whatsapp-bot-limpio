// index.js – Versión final del bot de WhatsApp con funciones completas

require("dotenv").config();
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const { OpenAI } = require("openai");
const puppeteer = require('puppeteer');
const { getWeather, getEfemeride } = require("./functions-handler");

const SESSION_PATH = "./session";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const POLLING_INTERVAL_MS = 2000;
const MAX_POLLING_ATTEMPTS = 30;
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  try {
    const executablePath = await puppeteer.executablePath();
    console.log("🚀 Usando Chromium de Puppeteer en:", executablePath);

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: "whatsapp-bot",
        dataPath: SESSION_PATH
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
      const { from, body, isStatus } = msg;
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

        let assistantResponseForUser = "🤖 Lo siento, no tengo una respuesta clara en este momento.";

        try {
          let run = await openai.beta.threads.createAndRun({
            assistant_id: ASSISTANT_ID,
            thread: { messages: [{ role: "user", content: body }] }
          });

          let pollingAttempts = 0;
          while (pollingAttempts < MAX_POLLING_ATTEMPTS) {
            console.log(`[OpenAI Run] ID: ${run.id}, Estado: ${run.status}, Intento de sondeo: ${pollingAttempts + 1}/${MAX_POLLING_ATTEMPTS}`);

            if (run.status === 'completed') {
              const messagesPage = await openai.beta.threads.messages.list(run.thread_id, { limit: 5, order: 'desc' });
              const assistantMessages = messagesPage.data.filter(m => m.role === 'assistant');
              if (assistantMessages.length > 0) {
                const latest = assistantMessages[0];
                if (latest.content?.[0]?.type === 'text') {
                  assistantResponseForUser = latest.content[0].text.value;
                } else {
                  assistantResponseForUser = "🤖 He procesado tu solicitud y tengo una respuesta compleja.";
                  console.log("[OpenAI] Respuesta no textual:", latest.content);
                }
              } else {
                assistantResponseForUser = "🤖 El asistente procesó tu solicitud pero no generó un mensaje visible.";
              }
              break;
            } else if (run.status === 'failed') {
              assistantResponseForUser = `⚠️ Hubo un error con el asistente. Intenta nuevamente.`;
              break;
            } else if (run.status === 'requires_action') {
              if (run.required_action?.type === 'submit_tool_outputs') {
                const toolCalls = run.required_action.submit_tool_outputs.tool_calls;
                let toolOutputs = [];

                for (const toolCall of toolCalls) {
                  let output = "";
                  try {
                    if (toolCall.function.name === 'get_clima_actual') {
                      output = await getWeather();
                    } else if (toolCall.function.name === 'fetchEfemeride') {
                      output = getEfemeride();
                    } else if (toolCall.function.name === 'get_current_time') {
                      const now = new Date();
                      const fecha = now.toLocaleDateString("es-AR", {
                        timeZone: "America/Argentina/Buenos_Aires",
                        weekday: "long",
                        year: "numeric",
                        month: "long",
                        day: "numeric"
                      });
                      const hora = now.toLocaleTimeString("es-AR", {
                        timeZone: "America/Argentina/Buenos_Aires",
                        hour: "2-digit",
                        minute: "2-digit"
                      });
                      output = `📅 Hoy es ${fecha} y la hora actual es ${hora}.`;
                    } else if (toolCall.function.name === 'access_web') {
                      output = "Actualmente no puedo acceder a información web externa.";
                    } else {
                      output = `Error: Función desconocida '${toolCall.function.name}'.`;
                    }
                  } catch (toolError) {
                    output = `Error al ejecutar ${toolCall.function.name}.`;
                  }
                  toolOutputs.push({ tool_call_id: toolCall.id, output });
                }

                run = await openai.beta.threads.runs.submitToolOutputs(run.thread_id, run.id, { tool_outputs: toolOutputs });
              } else {
                assistantResponseForUser = "🤖 El asistente requiere una acción que no reconozco.";
                break;
              }
            } else if (['queued', 'in_progress'].includes(run.status)) {
              await delay(POLLING_INTERVAL_MS);
              run = await openai.beta.threads.runs.retrieve(run.thread_id, run.id);
            } else {
              assistantResponseForUser = `🤖 La solicitud terminó con estado: ${run.status}.`;
              break;
            }

            pollingAttempts++;
          }

          if (pollingAttempts >= MAX_POLLING_ATTEMPTS && !['completed', 'failed', 'cancelled', 'expired'].includes(run.status)) {
            assistantResponseForUser = `🤖 El procesamiento está tardando más de lo esperado (estado: ${run.status}).`;
          }

        } catch (openaiError) {
          assistantResponseForUser = "⚠️ Error al comunicarme con el asistente de IA.";
        }

        return msg.reply(`${assistantResponseForUser}\n\n🤖 Asistente IA\nMunicipalidad de General San Martín.`);

      } catch (error) {
        console.error("❌ Error general:", error.stack);
        msg.reply("⚠️ Hubo un error procesando tu mensaje. Intenta nuevamente.");
      }
    });

    client.on('auth_failure', msg => {
      console.error('❌ Error de autenticación:', msg);
    });

    console.log("🚀 Inicializando cliente de WhatsApp...");
    await client.initialize();
    console.log("🚀 Cliente de WhatsApp inicializado.");

  } catch (error) {
    console.error("❌ Error en inicialización:", error.stack);
    process.exit(1);
  }
})();