// index.js FINAL DEFINITIVO - Bot WhatsApp Corregido y Depurado
// Versión estable con gestión mejorada de runs concurrentes

// Solo carga .env si no estamos en Fly.io (FLY_APP_NAME no está definido)
if (!process.env.FLY_APP_NAME) {
  console.log("INFO: [index.js] FLY_APP_NAME no definido, cargando .env");
  require("dotenv").config();
} else {
  console.log("INFO: [index.js] FLY_APP_NAME definido, omitiendo carga de .env");
}

const fs = require("fs").promises; // Para manejo de archivos
const path = require("path"); // Para manejar rutas de archivos
const express = require("express");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const { OpenAI } = require("openai");
const { getWeather, getEfemeride, getCurrentTime } = require("./functions-handler");
const { speechToText } = require("./speech-utils.js");

// ----------------------------------------------------
// 1. Configuración y Validación
// ----------------------------------------------------
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;
// Se unifica el manejo de la clave de OpenWeather. Se prioriza OPENWEATHER_API_KEY.
const OPENWEATHER_API_KEY_ENV = process.env.OPENWEATHER_API_KEY || process.env.OPENWEATHER_KEY;

if (OPENWEATHER_API_KEY_ENV) {
  // Asegura que la variable que usará el resto del código esté seteada.
  process.env.OPENWEATHER_API_KEY = OPENWEATHER_API_KEY_ENV;
}

if (!OPENAI_API_KEY || !OPENAI_ASSISTANT_ID || !OPENWEATHER_API_KEY_ENV) {
  console.error("❌ [CRÍTICO] Variables de entorno faltantes (OPENAI_API_KEY, OPENAI_ASSISTANT_ID, OPENWEATHER_API_KEY).");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
console.log("✅ [OpenAI] Configuración validada correctamente");

// Configuración optimizada
const CONFIG = {
  TIMEOUT_PRINCIPAL: 45,
  TIMEOUT_REINTENTO: 35,
  TIMEOUT_RAPIDO: 25,
  MAX_REINTENTOS: 2,
  LIMPIEZA_RUNS: 2 * 60 * 1000,
  OPTIMIZACION: 10 * 60 * 1000,
  STATS_INTERVAL: 5 * 60 * 1000,
  ASSISTANT: {
    temperature: 0.6,
    timeout_interno: 40000,
    max_contexto: 12
  }
};

const FIRMA_ASISTENTE = {
  sufijo: "\n\n🤖 _Asistente IA - Municipalidad San Martín_",
  activa: true
};

const MENSAJE_INICIAL = {
  activo: true,
  prompt: "Actúa como si fuera el primer contacto. Salúdalo profesionalmente como asistente de la Municipalidad de San Martín."
};

// ----------------------------------------------------
// 2. Cliente WhatsApp Optimizado
// ----------------------------------------------------
const client = new Client({
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox", 
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--disable-extensions",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--memory-pressure-off",
      `--user-data-dir=/app/session/wwebjs_auth_data` // Asegurar que Puppeteer use el volumen montado
    ]
  },
  authStrategy: new LocalAuth({
    dataPath: "/app/session/wwebjs_auth_data" // Ruta absoluta para LocalAuth
  })
});

// ----------------------------------------------------
// 3. Variables Globales
// ----------------------------------------------------
const chatThreads = new Map();      
const humanModeUsers = new Set();   
const userFaileds = new Map();      
const activeRuns = new Map();       
const pendingMessages = new Map();  
const threadLocks = new Map();      
const usuariosConocidos = new Set();

const TEMP_AUDIO_DIR = path.join(__dirname, 'temp_audio'); // Directorio para audios temporales
const stats = {
  mensajes_recibidos: 0,
  mensajes_filtrados: 0,
  respuestas_exitosas: 0,
  respuestas_reintento: 0,
  timeouts_primer_intento: 0,
  timeouts_totales: 0,
  usuarios_nuevos: 0,
  errores: 0,
  runs_cancelados: 0,  // NUEVO: Contador de runs cancelados
  tiempo_promedio: [],
  inicio: Date.now()
};

// ----------------------------------------------------
// 4. Funciones de Utilidad Básicas
// ----------------------------------------------------

function limpiarNumero(numero) {
  return numero?.replace(/[^\d]/g, "") || "";
}

function formatearTiempo(ms) {
  return (ms / 1000).toFixed(1);
}

function obtenerUptime() {
  return Math.floor((Date.now() - stats.inicio) / 1000 / 60);
}

/**
 * Limpia el texto de respuesta del asistente, eliminando artefactos no deseados
 * como las citaciones de archivos (ej: 【1:0†source.pdf】), pero conservando
 * el formato de WhatsApp (negritas, itálicas) y los emojis.
 * @param {string} texto El texto a limpiar.
 * @returns {string} El texto limpio.
 */
function limpiarRespuestaAsistente(texto) {
  if (typeof texto !== 'string') return texto;
  // Elimina las citaciones que OpenAI a veces agrega, como 【...】
  return texto.replace(/【.*?】/g, '').trim();
}

// ----------------------------------------------------
// 5. Filtros de Mensajes Estrictos
// ----------------------------------------------------

function esGrupo(chatId) {
  return chatId.includes("@g.us");
}

function esBot(message) {
  return message.fromMe || 
         message.from === "status@broadcast" ||
         message.author?.includes("bot");
}

function esComandoAdmin(body) {
  const comandos = ["!stats", "!status", "!help", "!human", "!ai", "!cleanup"];
  return comandos.some(cmd => body.toLowerCase().startsWith(cmd));
}

function esSpamOVacio(body) {
  if (!body || body.trim().length === 0) return true;
  if (body.length < 3) return true;
  
  const spamPatterns = [
    /^(.)\1{4,}$/,
    /^[0-9\s\-\+\(\)]{10,}$/,
    /^\W+$/,
  ];
  
  return spamPatterns.some(pattern => pattern.test(body.trim()));
}

function debeIgnorarMensaje(message) {
  try {
    const body = message.body?.trim() || "";
    
    const from = message.from;
    const isGroup = esGrupo(message.from);
    const isBot = esBot(message);
    const isEmpty = !body || body.length === 0;
    const isSpam = esSpamOVacio(body);
    const isAdmin = esComandoAdmin(body);
    
    if (isGroup) {
      console.log(`🚫 [FILTRO] Mensaje de grupo ignorado: ${from}`);
      stats.mensajes_filtrados++;
      return true;
    }
    
    if (isBot) {
      console.log(`🚫 [FILTRO] Bot/automático ignorado: ${from}`);
      stats.mensajes_filtrados++;
      return true;
    }
    
    if (isEmpty || isSpam) {
      console.log(`🚫 [FILTRO] Spam/vacío ignorado: "${body.substring(0, 50)}..."`);
      stats.mensajes_filtrados++;
      return true;
    }
    
    if (isAdmin) {
      console.log(`✅ [FILTRO] Comando admin permitido: ${body}`);
      return false;
    }
    
    console.log(`✅ [FILTRO] Mensaje válido de: ${from} - "${body.substring(0, 50)}..."`);
    return false;
    
  } catch (error) {
    console.error("❌ [ERROR-FILTRO]", error);
    stats.mensajes_filtrados++;
    return true;
  }
}

// ----------------------------------------------------
// 6. Gestión de Threads y Contexto
// ----------------------------------------------------

async function obtenerOCrearThread(chatId) {
  if (!chatThreads.has(chatId)) {
    try {
      const thread = await openai.beta.threads.create();
      chatThreads.set(chatId, thread.id);
      console.log(`🧵 [THREAD] Nuevo thread creado para ${chatId}: ${thread.id}`);
    } catch (error) {
      console.error("❌ [ERROR-THREAD]", error);
      throw error;
    }
  }
  return chatThreads.get(chatId);
}

async function limpiarContextoSiNecesario(threadId) {
  try {
    const messages = await openai.beta.threads.messages.list(threadId);
    
    if (messages.data.length > CONFIG.ASSISTANT.max_contexto) {
      console.log(`🧹 [LIMPIEZA] Thread ${threadId} tiene ${messages.data.length} mensajes, limpiando...`);
      
      const nuevoThread = await openai.beta.threads.create();
      
      for (let [chatId, tId] of chatThreads.entries()) {
        if (tId === threadId) {
          chatThreads.set(chatId, nuevoThread.id);
          console.log(`🔄 [THREAD] Reemplazado ${threadId} por ${nuevoThread.id} para ${chatId}`);
          break;
        }
      }
      
      return nuevoThread.id;
    }
    
    return threadId;
  } catch (error) {
    console.error("❌ [ERROR-LIMPIEZA]", error);
    return threadId;
  }
}

// ----------------------------------------------------
// 7. ✅ GESTIÓN MEJORADA DE RUNS CONCURRENTES
// ----------------------------------------------------

// ✅ NUEVA FUNCIÓN: Cancelar runs activos en un thread
async function cancelarRunsActivosEnThread(threadId) {
  try {
    const runsACancelar = [];
    
    // Buscar runs activos en el thread
    for (let [runId, runInfo] of activeRuns.entries()) {
      if (runInfo.threadId === threadId) {
        runsACancelar.push(runId);
      }
    }
    
    if (runsACancelar.length > 0) {
      console.log(`🛑 [CANCEL] Cancelando ${runsACancelar.length} runs activos en thread ${threadId}`);
      
      for (let runId of runsACancelar) {
        try {
          await openai.beta.threads.runs.cancel(threadId, runId);
          activeRuns.delete(runId);
          stats.runs_cancelados++;
          console.log(`✅ [CANCEL-OK] Run cancelado: ${runId}`);
        } catch (cancelError) {
          console.log(`⚠️ [CANCEL-ERROR] No se pudo cancelar ${runId}: ${cancelError.message}`);
          activeRuns.delete(runId); // Eliminar anyway
        }
      }
      
      // Pausa para asegurar la cancelación
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    
  } catch (error) {
    console.error("❌ [ERROR-CANCEL-RUNS]", error);
  }
}

// ✅ NUEVA FUNCIÓN: Limpiar todos los runs de un thread
async function limpiarRunsDelThread(threadId) {
  try {
    const runsAEliminar = [];
    for (let [runId, runInfo] of activeRuns.entries()) {
      if (runInfo.threadId === threadId) {
        runsAEliminar.push(runId);
      }
    }
    
    for (let runId of runsAEliminar) {
      activeRuns.delete(runId);
      console.log(`🧹 [CLEANUP] Run eliminado: ${runId}`);
    }
    
    if (runsAEliminar.length > 0) {
      console.log(`🧹 [CLEANUP-COMPLETE] ${runsAEliminar.length} runs limpiados del thread ${threadId}`);
    }
  } catch (error) {
    console.error("❌ [ERROR-CLEANUP-RUNS]", error);
  }
}

// ✅ FUNCIÓN MEJORADA: Procesamiento con gestión de runs
async function procesarConAssistant(message, threadId, timeoutMs = CONFIG.TIMEOUT_PRINCIPAL * 1000) {
  const startTime = Date.now();
  
  try {
    let prompt = message.body;
    const esNuevoUsuario = !usuariosConocidos.has(message.from);
    
    if (esNuevoUsuario && MENSAJE_INICIAL.activo) {
      prompt = `${MENSAJE_INICIAL.prompt}\n\nMensaje del usuario: ${prompt}`;
      usuariosConocidos.add(message.from);
      stats.usuarios_nuevos++;
      console.log(`👋 [NUEVO] Usuario nuevo detectado: ${message.from}`);
    }
    
    // ✅ NUEVO: Verificar y cancelar runs activos antes de crear mensaje
    await cancelarRunsActivosEnThread(threadId);
    
    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: prompt
    });
    
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: OPENAI_ASSISTANT_ID,
      temperature: CONFIG.ASSISTANT.temperature
    });
    
    console.log(`🤖 [RUN] Iniciado: ${run.id} para thread ${threadId}`);
    activeRuns.set(run.id, { 
      inicio: Date.now(), 
      threadId, 
      chatId: message.from 
    });
    
    const resultado = await esperarCompletado(threadId, run.id, timeoutMs);
    
    activeRuns.delete(run.id);
    
    const tiempoTotal = Date.now() - startTime;
    stats.tiempo_promedio.push(tiempoTotal);
    if (stats.tiempo_promedio.length > 50) {
      stats.tiempo_promedio = stats.tiempo_promedio.slice(-30);
    }
    
    return resultado;
    
  } catch (error) {
    console.error("❌ [ERROR-ASSISTANT]", error);
    
    // ✅ MEJORADO: Limpiar runs activos del thread problemático
    await limpiarRunsDelThread(threadId);
    
    throw error;
  }
}

// ✅ FUNCIÓN MEJORADA: Esperar completado con mejor manejo
async function esperarCompletado(threadId, runId, timeoutMs) {
  const maxTime = Date.now() + timeoutMs;
  const pollInterval = 2000;
  let lastStatusLog = 0;
  
  while (Date.now() < maxTime) {
    try {
      const run = await openai.beta.threads.runs.retrieve(threadId, runId);

      if (run.status === "completed") {
        const messages = await openai.beta.threads.messages.list(threadId);
        const lastMessage = messages.data[0];
        
        if (lastMessage && lastMessage.role === "assistant") {
          let respuesta = lastMessage.content[0]?.text?.value || "Sin respuesta";
          
          if (FIRMA_ASISTENTE.activa) {
            respuesta += FIRMA_ASISTENTE.sufijo;
          }
          
          return respuesta;
        }
      }

      if (run.status === "requires_action" && run.required_action?.type === "submit_tool_outputs") {
        const toolCalls = run.required_action.submit_tool_outputs.tool_calls;
        const toolOutputs = [];
        for (const toolCall of toolCalls) {
          let output = "";
          try {
            switch (toolCall.function.name) {
              case "get_clima_actual":
                output = await getWeather();
                break;
              case "fetchEfemeride":
                output = getEfemeride();
                break;
              case "get_current_time":
                output = getCurrentTime();
                break;
              case "access_web":
                output = "Actualmente no puedo acceder a información web externa para esta solicitud.";
                break;
              default:
                output = `Error: Función desconocida '${toolCall.function.name}' solicitada por el asistente.`;
            }
          } catch (err) {
            output = `Error interno al ejecutar la herramienta ${toolCall.function.name}.`;
          }
          toolOutputs.push({ tool_call_id: toolCall.id, output });
        }

        if (toolOutputs.length > 0) {
          await openai.beta.threads.runs.submitToolOutputs(threadId, runId, { tool_outputs: toolOutputs });
        } else {
          throw new Error("No se pudieron procesar las herramientas solicitadas por el asistente.");
        }
        continue; // seguir el loop hasta nueva recuperación
      }

      if (run.status === "failed" || run.status === "cancelled" || run.status === "expired") {
        throw new Error(`Run ${run.status}: ${run.last_error?.message || "Error desconocido"}`);
      }
      
      // ✅ MEJORADO: Log de progreso sin spam
      const tiempoTranscurrido = Date.now() - activeRuns.get(runId)?.inicio;
      if (tiempoTranscurrido > 20000 && Date.now() - lastStatusLog > 10000) {
        console.log(`⏰ [PROGRESS] Run ${runId} - ${Math.floor(tiempoTranscurrido/1000)}s - Status: ${run.status}`);
        lastStatusLog = Date.now();
      }
      
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      
    } catch (error) {
      if (error.message.includes("Run")) {
        throw error;
      }
      console.error("❌ [ERROR-POLLING]", error);
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }
  
  // ✅ MEJORADO: Cancelar run antes de timeout
  try {
    console.log(`🛑 [TIMEOUT-CANCEL] Cancelando run por timeout: ${runId}`);
    await openai.beta.threads.runs.cancel(threadId, runId);
    stats.runs_cancelados++;
    console.log(`✅ [TIMEOUT-CANCEL-OK] Run cancelado por timeout`);
  } catch (cancelError) {
    console.log(`⚠️ [TIMEOUT-CANCEL-ERROR] ${cancelError.message}`);
  }
  
  throw new Error("TIMEOUT: El asistente no respondió en el tiempo esperado");
}

// ----------------------------------------------------
// 8. Manejo de Comandos Administrativos
// ----------------------------------------------------

async function manejarComandoAdmin(message) {
  const body = message.body.toLowerCase().trim();
  const chatId = message.from;
  
  try {
    switch (true) {
      case body.startsWith("!stats"):
        await enviarStats(message);
        break;
        
      case body.startsWith("!status"):
        await enviarStatus(message);
        break;

      case body.startsWith("!uptime"):
        await enviarUptime(message);
        break;
        
      case body.startsWith("!help"):
        await enviarAyuda(message);
        break;
        
      case body.startsWith("!cleanup"):
        await limpiarRunsGlobales(message);
        break;
        
      case body.startsWith("!human"):
        humanModeUsers.add(chatId);
        await message.reply("🧑‍💼 *Modo humano activado*\nTus mensajes no serán procesados por el asistente IA hasta que uses `!ai`");
        break;
        
      case body.startsWith("!ai"):
        humanModeUsers.delete(chatId);
        await message.reply("🤖 *Modo IA activado*\nTus mensajes serán procesados por el asistente IA");
        break;
        
      default:
        await message.reply("❓ Comando no reconocido. Usa `!help` para ver comandos disponibles.");
    }
  } catch (error) {
    console.error("❌ [ERROR-ADMIN]", error);
    await message.reply("❌ Error al procesar comando administrativo");
  }
}

async function enviarStats(message) {
  const uptime = obtenerUptime();
  const promedioTiempo = stats.tiempo_promedio.length > 0 
    ? formatearTiempo(stats.tiempo_promedio.reduce((a, b) => a + b, 0) / stats.tiempo_promedio.length)
    : "0.0";
  
  const statsText = `📊 *ESTADÍSTICAS DEL BOT*

⏱️ *Tiempo activo:* ${uptime} minutos
📨 *Mensajes recibidos:* ${stats.mensajes_recibidos}
🚫 *Mensajes filtrados:* ${stats.mensajes_filtrados}
✅ *Respuestas exitosas:* ${stats.respuestas_exitosas}
🔄 *Respuestas con reintento:* ${stats.respuestas_reintento}
⏰ *Timeouts primer intento:* ${stats.timeouts_primer_intento}
🚨 *Timeouts totales:* ${stats.timeouts_totales}
👥 *Usuarios nuevos:* ${stats.usuarios_nuevos}
❌ *Errores:* ${stats.errores}
🛑 *Runs cancelados:* ${stats.runs_cancelados}
⚡ *Tiempo promedio:* ${promedioTiempo}s

🧵 *Threads activos:* ${chatThreads.size}
🏃 *Runs activos:* ${activeRuns.size}
👤 *Modo humano:* ${humanModeUsers.size} usuarios`;

  await message.reply(statsText);
}

async function enviarStatus(message) {
  const runsActivos = Array.from(activeRuns.entries()).map(([runId, info]) => {
    const tiempo = Math.floor((Date.now() - info.inicio) / 1000);
    return `• ${runId.substring(0, 8)}... (${tiempo}s)`;
  }).join('\n');
  
  const statusText = `🔍 *ESTADO DEL SISTEMA*

🏃 *Runs activos (${activeRuns.size}):*
${runsActivos || "Ninguno"}

🧵 *Threads:* ${chatThreads.size}
👤 *Modo humano:* ${humanModeUsers.size}
📝 *Mensajes pendientes:* ${pendingMessages.size}
🔒 *Locks activos:* ${threadLocks.size}

💾 *Memoria:* ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`;

  await message.reply(statusText);
}

async function enviarUptime(message) {
  const uptime = obtenerUptime();
  const memory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  await message.reply(`⏱️ *Uptime:* ${uptime} minutos\n💾 *Memoria:* ${memory}MB`);
}

async function enviarAyuda(message) {
  const helpText = `🆘 *COMANDOS ADMINISTRATIVOS*

📊 \`!stats\` - Estadísticas del bot
🔍 \`!status\` - Estado actual del sistema
⏱️ \`!uptime\` - Mostrar tiempo activo
🧹 \`!cleanup\` - Limpiar runs activos
👤 \`!human\` - Activar modo humano (sin IA)
🤖 \`!ai\` - Activar modo IA
❓ \`!help\` - Mostrar esta ayuda

*Nota:* Los comandos admin solo funcionan en chats privados.`;

  await message.reply(helpText);
}

async function limpiarRunsGlobales(message) {
  try {
    const runsALimpiar = activeRuns.size;
    
    for (let [runId, runInfo] of activeRuns.entries()) {
      try {
        await openai.beta.threads.runs.cancel(runInfo.threadId, runId);
        console.log(`🧹 [CLEANUP-GLOBAL] Run cancelado: ${runId}`);
      } catch (error) {
        console.log(`⚠️ [CLEANUP-GLOBAL] Error cancelando ${runId}: ${error.message}`);
      }
    }
    
    activeRuns.clear();
    stats.runs_cancelados += runsALimpiar;
    
    await message.reply(`🧹 *Limpieza completada*\n${runsALimpiar} runs cancelados y limpiados.`);
    
  } catch (error) {
    console.error("❌ [ERROR-CLEANUP-GLOBAL]", error);
    await message.reply("❌ Error durante la limpieza global");
  }
}

// ----------------------------------------------------
// 9. Procesamiento Principal de Mensajes
// ----------------------------------------------------

async function procesarMensaje(message) {
  const startTime = Date.now();
  stats.mensajes_recibidos++;
  
  try {
    if (debeIgnorarMensaje(message)) {
      return;
    }
    
    const chatId = message.from;
    const body = message.body?.trim() || "";
    
    if (esComandoAdmin(body)) {
      await manejarComandoAdmin(message);
      return;
    }
    
    if (humanModeUsers.has(chatId)) {
      console.log(`👤 [HUMAN-MODE] Mensaje ignorado de ${chatId} (modo humano activo)`);
      return;
    }
    
    // Verificar si hay un mensaje pendiente para este chat
    if (pendingMessages.has(chatId)) {
      console.log(`⏳ [PENDING] Mensaje en cola para ${chatId}, ignorando duplicado`);
      return;
    }
    
    // Verificar si el thread está bloqueado
    if (threadLocks.has(chatId)) {
      console.log(`🔒 [LOCKED] Thread bloqueado para ${chatId}, ignorando mensaje`);
      return;
    }
    
    // Marcar mensaje como pendiente y bloquear thread
    pendingMessages.set(chatId, { message, timestamp: Date.now() });
    threadLocks.set(chatId, Date.now());
    
    try {
      console.log(`📨 [PROCESANDO] Mensaje de ${chatId}: "${body.substring(0, 100)}..."`);
      
      const threadId = await obtenerOCrearThread(chatId);
      const threadLimpio = await limpiarContextoSiNecesario(threadId);
      
      let respuesta;
      let intentos = 0;
      const maxIntentos = CONFIG.MAX_REINTENTOS;
      
      while (intentos < maxIntentos) {
        try {
          const timeout = intentos === 0 ? CONFIG.TIMEOUT_PRINCIPAL : CONFIG.TIMEOUT_REINTENTO;
          respuesta = await procesarConAssistant(message, threadLimpio, timeout * 1000);
          
          if (intentos > 0) {
            stats.respuestas_reintento++;
          }
          break;
          
        } catch (error) {
          intentos++;
          
          if (error.message.includes("TIMEOUT")) {
            if (intentos === 1) {
              stats.timeouts_primer_intento++;
            }
            stats.timeouts_totales++;
            
            console.log(`⏰ [TIMEOUT] Intento ${intentos}/${maxIntentos} para ${chatId}`);
            
            if (intentos < maxIntentos) {
              console.log(`🔄 [REINTENTO] Esperando antes del siguiente intento...`);
              await new Promise(resolve => setTimeout(resolve, 3000));
              continue;
            }
          }
          
          throw error;
        }
      }
      
      if (!respuesta) {
        throw new Error("No se pudo obtener respuesta después de todos los intentos");
      }
      
      // Limpiar respuesta antes de enviar
      const respuestaLimpia = limpiarRespuestaAsistente(respuesta);
      
      await message.reply(respuestaLimpia);
      stats.respuestas_exitosas++;
      
      const tiempoTotal = Date.now() - startTime;
      console.log(`✅ [ÉXITO] Respuesta enviada a ${chatId} en ${formatearTiempo(tiempoTotal)}s`);
      
    } catch (error) {
      stats.errores++;
      console.error(`❌ [ERROR-PROCESAMIENTO] ${chatId}:`, error);
      
      const mensajeError = error.message.includes("TIMEOUT") 
        ? "⏰ El asistente está experimentando alta demanda. Por favor, intenta nuevamente en unos momentos."
        : "❌ Ocurrió un error al procesar tu mensaje. Por favor, intenta nuevamente.";
      
      try {
        await message.reply(mensajeError);
      } catch (replyError) {
        console.error("❌ [ERROR-REPLY]", replyError);
      }
      
      // Limpiar runs problemáticos
      const threadId = chatThreads.get(chatId);
      if (threadId) {
        await limpiarRunsDelThread(threadId);
      }
    }
    
  } catch (error) {
    stats.errores++;
    console.error("❌ [ERROR-GENERAL]", error);
  } finally {
    // Limpiar estado del chat
    const chatId = message.from;
    pendingMessages.delete(chatId);
    threadLocks.delete(chatId);
  }
}

// ----------------------------------------------------
// 10. Manejo de Mensajes de Audio
// ----------------------------------------------------

async function procesarAudio(message) {
  let tempFilePath = null;
  
  try {
    console.log(`🎵 [AUDIO] Procesando mensaje de audio de ${message.from}`);
    
    const media = await message.downloadMedia();
    if (!media || !media.data) {
      throw new Error("No se pudo descargar el archivo de audio");
    }
    
    // Crear nombre único para el archivo temporal
    const timestamp = Date.now();
    const fileName = `audio_${timestamp}.ogg`;
    tempFilePath = path.join(TEMP_AUDIO_DIR, fileName);
    
    // Guardar el archivo de audio
    await fs.writeFile(tempFilePath, media.data, 'base64');
    console.log(`💾 [AUDIO] Archivo guardado temporalmente: ${tempFilePath}`);
    
    // Transcribir el audio
    const textoTranscrito = await speechToText(openai, tempFilePath);
    
    if (!textoTranscrito || textoTranscrito.trim().length === 0) {
      await message.reply("🎵 No pude entender el audio. Por favor, intenta enviar un mensaje de texto o un audio más claro.");
      return;
    }
    
    console.log(`📝 [AUDIO] Texto transcrito: "${textoTranscrito}"`);
    
    // Crear un mensaje simulado con el texto transcrito.
    // Es crucial clonar el objeto manteniendo su prototipo para que métodos como .reply() sigan funcionando.
    const mensajeSimulado = Object.assign(Object.create(Object.getPrototypeOf(message)), message);
    // La propiedad 'client' no es enumerable y no se copia con Object.assign.
    // La reasignamos manualmente para que los métodos como .reply() funcionen.
    mensajeSimulado.client = client;
    mensajeSimulado.body = textoTranscrito;
    mensajeSimulado.hasMedia = false; // Se trata como un mensaje de texto
    
    // Procesar como mensaje de texto normal
    await procesarMensaje(mensajeSimulado);
    
  } catch (error) {
    console.error("❌ [ERROR-AUDIO]", error);
    await message.reply("❌ Ocurrió un error al procesar el audio. Por favor, intenta enviar un mensaje de texto.");
  } finally {
    // Limpiar archivo temporal
    if (tempFilePath) {
      try {
        await fs.unlink(tempFilePath);
        console.log(`🗑️ [AUDIO] Archivo temporal eliminado: ${tempFilePath}`);
      } catch (cleanupError) {
        console.error("⚠️ [AUDIO-CLEANUP]", cleanupError);
      }
    }
  }
}

// ----------------------------------------------------
// 11. Inicialización y Health Check
// ----------------------------------------------------

async function setupDirectories() {
  try {
    // Verificar si el directorio existe antes de intentar crearlo
    try {
      await fs.access(TEMP_AUDIO_DIR);
      console.log(`✅ [SETUP] Directorio temporal de audio ya existe: ${TEMP_AUDIO_DIR}`);
    } catch (accessError) {
      // El directorio no existe, intentar crearlo
      await fs.mkdir(TEMP_AUDIO_DIR, { recursive: true });
      console.log(`✅ [SETUP] Directorio temporal de audio creado: ${TEMP_AUDIO_DIR}`);
    }
  } catch (error) {
    console.error(`❌ [CRÍTICO] No se pudo crear el directorio temporal de audio: ${TEMP_AUDIO_DIR}`, error);
    // En lugar de salir, intentar usar un directorio temporal del sistema
    try {
      const os = require('os');
      const tempDir = path.join(os.tmpdir(), 'whatsapp_bot_audio');
      await fs.mkdir(tempDir, { recursive: true });
      // Actualizar la variable global
      global.TEMP_AUDIO_DIR = tempDir;
      console.log(`⚠️ [FALLBACK] Usando directorio temporal del sistema: ${tempDir}`);
    } catch (fallbackError) {
      console.error(`❌ [CRÍTICO] No se pudo crear directorio de fallback:`, fallbackError);
      process.exit(1);
    }
  }
}

setupDirectories(); // Asegurarse de que el directorio exista al iniciar

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get("/", (req, res) => {
  const uptime = obtenerUptime();
  res.json({
    status: "Bot WhatsApp Municipalidad San Martín",
    uptime: `${uptime} minutos`,
    stats: {
      mensajes_recibidos: stats.mensajes_recibidos,
      respuestas_exitosas: stats.respuestas_exitosas,
      errores: stats.errores,
      threads_activos: chatThreads.size,
      runs_activos: activeRuns.size
    },
    timestamp: new Date().toISOString()
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: obtenerUptime()
  });
});

app.get("/stats", (req, res) => {
  const uptime = obtenerUptime();
  const promedioTiempo = stats.tiempo_promedio.length > 0
    ? formatearTiempo(stats.tiempo_promedio.reduce((a, b) => a + b, 0) / stats.tiempo_promedio.length)
    : "0.0";

  res.json({
    uptime,
    mensajes_recibidos: stats.mensajes_recibidos,
    mensajes_filtrados: stats.mensajes_filtrados,
    respuestas_exitosas: stats.respuestas_exitosas,
    respuestas_reintento: stats.respuestas_reintento,
    timeouts_primer_intento: stats.timeouts_primer_intento,
    timeouts_totales: stats.timeouts_totales,
    usuarios_nuevos: stats.usuarios_nuevos,
    errores: stats.errores,
    runs_cancelados: stats.runs_cancelados,
    tiempo_promedio: promedioTiempo,
    threads_activos: chatThreads.size,
    runs_activos: activeRuns.size,
    modo_humano: humanModeUsers.size
  });
});

// ----------------------------------------------------
// 12. Event Handlers del Cliente WhatsApp
// ----------------------------------------------------

client.on("qr", (qr) => {
  console.log("🔗 [QR] Código QR generado:");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log("✅ [WHATSAPP] Cliente conectado y listo");
  console.log(`🤖 [BOT] Asistente IA activo - Municipalidad San Martín`);
  console.log(`🌐 [SERVER] Servidor health check en puerto ${PORT}`);
});

client.on("authenticated", () => {
  console.log("🔐 [AUTH] Cliente autenticado correctamente");
});

client.on("auth_failure", (msg) => {
  console.error("❌ [AUTH-FAIL] Fallo en autenticación:", msg);
});

client.on("disconnected", (reason) => {
  console.log("🔌 [DISCONNECT] Cliente desconectado:", reason);
});

client.on("message_create", async (message) => {
  try {
    // Verificar si el mensaje tiene audio
    if (message.hasMedia && message.type === 'ptt') {
      await procesarAudio(message);
    } else {
      await procesarMensaje(message);
    }
  } catch (error) {
    console.error("❌ [ERROR-MESSAGE-HANDLER]", error);
  }
});

// ----------------------------------------------------
// 13. Tareas de Mantenimiento
// ----------------------------------------------------

// Limpieza periódica de runs antiguos
setInterval(async () => {
  try {
    const ahora = Date.now();
    const runsALimpiar = [];
    
    for (let [runId, runInfo] of activeRuns.entries()) {
      if (ahora - runInfo.inicio > CONFIG.LIMPIEZA_RUNS) {
        runsALimpiar.push(runId);
      }
    }
    
    if (runsALimpiar.length > 0) {
      console.log(`🧹 [MANTENIMIENTO] Limpiando ${runsALimpiar.length} runs antiguos`);
      
      for (let runId of runsALimpiar) {
        const runInfo = activeRuns.get(runId);
        try {
          await openai.beta.threads.runs.cancel(runInfo.threadId, runId);
        } catch (error) {
          console.log(`⚠️ [MANTENIMIENTO] Error cancelando ${runId}: ${error.message}`);
        }
        activeRuns.delete(runId);
        stats.runs_cancelados++;
      }
    }
  } catch (error) {
    console.error("❌ [ERROR-MANTENIMIENTO]", error);
  }
}, CONFIG.LIMPIEZA_RUNS);

// Optimización periódica
setInterval(() => {
  try {
    // Limpiar mensajes pendientes antiguos
    const ahora = Date.now();
    for (let [chatId, info] of pendingMessages.entries()) {
      if (ahora - info.timestamp > 300000) { // 5 minutos
        pendingMessages.delete(chatId);
        threadLocks.delete(chatId);
        console.log(`🧹 [OPTIMIZACIÓN] Mensaje pendiente limpiado: ${chatId}`);
      }
    }
    
    // Limpiar locks antiguos
    for (let [chatId, timestamp] of threadLocks.entries()) {
      if (ahora - timestamp > 300000) { // 5 minutos
        threadLocks.delete(chatId);
        console.log(`🧹 [OPTIMIZACIÓN] Lock limpiado: ${chatId}`);
      }
    }
    
    // Forzar garbage collection si está disponible
    if (global.gc) {
      global.gc();
      console.log("🗑️ [OPTIMIZACIÓN] Garbage collection ejecutado");
    }
    
  } catch (error) {
    console.error("❌ [ERROR-OPTIMIZACIÓN]", error);
  }
}, CONFIG.OPTIMIZACION);

// Estadísticas periódicas
setInterval(() => {
  const uptime = obtenerUptime();
  const memoryUsage = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  
  console.log(`📊 [STATS] Uptime: ${uptime}min | Memoria: ${memoryUsage}MB | Threads: ${chatThreads.size} | Runs: ${activeRuns.size} | Mensajes: ${stats.mensajes_recibidos}`);
}, CONFIG.STATS_INTERVAL);

// ----------------------------------------------------
// 14. Inicialización Final
// ----------------------------------------------------

console.log("🚀 [INICIO] Inicializando Bot WhatsApp Municipalidad San Martín...");
console.log(`⚙️ [CONFIG] Timeouts: Principal=${CONFIG.TIMEOUT_PRINCIPAL}s, Reintento=${CONFIG.TIMEOUT_REINTENTO}s`);
console.log(`🔄 [CONFIG] Max reintentos: ${CONFIG.MAX_REINTENTOS}`);

// Inicializar cliente WhatsApp
client.initialize();

// Inicializar servidor Express
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 [SERVER] Servidor iniciado en puerto ${PORT}`);
});

// Manejo de señales del sistema
process.on('SIGINT', async () => {
  console.log('🛑 [SHUTDOWN] Recibida señal SIGINT, cerrando aplicación...');
  
  try {
    // Cancelar todos los runs activos
    for (let [runId, runInfo] of activeRuns.entries()) {
      try {
        await openai.beta.threads.runs.cancel(runInfo.threadId, runId);
      } catch (error) {
        console.log(`⚠️ [SHUTDOWN] Error cancelando ${runId}: ${error.message}`);
      }
    }
    
    // Cerrar cliente WhatsApp
    await client.destroy();
    console.log('✅ [SHUTDOWN] Cliente WhatsApp cerrado correctamente');
    
  } catch (error) {
    console.error('❌ [SHUTDOWN] Error durante el cierre:', error);
  }
  
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('🛑 [SHUTDOWN] Recibida señal SIGTERM, cerrando aplicación...');
  process.exit(0);
});

// Manejo de errores no capturados
process.on('uncaughtException', (error) => {
  console.error('❌ [UNCAUGHT-EXCEPTION]', error);
  stats.errores++;
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ [UNHANDLED-REJECTION]', reason);
  stats.errores++;
});

// Exportar funciones clave (disponibles para integraciones externas)
module.exports = {
  procesarConAssistant,
  obtenerOCrearThread
};

console.log("✅ [READY] Bot WhatsApp Municipalidad San Martín iniciado correctamente");

// Integración con Telegram deshabilitada intencionalmente
