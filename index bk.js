// index.js FINAL DEFINITIVO - Bot WhatsApp Corregido y Depurado
// Versión estable con gestión mejorada de runs concurrentes

require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { OpenAI } = require('openai');
const http = require('http');

// ----------------------------------------------------
// 1. Configuración y Validación
// ----------------------------------------------------
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;

if (!OPENAI_API_KEY || !OPENAI_ASSISTANT_ID) {
  console.error('❌ [CRÍTICO] Variables de entorno faltantes');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
console.log('✅ [OpenAI] Configuración validada correctamente');

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
      '--no-sandbox',
      '--disable-setuid-sandbox', 
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--disable-extensions',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--memory-pressure-off'
    ]
  },
  authStrategy: new LocalAuth({
    dataPath: './session'
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
  return numero?.replace(/[^\d]/g, '') || '';
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
  return chatId.includes('@g.us');
}

function esBot(message) {
  return message.fromMe || 
         message.from === 'status@broadcast' ||
         message.author?.includes('bot');
}

function esComandoAdmin(body) {
  const comandos = ['!stats', '!status', '!help', '!human', '!ai', '!cleanup'];
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
    const body = message.body?.trim() || '';
    
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
    console.error('❌ [ERROR-FILTRO]', error);
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
      console.error('❌ [ERROR-THREAD]', error);
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
    console.error('❌ [ERROR-LIMPIEZA]', error);
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
    console.error('❌ [ERROR-CANCEL-RUNS]', error);
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
    console.error('❌ [ERROR-CLEANUP-RUNS]', error);
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
      role: 'user',
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
    console.error('❌ [ERROR-ASSISTANT]', error);
    
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
      
      if (run.status === 'completed') {
        const messages = await openai.beta.threads.messages.list(threadId);
        const lastMessage = messages.data[0];
        
        if (lastMessage && lastMessage.role === 'assistant') {
          let respuesta = lastMessage.content[0]?.text?.value || 'Sin respuesta';
          
          if (FIRMA_ASISTENTE.activa) {
            respuesta += FIRMA_ASISTENTE.sufijo;
          }
          
          return respuesta;
        }
      }
      
      if (run.status === 'failed' || run.status === 'cancelled' || run.status === 'expired') {
        throw new Error(`Run ${run.status}: ${run.last_error?.message || 'Error desconocido'}`);
      }
      
      // ✅ MEJORADO: Log de progreso sin spam
      const tiempoTranscurrido = Date.now() - activeRuns.get(runId)?.inicio;
      if (tiempoTranscurrido > 20000 && Date.now() - lastStatusLog > 10000) {
        console.log(`⏰ [PROGRESS] Run ${runId} - ${Math.floor(tiempoTranscurrido/1000)}s - Status: ${run.status}`);
        lastStatusLog = Date.now();
      }
      
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      
    } catch (error) {
      if (error.message.includes('Run')) {
        throw error;
      }
      console.error('❌ [ERROR-POLLING]', error);
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
  
  throw new Error('TIMEOUT: El asistente no respondió en el tiempo esperado');
}

// ----------------------------------------------------
// 8. Manejo de Comandos Administrativos
// ----------------------------------------------------

async function manejarComandoAdmin(message) {
  const body = message.body.toLowerCase().trim();
  const chatId = message.from;
  
  try {
    switch (true) {
      case body.startsWith('!stats'):
        await enviarStats(message);
        break;
        
      case body.startsWith('!status'):
        await enviarStatus(message);
        break;
        
      case body.startsWith('!help'):
        await enviarAyuda(message);
        break;
        
      case body.startsWith('!cleanup'):
        await limpiarRunsGlobales(message);
        break;
        
      case body.startsWith('!human'):
        humanModeUsers.add(chatId);
        await message.reply('🧑 Modo humano activado. Tus mensajes no serán procesados por IA.');
        break;
        
      case body.startsWith('!ai'):
        humanModeUsers.delete(chatId);
        await message.reply('🤖 Modo IA reactivado. Volviendo al procesamiento automático.');
        break;
        
      default:
        await message.reply('❓ Comando no reconocido. Usa !help para ver comandos disponibles.');
    }
  } catch (error) {
    console.error('❌ [ERROR-COMANDO]', error);
    await message.reply('❌ Error al ejecutar comando.');
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
    
    await message.reply(`🧹 *Limpieza Completada*

✅ Runs cancelados: ${runsAntesLimpieza}
🧵 Threads afectados: ${threadsAfectados.size}
📊 Total runs cancelados: ${stats.runs_cancelados}

Sistema optimizado y listo.`);

  } catch (error) {
    console.error('❌ [ERROR-CLEANUP-GLOBAL]', error);
    await message.reply('❌ Error durante la limpieza global.');
  }
}

async function enviarStats(message) {
  const uptime = obtenerUptime();
  const tasaExito = stats.mensajes_recibidos > 0 ? 
    Math.round((stats.respuestas_exitosas / stats.mensajes_recibidos) * 100) : 0;
  const tiempoPromedio = stats.tiempo_promedio.length > 0 ? 
    (stats.tiempo_promedio.reduce((a, b) => a + b, 0) / stats.tiempo_promedio.length / 1000).toFixed(1) : '0';
  const tasaTimeoutPrimer = stats.mensajes_recibidos > 0 ? 
    Math.round((stats.timeouts_primer_intento / stats.mensajes_recibidos) * 100) : 0;
    
  const statsMessage = `📊 *Estadísticas del Bot - MEJORADO*

⏰ *Uptime:* ${uptime} minutos
📊 *Performance:*
  • Mensajes recibidos: ${stats.mensajes_recibidos}
  • Mensajes filtrados: ${stats.mensajes_filtrados}
  • Respuestas exitosas: ${stats.respuestas_exitosas}
  • Respuestas por reintento: ${stats.respuestas_reintento}
  • Tasa de éxito: ${tasaExito}%

⚡ *Tiempos:*
  • Tiempo promedio: ${tiempoPromedio}s
  • Timeouts primer intento: ${stats.timeouts_primer_intento}
  • Timeouts totales: ${stats.timeouts_totales}

🔄 *Gestión de Runs:*
  • Runs cancelados: ${stats.runs_cancelados}
  • Runs activos: ${activeRuns.size}

👥 *Usuarios:*
  • Nuevos usuarios: ${stats.usuarios_nuevos}
  • Threads activos: ${chatThreads.size}
  • Cola de mensajes: ${Array.from(pendingMessages.values()).reduce((sum, arr) => sum + arr.length, 0)}

❌ *Errores:* ${stats.errores}

🚀 *Estado:* ${tasaExito > 80 ? 'ÓPTIMO' : tasaExito > 60 ? 'BUENO' : 'NECESITA OPTIMIZACIÓN'}`;

  await message.reply(statsMessage);
}

async function enviarStatus(message) {
  const status = `🟢 *Bot WhatsApp - Estado MEJORADO*

✅ *Sistema:* Operativo
🔗 *OpenAI:* Conectado
📱 *WhatsApp:* Activo
⚡ *Performance:* ${stats.respuestas_exitosas}/${stats.mensajes_recibidos} éxitos
🧵 *Threads:* ${chatThreads.size} activos
🔄 *Runs:* ${activeRuns.size} ejecutándose

*Versión:* Mejorada - Gestión de runs optimizada`;

  await message.reply(status);
}

async function enviarAyuda(message) {
  const ayuda = `📋 *Comandos Disponibles:*

🔹 *!stats* - Estadísticas detalladas
🔹 *!status* - Estado del sistema  
🔹 *!help* - Esta ayuda
🔹 *!cleanup* - Limpiar runs activos
🔹 *!human* - Desactivar IA (modo manual)
🔹 *!ai* - Reactivar IA

💡 *Uso Normal:*
Simplemente envía tu mensaje y el asistente responderá automáticamente.

🚫 *Limitaciones:*
• No funciona en grupos
• Mensajes muy cortos son filtrados
• Timeouts automáticos por seguridad

🔧 *Nuevo:* Gestión optimizada de runs concurrentes`;

  await message.reply(ayuda);
}

// ----------------------------------------------------
// 9. Sistema de Cola de Mensajes
// ----------------------------------------------------

function encolarMensaje(chatId, message) {
  if (!pendingMessages.has(chatId)) {
    pendingMessages.set(chatId, []);
  }
  pendingMessages.get(chatId).push({
    message,
    timestamp: Date.now()
  });
}

async function procesarColaMensajes(chatId) {
  if (threadLocks.has(chatId)) {
    return;
  }
  
  const cola = pendingMessages.get(chatId) || [];
  if (cola.length === 0) {
    return;
  }
  
  threadLocks.set(chatId, true);
  
  try {
    while (cola.length > 0) {
      const { message } = cola.shift();
      await procesarMensajeIndividual(message);
      
      if (cola.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  } catch (error) {
    console.error(`❌ [ERROR-COLA] ${chatId}:`, error);
  } finally {
    threadLocks.delete(chatId);
    if (pendingMessages.get(chatId)?.length === 0) {
      pendingMessages.delete(chatId);
    }
  }
}

// ----------------------------------------------------
// 10. Procesamiento Principal de Mensajes
// ----------------------------------------------------

async function procesarMensajeIndividual(message) {
  const startTime = Date.now();
  const chatId = message.from;
  
  try {
    console.log(`📨 [PROCESANDO] ${chatId}: "${message.body?.substring(0, 50)}..."`);
    
    if (humanModeUsers.has(chatId)) {
      console.log(`👨 [HUMAN] Mensaje ignorado (modo humano): ${chatId}`);
      return;
    }
    
    let threadId = await obtenerOCrearThread(chatId);
    threadId = await limpiarContextoSiNecesario(threadId);
    
    let respuesta = null;
    let exito = false;
    
    try {
      respuesta = await procesarConAssistant(message, threadId, CONFIG.TIMEOUT_PRINCIPAL * 1000);
      exito = true;
      stats.respuestas_exitosas++;
    } catch (error) {
      console.log(`⚠️ [TIMEOUT-1] Primer intento falló: ${error.message}`);
      stats.timeouts_primer_intento++;
      
      try {
        respuesta = await procesarConAssistant(message, threadId, CONFIG.TIMEOUT_REINTENTO * 1000);
        exito = true;
        stats.respuestas_reintento++;
        console.log(`✅ [REINTENTO] Exitoso en segundo intento`);
      } catch (error2) {
        console.log(`⚠️ [TIMEOUT-2] Segundo intento falló: ${error2.message}`);
        stats.timeouts_totales++;
        
        try {
          respuesta = await procesarConAssistant(message, threadId, CONFIG.TIMEOUT_RAPIDO * 1000);
          exito = true;
          stats.respuestas_reintento++;
          console.log(`✅ [ÚLTIMO-REINTENTO] Exitoso en tercer intento`);
        } catch (error3) {
          console.error(`❌ [TIMEOUT-FINAL] Todos los reintentos fallaron: ${error3.message}`);
          respuesta = "⏰ El sistema está experimentando alta demanda. Por favor, intenta nuevamente en unos momentos.";
          stats.errores++;
        }
      }
    }
    
    if (respuesta) {
      await message.reply(respuesta);
      const tiempoTotal = Date.now() - startTime;
      console.log(`✅ [COMPLETADO] ${chatId} en ${formatearTiempo(tiempoTotal)}s`);
    }
    
    if (exito) {
      userFaileds.delete(chatId);
    } else {
      userFaileds.set(chatId, (userFaileds.get(chatId) || 0) + 1);
    }
    
  } catch (error) {
    console.error(`❌ [ERROR-PROCESAMIENTO] ${chatId}:`, error);
    stats.errores++;
    
    try {
      await message.reply("❌ Error interno del sistema. El equipo técnico ha sido notificado.");
    } catch (replyError) {
      console.error(`❌ [ERROR-REPLY] ${chatId}:`, replyError);
    }
  }
}

// ----------------------------------------------------
// 11. Tareas de Mantenimiento
// ----------------------------------------------------

function iniciarTareasMantenimiento() {
  // ✅ MEJORADO: Limpieza de runs más agresiva
  setInterval(() => {
    const ahora = Date.now();
    let runsLimpiados = 0;
    
    for (let [runId, runInfo] of activeRuns.entries()) {
      const tiempoActivo = ahora - runInfo.inicio;
      
      // Limpiar runs que llevan más tiempo del timeout interno
      if (tiempoActivo > CONFIG.ASSISTANT.timeout_interno) {
        activeRuns.delete(runId);
        runsLimpiados++;
        
        // ✅ NUEVO: Intentar cancelar el run también
        try {
          openai.beta.threads.runs.cancel(runInfo.threadId, runId).catch(() => {});
        } catch (error) {
          // Ignorar errores de cancelación
        }
      }
    }
    
    if (runsLimpiados > 0) {
      console.log(`🧹 [LIMPIEZA] ${runsLimpiados} runs inactivos eliminados`);
      stats.runs_cancelados += runsLimpiados;
    }
  }, CONFIG.LIMPIEZA_RUNS);
  
  setInterval(() => {
    const uptime = obtenerUptime();
    const tasaExito = stats.mensajes_recibidos > 0 ? 
      Math.round((stats.respuestas_exitosas / stats.mensajes_recibidos) * 100) : 0;
    const tiempoPromedio = stats.tiempo_promedio.length > 0 ? 
      (stats.tiempo_promedio.reduce((a, b) => a + b, 0) / stats.tiempo_promedio.length / 1000).toFixed(1) : '0';
    const tasaTimeoutPrimer = stats.mensajes_recibidos > 0 ? 
      Math.round((stats.timeouts_primer_intento / stats.mensajes_recibidos) * 100) : 0;
    
    const mensajeStats = `📊 [STATS] ${uptime}min | Mensajes: ${stats.mensajes_recibidos} | Filtrados: ${stats.mensajes_filtrados} | Éxito: ${tasaExito}% | T.Promedio: ${tiempoPromedio}s | Timeouts1er: ${tasaTimeoutPrimer}% | Nuevos: ${stats.usuarios_nuevos} | RunsCancelados: ${stats.runs_cancelados}`;
    console.log(mensajeStats);
  }, CONFIG.STATS_INTERVAL);
  
  setInterval(() => {
    if (stats.tiempo_promedio.length > 100) {
      stats.tiempo_promedio = stats.tiempo_promedio.slice(-50);
      console.log(`🧹 [OPTIMIZACIÓN] Array de tiempos reducido`);
    }
    
    const unHoraAtras = Date.now() - (60 * 60 * 1000);
    for (let [chatId, cola] of pendingMessages.entries()) {
      const colaFiltrada = cola.filter(item => item.timestamp > unHoraAtras);
      if (colaFiltrada.length !== cola.length) {
        pendingMessages.set(chatId, colaFiltrada);
        console.log(`🧹 [OPTIMIZACIÓN] Mensajes antiguos eliminados para ${chatId}`);
      }
    }
    
    console.log(`🔧 [OPTIMIZACIÓN] Memoria optimizada - Threads: ${chatThreads.size}, Runs: ${activeRuns.size}`);
  }, CONFIG.OPTIMIZACION);
}

// ----------------------------------------------------
// 12. Eventos de WhatsApp
// ----------------------------------------------------

client.on('qr', (qr) => {
  console.log('📱 [QR] Código QR generado');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ [WHATSAPP] Cliente conectado y listo');
  console.log('🤖 [BOT] Bot WhatsApp MEJORADO iniciado');
  console.log('🔧 [SISTEMA] Iniciando tareas de mantenimiento...');
  
  iniciarTareasMantenimiento();
});

client.on('disconnected', (reason) => {
  console.log('⚠️ [WHATSAPP] Cliente desconectado:', reason);
});

client.on('message_create', async (message) => {
  try {
    stats.mensajes_recibidos++;
    
    if (debeIgnorarMensaje(message)) {
      return;
    }
    
    if (esComandoAdmin(message.body)) {
      await manejarComandoAdmin(message);
      return;
    }
    
    const chatId = message.from;
    encolarMensaje(chatId, message);
    
    procesarColaMensajes(chatId).catch(error => {
      console.error(`❌ [ERROR-COLA-ASYNC] ${chatId}:`, error);
    });
    
  } catch (error) {
    console.error('❌ [ERROR-MESSAGE-CREATE]', error);
    stats.errores++;
  }
});

client.on('auth_failure', (msg) => {
  console.error('❌ [AUTH] Fallo de autenticación:', msg);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ [UNHANDLED-REJECTION]', error);
  stats.errores++;
});

process.on('uncaughtException', (error) => {
  console.error('❌ [UNCAUGHT-EXCEPTION]', error);
  stats.errores++;
});

// ----------------------------------------------------
// 13. Servidor HTTP para Health Check
// ----------------------------------------------------

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    const uptime = obtenerUptime();
    const health = {
      status: 'OK',
      uptime: `${uptime} minutos`,
      whatsapp: client.info ? 'Conectado' : 'Desconectado',
      stats: {
        mensajes_recibidos: stats.mensajes_recibidos,
        mensajes_filtrados: stats.mensajes_filtrados,
        respuestas_exitosas: stats.respuestas_exitosas,
        runs_cancelados: stats.runs_cancelados,
        runs_activos: activeRuns.size,
        errores: stats.errores
      },
      timestamp: new Date().toISOString(),
      version: 'MEJORADO_RUNS'
    };
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(health, null, 2));
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🌐 [HTTP] Servidor iniciado en puerto ${PORT}`);
  console.log(`🔍 [HEALTH] Health check disponible en: http://localhost:${PORT}/health`);
});

// ----------------------------------------------------
// 14. Inicialización Final
// ----------------------------------------------------

console.log('🚀 [INICIO] Iniciando cliente WhatsApp...');
console.log('📋 [CONFIG] Configuración cargada:');
console.log(`   • Timeout Principal: ${CONFIG.TIMEOUT_PRINCIPAL}s`);
console.log(`   • Timeout Reintento: ${CONFIG.TIMEOUT_REINTENTO}s`);
console.log(`   • Max Reintentos: ${CONFIG.MAX_REINTENTOS}`);
console.log(`   • Max Contexto: ${CONFIG.ASSISTANT.max_contexto}`);
console.log(`   • Firma Activa: ${FIRMA_ASISTENTE.activa}`);

client.initialize();

console.log('✅ [SISTEMA] Bot WhatsApp MEJORADO - Gestión de runs optimizada');
console.log('📱 [ESPERA] Esperando código QR para conectar...');
