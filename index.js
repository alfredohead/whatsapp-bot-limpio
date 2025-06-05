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
    
    if (runStatus.status !== "completed") {
      await openai.beta.threads.runs.cancel(threadId, newRun.id);
      return 'Lo siento, esta consulta es demasiado compleja y está tomando mucho tiempo. ¿Podrías reformularla de manera más específica?';
    }
    
    // Obtener los mensajes del thread
    const messages = await openai.beta.threads.messages.list(threadId);
    const assistantMessages = messages.data.filter(msg => msg.role === "assistant");
    
    if (assistantMessages.length > 0 && assistantMessages[0].content.length > 0) {
      return assistantMessages[0].content[0].text.value;
    } else {
      return 'Disculpa, no pude procesar tu consulta después de varios intentos.';
    }
  } catch (error) {
    console.error('❌ [Error en reintento]:', error);
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

      // Añadir el mensaje del usuario al thread
      await openai.beta.threads.messages.create(threadId, {
        role: "user",
        content: message
      });

      // Ejecutar el assistant en el thread
      const run = await openai.beta.threads.runs.create(threadId, {
        assistant_id: OPENAI_ASSISTANT_ID
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
      
      if (runStatus.status !== "completed") {
        // Si es una consulta simple, reintentar automáticamente
        if (isSimpleQuery) {
          await msg.reply('Esta consulta está tomando más tiempo de lo esperado. Estoy reintentando...');
          return await reintentarConsulta(msg, threadId, run.id, message);
        }
        
        // Para consultas complejas, ofrecer reintento manual
        await openai.beta.threads.runs.cancel(threadId, run.id);
        return 'Lo siento, la respuesta está tardando demasiado. Por favor, intenta reformular tu pregunta de manera más específica.';
      }

      // Obtener los mensajes del thread
      const messages = await openai.beta.threads.messages.list(threadId);
      const assistantMessages = messages.data.filter(msg => msg.role === "assistant");
      
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
    
    // Manejar errores específicos
    if (error.status === 429) {
      return 'Lo siento, estamos experimentando alta demanda en este momento. Por favor, intenta nuevamente en unos segundos.';
    } else if (error.message && error.message.includes('timeout')) {
      return 'Lo siento, la consulta está tomando demasiado tiempo. Por favor, intenta con una pregunta más específica.';
    }
    
    return 'Lo siento, ocurrió un error al procesar tu consulta.';
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

    // Contador de intentos fallidos
    let failed = userFaileds.get(userId) || 0;

    try {
      // Llamar a GPT (Assistant)
      const reply = await responderConGPT(userId, incoming, msg);
      await msg.reply(reply);
      console.log(`📤 [Respuesta GPT] ${userId}: ${reply.substring(0, 50)}...`);
      userFaileds.set(userId, 0);

    } catch (error) {
      console.error('❌ [Error interno al responderConGPT]', error);
      failed++;
      userFaileds.set(userId, failed);
      if (failed < 3) {
        await msg.reply('Lo siento, hubo un problema al procesar tu mensaje. Por favor, inténtalo de nuevo.');
      } else {
        await msg.reply('Lo siento mucho, estoy teniendo dificultades para responder. ¿Te gustaría hablar con un operador humano? Escribe "operador".');
      }
    }

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
