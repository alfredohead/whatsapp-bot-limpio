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

// Mapa para rastrear threads con runs activos
const activeRuns = new Map();  // Map<userId, {runId, threadId, timestamp}>

// Cola de mensajes pendientes por usuario
const pendingMessages = new Map();  // Map<userId, Array<{message, timestamp, msgObj}>>

// Bloqueos para operaciones en threads
const threadLocks = new Map(); // Map<threadId, boolean>

// NUEVO: Sistema de caché para respuestas frecuentes
const respuestasCacheadas = {
  "cursos": {
    palabrasClave: ["curso", "cursos", "capacitacion", "capacitaciones", "taller", "talleres"],
    respuesta: "La Municipalidad de San Martín ofrece diversos cursos a través de la Escuela de Oficio Manuel Belgrano y el Punto Digital. Los cursos actuales incluyen: informática básica, diseño gráfico, programación, administración pública, y oficios varios. ¿Te interesa alguno en particular?"
  },
  "punto_digital": {
    palabrasClave: ["punto digital", "puntodigital", "centro digital", "tecnologia"],
    respuesta: "El Punto Digital de San Martín ofrece acceso gratuito a tecnología, internet y capacitaciones. Está ubicado en la sede municipal y funciona de lunes a viernes de 9:00 a 18:00. Ofrecen cursos de alfabetización digital, diseño, programación y más."
  },
  "artesanos": {
    palabrasClave: ["artesano", "artesanos", "feria", "ferias", "artesania", "artesanias"],
    respuesta: "La Feria de Artesanos de San Martín se realiza todos los fines de semana en la Plaza Central, de 10:00 a 19:00. Los artesanos interesados en participar pueden inscribirse en la Dirección de Cultura (Edificio Municipal, 2° piso) de lunes a viernes de 8:00 a 14:00."
  },
  "escuela_belgrano": {
    palabrasClave: ["belgrano", "manuel belgrano", "escuela de oficio", "escuela oficio"],
    respuesta: "La Escuela de Oficio Manuel Belgrano ofrece formación gratuita en diversos oficios como carpintería, electricidad, plomería, costura, y gastronomía. Las inscripciones están abiertas todo el año en la sede municipal. Para más información, puede acercarse personalmente o llamar a la Dirección de Educación."
  }
};

// NUEVO: Función para buscar respuesta cacheada
function buscarRespuestaCacheada(mensaje) {
  const mensajeLower = mensaje.toLowerCase();
  
  for (const [clave, datos] of Object.entries(respuestasCacheadas)) {
    if (datos.palabrasClave.some(palabra => mensajeLower.includes(palabra))) {
      console.log(`🔍 [Caché] Encontrada respuesta cacheada para: ${clave}`);
      return datos.respuesta;
    }
  }
  
  return null;
}

// NUEVO: Límites de tiempo adaptativos
const TIMEOUT_SIMPLE = 15;    // 15 segundos para consultas simples
const TIMEOUT_NORMAL = 30;    // 30 segundos para consultas normales
const TIMEOUT_COMPLEJO = 45;  // 45 segundos para consultas complejas

// NUEVO: Función para determinar la complejidad de una consulta
function determinarComplejidad(mensaje) {
  const longitud = mensaje.length;
  const tienePreguntas = mensaje.includes('?');
  const tieneMultiplesPreguntas = (mensaje.match(/\?/g) || []).length > 1;
  
  if (longitud < 20 && !tienePreguntas) {
    return 'simple';
  } else if (tieneMultiplesPreguntas || longitud > 100) {
    return 'complejo';
  } else {
    return 'normal';
  }
}

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
    // Verificar primero si el run sigue activo
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

// NUEVO: Función para limpiar threads antiguos
async function limpiarThreadAntiguo(threadId) {
  try {
    // Obtener todos los mensajes del thread
    const mensajes = await openai.beta.threads.messages.list(threadId);
    
    // Si hay más de 10 mensajes, crear un nuevo thread con un resumen
    if (mensajes.data.length > 10) {
      console.log(`🧹 [Limpieza] Thread ${threadId} tiene ${mensajes.data.length} mensajes, creando uno nuevo`);
      
      // Crear un nuevo thread
      const nuevoThread = await openai.beta.threads.create();
      
      // Añadir un mensaje de resumen al nuevo thread
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

// NUEVO: Función para extraer temas principales de la conversación
function obtenerTemasConversacion(mensajes) {
  // Implementación simplificada
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

// Función para procesar mensajes pendientes
async function procesarMensajesPendientes(userId) {
  // Verificar si hay mensajes pendientes
  if (pendingMessages.has(userId) && pendingMessages.get(userId).length > 0) {
    // Verificar que no haya un run activo
    if (tieneRunActivo(userId)) {
      console.log(`⏳ [Cola] Usuario ${userId} tiene un run activo, posponiendo procesamiento de cola`);
      return;
    }
    
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

// Función para limpiar runs abandonados
function limpiarRunsAbandonados() {
  const ahora = Date.now();
  const MAX_RUN_TIME = 5 * 60 * 1000; // 5 minutos
  
  for (const [userId, runInfo] of activeRuns.entries()) {
    if (ahora - runInfo.timestamp > MAX_RUN_TIME) {
      console.log(`🧹 [Limpieza] Run abandonado para ${userId}: ${runInfo.runId}`);
      
      // Intentar cancelar el run
      cancelarRunSeguro(runInfo.threadId, runInfo.runId)
        .then(() => {
          // Eliminar de la lista de activos
          activeRuns.delete(userId);
          
          // Desbloquear el thread
          desbloquearThread(runInfo.threadId);
          
          // Procesar mensajes pendientes si hay
          setTimeout(() => procesarMensajesPendientes(userId), 1000);
        })
        .catch(err => console.error('Error al limpiar run abandonado:', err));
    }
  }
}

// Ejecutar limpieza cada 5 minutos
setInterval(limpiarRunsAbandonados, 5 * 60 * 1000);

// NUEVO: Función para enviar respuesta progresiva
async function enviarRespuestaProgresiva(msg, threadId, runId) {
  try {
    // Enviar mensaje inicial rápido
    await msg.reply("Estoy preparando tu respuesta...");
    
    // Esperar un tiempo corto
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Verificar si el run sigue en proceso
    const status = await verificarEstadoRun(threadId, runId);
    
    if (status !== "completed") {
      // Intentar obtener una respuesta parcial
      const mensajesParciales = await openai.beta.threads.messages.list(threadId);
      const mensajesAsistente = mensajesParciales.data.filter(m => m.role === "assistant");
      
      if (mensajesAsistente.length > 0 && mensajesAsistente[0].content.length > 0) {
        // Hay una respuesta parcial, enviarla
        const respuestaParcial = "Aquí hay información preliminar mientras completo mi respuesta: " + 
                                mensajesAsistente[0].content[0].text.value.substring(0, 100) + "...";
        await msg.reply(respuestaParcial);
      }
    }
  } catch (error) {
    console.error("Error al enviar respuesta progresiva:", error);
  }
}

// Función para enviar mensajes de estado durante esperas largas
async function enviarEstadoProgresivo(msg, threadId, runId) {
  // Limpiar cualquier intervalo existente para este usuario
  if (statusMessages.has(msg.from)) {
    clearInterval(statusMessages.get(msg.from));
  }
  
  // MODIFICADO: Checkpoints más frecuentes
  const checkpoints = [10, 20, 30]; // segundos (antes era 15, 30, 60)
  let currentCheckpoint = 0;
  
  const intervalId = setInterval(async () => {
    if (currentCheckpoint >= checkpoints.length) {
      clearInterval(intervalId);
      return;
    }
    
    // Verificar si el run sigue en proceso
    try {
      const status = await verificarEstadoRun(threadId, runId);
      if (status === "completed" || status === "failed" || status === "cancelled" || status === "error") {
        clearInterval(intervalId);
        statusMessages.delete(msg.from);
        return;
      }
      
      // Enviar mensaje de estado
      if (checkpoints[currentCheckpoint] === 10) {
        await msg.reply("Estoy procesando tu consulta, esto puede tomar un momento...");
      } else if (checkpoints[currentCheckpoint] === 20) {
        await msg.reply("Tu consulta es compleja, sigo trabajando en ella...");
      } else if (checkpoints[currentCheckpoint] === 30) {
        await msg.reply("Esta consulta está tomando más tiempo de lo habitual, pero sigo procesándola. Gracias por tu paciencia.");
      }
      
      currentCheckpoint++;
    } catch (error) {
      console.error("Error al verificar estado:", error);
      clearInterval(intervalId);
      statusMessages.delete(msg.from);
    }
  }, 1000 * 10); // Verificar cada 10 segundos (antes era 15)
  
  statusMessages.set(msg.from, intervalId);
  return intervalId;
}

// NUEVO: Función para responder rápidamente a consultas simples
async function responderConsultaSimple(message) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'Responde de forma muy breve y concisa.' },
        { role: 'user', content: message }
      ],
      temperature: 0.3,
      max_tokens: 50
    });
    
    return response.choices[0]?.message?.content?.trim();
  } catch (error) {
    console.error('Error en respuesta rápida:', error);
    return null;
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
        console.log(`❌ [Reintento] Thread ${threadId} sigue bloqueado después de esperar, abortando`);
        return 'Lo siento, el sistema está ocupado procesando otras consultas. Por favor, intenta nuevamente en unos momentos.';
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
    
    // Esperar un momento para asegurar que el run anterior se haya cancelado completamente
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // MODIFICADO: Crear un nuevo run con parámetros optimizados
    console.log(`🆕 [Reintento] Creando nuevo run en thread ${threadId}`);
    const newRun = await openai.beta.threads.runs.create(threadId, {
      assistant_id: OPENAI_ASSISTANT_ID,
      temperature: 0.3,  // Valor más bajo para respuestas más deterministas y rápidas
      max_tokens: 300    // Limitar longitud para respuestas más rápidas
    });
    
    // Registrar el run activo
    activeRuns.set(msg.from, {
      runId: newRun.id,
      threadId: threadId,
      timestamp: Date.now()
    });
    
    // NUEVO: Enviar respuesta progresiva
    enviarRespuestaProgresiva(msg, threadId, newRun.id);
    
    // Iniciar mensajes de estado para el nuevo run
    enviarEstadoProgresivo(msg, threadId, newRun.id);
    
    // MODIFICADO: Esperar con timeout más corto
    let runStatus = await verificarEstadoRun(threadId, newRun.id);
    let attempts = 0;
    const extendedTimeout = 45; // 45 segundos para el reintento (antes era 90)
    
    while (runStatus !== "completed" && runStatus !== "failed" && runStatus !== "cancelled" && runStatus !== "error" && attempts < extendedTimeout) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      runStatus = await verificarEstadoRun(threadId, newRun.id);
      attempts++;
    }
    
    // Limpiar intervalo de mensajes de estado
    if (statusMessages.has(msg.from)) {
      clearInterval(statusMessages.get(msg.from));
      statusMessages.delete(msg.from);
    }
    
    // Eliminar el run activo
    activeRuns.delete(msg.from);
    
    // Desbloquear el thread
    desbloquearThread(threadId);
    
    if (runStatus !== "completed") {
      // Cancelar el run si no se completó
      await cancelarRunSeguro(threadId, newRun.id);
      
      // Procesar mensajes pendientes después de liberar el thread
      setTimeout(() => procesarMensajesPendientes(msg.from), 1000);
      
      return 'Lo siento, esta consulta es demasiado compleja y está tomando mucho tiempo. ¿Podrías reformularla de manera más específica?';
    }
    
    // Obtener los mensajes del thread
    const messages = await openai.beta.threads.messages.list(threadId);
    const assistantMessages = messages.data.filter(msg => msg.role === "assistant");
    
    // Procesar mensajes pendientes después de liberar el thread
    setTimeout(() => procesarMensajesPendientes(msg.from), 1000);
    
    if (assistantMessages.length > 0 && assistantMessages[0].content.length > 0) {
      return assistantMessages[0].content[0].text.value;
    } else {
      return 'Disculpa, no pude procesar tu consulta después de varios intentos.';
    }
  } catch (error) {
    console.error('❌ [Error en reintento]:', error);
    
    // Eliminar el run activo en caso de error
    activeRuns.delete(msg.from);
    
    // Desbloquear el thread en caso de error
    desbloquearThread(threadId);
    
    // Procesar mensajes pendientes después de liberar el thread
    setTimeout(() => procesarMensajesPendientes(msg.from), 1000);
    
    // Manejar errores específicos
    if (error.message && error.message.includes("already has an active run")) {
      return 'Lo siento, el sistema está ocupado procesando otra consulta. Por favor, intenta nuevamente en unos momentos.';
    }
    
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
    // NUEVO: Verificar si hay una respuesta cacheada
    const respuestaCacheada = buscarRespuestaCacheada(message);
    if (respuestaCacheada) {
      console.log(`⚡ [Caché] Usando respuesta cacheada para ${userId}`);
      return respuestaCacheada;
    }
    
    // NUEVO: Para consultas muy simples, intentar respuesta rápida
    if (esConsultaSimple(message)) {
      console.log(`⚡ [Rápida] Intentando respuesta rápida para ${userId}`);
      const respuestaRapida = await responderConsultaSimple(message);
      if (respuestaRapida) {
        return respuestaRapida;
      }
    }

    // Si existe Assistant ID, lo usamos
    if (OPENAI_ASSISTANT_ID) {
      // Obtener o crear un thread para este usuario
      let threadId = chatThreads.get(userId);
      if (!threadId) {
        const thread = await openai.beta.threads.create();
        threadId = thread.id;
        chatThreads.set(userId, threadId);
        // Inicializar el estado de bloqueo
        threadLocks.set(threadId, false);
      } else {
        // NUEVO: Limpiar thread si es necesario
        threadId = await limpiarThreadAntiguo(threadId);
        chatThreads.set(userId, threadId);
      }

      // Verificar si el thread está bloqueado
      if (threadEstaBloqueado(threadId)) {
        console.log(`⚠️ [Respuesta] Thread ${threadId} bloqueado, esperando...`);
        const desbloqueado = await esperarDesbloqueoThread(threadId);
        if (!desbloqueado) {
          console.log(`❌ [Respuesta] Thread ${threadId} sigue bloqueado después de esperar, abortando`);
          return 'Lo siento, el sistema está ocupado procesando otras consultas. Por favor, intenta nuevamente en unos momentos.';
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
          
          // Esperar un momento para asegurar que el run anterior se haya cancelado completamente
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        // Añadir el mensaje del usuario al thread
        await openai.beta.threads.messages.create(threadId, {
          role: "user",
          content: message
        });
      } catch (error) {
        // Si el error es porque hay un run activo, manejarlo específicamente
        if (error.message && error.message.includes("while a run") && error.message.includes("is active")) {
          console.log(`⚠️ [Run Activo] No se pudo añadir mensaje para ${userId}, run activo detectado`);
          desbloquearThread(threadId);
          return 'Estoy procesando tu consulta anterior. Por favor, espera un momento antes de enviar un nuevo mensaje.';
        } else {
          // Si es otro tipo de error, relanzarlo
          desbloquearThread(threadId);
          throw error;
        }
      }

      // MODIFICADO: Crear run con parámetros optimizados
      console.log(`🆕 [Respuesta] Creando nuevo run en thread ${threadId}`);
      const runParams = {
        assistant_id: OPENAI_ASSISTANT_ID,
        temperature: 0.3,  // Valor más bajo para respuestas más deterministas y rápidas
        max_tokens: 300    // Limitar longitud para respuestas más rápidas
      };
      const run = await openai.beta.threads.runs.create(threadId, runParams);
      
      // Registrar el run activo
      activeRuns.set(userId, {
        runId: run.id,
        threadId: threadId,
        timestamp: Date.now()
      });

      // MODIFICADO: Determinar timeout según complejidad
      const complejidad = determinarComplejidad(message);
      const timeout = complejidad === 'simple' ? TIMEOUT_SIMPLE : 
                      complejidad === 'complejo' ? TIMEOUT_COMPLEJO : 
                      TIMEOUT_NORMAL;
      
      console.log(`⏱️ [Timeout] Usando timeout ${timeout}s para consulta de complejidad ${complejidad}`);
      
      // NUEVO: Enviar respuesta progresiva para consultas no simples
      if (complejidad !== 'simple') {
        enviarRespuestaProgresiva(msg, threadId, run.id);
      }
      
      // Para consultas complejas, iniciar mensajes de estado
      if (complejidad === 'complejo') {
        enviarEstadoProgresivo(msg, threadId, run.id);
      }

      // Esperar a que termine la ejecución (con timeout)
      let runStatus = await verificarEstadoRun(threadId, run.id);
      let attempts = 0;
      
      while (runStatus !== "completed" && runStatus !== "failed" && runStatus !== "cancelled" && runStatus !== "error" && attempts < timeout) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        runStatus = await verificarEstadoRun(threadId, run.id);
        attempts++;
      }
      
      // Limpiar intervalo de mensajes de estado
      if (statusMessages.has(userId)) {
        clearInterval(statusMessages.get(userId));
        statusMessages.delete(userId);
      }
      
      // Eliminar el run activo
      activeRuns.delete(userId);
      
      // Desbloquear el thread
      desbloquearThread(threadId);
      
      if (runStatus !== "completed") {
        // Si es una consulta simple, reintentar automáticamente
        if (complejidad === 'simple') {
          await msg.reply('Esta consulta está tomando más tiempo de lo esperado. Estoy reintentando...');
          return await reintentarConsulta(msg, threadId, run.id, message);
        }
        
        // Para consultas complejas, ofrecer reintento manual
        await cancelarRunSeguro(threadId, run.id);
        
        // Procesar mensajes pendientes después de liberar el thread
        setTimeout(() => procesarMensajesPendientes(userId), 1000);
        
        return 'Lo siento, la respuesta está tardando demasiado. Por favor, intenta reformular tu pregunta de manera más específica.';
      }

      // Obtener los mensajes del thread
      const messages = await openai.beta.threads.messages.list(threadId);
      const assistantMessages = messages.data.filter(msg => msg.role === "assistant");
      
      // Procesar mensajes pendientes después de liberar el thread
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
      temperature: 0.3,  // MODIFICADO: Valor más bajo para respuestas más rápidas
      max_tokens: 300    // MODIFICADO: Limitar longitud para respuestas más rápidas
    });

    return response.choices[0]?.message?.content?.trim() ||
           'Disculpa, no pude procesar tu consulta.';

  } catch (error) {
    console.error('❌ [GPT] Error:', error);
    
    // Obtener el threadId para desbloquear en caso de error
    const threadId = chatThreads.get(userId);
    if (threadId && threadEstaBloqueado(threadId)) {
      desbloquearThread(threadId);
    }
    
    // Eliminar el run activo en caso de error
    activeRuns.delete(userId);
    
    // Manejar errores específicos
    if (error.status === 429) {
      return 'Lo siento, estamos experimentando alta demanda en este momento. Por favor, intenta nuevamente en unos segundos.';
    } else if (error.message && error.message.includes('timeout')) {
      return 'Lo siento, la consulta está tomando demasiado tiempo. Por favor, intenta con una pregunta más específica.';
    } else if (error.message && error.message.includes("while a run") && error.message.includes("is active")) {
      return 'Estoy procesando tu consulta anterior. Por favor, espera un momento antes de enviar un nuevo mensaje.';
    } else if (error.message && error.message.includes("already has an active run")) {
      return 'Lo siento, el sistema está ocupado procesando otra consulta. Por favor, intenta nuevamente en unos momentos.';
    }
    
    return 'Lo siento, ocurrió un error al procesar tu consulta.';
  }
}

// Función para procesar mensajes con manejo de concurrencia
async function procesarMensaje(userId, message, msgObj) {
  // NUEVO: Verificar si hay una respuesta cacheada
  const respuestaCacheada = buscarRespuestaCacheada(message);
  if (respuestaCacheada) {
    console.log(`⚡ [Caché] Respondiendo inmediatamente a ${userId}`);
    await msgObj.reply(respuestaCacheada);
    console.log(`📤 [Respuesta Caché] ${userId}: ${respuestaCacheada.substring(0, 50)}...`);
    return;
  }
  
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
    // NUEVO: Para consultas muy simples, intentar respuesta rápida
    if (esConsultaSimple(message)) {
      console.log(`⚡ [Rápida] Intentando respuesta rápida para ${userId}`);
      const respuestaRapida = await responderConsultaSimple(message);
      if (respuestaRapida) {
        await msgObj.reply(respuestaRapida);
        console.log(`📤 [Respuesta Rápida] ${userId}: ${respuestaRapida.substring(0, 50)}...`);
        return;
      }
    }
    
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

    // Usar la función de procesamiento con manejo de concurrencia
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
  
  // Limpiar runs activos
  activeRuns.clear();
  
  // Desbloquear todos los threads
  for (const [threadId] of threadLocks.entries()) {
    threadLocks.set(threadId, false);
  }
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
  
  // Limpiar runs activos
  activeRuns.clear();
  
  // Desbloquear todos los threads
  for (const [threadId] of threadLocks.entries()) {
    threadLocks.set(threadId, false);
  }
  
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
