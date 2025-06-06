// index.js: Bot de WhatsApp CORREGIDO - Solo Asistente de OpenAI
// Versión FINAL con corrección crítica del error max_tokens

require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { OpenAI } = require('openai');

// ----------------------------------------------------
// 1. Configuración de variables de entorno
// ----------------------------------------------------
const OPENAI_API_KEY      = process.env.OPENAI_API_KEY;
const OPENAI_ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;

// Debug: confirmar que las variables se cargaron
console.log('🟣 [DEBUG ENV] OPENAI_ASSISTANT_ID =', OPENAI_ASSISTANT_ID);

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
  console.warn('⚠️ [OpenAI] OPENAI_API_KEY no configurada. El servicio no funcionará.');
}

// ----------------------------------------------------
// 2. Configuración optimizada para velocidad y estabilidad
// ----------------------------------------------------
const TIMEOUT_DEFAULT = 30;        // 30 segundos - optimizado para velocidad
const TIMEOUT_REINTENTO = 20;      // 20 segundos para reintentos
const MAX_REINTENTOS = 2;          // Máximo 2 reintentos por mensaje
const INTERVALO_LIMPIEZA = 3 * 60 * 1000; // Limpiar cada 3 minutos

// ✅ CONFIGURACIÓN CORREGIDA - max_tokens solo para chat.completions
const ASSISTANT_CONFIG = {
  temperature: 0.5,     // Equilibrio óptimo entre velocidad y calidad
  max_tokens: 400,      // ✅ SOLO para chat.completions (NO para Assistants API)
  timeout: 25000        // Timeout interno de 25 segundos
};

// ----------------------------------------------------
// 3. Configuración de WhatsApp
// ----------------------------------------------------
const client = new Client({
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  },
  authStrategy: new LocalAuth({
    dataPath: './session'
  })
});

// ----------------------------------------------------
// 4. Variables globales
// ----------------------------------------------------
const SYSTEM_PROMPT = `Eres un asistente amable y profesional que ayuda a los usuarios de la Municipalidad de San Martín (Dirección Programas Nacionales). Responde con claridad y brevedad.`;

const chatThreads = new Map();      // Map<userId, threadId>
const humanModeUsers = new Set();   // Set<userId> usuarios en modo "operador humano"
const userFaileds = new Map();      // Map<userId, número de intentos fallidos>
const statusMessages = new Map();   // Map<userId, intervalId> para mensajes de estado

// Mapa para rastrear threads con runs activos
const activeRuns = new Map();       // Map<userId, {runId, threadId, timestamp}>

// Cola de mensajes pendientes por usuario
const pendingMessages = new Map();  // Map<userId, Array<{message, timestamp, msgObj}>>

// Bloqueos para operaciones en threads
const threadLocks = new Map();      // Map<threadId, boolean>

// ----------------------------------------------------
// 5. Funciones utilitarias
// ----------------------------------------------------

// Función para verificar si un chat es grupal
function esGrupoWhatsApp(chatId) {
  return chatId.endsWith('@g.us');
}

// Función para verificar si hay un run activo para un usuario
function tieneRunActivo(userId) {
  return activeRuns.has(userId);
}

// Función para verificar si un thread está bloqueado
function threadEstaBloqueado(threadId) {
  return threadLocks.get(threadId) === true;
}

// Función para bloquear un thread
function bloquearThread(threadId) {
  threadLocks.set(threadId, true);
  console.log(`🔒 [Bloqueo] Thread ${threadId} bloqueado`);
}

// Función para desbloquear un thread
function desbloquearThread(threadId) {
  threadLocks.set(threadId, false);
  console.log(`🔓 [Desbloqueo] Thread ${threadId} desbloqueado`);
}

// Función para esperar a que un thread se desbloquee
async function esperarDesbloqueoThread(threadId, maxIntentos = 30) {
  let intentos = 0;
  while (threadEstaBloqueado(threadId) && intentos < maxIntentos) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    intentos++;
  }
  return !threadEstaBloqueado(threadId);
}

// Función para verificar el estado de un run
async function verificarEstadoRun(threadId, runId) {
  try {
    const status = await openai.beta.threads.runs.retrieve(threadId, runId);
    return status.status;
  } catch (error) {
    console.error(`❌ [Error] Al verificar estado del run ${runId}:`, error);
    return "error";
  }
}

// Función para cancelar un run de forma segura
async function cancelarRunSeguro(threadId, runId) {
  try {
    const status = await verificarEstadoRun(threadId, runId);
    if (status !== "completed" && status !== "cancelled" && status !== "failed" && status !== "error") {
      console.log(`🛑 [Cancelando] Run ${runId} en thread ${threadId}`);
      await openai.beta.threads.runs.cancel(threadId, runId);
      
      // Esperar a que la cancelación se complete
      let runStatus = "cancelling";
      let intentos = 0;
      while (runStatus !== "cancelled" && runStatus !== "completed" && runStatus !== "failed" && intentos < 10) {
        await new Promise(resolve => setTimeout(resolve, 500));
        runStatus = await verificarEstadoRun(threadId, runId);
        intentos++;
      }
      
      console.log(`✅ [Cancelado] Run ${runId}, estado final: ${runStatus}`);
      return true;
    } else {
      console.log(`ℹ️ [Info] Run ${runId} ya está en estado ${status}, no es necesario cancelar`);
      return true;
    }
  } catch (error) {
    console.error(`❌ [Error] Al cancelar run ${runId}:`, error);
    return false;
  }
}

// ----------------------------------------------------
// 6. Sistema de priorización y optimización
// ----------------------------------------------------

// Sistema de priorización para mejorar velocidad
function esMensajePrioritario(mensaje) {
  const palabrasPrioridad = [
    'urgente', 'emergencia', 'problema', 'error', 'ayuda',
    'inscripcion', 'inscripción', 'horario', 'telefono', 'teléfono'
  ];
  
  const mensajeLower = mensaje.toLowerCase();
  return palabrasPrioridad.some(palabra => mensajeLower.includes(palabra));
}

// Función para procesar mensajes prioritarios primero
async function procesarColaPrioritaria(userId) {
  if (!pendingMessages.has(userId)) return false;
  
  const mensajes = pendingMessages.get(userId);
  const indicePrioritario = mensajes.findIndex(msg => esMensajePrioritario(msg.message));
  
  if (indicePrioritario !== -1) {
    // Mover mensaje prioritario al frente
    const [mensajePrioritario] = mensajes.splice(indicePrioritario, 1);
    mensajes.unshift(mensajePrioritario);
    console.log(`⚡ [Prioridad] Mensaje prioritario movido al frente para ${userId}`);
    return true;
  }
  
  return false;
}

// Función para limpiar threads antiguos
async function limpiarThreadAntiguo(threadId) {
  try {
    const mensajes = await openai.beta.threads.messages.list(threadId);
    
    if (mensajes.data.length > 10) {
      console.log(`🧹 [Limpieza] Thread ${threadId} tiene ${mensajes.data.length} mensajes, creando uno nuevo`);
      
      const nuevoThread = await openai.beta.threads.create();
      
      await openai.beta.threads.messages.create(nuevoThread.id, {
        role: "user",
        content: "Esta es una continuación de una conversación anterior sobre: " + 
                 obtenerTemasConversacion(mensajes.data)
      });
      
      return nuevoThread.id;
    }
    
    return threadId;
  } catch (error) {
    console.error(`❌ [Error] Al limpiar thread antiguo:`, error);
    return threadId;
  }
}

// Función para extraer temas principales de la conversación
function obtenerTemasConversacion(mensajes) {
  const temas = new Set();
  for (const mensaje of mensajes) {
    if (mensaje.content && mensaje.content[0] && mensaje.content[0].text) {
      const texto = mensaje.content[0].text.value.toLowerCase();
      if (texto.includes("curso")) temas.add("cursos");
      if (texto.includes("digital")) temas.add("punto digital");
      if (texto.includes("artesano")) temas.add("artesanos");
      if (texto.includes("belgrano")) temas.add("escuela de oficios");
    }
  }
  return Array.from(temas).join(", ");
}

// Función para optimizar memoria y rendimiento
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
  
  // Limpiar fallos de usuario antiguos
  for (const [userId, timestamp] of userFaileds.entries()) {
    if (ahora - timestamp > 30 * 60 * 1000) { // 30 minutos
      userFaileds.delete(userId);
    }
  }
  
  console.log(`🧹 [Optimización] Sistema optimizado. Memoria liberada.`);
}

// Función para limpiar runs abandonados
function limpiarRunsAbandonados() {
  const ahora = Date.now();
  const MAX_RUN_TIME = 2 * 60 * 1000; // 2 minutos para mayor estabilidad
  
  for (const [userId, runInfo] of activeRuns.entries()) {
    if (ahora - runInfo.timestamp > MAX_RUN_TIME) {
      console.log(`🧹 [Limpieza] Run abandonado para ${userId}: ${runInfo.runId}`);
      
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
// 7. Función principal para responder con GPT Assistant
// ----------------------------------------------------

async function responderConGPT(userId, message, msg) {
  if (!openai) {
    return 'Lo siento, el servicio de asistencia no está disponible en este momento.';
  }

  try {
    // Si existe Assistant ID, usarlo
    if (OPENAI_ASSISTANT_ID) {
      // Obtener o crear un thread para este usuario
      let threadId = chatThreads.get(userId);
      if (!threadId) {
        const thread = await openai.beta.threads.create();
        threadId = thread.id;
        chatThreads.set(userId, threadId);
        threadLocks.set(threadId, false);
      } else {
        // Limpiar thread si es necesario
        threadId = await limpiarThreadAntiguo(threadId);
        chatThreads.set(userId, threadId);
      }

      // Verificar si el thread está bloqueado
      if (threadEstaBloqueado(threadId)) {
        console.log(`⚠️ [Respuesta] Thread ${threadId} bloqueado, esperando...`);
        const desbloqueado = await esperarDesbloqueoThread(threadId);
        if (!desbloqueado) {
          console.log(`❌ [Respuesta] Thread ${threadId} sigue bloqueado, abortando`);
          return 'Lo siento, el sistema está ocupado. Por favor, intenta nuevamente en unos momentos.';
        }
      }
      
      // Bloquear el thread durante la operación
      bloquearThread(threadId);

      try {
        // Verificar si hay un run activo para este usuario
        if (tieneRunActivo(userId)) {
          console.log(`⚠️ [Respuesta] Usuario ${userId} ya tiene un run activo, cancelando primero`);
          const runActivo = activeRuns.get(userId);
          await cancelarRunSeguro(runActivo.threadId, runActivo.runId);
          activeRuns.delete(userId);
        }

        // Añadir el mensaje del usuario al thread
        await openai.beta.threads.messages.create(threadId, {
          role: "user",
          content: message
        });

        console.log(`🆕 [Respuesta] Creando nuevo run optimizado en thread ${threadId}`);
        
        // ✅ CORREGIDO: Sin max_tokens para Assistants API
        const runParams = {
          assistant_id: OPENAI_ASSISTANT_ID,
          temperature: ASSISTANT_CONFIG.temperature
          // ❌ max_tokens eliminado - NO válido para Assistants API
        };
        const run = await openai.beta.threads.runs.create(threadId, runParams);
        
        // Registrar el run activo
        activeRuns.set(userId, {
          runId: run.id,
          threadId: threadId,
          timestamp: Date.now()
        });

        // Usar timeout optimizado unificado
        const timeout = TIMEOUT_DEFAULT;
        console.log(`⏱️ [Timeout] Usando timeout optimizado de ${timeout}s`);
        
        // Esperar a que se complete el run
        let runStatus = await verificarEstadoRun(threadId, run.id);
        let attempts = 0;

        while (runStatus !== "completed" && runStatus !== "failed" && runStatus !== "cancelled" && runStatus !== "error" && attempts < timeout) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          runStatus = await verificarEstadoRun(threadId, run.id);
          attempts++;
        }

        // Eliminar el run activo
        activeRuns.delete(userId);
        
        // Desbloquear el thread
        desbloquearThread(threadId);

        if (runStatus !== "completed") {
          // Cancelar el run si no se completó
          await cancelarRunSeguro(threadId, run.id);
          
          // Intentar reintento si es necesario
          console.log(`⚠️ [Timeout] Run ${run.id} no completado en ${timeout}s, iniciando reintento`);
          const respuestaReintento = await reintentarConsulta(msg, threadId, run.id, message);
          setTimeout(() => procesarMensajesPendientes(userId), 1000);
          return respuestaReintento;
        }

        // Obtener los mensajes del thread
        const messages = await openai.beta.threads.messages.list(threadId);
        const assistantMessages = messages.data.filter(msg => msg.role === "assistant");
        
        setTimeout(() => procesarMensajesPendientes(userId), 1000);
        
        if (assistantMessages.length > 0 && assistantMessages[0].content.length > 0) {
          return assistantMessages[0].content[0].text.value;
        } else {
          return 'Disculpa, no pude procesar tu consulta.';
        }

      } catch (error) {
        console.error('❌ [Error en run]:', error);
        activeRuns.delete(userId);
        desbloquearThread(threadId);
        throw error;
      }
    }

    // ✅ FALLBACK CORRECTO: max_tokens SÍ es válido para chat.completions
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: message }
      ],
      temperature: ASSISTANT_CONFIG.temperature,
      max_tokens: ASSISTANT_CONFIG.max_tokens  // ✅ Válido para chat.completions
    });

    return response.choices[0]?.message?.content?.trim() ||
           'Disculpa, no pude procesar tu consulta.';

  } catch (error) {
    console.error('❌ [GPT] Error:', error);
    
    // Limpiar en caso de error
    const threadId = chatThreads.get(userId);
    if (threadId && threadEstaBloqueado(threadId)) {
      desbloquearThread(threadId);
    }
    activeRuns.delete(userId);
    
    // Manejar errores específicos
    if (error.status === 429) {
      return 'Lo siento, estamos experimentando alta demanda. Por favor, intenta nuevamente en unos segundos.';
    } else if (error.message && error.message.includes('timeout')) {
      return 'Lo siento, la consulta está tomando demasiado tiempo. Por favor, intenta con una pregunta más específica.';
    } else if (error.message && error.message.includes("already has an active run")) {
      return 'Lo siento, el sistema está ocupado. Por favor, intenta nuevamente en unos momentos.';
    }
    
    return 'Lo siento, ocurrió un error al procesar tu consulta.';
  }
}

// Función para reintentar una consulta que falló por timeout
async function reintentarConsulta(msg, threadId, runId, message) {
  console.log(`🔄 [Reintento] Usuario: ${msg.from}, Mensaje: "${message.substring(0, 30)}..."`);
  
  try {
    // Verificar si el thread está bloqueado
    if (threadEstaBloqueado(threadId)) {
      console.log(`⚠️ [Reintento] Thread ${threadId} bloqueado, esperando...`);
      const desbloqueado = await esperarDesbloqueoThread(threadId);
      if (!desbloqueado) {
        return 'Lo siento, el sistema está ocupado. Por favor, intenta nuevamente en unos momentos.';
      }
    }
    
    // Bloquear el thread durante la operación
    bloquearThread(threadId);
    
    // Cancelar el run anterior si aún está en proceso
    await cancelarRunSeguro(threadId, runId);
    
    // Verificar si hay otro run activo para este usuario
    if (tieneRunActivo(msg.from)) {
      const runActivo = activeRuns.get(msg.from);
      if (runActivo.runId !== runId) {
        console.log(`⚠️ [Reintento] Usuario ${msg.from} ya tiene otro run activo ${runActivo.runId}, cancelando primero`);
        await cancelarRunSeguro(runActivo.threadId, runActivo.runId);
        activeRuns.delete(msg.from);
      }
    }
    
    // Esperar un momento para asegurar que el run anterior se haya cancelado
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // ✅ CORREGIDO: Sin max_tokens para Assistants API
    console.log(`🆕 [Reintento] Creando nuevo run optimizado en thread ${threadId}`);
    const newRun = await openai.beta.threads.runs.create(threadId, {
      assistant_id: OPENAI_ASSISTANT_ID,
      temperature: ASSISTANT_CONFIG.temperature
      // ❌ max_tokens eliminado - NO válido para Assistants API
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
    const extendedTimeout = TIMEOUT_REINTENTO; // Timeout optimizado para reintentos
    
    while (runStatus !== "completed" && runStatus !== "failed" && runStatus !== "cancelled" && runStatus !== "error" && attempts < extendedTimeout) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      runStatus = await verificarEstadoRun(threadId, newRun.id);
      attempts++;
    }
    
    // Eliminar el run activo
    activeRuns.delete(msg.from);
    
    // Desbloquear el thread
    desbloquearThread(threadId);
    
    if (runStatus !== "completed") {
      // Cancelar el run si no se completó
      await cancelarRunSeguro(threadId, newRun.id);
      
      setTimeout(() => procesarMensajesPendientes(msg.from), 1000);
      
      return 'Lo siento, esta consulta es demasiado compleja y está tomando mucho tiempo. ¿Podrías reformularla de manera más específica?';
    }
    
    // Obtener los mensajes del thread
    const messages = await openai.beta.threads.messages.list(threadId);
    const assistantMessages = messages.data.filter(msg => msg.role === "assistant");
    
    setTimeout(() => procesarMensajesPendientes(msg.from), 1000);
    
    if (assistantMessages.length > 0 && assistantMessages[0].content.length > 0) {
      return assistantMessages[0].content[0].text.value;
    } else {
      return 'Disculpa, no pude procesar tu consulta después de varios intentos.';
    }
  } catch (error) {
    console.error('❌ [Error en reintento]:', error);
    
    activeRuns.delete(msg.from);
    desbloquearThread(threadId);
    
    setTimeout(() => procesarMensajesPendientes(msg.from), 1000);
    
    if (error.message && error.message.includes("already has an active run")) {
      return 'Lo siento, el sistema está ocupado. Por favor, intenta nuevamente en unos momentos.';
    }
    
    return 'Lo siento, ocurrió un error al procesar tu consulta. Por favor, intenta con una pregunta diferente.';
  }
}

// ----------------------------------------------------
// 8. Función para procesar mensajes pendientes
// ----------------------------------------------------

async function procesarMensajesPendientes(userId) {
  // Verificar si hay mensajes pendientes
  if (pendingMessages.has(userId) && pendingMessages.get(userId).length > 0) {
    // Verificar que no haya un run activo
    if (tieneRunActivo(userId)) {
      console.log(`⏳ [Cola] Usuario ${userId} tiene un run activo, posponiendo procesamiento de cola`);
      return;
    }
    
    // Procesar cola prioritaria
    await procesarColaPrioritaria(userId);
    
    console.log(`📋 [Cola] Procesando mensaje pendiente para ${userId}`);
    const nextMessage = pendingMessages.get(userId).shift();
    
    // Si la cola queda vacía, eliminarla
    if (pendingMessages.get(userId).length === 0) {
      pendingMessages.delete(userId);
    }
    
    // Procesar el siguiente mensaje
    try {
      const reply = await responderConGPT(userId, nextMessage.message, nextMessage.msgObj);
      await nextMessage.msgObj.reply(reply);
      console.log(`📤 [Respuesta GPT] ${userId}: ${reply.substring(0, 50)}...`);
      userFaileds.set(userId, 0);
    } catch (error) {
      console.error('❌ [Error al procesar mensaje pendiente]', error);
      const failed = userFaileds.get(userId) || 0;
      userFaileds.set(userId, failed + 1);
      await nextMessage.msgObj.reply('Lo siento, hubo un problema al procesar tu mensaje pendiente.');
    }
  }
}

// ----------------------------------------------------
// 9. Función para procesar mensajes con manejo de concurrencia
// ----------------------------------------------------

async function procesarMensaje(userId, message, msgObj) {
  // Todos los mensajes van directamente al asistente de OpenAI
  
  // Verificar si hay un run activo para este usuario
  if (tieneRunActivo(userId)) {
    console.log(`⏳ [Encolando] Mensaje de ${userId} mientras hay un run activo`);
    
    // Añadir mensaje a la cola de pendientes
    if (!pendingMessages.has(userId)) {
      pendingMessages.set(userId, []);
    }
    pendingMessages.get(userId).push({
      message,
      timestamp: Date.now(),
      msgObj
    });
    
    // Informar al usuario que su mensaje está en cola
    await msgObj.reply("Estoy procesando tu consulta anterior. Tu nuevo mensaje será atendido en breve.");
    return;
  }
  
  // Verificar si el thread está bloqueado
  const threadId = chatThreads.get(userId);
  if (threadId && threadEstaBloqueado(threadId)) {
    console.log(`⏳ [Encolando] Mensaje de ${userId} mientras el thread está bloqueado`);
    
    // Añadir mensaje a la cola de pendientes
    if (!pendingMessages.has(userId)) {
      pendingMessages.set(userId, []);
    }
    pendingMessages.get(userId).push({
      message,
      timestamp: Date.now(),
      msgObj
    });
    
    // Informar al usuario que su mensaje está en cola
    await msgObj.reply("El sistema está ocupado procesando otra consulta. Tu mensaje será atendido en breve.");
    return;
  }
  
  // Si no hay run activo ni thread bloqueado, procesar normalmente
  try {
    // Llamar directamente al asistente de OpenAI para todas las consultas
    const reply = await responderConGPT(userId, message, msgObj);
    await msgObj.reply(reply);
    console.log(`📤 [Respuesta GPT] ${userId}: ${reply.substring(0, 50)}...`);
    userFaileds.set(userId, 0);
  } catch (error) {
    console.error('❌ [Error interno al responderConGPT]', error);
    const failed = userFaileds.get(userId) || 0;
    userFaileds.set(userId, failed + 1);
    if (failed < 3) {
      await msgObj.reply('Lo siento, hubo un problema al procesar tu mensaje. Por favor, inténtalo de nuevo.');
    } else {
      await msgObj.reply('Lo siento mucho, estoy teniendo dificultades para responder. ¿Te gustaría hablar con un operador humano? Escribe "operador".');
    }
  }
}

// ----------------------------------------------------
// 10. Eventos de WhatsApp
// ----------------------------------------------------

client.on('qr', qr => {
  qrcode.generate(qr, { small: true });
  console.log('📸 [QR] Escanea este código QR con tu WhatsApp para conectar.');
});

client.on('ready', () => {
  console.log('🟢 [Conectado] El bot de WhatsApp está listo.');
});

client.on('message', async msg => {
  const userId = msg.from;
  const incoming = msg.body;
  console.log(`📥 [Mensaje] ${userId}: ${incoming}`);

  // Ignorar mensajes de grupos
  if (esGrupoWhatsApp(userId)) {
    console.log(`🚫 [Grupo] Ignorando mensaje de grupo: ${userId}`);
    return;
  }

  // Ignorar mensajes del propio bot
  if (msg.fromMe) {
    return;
  }

  // Manejar comando de operador humano
  if (incoming.toLowerCase().includes('operador')) {
    if (humanModeUsers.has(userId)) {
      humanModeUsers.delete(userId);
      await msg.reply('Has salido del modo operador humano. Ahora volveré a responder automáticamente.');
    } else {
      humanModeUsers.add(userId);
      await msg.reply('Activado el modo operador humano. Un operador te contactará pronto. Escribe "operador" nuevamente para volver al modo automático.');
    }
    return;
  }

  // Si el usuario está en modo operador humano, no responder automáticamente
  if (humanModeUsers.has(userId)) {
    console.log(`👤 [Operador] Usuario ${userId} en modo operador humano`);
    return;
  }

  // Procesar el mensaje con el asistente de OpenAI
  await procesarMensaje(userId, incoming, msg);
});

client.on('disconnected', (reason) => {
  console.log('🔴 [Desconectado] Cliente desconectado:', reason);
});

// ----------------------------------------------------
// 11. Inicialización y tareas de mantenimiento
// ----------------------------------------------------

// Ejecutar limpieza más frecuente para mejor estabilidad
setInterval(limpiarRunsAbandonados, INTERVALO_LIMPIEZA);

// Ejecutar optimización del sistema cada 15 minutos
setInterval(optimizarSistema, 15 * 60 * 1000);

// Inicializar el cliente
client.initialize();

console.log('🚀 [Iniciando] Bot de WhatsApp CORREGIDO - Solo Asistente de OpenAI');
console.log('⚡ [Configuración] Velocidad y estabilidad optimizadas');
console.log('✅ [Corrección] Error max_tokens solucionado');
console.log(`⏱️ [Timeouts] Default: ${TIMEOUT_DEFAULT}s, Reintento: ${TIMEOUT_REINTENTO}s`);
console.log(`🎛️ [Asistente] Temperature: ${ASSISTANT_CONFIG.temperature}, Fallback max_tokens: ${ASSISTANT_CONFIG.max_tokens}`);
