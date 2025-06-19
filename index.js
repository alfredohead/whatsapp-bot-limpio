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

// Constantes para el sondeo (polling)
const POLLING_INTERVAL_MS = 2000; // Intervalo de sondeo: 2 segundos
const MAX_POLLING_ATTEMPTS = 30; // Máximo de intentos: 30 (total ~60 segundos)

// Función de utilidad para esperar
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

(async () => { // Inicio de IIFE async
  try {
    const executablePath = await puppeteer.executablePath();
    console.log("🚀 Usando Chromium de Puppeteer en:", executablePath);

    const client = new Client({
      authStrategy: new LocalAuth({ dataPath: SESSION_PATH }),
      puppeteer: {
        headless: true,
        executablePath: executablePath, // Usar la ruta obtenida
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--headless',
          '--disable-gpu',
          '--no-zygote'
        ],
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

        // --- OpenAI Interaction Block START ---
        let assistantResponseForUser = "🤖 Lo siento, no tengo una respuesta clara en este momento."; // Default
        try { // Inner try specifically for OpenAI API calls
          let run = await openai.beta.threads.createAndRun({ // Cambiado a let para poder reasignar 'run'
            assistant_id: ASSISTANT_ID,
            thread: { messages: [{ role: "user", content: body }] },
          });

          // Bucle de sondeo si el estado inicial es 'queued' o 'in_progress'
          let pollingAttempts = 0;
          while (['queued', 'in_progress'].includes(run.status) && pollingAttempts < MAX_POLLING_ATTEMPTS) {
            pollingAttempts++;
            console.log(`[OpenAI Polling] Intento ${pollingAttempts}/${MAX_POLLING_ATTEMPTS}: Run ID ${run.id}, Estado actual: ${run.status}. Esperando ${POLLING_INTERVAL_MS}ms...`);
            await delay(POLLING_INTERVAL_MS);
            run = await openai.beta.threads.runs.retrieve(run.thread_id, run.id);
            console.log(`[OpenAI Polling] Intento ${pollingAttempts}/${MAX_POLLING_ATTEMPTS}: Run ID ${run.id}, Nuevo estado: ${run.status}.`);
          }

          if (['queued', 'in_progress'].includes(run.status)) {
            console.warn(`[OpenAI Polling] Run ID ${run.id} alcanzó el máximo de sondeos (${MAX_POLLING_ATTEMPTS}) sin llegar a un estado terminal. Estado final: ${run.status}.`);
            // Considerar este caso como un timeout o un error específico
            assistantResponseForUser = `🤖 El procesamiento de tu solicitud está tardando más de lo esperado (estado: ${run.status}). Por favor, intenta nuevamente en unos momentos.`;
            // Se salta la lógica de procesamiento de 'completed', 'failed', etc., y va directo al reply.
          } else if (run.status === 'completed') {
            const messagesPage = await openai.beta.threads.messages.list(run.thread_id, { limit: 5, order: 'desc' });
            const assistantMessages = messagesPage.data.filter(m => m.role === 'assistant');
            if (assistantMessages.length > 0) {
              const latestAssistantMessage = assistantMessages[0]; // Most recent
              if (latestAssistantMessage.content && latestAssistantMessage.content[0]?.type === 'text') {
                assistantResponseForUser = latestAssistantMessage.content[0].text.value;
              } else if (latestAssistantMessage.content && latestAssistantMessage.content.length > 0) {
                assistantResponseForUser = "🤖 He procesado tu solicitud y tengo una respuesta compleja (no solo texto).";
                console.log("OpenAI response was not simple text:", latestAssistantMessage.content);
              }
            } else {
               console.warn("OpenAI Run completed, but no assistant messages found in thread:", run.id);
               assistantResponseForUser = "🤖 El asistente procesó tu solicitud pero no generó un mensaje de respuesta visible. Intenta reformular.";
            }
          } else if (run.status === 'failed') {
            console.error("❌ OpenAI Run failed. Run ID:", run.id, "Error:", run.last_error);
            assistantResponseForUser = `⚠️ Hubo un error con el asistente (Fallo: ${run.last_error?.code || 'UnknownError'}). Intenta nuevamente.`;
          } else if (run.status === 'requires_action') {
            console.warn("⚠️ OpenAI Run requires action. This bot is not configured to handle this. Run ID:", run.id, "Details:", run.required_action);
            assistantResponseForUser = "🤖 El asistente necesita realizar una acción adicional que no puedo completar. Por favor, reformula tu pregunta.";
          } else {
            console.warn(`⚠️ OpenAI Run ended with unhandled status: ${run.status}. Run ID:`, run.id);
            assistantResponseForUser = `🤖 El asistente está procesando tu solicitud (estado: ${run.status}). Por favor, espera o intenta de nuevo.`;
          }
        } catch (openaiError) {
          console.error("❌ Error en la llamada a API de OpenAI:", openaiError.stack); // Log full stack
          let userFacingErrorMessage = "⚠️ Hubo un error al comunicarme con el asistente de IA. Intenta nuevamente más tarde.";

          if (openaiError.status) { // It's an OpenAI error object
            console.error(`  OpenAI Error Details: Status=${openaiError.status}, Code=${openaiError.code}, Type=${openaiError.type}, Message=${openaiError.message}`);
            if (openaiError.status === 429) { // Rate limit
                userFacingErrorMessage = "⚠️ Demasiadas solicitudes al asistente. Por favor, espera un momento y vuelve a intentarlo.";
            } else if (openaiError.status === 401) { // Authentication
                userFacingErrorMessage = "⚠️ Problema de autenticación con el asistente. Notifica al administrador.";
            } else if (openaiError.status === 400) { // Bad request
                userFacingErrorMessage = `⚠️ Tu solicitud no pudo ser procesada por el asistente (Error: ${openaiError.code || openaiError.status}). Verifica tu mensaje o intenta de forma diferente.`;
            } else if (openaiError.status >= 500) { // Server-side errors
                userFacingErrorMessage = "⚠️ El servicio del asistente de IA está experimentando problemas. Intenta más tarde.";
            }
          }
          assistantResponseForUser = userFacingErrorMessage; // Set the OpenAI response to the error message
        }
        // --- OpenAI Interaction Block END ---

        return msg.reply(`${assistantResponseForUser}\n\n🤖 Asistente Virtual\nMunicipalidad de General San Martín.`);
      } catch (error) { // Outer catch for any other errors
        console.error("❌ Error en el manejador de mensajes (fuera de OpenAI):", error.stack);
        // Basic check to avoid double reply if OpenAI block already sent one.
        // A more robust solution would involve explicit state management if msg.reply itself could fail.
        if (!msg.hasReplied) { // This is a hypothetical property, actual state management might be needed for robustness here.
             msg.reply("⚠️ Hubo un error general procesando tu mensaje. Intenta nuevamente más tarde.");
        }
      }
    });

    console.log("🚀 Inicializando cliente de WhatsApp...");
    await client.initialize(); // Usar await
    console.log("🚀 Cliente de WhatsApp inicializado.");

  } catch (error) {
    console.error("❌ Error durante la inicialización del bot:", error.stack);
    process.exit(1); // Salir si hay un error crítico en la inicialización
  }
})(); // Fin de IIFE


