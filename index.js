// index.js – Versión final del bot de WhatsApp con funciones completas

require("dotenv").config();
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const { OpenAI } = require("openai");
const puppeteer = require('puppeteer'); // Importar puppeteer
const { getWeather, getEfemeride, getCurrentTime } = require("./functions-handler");

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
  let readyTimeout; // Declarar readyTimeout aquí para que sea accesible

  try {
    const executablePath = await puppeteer.executablePath();
    console.log("🚀 Usando Chromium de Puppeteer en:", executablePath);

    const client = new Client({
      authStrategy: new LocalAuth({ dataPath: SESSION_PATH }),
      puppeteer: {
        headless: true,
        executablePath: executablePath,
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

        let assistantResponseForUser = "🤖 Lo siento, no tengo una respuesta clara en este momento.";
        try {
          let run = await openai.beta.threads.createAndRun({
            assistant_id: ASSISTANT_ID,
            thread: { messages: [{ role: "user", content: body }] },
          });

          let pollingAttempts = 0;
          while (pollingAttempts < MAX_POLLING_ATTEMPTS) {
            console.log(`[OpenAI Run] ID: ${run.id}, Estado: ${run.status}, Intento de sondeo: ${pollingAttempts + 1}/${MAX_POLLING_ATTEMPTS}`);

            if (run.status === 'completed') {
              const messagesPage = await openai.beta.threads.messages.list(run.thread_id, { limit: 5, order: 'desc' });
              const assistantMessages = messagesPage.data.filter(m => m.role === 'assistant');
              if (assistantMessages.length > 0) {
                const latestAssistantMessage = assistantMessages[0];
                if (latestAssistantMessage.content && latestAssistantMessage.content[0]?.type === 'text') {
                  assistantResponseForUser = latestAssistantMessage.content[0].text.value;
                } else if (latestAssistantMessage.content && latestAssistantMessage.content.length > 0) {
                  assistantResponseForUser = "🤖 He procesado tu solicitud y tengo una respuesta compleja (no solo texto).";
                  console.log("[OpenAI] Respuesta no textual:", latestAssistantMessage.content);
                }
              } else {
                console.warn("[OpenAI] Run completado pero sin mensajes del asistente en el hilo:", run.id);
                assistantResponseForUser = "🤖 El asistente procesó tu solicitud pero no generó un mensaje visible. Intenta reformular.";
              }
              break;
            } else if (run.status === 'failed') {
              console.error("❌ OpenAI Run falló. ID:", run.id, "Error:", run.last_error);
              assistantResponseForUser = `⚠️ Hubo un error con el asistente (Fallo: ${run.last_error?.code || 'UnknownError'}). Intenta nuevamente.`;
              break;
            } else if (run.status === 'requires_action') {
              if (run.required_action && run.required_action.type === 'submit_tool_outputs') {
                const toolCalls = run.required_action.submit_tool_outputs.tool_calls;
                let toolOutputs = [];
                console.log(`[OpenAI Tool Call] Run ID ${run.id} requiere acción: submit_tool_outputs. ${toolCalls.length} herramienta(s) por llamar.`);
                for (const toolCall of toolCalls) {
                  let output = "";
                  console.log(`[OpenAI Tool Call] Ejecutando función: ${toolCall.function.name}, ID de llamada: ${toolCall.id}`);
                  try {
                    if (toolCall.function.name === 'get_clima_actual') {
                      output = await getWeather();
                    } else if (toolCall.function.name === 'fetchEfemeride') {
                      output = getEfemeride();
                    } else if (toolCall.function.name === 'get_current_time') {
                      output = getCurrentTime();
                    } else if (toolCall.function.name === 'access_web') {
                      output = "Actualmente no puedo acceder a información web externa para esta solicitud.";
                    } else {
                      console.warn(`[OpenAI Tool Call] Función desconocida: ${toolCall.function.name}`);
                      output = `Error: Función desconocida '${toolCall.function.name}' solicitada por el asistente.`;
                    }
                  } catch (toolError) {
                    console.error(`[OpenAI Tool Call] Error al ejecutar la herramienta ${toolCall.function.name}:`, toolError.stack);
                    output = `Error interno al ejecutar la herramienta ${toolCall.function.name}.`;
                  }
                  toolOutputs.push({ tool_call_id: toolCall.id, output: output });
                }
                if (toolOutputs.length > 0) {
                  console.log(`[OpenAI Tool Call] Enviando salidas de herramientas para Run ID ${run.id}:`, toolOutputs);
                  run = await openai.beta.threads.runs.submitToolOutputs(run.thread_id, run.id, { tool_outputs: toolOutputs });
                } else {
                  console.warn(`[OpenAI Tool Call] No se generaron salidas de herramientas para Run ID ${run.id}. Esto puede ser un error.`);
                }
              } else {
                console.warn(`[OpenAI Run] Estado 'requires_action' con tipo desconocido: ${run.required_action?.type}. Run ID: ${run.id}`);
                assistantResponseForUser = "🤖 El asistente requiere una acción que no reconozco. Por favor, intenta de nuevo.";
                break;
              }
            } else if (['queued', 'in_progress'].includes(run.status)) {
              await delay(POLLING_INTERVAL_MS);
              run = await openai.beta.threads.runs.retrieve(run.thread_id, run.id);
            } else {
              console.warn(`[OpenAI Run] Estado terminal no manejado explícitamente: ${run.status}. Run ID: ${run.id}`);
              assistantResponseForUser = `🤖 El procesamiento de tu solicitud terminó con estado: ${run.status}.`;
              break;
            }
            pollingAttempts++;
          }

          if (pollingAttempts >= MAX_POLLING_ATTEMPTS && !['completed', 'failed', 'cancelled', 'expired'].includes(run.status)) {
            console.warn(`[OpenAI Polling] Run ID ${run.id} alcanzó el máximo de sondeos (${MAX_POLLING_ATTEMPTS}) sin llegar a un estado terminal completo. Estado final: ${run.status}.`);
            assistantResponseForUser = `🤖 El procesamiento de tu solicitud está tardando más de lo esperado (estado final: ${run.status}). Por favor, intenta nuevamente en unos momentos.`;
          }
        } catch (openaiError) {
          console.error("❌ Error durante la interacción con API de OpenAI:", openaiError.stack);
          let userFacingErrorMessage = "⚠️ Hubo un error al comunicarme con el asistente de IA. Intenta nuevamente más tarde.";
          if (openaiError.status) {
            console.error(`  OpenAI Error Details: Status=${openaiError.status}, Code=${openaiError.code}, Type=${openaiError.type}, Message=${openaiError.message}`);
            if (openaiError.status === 429) {
                userFacingErrorMessage = "⚠️ Demasiadas solicitudes al asistente. Por favor, espera un momento y vuelve a intentarlo.";
            } else if (openaiError.status === 401) {
                userFacingErrorMessage = "⚠️ Problema de autenticación con el asistente. Notifica al administrador.";
            } else if (openaiError.status === 400) {
                userFacingErrorMessage = `⚠️ Tu solicitud no pudo ser procesada por el asistente (Error: ${openaiError.code || openaiError.status}). Verifica tu mensaje o intenta de forma diferente.`;
            } else if (openaiError.status >= 500) {
                userFacingErrorMessage = "⚠️ El servicio del asistente de IA está experimentando problemas. Intenta más tarde.";
            }
          }
          assistantResponseForUser = userFacingErrorMessage;
        }
        return msg.reply(`${assistantResponseForUser}\n\n🤖 Asistente IA\nMunicipalidad de General San Martín.`);
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

    console.log("🚀 Inicializando cliente de WhatsApp...");
    await client.initialize();
    console.log("🚀 Cliente de WhatsApp inicializado.");
    console.log("🚀🚀🚀 Final de la configuración del cliente y handlers. Esperando eventos...");

  } catch (error) {
    console.error("❌ Error durante la inicialización del bot:", error.stack);
    process.exit(1);
  }
})();
