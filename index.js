// index.js: Bot de WhatsApp FINAL - Solo Asistente de OpenAI
// Versión final mejorada y corregida - Todas las optimizaciones aplicadas

require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { OpenAI } = require('openai');

// ----------------------------------------------------
// 1. Configuración de variables de entorno
// ----------------------------------------------------
const OPENAI_API_KEY      = process.env.OPENAI_API_KEY;
const OPENAI_ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;

// Debug: confirmar configuración
console.log('🟣 [DEBUG] OPENAI_API_KEY:', OPENAI_API_KEY ? 'CONFIGURADA' : '❌ FALTA');
console.log('🟣 [DEBUG] OPENAI_ASSISTANT_ID:', OPENAI_ASSISTANT_ID || '❌ FALTA');

// Inicializar cliente de OpenAI
let openai = null;
if (OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  console.log('✅ [OpenAI] API configurada correctamente');
  if (OPENAI_ASSISTANT_ID) {
    console.log(`✅ [OpenAI] Assistant ID configurado: ${OPENAI_ASSISTANT_ID}`);
  } else {
    console.warn('⚠️ [OpenAI] No se encontró OPENAI_ASSISTANT_ID en env. Se usará fallback.');
  }
} else {
  console.error('❌ [OpenAI] OPENAI_API_KEY no configurada. El servicio no funcionará.');
  process.exit(1);
}

// ----------------------------------------------------
// 2. Configuración optimizada
// ----------------------------------------------------
const TIMEOUT_DEFAULT = 30;        // 30 segundos optimizado
const TIMEOUT_REINTENTO = 20;      // 20 segundos para reintentos
const MAX_REINTENTOS = 2;          // Máximo 2 reintentos
const INTERVALO_LIMPIEZA = 3 * 60 * 1000; // Cada 3 minutos

// ✅ Configuración corregida del asistente
const ASSISTANT_CONFIG = {
  temperature: 0.6,     // Equilibrio óptimo para respuestas naturales
  max_tokens: 400,      // Solo para chat.completions (NO para Assistants)
  timeout: 25000        // 25 segundos internos
};

// ✅ Configuración de firma del asistente
const FIRMA_ASISTENTE = {
  sufijo: "\n\n🤖 _Asistente IA - Municipalidad San Martín_",
  activa: true
};

// ----------------------------------------------------
// 3. Configuración de WhatsApp
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
      '--disable-extensions'
    ]
  },
  authStrategy: new LocalAuth({
    dataPath: './session'
  })
});

// ----------------------------------------------------
// 4. Variables globales
// ----------------------------------------------------
const SYSTEM_PROMPT = `Eres un asistente profesional y amable de la Municipalidad de San Martín (Dirección Programas Nacionales). 

INSTRUCCIONES:
- Responde de manera clara, concisa y profesional
- Usa un tono amigable pero formal
- Proporciona información útil sobre servicios municipales
- Si no sabes algo específico, dirígelos a contactar la municipalidad
- Mantén las respuestas entre 1-3 párrafos máximo
- Ayuda con información sobre trámites, cursos, programas y servicios

Tu objetivo es ayudar a los ciudadanos con información municipal.`;

const chatThreads = new Map();      // Map<userId, threadId>
const humanModeUsers = new Set();   // Set<userId> usuarios en modo "operador humano"
const userFaileds = new Map();      // Map<userId, número de intentos fallidos>
const activeRuns = new Map();       // Map<userId, {runId, threadId, timestamp}>
const pendingMessages = new Map();  // Map<userId, Array<{message, timestamp, msgObj}>>
const threadLocks = new Map();      // Map<threadId, boolean>

// Stats para monitoreo
const stats = {
  mensajes_recibidos: 0,
  respuestas_enviadas: 0,
  errores: 0,
  inicio: Date.now()
};

// ----------------------------------------------------
// 5. Funciones utilitarias mejoradas
// ----------------------------------------------------

function esGrupoWhatsApp(chatId) {
  return chatId.endsWith('@g.us');
}

function tieneRunActivo(userId) {
  return activeRuns.has(userId);
}

function threadEstaBloqueado(threadId) {
  return threadLocks.get(threadId) === true;
}

function bloquearThread(threadId) {
  threadLocks.set(threadId, true);
  console.log(`🔒 [Bloqueo] Thread ${threadId} bloqueado`);
}

function desbloquearThread(threadId) {
  threadLocks.set(threadId, false);
  console.log(`🔓 [Desbloqueo] Thread ${threadId} desbloqueado`);
}

async function esperarDesbloqueoThread(threadId, maxIntentos = 30) {
  let intentos = 0;
  while (threadEstaBloqueado(threadId) && intentos < maxIntentos) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    intentos++;
  }
  return !threadEstaBloqueado(threadId);
}

// ✅ Función mejorada para añadir firma del asistente
function añadirFirmaAsistente(respuesta) {
  if (!FIRMA_ASISTENTE.activa || !respuesta) {
    return respuesta;
  }

  // Limpiar respuesta de posibles firmas anteriores para evitar duplicados
  let respuestaLimpia = respuesta
    .replace(/\n\n🤖.*$/gm, '')
    .replace(/\n\n_Asistente.*$/gm, '')
    .replace(/\n\n--.*Municipalidad.*$/gm, '')
    .trim();

  // Añadir firma solo si no la tiene ya
  if (!respuestaLimpia.includes('🤖') && !respuestaLimpia.includes('Asistente IA')) {
    return respuestaLimpia + FIRMA_ASISTENTE.sufijo;
  }

  return respuestaLimpia;
}

// ✅ Función mejorada de stats
function mostrarStats() {
  const uptime = Math.floor((Date.now() - stats.inicio) / 1000);
  const horas = Math.floor(uptime / 3600);
  const minutos = Math.floor((uptime % 3600) / 60);
  
  console.log(`📊 [STATS] Uptime: ${horas}h ${minutos}m | Mensajes: ${stats.mensajes_recibidos} | Respuestas: ${stats.respuestas_enviadas} | Errores: ${stats.errores}`);
}

async function verificarEstadoRun(threadId, runId) {
  try {
    const status = await openai.beta.threads.runs.retrieve(threadId, runId);
    return status.status;
  } catch (error) {
    console.error(`❌ [Error] Al verificar estado del run ${runId}:`, error.message);
    stats.errores++;
    return "error";
  }
}

async function cancelarRunSeguro(threadId, runId) {
  try {
    const status = await verificarEstadoRun(threadId, runId);
    if (status !== "completed" && status !== "cancelled" && status !== "failed" && status !== "error") {
      console.log(`🛑 [Cancelando] Run ${runId} en thread ${threadId}`);
      await openai.beta.threads.runs.cancel(threadId, runId);
      
      // Esperar cancelación con timeout optimizado
      let runStatus = "cancelling";
      let intentos = 0;
      while (runStatus !== "cancelled" && runStatus !== "completed" && runStatus !== "failed" && intentos < 10) {
        await new Promise(resolve => setTimeout(resolve, 500));
        runStatus = await verificarEstadoRun(threadId, runId);
        intentos++;
      }
      
      console.log(`✅ [Cancelado] Run ${runId}, estado final: ${runStatus}`);
      return true;
    }
    return true;
  } catch (error) {
    console.error(`❌ [Error] Al cancelar run ${runId}:`, error.message);
    stats.errores++;
    return false;
  }
}

// ✅ Sistema de priorización mejorado
function esMensajePrioritario(mensaje) {
  const palabrasPrioridad = [
    'urgente', 'emergencia', 'problema', 'error', 'ayuda',
    'inscripcion', 'inscripción', 'horario', 'telefono', 'teléfono',
    'consulta', 'información', 'info'
  ];
  
  const mensajeLower = mensaje.toLowerCase();
  return palabrasPrioridad.some(palabra => mensajeLower.includes(palabra));
}

async function procesarColaPrioritaria(userId) {
  if (!pendingMessages.has(userId)) return false;
  
  const mensajes = pendingMessages.get(userId);
  const indicePrioritario = mensajes.findIndex(msg => esMensajePrioritario(msg.message));
  
  if (indicePrioritario !== -1) {
    const [mensajePrioritario] = mensajes.splice(indicePrioritario, 1);
    mensajes.unshift(mensajePrioritario);
    console.log(`⚡ [Prioridad] Mensaje prioritario movido al frente para ${userId.substring(0, 10)}`);
    return true;
  }
  
  return false;
}

// ✅ Función mejorada de limpieza de threads
async function limpiarThreadAntiguo(threadId) {
  try {
    const mensajes = await openai.beta.threads.messages.list(threadId);
    
    // Si hay más de 15 mensajes, crear un nuevo thread
    if (mensajes.data.length > 15) {
      console.log(`🧹 [Limpieza] Thread ${threadId} tiene ${mensajes.data.length} mensajes, creando uno nuevo`);
      
      const nuevoThread = await openai.beta.threads.create();
      
      // Añadir contexto de continuación
      await openai.beta.threads.messages.create(nuevoThread.id, {
        role: "user",
        content: "Esta es una continuación de una conversación anterior. Mantén el contexto profesional de asistencia municipal."
      });
      
      return nuevoThread.id;
    }
    
    return threadId;
  } catch (error) {
    console.error(`❌ [Error] Al limpiar thread antiguo:`, error.message);
    return threadId;
  }
}

// ✅ Función mejorada de optimización del sistema
function optimizarSistema() {
  const ahora = Date.now();
  
  // Limpiar mensajes pendientes antiguos (más de 10 minutos)
  for (const [userId, mensajes] of pendingMessages.entries()) {
    const mensajesFiltrados = mensajes.filter(msg => ahora - msg.timestamp < 10 * 60 * 1000);
    if (mensajesFiltrados.length === 0) {
      pendingMessages.delete(userId);
    } else {
      pendingMessages.set(userId, mensajesFiltrados);
    }
  }
  
  // Limpiar fallos de usuario antiguos (más de 30 minutos)
  for (const [userId, timestamp] of userFaileds.entries()) {
    if (ahora - timestamp > 30 * 60 * 1000) {
      userFaileds.delete(userId);
    }
  }
  
  // Limpiar threads inactivos muy antiguos (más de 2 horas)
  for (const [userId, threadId] of chatThreads.entries()) {
    if (!activeRuns.has(userId) && !pendingMessages.has(userId)) {
      // Podríamos implementar timestamp de última actividad aquí
    }
  }
  
  console.log(`🧹 [Optimización] Sistema optimizado. Memoria liberada.`);
  mostrarStats();
}

function limpiarRunsAbandonados() {
  const ahora = Date.now();
  const MAX_RUN_TIME = 2 * 60 * 1000; // 2 minutos máximo

  for (const [userId, runInfo] of activeRuns.entries()) {
    if (ahora - runInfo.timestamp > MAX_RUN_TIME) {
      console.log(`🧹 [Limpieza] Run abandonado para ${userId.substring(0, 10)}: ${runInfo.runId}`);
      
      cancelarRunSeguro(runInfo.threadId, runInfo.runId)
        .then(() => {
          activeRuns.delete(userId);
          desbloquearThread(runInfo.threadId);
          setTimeout(() => procesarMensajesPendientes(userId), 1000);
        })
        .catch(err => console.error('Error al limpiar run abandonado:', err));
    }
  }
}

// ----------------------------------------------------
// 6. Función principal MEJORADA para responder con GPT Assistant
// ----------------------------------------------------

async function responderConGPT(userId, message, msg) {
  if (!openai) {
    return añadirFirmaAsistente('Lo siento, el servicio de asistencia no está disponible en este momento.');
  }

  try {
    console.log(`🚀 [Respuesta] Procesando mensaje de ${userId.substring(0, 10)}...`);
    
    if (OPENAI_ASSISTANT_ID) {
      // Obtener o crear thread
      let threadId = chatThreads.get(userId);
      if (!threadId) {
        const thread = await openai.beta.threads.create();
        threadId = thread.id;
        chatThreads.set(userId, threadId);
        threadLocks.set(threadId, false);
        console.log(`🆕 [Thread] Creado para ${userId.substring(0, 10)}`);
      } else {
        // Limpiar thread si es necesario
        threadId = await limpiarThreadAntiguo(threadId);
        chatThreads.set(userId, threadId);
      }

      // Verificar bloqueos
      if (threadEstaBloqueado(threadId)) {
        console.log(`⚠️ [Bloqueado] Thread ocupado para ${userId.substring(0, 10)}`);
        const desbloqueado = await esperarDesbloqueoThread(threadId);
        if (!desbloqueado) {
          return añadirFirmaAsistente('El sistema está procesando tu consulta anterior. Por favor espera un momento.');
        }
      }
      
      bloquearThread(threadId);

      try {
        // Limpiar runs activos anteriores
        if (tieneRunActivo(userId)) {
          const runActivo = activeRuns.get(userId);
          await cancelarRunSeguro(runActivo.threadId, runActivo.runId);
          activeRuns.delete(userId);
        }

        // Añadir mensaje al thread
        await openai.beta.threads.messages.create(threadId, {
          role: "user",
          content: message
        });

        // ✅ CORREGIDO: Crear run SIN max_tokens (solo para Assistants API)
        const runParams = {
          assistant_id: OPENAI_ASSISTANT_ID,
          temperature: ASSISTANT_CONFIG.temperature
          // max_tokens NO es válido para Assistants API
        };
        const run = await openai.beta.threads.runs.create(threadId, runParams);
        
        // Registrar run activo
        activeRuns.set(userId, {
          runId: run.id,
          threadId: threadId,
          timestamp: Date.now()
        });

        console.log(`⏳ [Run] Esperando respuesta ${run.id.substring(0, 15)} (${TIMEOUT_DEFAULT}s)`);
        
        // Esperar completion con timeout optimizado
        let runStatus = await verificarEstadoRun(threadId, run.id);
        let attempts = 0;

        while (runStatus !== "completed" && runStatus !== "failed" && runStatus !== "cancelled" && runStatus !== "error" && attempts < TIMEOUT_DEFAULT) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          runStatus = await verificarEstadoRun(threadId, run.id);
          attempts++;
          
          // Log progreso cada 10 segundos
          if (attempts % 10 === 0) {
            console.log(`⏳ [Progreso] ${attempts}/${TIMEOUT_DEFAULT}s - Estado: ${runStatus}`);
          }
        }

        // Limpiar run activo
        activeRuns.delete(userId);
        desbloquearThread(threadId);

        if (runStatus !== "completed") {
          await cancelarRunSeguro(threadId, run.id);
          console.log(`❌ [Timeout] Run ${run.id.substring(0, 15)} falló en ${attempts}s`);
          stats.errores++;
          
          // Intentar reintento si es la primera vez
          const failed = userFaileds.get(userId) || 0;
          if (failed < MAX_REINTENTOS) {
            console.log(`🔄 [Reintento] Intentando reintento ${failed + 1}/${MAX_REINTENTOS}`);
            return await reintentarConsulta(msg, threadId, run.id, message);
          }
          
          return añadirFirmaAsistente('Lo siento, la consulta está tomando demasiado tiempo. Por favor, intenta con una pregunta más específica.');
        }

        // Obtener respuesta
        const messages = await openai.beta.threads.messages.list(threadId);
        const assistantMessages = messages.data.filter(msg => msg.role === "assistant");
        
        if (assistantMessages.length > 0 && assistantMessages[0].content.length > 0) {
          const respuesta = assistantMessages[0].content[0].text.value;
          console.log(`✅ [Success] Respuesta del Assistant obtenida (${respuesta.length} chars)`);
          stats.respuestas_enviadas++;
          
          // Procesar mensajes pendientes después de liberar el thread
          setTimeout(() => procesarMensajesPendientes(userId), 1000);
          
          return añadirFirmaAsistente(respuesta);
        } else {
          console.log(`❌ [No Response] Assistant no generó respuesta`);
          stats.errores++;
          return añadirFirmaAsistente('Disculpa, no pude procesar tu consulta en este momento.');
        }

      } catch (error) {
        console.error('❌ [Error Run]:', error.message);
        activeRuns.delete(userId);
        desbloquearThread(threadId);
        stats.errores++;
        throw error;
      }
    } else {
      // ✅ Fallback mejorado (max_tokens SÍ es válido aquí)
      console.log(`🔄 [Fallback] Usando chat.completions para ${userId.substring(0, 10)}`);
      const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: message }
        ],
        temperature: ASSISTANT_CONFIG.temperature,
        max_tokens: ASSISTANT_CONFIG.max_tokens  // ✅ Válido para chat.completions
      });

      const respuesta = response.choices[0]?.message?.content?.trim();
      if (respuesta) {
        stats.respuestas_enviadas++;
        return añadirFirmaAsistente(respuesta);
      } else {
        stats.errores++;
        return añadirFirmaAsistente('Disculpa, no pude procesar tu consulta.');
      }
    }

  } catch (error) {
    console.error('❌ [Error General]:', error.message);
    stats.errores++;
    
    // Limpiar en caso de error
    const threadId = chatThreads.get(userId);
    if (threadId && threadEstaBloqueado(threadId)) {
      desbloquearThread(threadId);
    }
    activeRuns.delete(userId);
    
    // Manejar errores específicos mejorados
    if (error.status === 429) {
      return añadirFirmaAsistente('El sistema está experimentando alta demanda. Por favor, intenta nuevamente en unos segundos.');
    } else if (error.message && error.message.includes('timeout')) {
      return añadirFirmaAsistente('La consulta está tomando demasiado tiempo. Por favor, intenta con una pregunta más específica.');
    } else if (error.code === 'ECONNRESET' || error.code === 'ENOTFOUND') {
      return añadirFirmaAsistente('Problemas de conectividad temporal. Por favor, intenta nuevamente en unos momentos.');
    } else if (error.message && error.message.includes("already has an active run")) {
      return añadirFirmaAsistente('El sistema está ocupado procesando otra consulta. Por favor, intenta nuevamente en unos momentos.');
    }
    
    return añadirFirmaAsistente('Lo siento, ocurrió un error al procesar tu consulta. Por favor, inténtalo nuevamente.');
  }
}

// ✅ Función mejorada para reintentar consultas
async function reintentarConsulta(msg, threadId, runId, message) {
  console.log(`🔄 [Reintento] Usuario: ${msg.from.substring(0, 10)}, Mensaje: "${message.substring(0, 30)}..."`);
  
  try {
    // Verificar si el thread está bloqueado
    if (threadEstaBloqueado(threadId)) {
      const desbloqueado = await esperarDesbloqueoThread(threadId);
      if (!desbloqueado) {
        return añadirFirmaAsistente('El sistema está ocupado. Por favor, intenta nuevamente en unos momentos.');
      }
    }
    
    bloquearThread(threadId);
    
    // Cancelar el run anterior
    await cancelarRunSeguro(threadId, runId);
    
    // Esperar un momento
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // ✅ CORREGIDO: Crear nuevo run SIN max_tokens
    console.log(`🆕 [Reintento] Creando nuevo run optimizado en thread ${threadId}`);
    const newRun = await openai.beta.threads.runs.create(threadId, {
      assistant_id: OPENAI_ASSISTANT_ID,
      temperature: ASSISTANT_CONFIG.temperature
      // max_tokens NO es válido para Assistants API
    });
    
    // Registrar el run activo
    activeRuns.set(msg.from, {
      runId: newRun.id,
      threadId: threadId,
      timestamp: Date.now()
    });
    
    // Esperar con timeout optimizado para reintentos
    let runStatus = await verificarEstadoRun(threadId, newRun.id);
    let attempts = 0;
    
    while (runStatus !== "completed" && runStatus !== "failed" && runStatus !== "cancelled" && runStatus !== "error" && attempts < TIMEOUT_REINTENTO) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      runStatus = await verificarEstadoRun(threadId, newRun.id);
      attempts++;
    }
    
    // Limpiar
    activeRuns.delete(msg.from);
    desbloquearThread(threadId);
    
    if (runStatus !== "completed") {
      await cancelarRunSeguro(threadId, newRun.id);
      setTimeout(() => procesarMensajesPendientes(msg.from), 1000);
      return añadirFirmaAsistente('Lo siento, esta consulta es demasiado compleja. ¿Podrías reformularla de manera más específica?');
    }
    
    // Obtener respuesta
    const messages = await openai.beta.threads.messages.list(threadId);
    const assistantMessages = messages.data.filter(msg => msg.role === "assistant");
    
    setTimeout(() => procesarMensajesPendientes(msg.from), 1000);
    
    if (assistantMessages.length > 0 && assistantMessages[0].content.length > 0) {
      return añadirFirmaAsistente(assistantMessages[0].content[0].text.value);
    } else {
      return añadirFirmaAsistente('Disculpa, no pude procesar tu consulta después de varios intentos.');
    }
  } catch (error) {
    console.error('❌ [Error en reintento]:', error.message);
    
    activeRuns.delete(msg.from);
    desbloquearThread(threadId);
    
    setTimeout(() => procesarMensajesPendientes(msg.from), 1000);
    
    return añadirFirmaAsistente('Lo siento, ocurrió un error al procesar tu consulta. Por favor, intenta con una pregunta diferente.');
  }
}

// ----------------------------------------------------
// 7. Función mejorada para procesar mensajes pendientes
// ----------------------------------------------------

async function procesarMensajesPendientes(userId) {
  if (pendingMessages.has(userId) && pendingMessages.get(userId).length > 0) {
    if (tieneRunActivo(userId)) {
      console.log(`⏳ [Cola] Usuario ${userId.substring(0, 10)} tiene un run activo, posponiendo procesamiento`);
      return;
    }
    
    // Procesar cola prioritaria
    await procesarColaPrioritaria(userId);
    
    console.log(`📋 [Cola] Procesando mensaje pendiente para ${userId.substring(0, 10)}`);
    const nextMessage = pendingMessages.get(userId).shift();
    
    if (pendingMessages.get(userId).length === 0) {
      pendingMessages.delete(userId);
    }
    
    try {
      const reply = await responderConGPT(userId, nextMessage.message, nextMessage.msgObj);
      await nextMessage.msgObj.reply(reply);
      console.log(`📤 [Respuesta GPT] ${userId.substring(0, 10)}: ${reply.substring(0, 50)}...`);
      userFaileds.set(userId, 0);
    } catch (error) {
      console.error('❌ [Error al procesar mensaje pendiente]', error.message);
      const failed = userFaileds.get(userId) || 0;
      userFaileds.set(userId, failed + 1);
      await nextMessage.msgObj.reply(añadirFirmaAsistente('Lo siento, hubo un problema al procesar tu mensaje pendiente.'));
    }
  }
}

// ----------------------------------------------------
// 8. Función mejorada para procesar mensajes
// ----------------------------------------------------

async function procesarMensaje(userId, message, msgObj) {
  stats.mensajes_recibidos++;
  console.log(`📥 [${stats.mensajes_recibidos}] ${userId.substring(0, 15)}: "${message.substring(0, 30)}${message.length > 30 ? '...' : ''}"`);
  
  // Verificar run activo con sistema de cola mejorado
  if (tieneRunActivo(userId)) {
    console.log(`⏳ [Cola] Usuario ${userId.substring(0, 10)} tiene run activo, encolando`);
    
    if (!pendingMessages.has(userId)) {
      pendingMessages.set(userId, []);
    }
    
    // Verificar límite de cola para evitar spam
    if (pendingMessages.get(userId).length >= 3) {
      await msgObj.reply(añadirFirmaAsistente("Tienes varios mensajes en cola. Por favor espera a que procese los anteriores."));
      return;
    }
    
    pendingMessages.get(userId).push({
      message,
      timestamp: Date.now(),
      msgObj
    });
    
    await msgObj.reply("⏳ Estoy procesando tu consulta anterior. Tu nuevo mensaje será atendido en breve.");
    return;
  }
  
  // Verificar thread bloqueado
  const threadId = chatThreads.get(userId);
  if (threadId && threadEstaBloqueado(threadId)) {
    console.log(`⏳ [Bloqueado] Thread bloqueado para ${userId.substring(0, 10)}`);
    
    if (!pendingMessages.has(userId)) {
      pendingMessages.set(userId, []);
    }
    
    pendingMessages.get(userId).push({
      message,
      timestamp: Date.now(),
      msgObj
    });
    
    await msgObj.reply("⏳ El sistema está ocupado procesando otra consulta. Tu mensaje será procesado en breve.");
    return;
  }
  
  // Procesar normalmente
  try {
    const reply = await responderConGPT(userId, message, msgObj);
    await msgObj.reply(reply);
    console.log(`📤 [Enviado] Respuesta a ${userId.substring(0, 10)} (${reply.length} chars)`);
    userFaileds.set(userId, 0);
  } catch (error) {
    console.error('❌ [Error Proceso]:', error.message);
    stats.errores++;
    const failed = userFaileds.get(userId) || 0;
    userFaileds.set(userId, failed + 1);
    
    if (failed < 2) {
      await msgObj.reply(añadirFirmaAsistente('Lo siento, hubo un problema al procesar tu mensaje. Por favor, inténtalo de nuevo.'));
    } else {
      await msgObj.reply(añadirFirmaAsistente('Estoy teniendo dificultades técnicas. Por favor, intenta más tarde o escribe "operador" para hablar con una persona.'));
    }
  }
}

// ----------------------------------------------------
// 9. Eventos de WhatsApp mejorados
// ----------------------------------------------------

client.on('qr', qr => {
  qrcode.generate(qr, { small: true });
  console.log('📸 [QR] Escanea este código QR con tu WhatsApp para conectar.');
});

client.on('ready', () => {
  console.log('🟢 [CONECTADO] Bot de WhatsApp listo y funcionando correctamente');
  console.log(`🤖 [FIRMA] Firma del asistente: ${FIRMA_ASISTENTE.activa ? 'ACTIVADA' : 'DESACTIVADA'}`);
  mostrarStats();
});

client.on('authenticated', () => {
  console.log('✅ [AUTH] WhatsApp autenticado correctamente');
});

client.on('auth_failure', () => {
  console.log('❌ [AUTH] Fallo de autenticación WhatsApp');
  stats.errores++;
});

client.on('disconnected', (reason) => {
  console.log('🔴 [DESCONECTADO] Cliente desconectado:', reason);
  stats.errores++;
});

client.on('message', async msg => {
  const userId = msg.from;
  const incoming = msg.body;

  // Ignorar mensajes de grupos
  if (esGrupoWhatsApp(userId)) {
    return;
  }

  // Ignorar mensajes del propio bot
  if (msg.fromMe) {
    return;
  }

  // ✅ Comando mejorado para stats (solo en modo debug)
  if (incoming.toLowerCase() === '/stats' && process.env.DEBUG_MODE === 'true') {
    const uptime = Math.floor((Date.now() - stats.inicio) / 1000);
    const horas = Math.floor(uptime / 3600);
    const minutos = Math.floor((uptime % 3600) / 60);
    
    const statsMessage = `📊 *Bot Statistics*\n` +
                        `🕐 Uptime: ${horas}h ${minutos}m\n` +
                        `📥 Mensajes recibidos: ${stats.mensajes_recibidos}\n` +
                        `📤 Respuestas enviadas: ${stats.respuestas_enviadas}\n` +
                        `❌ Errores: ${stats.errores}\n` +
                        `🧠 Assistant: ${OPENAI_ASSISTANT_ID ? 'Activo' : 'Fallback'}\n` +
                        `⚡ Threads activos: ${chatThreads.size}\n` +
                        `⏳ Runs activos: ${activeRuns.size}\n` +
                        `📋 Mensajes en cola: ${Array.from(pendingMessages.values()).reduce((sum, arr) => sum + arr.length, 0)}`;
    
    await msg.reply(añadirFirmaAsistente(statsMessage));
    return;
  }

  // Manejar comando de operador mejorado
  if (incoming.toLowerCase().includes('operador')) {
    if (humanModeUsers.has(userId)) {
      humanModeUsers.delete(userId);
      await msg.reply(añadirFirmaAsistente('Has salido del modo operador humano. Ahora volveré a responder automáticamente.'));
    } else {
      humanModeUsers.add(userId);
      await msg.reply('👤 *Modo Operador Humano Activado*\n\nUn operador te contactará pronto. Escribe "operador" nuevamente para volver al modo automático.');
    }
    return;
  }

  // Verificar modo operador humano
  if (humanModeUsers.has(userId)) {
    return;
  }

  // Procesar el mensaje
  await procesarMensaje(userId, incoming, msg);
});

// ----------------------------------------------------
// 10. Inicialización y tareas de mantenimiento mejoradas
// ----------------------------------------------------

// Manejo de señales del sistema
process.on('SIGTERM', () => {
  console.log('📴 [SHUTDOWN] Recibida señal SIGTERM, cerrando gracefully...');
  mostrarStats();
  client.destroy();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('📴 [SHUTDOWN] Recibida señal SIGINT, cerrando gracefully...');
  mostrarStats();
  client.destroy();
  process.exit(0);
});

// Manejo de errores no capturados
process.on('uncaughtException', (error) => {
  console.error('❌ [UNCAUGHT] Error no capturado:', error.message);
  stats.errores++;
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ [UNHANDLED] Promesa rechazada:', reason);
  stats.errores++;
});

// Tareas de mantenimiento
setInterval(limpiarRunsAbandonados, INTERVALO_LIMPIEZA);
setInterval(optimizarSistema, 15 * 60 * 1000);  // Cada 15 minutos
setInterval(mostrarStats, 10 * 60 * 1000);      // Stats cada 10 minutos

// Inicializar el cliente
client.initialize();

console.log('🚀 [INICIANDO] Bot WhatsApp FINAL MEJORADO');
console.log('🤖 [ASISTENTE] Solo respuestas del Asistente de OpenAI con firma identificatoria');
console.log('🔧 [OPTIMIZADO] Velocidad, estabilidad y manejo de errores mejorados');
console.log(`⚙️ [CONFIG] Assistant: ${OPENAI_ASSISTANT_ID ? 'CONFIGURADO' : 'FALLBACK'}`);
console.log(`⏱️ [TIMEOUTS] Default: ${TIMEOUT_DEFAULT}s, Reintento: ${TIMEOUT_REINTENTO}s, Max reintentos: ${MAX_REINTENTOS}`);
console.log(`🎭 [FIRMA] "${FIRMA_ASISTENTE.sufijo}"`);
console.log(`📊 [MONITOREO] Stats disponibles con comando /stats (modo debug)`);
