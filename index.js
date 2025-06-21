// index.js FINAL DEFINITIVO - Bot WhatsApp Corregido y Depurado
// Versión estable con gestión mejorada de runs concurrentes

require("dotenv").config();
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const { OpenAI } = require("openai");
const http = require("http");
const express = require('express');

// ----------------------------------------------------
// 1. Configuración y Validación
// ----------------------------------------------------
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;
const OPENWEATHER_KEY = process.env.OPENWEATHER_KEY; // Asegurarse de que esta también se lea

if (!OPENAI_API_KEY || !OPENAI_ASSISTANT_ID || !OPENWEATHER_KEY) {
  console.error("❌ [CRÍTICO] Variables de entorno faltantes. Asegúrate de que OPENAI_API_KEY, OPENAI_ASSISTANT_ID y OPENWEATHER_KEY estén configuradas.");
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
        
      case body.startsWith("!help"):
        await enviarAyuda(message);
        break;
        
      case body.startsWith("!cleanup"):
        await limpiarRunsGlobales(message);
        break;
        
      case body.startsWith("!human"):
        humanModeUsers.add(chatId);
        await message.reply("🧑 Modo humano activado. Tus mensajes no serán procesados por IA.");
        break;
        
      case body.startsWith("!ai"):
        humanModeUsers.delete(chatId);
        await message.reply("🤖 Modo IA reactivado. Volviendo al procesamiento automático.");
        break;
        
      default:
        await message.reply("❓ Comando no reconocido. Usa !help para ver comandos disponibles.");
    }
  } catch (error) {
    console.error("❌ [ERROR-COMANDO]", error);
    await message.reply("❌ Error al ejecutar comando.");
  }
}

// ✅ NUEVA FUNCIÓN: Limpiar runs globales
async function limpiarRunsGlobales(message) {
  try {
    const runsAntesLimpieza = activeRuns.size;
    
    console.log(`🧹 [CLEANUP-GLOBAL] Iniciando limpieza de ${runsAntesLimpieza} runs activos`);
    
    const threadsAfectados = new Set();
    for (let [runId, runInfo] of activeRuns.entries()) {
      threadsAfectados.add(runInfo.threadId);
      try {
        await openai.beta.threads.runs.cancel(runInfo.threadId, runId);
        console.log(`✅ [CLEANUP-CANCEL] Run cancelado: ${runId}`);
      } catch (error) {
        console.log(`⚠️ [CLEANUP-CANCEL-ERROR] ${runId}: ${error.message}`);
      }
    }
    
    activeRuns.clear();
    stats.runs_cancelados += runsAntesLimpieza;
    
    await message.reply(`🧹 *Limpieza Completada*\n\n✅ Runs cancelados: ${runsAntesLimpieza}\n🧵 Threads afectados: ${threadsAfectados.size}\n📊 Total runs cancelados: ${stats.runs_cancelados}\n\nSistema optimizado y listo.`);

  } catch (error) {
    console.error("❌ [ERROR-CLEANUP-GLOBAL]", error);
    await message.reply("❌ Error durante la limpieza global.");
  }
}

async function enviarStats(message) {
  const uptime = obtenerUptime();
  const tasaExito = stats.mensajes_recibidos > 0 ? 
    Math.round((stats.respuestas_exitosas / stats.mensajes_recibidos) * 100) : 0;
  const tiempoPromedio = stats.tiempo_promedio.length > 0 ? 
    (stats.tiempo_promedio.reduce((a, b) => a + b, 0) / stats.tiempo_promedio.length / 1000).toFixed(1) : "0";
  const tasaTimeoutPrimer = stats.mensajes_recibidos > 0 ? 
    Math.round((stats.timeouts_primer_intento / stats.mensajes_recibidos) * 100) : 0;
    
  const statsMessage = `📊 *Estadísticas del Bot - MEJORADO*\n\n⏰ *Uptime:* ${uptime} minutos\n📊 *Performance:*\n  • Mensajes recibidos: ${stats.mensajes_recibidos}\n  • Mensajes filtrados: ${stats.mensajes_filtrados}\n  • Respuestas exitosas: ${stats.respuestas_exitosas}\n  • Respuestas por reintento: ${stats.respuestas_reintento}\n  • Tasa de éxito: ${tasaExito}%\n\n⚡ *Tiempos:*\n  • Tiempo promedio: ${tiempoPromedio}s\n  • Timeouts primer intento: ${stats.timeouts_primer_intento}\n  • Timeouts totales: ${stats.timeouts_totales}\n\n🔄 *Gestión de Runs:*\n  • Runs cancelados: ${stats.runs_cancelados}\n\n🚨 *Errores:*\n  • Errores generales: ${stats.errores}\n\n👤 *Usuarios:*\n  • Usuarios nuevos: ${stats.usuarios_nuevos}\n\n_Última actualización: ${new Date().toLocaleString()}_`;

  await message.reply(statsMessage);
}

async function enviarStatus(message) {
  const statusMessage = `🟢 *Estado del Bot: ACTIVO*\n\nEl bot está en línea y funcionando correctamente.`;
  await message.reply(statusMessage);
}

async function enviarAyuda(message) {
  const helpMessage = `📚 *Comandos Disponibles*\n\n• *!stats*: Muestra estadísticas de uso del bot.\n• *!status*: Muestra el estado actual del bot.\n• *!human*: Activa el modo humano (el bot no responderá a tus mensajes con IA).\n• *!ai*: Desactiva el modo humano (el bot volverá a responder con IA).\n• *!cleanup*: Cancela todos los runs de OpenAI activos y limpia el estado interno.\n\n_Estos comandos son solo para administradores._`;
  await message.reply(helpMessage);
}

// ----------------------------------------------------
// 9. Manejador Principal de Mensajes
// ----------------------------------------------------

client.on("message", async (message) => {
  stats.mensajes_recibidos++;

  if (debeIgnorarMensaje(message)) {
    return;
  }

  const chatId = message.from;
  const body = message.body;

  if (body.startsWith("!")) {
    await manejarComandoAdmin(message);
    return;
  }

  if (humanModeUsers.has(chatId)) {
    console.log(`👤 [HUMAN-MODE] Mensaje de ${chatId} ignorado (modo humano activo).`);
    return;
  }

  try {
    // Adquirir bloqueo para el thread
    if (threadLocks.has(chatId)) {
      pendingMessages.set(chatId, (pendingMessages.get(chatId) || []).concat(message));
      console.log(`⏳ [LOCK] Mensaje de ${chatId} en cola. Thread bloqueado.`);
      return;
    }
    threadLocks.set(chatId, true);

    let threadId = await obtenerOCrearThread(chatId);
    threadId = await limpiarContextoSiNecesario(threadId);

    const assistantResponse = await procesarConAssistant(message, threadId);
    await message.reply(assistantResponse);
    stats.respuestas_exitosas++;

  } catch (error) {
    console.error("❌ [ERROR-GENERAL]", error);
    stats.errores++;
    let errorMessage = "⚠️ Lo siento, hubo un error al procesar tu solicitud. Por favor, intenta de nuevo más tarde.";
    if (error.message.includes("TIMEOUT")) {
      errorMessage = "⏳ Tu solicitud tardó demasiado en ser procesada. Por favor, intenta de nuevo o reformula tu pregunta.";
      stats.timeouts_totales++;
    }
    await message.reply(errorMessage);
  } finally {
    // Liberar bloqueo del thread
    threadLocks.delete(chatId);
    // Procesar mensajes pendientes
    if (pendingMessages.has(chatId)) {
      const queuedMessages = pendingMessages.get(chatId);
      pendingMessages.delete(chatId);
      console.log(`🔄 [LOCK] Procesando ${queuedMessages.length} mensajes en cola para ${chatId}.`);
      for (const msg of queuedMessages) {
        await client.emit("message", msg); // Re-emitir para procesar
      }
    }
  }
});

// ----------------------------------------------------
// 10. Eventos del Cliente WhatsApp
// ----------------------------------------------------

client.on("qr", (qr) => {
  console.log("🔵 Evento QR recibido. Contenido del QR:", qr);
  qrcode.generate(qr, { small: true });
  console.log("🔹 Escanea este QR para iniciar sesión (o re-iniciar si la sesión se perdió).");
});

client.on("ready", () => {
  console.log("🚀 Evento 'ready' de client disparado. Bot listo y conectado.");
});

client.on("authenticated", () => {
  console.log("✅ Cliente AUTENTICADO");
});

client.on("disconnected", (reason) => {
  console.log("❌ Cliente DESCONECTADO:", reason);
});

client.on("auth_failure", (msg) => {
  console.error("❌ FALLO DE AUTENTICACIÓN:", msg);
});

// ----------------------------------------------------
// 11. Inicialización y Health Check
// ----------------------------------------------------

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Servidor de Health Check escuchando en el puerto ${PORT}`);
});

console.log("🚀 Inicializando cliente de WhatsApp...");
client.initialize();
console.log("🚀 Cliente de WhatsApp inicializado.");
console.log("🚀🚀🚀 Final de la configuración del cliente y handlers. Esperando eventos...");


