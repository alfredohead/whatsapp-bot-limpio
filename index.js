// index.js: Conexión definitiva al Assistant en OpenAI

require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { OpenAI } = require('openai');

// ----------------------------------------------------
// 1. Leer variables de entorno
// ----------------------------------------------------
const OPENAI_API_KEY      = process.env.OPENAI_API_KEY;
const OPENAI_ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;

// Debug: confirmar que la variable se cargó
console.log('🟣 [DEBUG ENV] OPENAI_ASSISTANT_ID =', OPENAI_ASSISTANT_ID);

// Inicializar cliente de OpenAI
let openai = null;
if (OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  console.log('✅ [OpenAI] API configurada correctamente');
  if (OPENAI_ASSISTANT_ID) {
    console.log(`✅ [OpenAI] Assistant ID configurado: ${OPENAI_ASSISTANT_ID}`);
  } else {
    console.warn('⚠️ [OpenAI] No se encontró OPENAI_ASSISTANT_ID en env. Se usará fallback a modelo genérico.');
  }
} else {
  console.warn('⚠️ [OpenAI] OPENAI_API_KEY no configurada. El servicio de GPT no funcionará.');
}

// ----------------------------------------------------
// 2. Configuración de WhatsApp (Puppeteer flags para Fly.io)
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
// 3. Variables globales
// ----------------------------------------------------
const SYSTEM_PROMPT    = `Eres un asistente amable y profesional que ayuda a los usuarios de la Municipalidad de San Martín (Área Programas Nacionales). Responde con claridad y brevedad.`;
const chatThreads      = new Map();   // Map<userId, threadId>
const humanModeUsers   = new Set();   // Set<userId> usuarios en modo "operador humano"
const userFaileds      = new Map();   // Map<userId, número de intentos fallidos
const statusMessages   = new Map();   // Map<userId, intervalId> para mensajes de estado

// NUEVO: Mapa para rastrear threads con runs activos
const activeRuns = new Map();  // Map<userId, {runId, threadId, timestamp}>

// NUEVO: Cola de mensajes pendientes por usuario
const pendingMessages = new Map();  // Map<userId, Array<{message, timestamp, msgObj}>>

// Función para detectar si una consulta es simple
function esConsultaSimple(mensaje) {
  // Lista de patrones de consultas simples
  const patronesSimples = [
    /^hola+/i,
    /^buenos días/i,
    /^buenas tardes/i,
    /^buenas noches/i,
    /^gracias/i,
    /^ok/i,
    /^sí/i,
    /^no/i,
    /^ayuda/i
  ];
  
  // Verificar si el mensaje coincide con algún patrón simple
  return patronesSimples.some(patron => patron.test(mensaje)) || mensaje.length < 15;
}

// Función para verificar si un chat es grupal
function esGrupoWhatsApp(chatId) {
  // Los IDs de grupos de WhatsApp terminan con @g.us
  return chatId.endsWith('@g.us');
}

// NUEVO: Función para verificar si hay un run activo para un usuario
function tieneRunActivo(userId) {
  return activeRuns.has(userId);
}

// NUEVO: Función para procesar mensajes pendientes
async function procesarMensajesPendientes(userId) {
  // Verificar si hay mensajes pendientes
  if (pendingMessages.has(userId) && pendingMessages.get(userId).length > 0) {
    console.log(`📋 [Cola] Procesando mensaje pendiente para ${userId}`);
    const nextMessage = pendingMessages.get(userId).shift();
    
    // Si la cola queda vacía, eliminarla
    if (pendingMessages.get(userId).length === 0) {
      pendingMessages.delete(userId);
    }
    
    // Procesar el siguiente mensaje
    try {
      // Llamar a GPT (Assistant)
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

// NUEVO: Función para limpiar runs abandonados
function limpiarRunsAbandonados() {
  const ahora = Date.now();
  const MAX_RUN_TIME = 5 * 60 * 1000; // 5 minutos
  
  for (const [userId, runInfo] of activeRuns.entries()) {
    if (ahora - runInfo.timestamp > MAX_RUN_TIME) {
      console.log(`🧹 [Limpieza] Run abandonado para ${userId}: ${runInfo.runId}`);
      
      // Intentar cancelar el run
      try {
        openai.beta.threads.runs.cancel(runInfo.threadId, runInfo.runId)
          .catch(err => console.error('Error al cancelar run abandonado:', err));
      } catch (error) {
        console.error('Error al intentar cancelar run abandonado:', error);
      }
      
      // Eliminar de la lista de activos
      activeRuns.delete(userId);
      
      // Procesar mensajes pendientes si hay
      procesarMensajesPendientes(userId);
    }
  }
}

// Ejecutar limpieza cada 5 minutos
setInterval(limpiarRunsAbandonados, 5 * 60 * 1000);

// Función para enviar mensajes de estado durante esperas largas
async function enviarEstadoProgresivo(msg, threadId, runId) {
  // Limpiar cualquier intervalo existente para este usuario
  if (statusMessages.has(msg.from)) {
    clearInterval(statusMessages.get(msg.from));
  }
  
  const checkpoints = [15, 30, 60]; // segundos
  let currentCheckpoint = 0;
  
  const intervalId = setInterval(async () => {
    if (currentCheckpoint >= checkpoints.length) {
      clearInterval(intervalId);
      return;
    }
    
    // Verificar si el run sigue en proceso
    try {
      const status = await openai.beta.threads.runs.retrieve(threadId, runId);
      if (status.status === "completed" || status.status === "failed" || status.status === "cancelled") {
        clearInterval(intervalId);
        statusMessages.delete(msg.from);
        return;
      }
      
      // Enviar mensaje de estado
      if (checkpoints[currentCheckpoint] === 15) {
        await msg.reply("Estoy procesando tu consulta, esto puede tomar un momento...");
      } else if (checkpoints[currentCheckpoint] === 30) {
        await msg.reply("Tu consulta es compleja, sigo trabajando en ella...");
      } else if (checkpoints[currentCheckpoint] === 60) {
        await msg.reply("Esta consulta está tomando más tiempo de lo habitual, pero sigo procesándola. Gracias por tu paciencia.");
      }
      
      currentCheckpoint++;
    } catch (error) {
      console.error("Error al verificar estado:", error);
      clearInterval(intervalId);
      statusMessages.delete(msg.from);
    }
  }, 1000 * 15); // Verificar cada 15 segundos
  
  statusMessages.set(msg.from, intervalId);
  return intervalId;
}

// Función para reintentar una consulta que falló por timeout
async function reintentarConsulta(msg, threadId, runId, message) {
  console.log(`🔄 [Reintento] Usuario: ${msg.from}, Mensaje: "${message.substring(0, 30)}..."`);
  
  try {
    // Cancelar el run anterior si aún está en proceso
    try {
      await openai.beta.threads.runs.cancel(threadId, runId);
    } catch (error) {
      // Ignorar errores al cancelar (puede que ya esté cancelado)
      console.log("Run ya finalizado o error al cancelar:", error.message);
    }
    
    // Crear un nuevo run
    const newRun = await openai.beta.threads.runs.create(threadId, {
      assistant_id: OPENAI_ASSISTANT_ID
    });
    
    // NUEVO: Registrar el run activo
    activeRuns.set(msg.from, {
      runId: newRun.id,
      threadId: threadId,
      timestamp: Date.now()
    });
    
    // Iniciar mensajes de estado para el nuevo run
    enviarEstadoProgresivo(msg, threadId, newRun.id);
    
    // Esperar con timeout extendido
    let runStatus = await openai.beta.threads.runs.retrieve(threadId, newRun.id);
    let attempts = 0;
    const extendedTimeout = 90; // 90 segundos para el reintento
    
    while (runStatus.status !== "completed" && attempts < extendedTimeout) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      runStatus = await openai.beta.threads.runs.retrieve(threadId, newRun.id);
      attempts++;
    }
    
    // Limpiar intervalo de mensajes de estado
    if (statusMessages.has(msg.from)) {
      clearInterval(statusMessages.get(msg.from));
      statusMessages.delete(msg.from);
    }
    
    // NUEVO: Eliminar el run activo
    activeRuns.delete(msg.from);
    
    if (runStatus.status !== "completed") {
      await openai.beta.threads.runs.cancel(threadId, newRun.id);
      
      // NUEVO: Procesar mensajes pendientes después de liberar el thread
      setTimeout(() => procesarMensajesPendientes(msg.from), 1000);
      
      return 'Lo siento, esta consulta es demasiado compleja y está tomando mucho tiempo. ¿Podrías reformularla de manera más específica?';
    }
    
    // Obtener los mensajes del thread
    const messages = await openai.beta.threads.messages.list(threadId);
    const assistantMessages = messages.data.filter(msg => msg.role === "assistant");
    
    // NUEVO: Procesar mensajes pendientes después de liberar el thread
    setTimeout(() => procesarMensajesPendientes(msg.from), 1000);
    
    if (assistantMessages.length > 0 && assistantMessages[0].content.length > 0) {
      return assistantMessages[0].content[0].text.value;
    } else {
      return 'Disculpa, no pude procesar tu consulta después de varios intentos.';
    }
  } catch (error) {
    console.error('❌ [Error en reintento]:', error);
    
    // NUEVO: Eliminar el run activo en caso de error
    activeRuns.delete(msg.from);
    
    // NUEVO: Procesar mensajes pendientes después de liberar el thread
    setTimeout(() => procesarMensajesPendientes(msg.from), 1000);
    
    return 'Lo siento, ocurrió un error al procesar tu consulta. Por favor, intenta con una pregunta diferente.';
  }
}

// ----------------------------------------------------
// 4. Función para responder (usando API de Assistants)
// ----------------------------------------------------
async function responderConGPT(userId, message, msg) {
  if (!openai) {
    return 'Lo siento, el servicio de asistencia avanzada no está disponible en este momento.';
  }

  try {
    // Si existe Assistant ID, lo usamos
    if (OPENAI_ASSISTANT_ID) {
      // Obtener o crear un thread para este usuario
      let threadId = chatThreads.get(userId);
      if (!threadId) {
        const thread = await openai.beta.threads.create();
        threadId = thread.id;
        chatThreads.set(userId, threadId);
      }

      // NUEVO: Verificar si hay un run activo antes de añadir el mensaje
      try {
        // Añadir el mensaje del usuario al thread
        await openai.beta.threads.messages.create(threadId, {
          role: "user",
          content: message
        });
      } catch (error) {
        // Si el error es porque hay un run activo, manejarlo específicamente
        if (error.message && error.message.includes("while a run") && error.message.includes("is active")) {
          console.log(`⚠️ [Run Activo] No se pudo añadir mensaje para ${userId}, run activo detectado`);
          return 'Estoy procesando tu consulta anterior. Por favor, espera un momento antes de enviar un nuevo mensaje.';
        } else {
          // Si es otro tipo de error, relanzarlo
          throw error;
        }
      }

      // Ejecutar el assistant en el thread
      const run = await openai.beta.threads.runs.create(threadId, {
        assistant_id: OPENAI_ASSISTANT_ID
      });
      
      // NUEVO: Registrar el run activo
      activeRuns.set(userId, {
        runId: run.id,
        threadId: threadId,
        timestamp: Date.now()
      });

      // Determinar si es una consulta simple o compleja
      const isSimpleQuery = esConsultaSimple(message);
      const maxAttempts = isSimpleQuery ? 30 : 60; // 30 segundos para consultas simples, 60 para complejas
      
      // Para consultas complejas, iniciar mensajes de estado
      if (!isSimpleQuery) {
        enviarEstadoProgresivo(msg, threadId, run.id);
      }

      // Esperar a que termine la ejecución (con timeout)
      let runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
      let attempts = 0;
      
      while (runStatus.status !== "completed" && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
        attempts++;
      }
      
      // Limpiar intervalo de mensajes de estado
      if (statusMessages.has(userId)) {
        clearInterval(statusMessages.get(userId));
        statusMessages.delete(userId);
      }
      
      // NUEVO: Eliminar el run activo
      activeRuns.delete(userId);
      
      if (runStatus.status !== "completed") {
        // Si es una consulta simple, reintentar automáticamente
        if (isSimpleQuery) {
          await msg.reply('Esta consulta está tomando más tiempo de lo esperado. Estoy reintentando...');
          return await reintentarConsulta(msg, threadId, run.id, message);
        }
        
        // Para consultas complejas, ofrecer reintento manual
        await openai.beta.threads.runs.cancel(threadId, run.id);
        
        // NUEVO: Procesar mensajes pendientes después de liberar el thread
        setTimeout(() => procesarMensajesPendientes(userId), 1000);
        
        return 'Lo siento, la respuesta está tardando demasiado. Por favor, intenta reformular tu pregunta de manera más específica.';
      }

      // Obtener los mensajes del thread
      const messages = await openai.beta.threads.messages.list(threadId);
      const assistantMessages = messages.data.filter(msg => msg.role === "assistant");
      
      // NUEVO: Procesar mensajes pendientes después de liberar el thread
      setTimeout(() => procesarMensajesPendientes(userId), 1000);
      
      if (assistantMessages.length > 0 && assistantMessages[0].content.length > 0) {
        return assistantMessages[0].content[0].text.value;
      } else {
        return 'Disculpa, no pude procesar tu consulta.';
      }
    }

    // (Rama de fallback, solo si por alguna razón falta OPENAI_ASSISTANT_ID)
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: message }
      ],
      temperature: 0.5,
      max_tokens: 400
    });

    return response.choices[0]?.message?.content?.trim() ||
           'Disculpa, no pude procesar tu consulta.';

  } catch (error) {
    console.error('❌ [GPT] Error:', error);
    
    // NUEVO: Eliminar el run activo en caso de error
    activeRuns.delete(userId);
    
    // Manejar errores específicos
    if (error.status === 429) {
      return 'Lo siento, estamos experimentando alta demanda en este momento. Por favor, intenta nuevamente en unos segundos.';
    } else if (error.message && error.message.includes('timeout')) {
      return 'Lo siento, la consulta está tomando demasiado tiempo. Por favor, intenta con una pregunta más específica.';
    } else if (error.message && error.message.includes("while a run") && error.message.includes("is active")) {
      return 'Estoy procesando tu consulta anterior. Por favor, espera un momento antes de enviar un nuevo mensaje.';
    }
    
    return 'Lo siento, ocurrió un error al procesar tu consulta.';
  }
}

// NUEVO: Función para procesar mensajes con manejo de concurrencia
async function procesarMensaje(userId, message, msgObj) {
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
  
  // Si no hay run activo, procesar normalmente
  try {
    // Llamar a GPT (Assistant)
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
// 5. Eventos de WhatsApp
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

  // Verificar si el mensaje proviene de un grupo
  if (esGrupoWhatsApp(userId)) {
    console.log(`🔇 [Grupo ignorado] ${userId}`);
    return; // No responder a mensajes de grupos
  }

  try {
    // Si OpenAI no está listo, informamos y ofrecemos operador humano
    if (!openai) {
      await msg.reply('Lo siento, el servicio de asistencia avanzada no está disponible en este momento.');
      await msg.reply('¿Te gustaría hablar con un operador humano? Escribe "operador" para ser derivado.');
      return;
    }

    // Comando "operador" / "bot"
    if (incoming.toLowerCase() === 'operador') {
      humanModeUsers.add(userId);
      await msg.reply('Te paso con un operador. Cuando quieras volver a hablar con el bot, escribe "bot".');
      return;
    }
    if (incoming.toLowerCase() === 'bot') {
      humanModeUsers.delete(userId);
      await msg.reply('✅ El bot ha sido reactivado. ¿En qué puedo ayudarte?');
      return;
    }

    // Si está en modo humano, no procesa con GPT
    if (humanModeUsers.has(userId)) {
      return;
    }

    // MODIFICADO: Usar la nueva función de procesamiento con manejo de concurrencia
    await procesarMensaje(userId, incoming, msg);

  } catch (err) {
    console.error('❌ [Error al procesar mensaje]', err);
    await msg.reply('Lo siento, ocurrió un error. Por favor, intenta más tarde.');
    await msg.reply('¿Te gustaría hablar con un operador humano? Escribe "operador" para ser derivado.');
  }
});

// Limpiar intervalos de mensajes de estado al desconectar
client.on('disconnected', () => {
  console.log('🔴 [Desconectado] El bot de WhatsApp se ha desconectado.');
  
  // Limpiar todos los intervalos de mensajes de estado
  for (const [userId, intervalId] of statusMessages.entries()) {
    clearInterval(intervalId);
  }
  statusMessages.clear();
  
  // NUEVO: Limpiar runs activos
  activeRuns.clear();
});

// ----------------------------------------------------
// 6. Inicializar cliente y servidor HTTP dummy
// ----------------------------------------------------
console.log('🚀 [Iniciando] Bot de WhatsApp con GPT (Assistant) …');
console.log('🟢 [DEBUG] Antes de client.initialize()');

client.initialize()
  .then(() => {
    console.log('🟢 [DEBUG] client.initialize() resuelto');
  })
  .catch(err => {
    console.error('❌ [Error de inicialización]', err);
    setTimeout(() => {
      console.log('🔄 Reintentando client.initialize()…');
      client.initialize();
    }, 30000);
  });

const http = require('http');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot de WhatsApp activo\n');
}).listen(3000, '0.0.0.0', () => {
  console.log('🌐 [HTTP] Servidor dummy escuchando en 0.0.0.0:3000');
});

// ----------------------------------------------------
// 7. Capturar promesas no manejadas
// ----------------------------------------------------
process.on('unhandledRejection', reason => {
  console.error('❌ [Error] Promesa no manejada:', reason);
});

// ----------------------------------------------------
// 8. Manejo de señales para apagado limpio
// ----------------------------------------------------
function shutdown(signal) {
  console.log(`\n🛑 [Sistema] Señal recibida: ${signal}. Cerrando bot y servidor HTTP…`);
  
  // Limpiar todos los intervalos de mensajes de estado
  for (const [userId, intervalId] of statusMessages.entries()) {
    clearInterval(intervalId);
  }
  statusMessages.clear();
  
  // NUEVO: Limpiar runs activos
  activeRuns.clear();
  
  try {
    client.destroy();
  } catch (e) {
    console.error('❌ [Error] Al cerrar cliente WhatsApp:', e);
  }
  try {
    server.close(() => {
      console.log('🌐 [HTTP] Servidor cerrado.');
      process.exit(0);
    });
  } catch (e) {
    console.error('❌ [Error] Al cerrar servidor HTTP:', e);
    process.exit(1);
  }
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
