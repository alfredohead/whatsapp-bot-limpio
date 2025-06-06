// index.js: Bot de WhatsApp con MENSAJE INICIAL del Asistente
// Versión que responde automáticamente desde el primer contacto

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
const TIMEOUT_DEFAULT = 30;        
const TIMEOUT_REINTENTO = 20;      
const MAX_REINTENTOS = 2;          
const INTERVALO_LIMPIEZA = 3 * 60 * 1000;

const ASSISTANT_CONFIG = {
  temperature: 0.6,     
  max_tokens: 400,      
  timeout: 25000        
};

// ✅ Configuración de firma del asistente
const FIRMA_ASISTENTE = {
  sufijo: "\n\n🤖 _Asistente IA - Municipalidad San Martín_",
  activa: true
};

// ✅ NUEVO: Configuración del mensaje inicial
const MENSAJE_INICIAL = {
  activo: true,
  // El asistente generará el mensaje inicial basado en este prompt
  prompt_inicial: "Saluda de manera profesional y amable como asistente de la Municipalidad de San Martín. Preséntate brevemente y pregunta en qué puedes ayudar. Menciona que puedes ayudar con información sobre trámites, cursos, programas municipales y servicios."
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

MENSAJE DE BIENVENIDA:
Cuando sea el primer contacto con un usuario, preséntate como el asistente virtual de la Municipalidad de San Martín, explica brevemente que puedes ayudar con información sobre trámites, cursos, programas municipales y servicios, y pregunta en qué puedes ayudar específicamente.

Tu objetivo es ayudar a los ciudadanos con información municipal.`;

const chatThreads = new Map();      
const humanModeUsers = new Set();   
const userFaileds = new Map();      
const activeRuns = new Map();       
const pendingMessages = new Map();  
const threadLocks = new Map();      

// ✅ NUEVO: Tracking de usuarios nuevos
const usuariosConocidos = new Set(); // Set<userId> para trackear usuarios que ya han interactuado

// Stats para monitoreo
const stats = {
  mensajes_recibidos: 0,
  respuestas_enviadas: 0,
  errores: 0,
  usuarios_nuevos: 0,
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

// ✅ NUEVO: Función para detectar usuarios nuevos
function esUsuarioNuevo(userId) {
  return !usuariosConocidos.has(userId);
}

// ✅ NUEVO: Función para marcar usuario como conocido
function marcarUsuarioConocido(userId) {
  usuariosConocidos.add(userId);
  console.log(`👋 [NUEVO USUARIO] ${userId.substring(0, 15)} registrado`);
}

// ✅ Función mejorada para añadir firma del asistente
function añadirFirmaAsistente(respuesta) {
  if (!FIRMA_ASISTENTE.activa || !respuesta) {
    return respuesta;
  }

  let respuestaLimpia = respuesta
    .replace(/\n\n🤖.*$/gm, '')
    .replace(/\n\n_Asistente.*$/gm, '')
    .replace(/\n\n--.*Municipalidad.*$/gm, '')
    .trim();

  if (!respuestaLimpia.includes('🤖') && !respuestaLimpia.includes('Asistente IA')) {
    return respuestaLimpia + FIRMA_ASISTENTE.sufijo;
  }

  return respuestaLimpia;
}

function mostrarStats() {
  const uptime = Math.floor((Date.now() - stats.inicio) / 1000);
  const horas = Math.floor(uptime / 3600);
  const minutos = Math.floor((uptime % 3600) / 60);
  
  console.log(`📊 [STATS] Uptime: ${horas}h ${minutos}m | Mensajes: ${stats.mensajes_recibidos} | Respuestas: ${stats.respuestas_enviadas} | Nuevos usuarios: ${stats.usuarios_nuevos} | Errores: ${stats.errores}`);
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

async function limpiarThreadAntiguo(threadId) {
  try {
    const mensajes = await openai.beta.threads.messages.list(threadId);
    
    if (mensajes.data.length > 15) {
      console.log(`🧹 [Limpieza] Thread ${threadId} tiene ${mensajes.data.length} mensajes, creando uno nuevo`);
      
      const nuevoThread = await openai.beta.threads.create();
      
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

function optimizarSistema() {
  const ahora = Date.now();
  
  for (const [userId, mensajes] of pendingMessages.entries()) {
    const mensajesFiltrados = mensajes.filter(msg => ahora - msg.timestamp < 10 * 60 * 1000);
    if (mensajesFiltrados.length === 0) {
      pendingMessages.delete(userId);
    } else {
      pendingMessages.set(userId, mensajesFiltrados);
    }
  }
  
  for (const [userId, timestamp] of userFaileds.entries()) {
    if (ahora - timestamp > 30 * 60 * 1000) {
      userFaileds.delete(userId);
    }
  }
  
  console.log(`🧹 [Optimización] Sistema optimizado. Memoria liberada.`);
  mostrarStats();
}

function limpiarRunsAbandonados() {
  const ahora = Date.now();
  const MAX_RUN_TIME = 2 * 60 * 1000;

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
// 6. ✅ NUEVA: Función para enviar mensaje inicial automático
// ----------------------------------------------------

async function enviarMensajeInicial(userId, msgObj) {
  if (!MENSAJE_INICIAL.activo) {
    return false;
  }

  try {
    console.log(`👋 [MENSAJE INICIAL] Enviando bienvenida a usuario nuevo: ${userId.substring(0, 15)}`);
    
    // Generar mensaje inicial usando el asistente
    const mensajeInicial = await generarMensajeInicial(userId);
    
    if (mensajeInicial) {
      await msgObj.reply(mensajeInicial);
      console.log(`✅ [MENSAJE INICIAL] Enviado a ${userId.substring(0, 15)}: ${mensajeInicial.substring(0, 50)}...`);
      stats.respuestas_enviadas++;
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('❌ [Error] Al enviar mensaje inicial:', error.message);
    stats.errores++;
    return false;
  }
}

async function generarMensajeInicial(userId) {
  try {
    if (OPENAI_ASSISTANT_ID) {
      // Usar el Assistant para generar el mensaje inicial
      const thread = await openai.beta.threads.create();
      
      await openai.beta.threads.messages.create(thread.id, {
        role: "user",
        content: MENSAJE_INICIAL.prompt_inicial
      });

      const run = await openai.beta.threads.runs.create(thread.id, {
        assistant_id: OPENAI_ASSISTANT_ID,
        temperature: ASSISTANT_CONFIG.temperature
      });

      // Esperar respuesta
      let runStatus = await verificarEstadoRun(thread.id, run.id);
      let attempts = 0;

      while (runStatus !== "completed" && runStatus !== "failed" && runStatus !== "cancelled" && runStatus !== "error" && attempts < 20) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        runStatus = await verificarEstadoRun(thread.id, run.id);
        attempts++;
      }

      if (runStatus === "completed") {
        const messages = await openai.beta.threads.messages.list(thread.id);
        const assistantMessages = messages.data.filter(msg => msg.role === "assistant");
        
        if (assistantMessages.length > 0 && assistantMessages[0].content.length > 0) {
          const respuesta = assistantMessages[0].content[0].text.value;
          return añadirFirmaAsistente(respuesta);
        }
      }
    }
    
    // Fallback usando chat.completions
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: MENSAJE_INICIAL.prompt_inicial }
      ],
      temperature: ASSISTANT_CONFIG.temperature,
      max_tokens: ASSISTANT_CONFIG.max_tokens
    });

    const respuesta = response.choices[0]?.message?.content?.trim();
    return respuesta ? añadirFirmaAsistente(respuesta) : null;
    
  } catch (error) {
    console.error('❌ [Error] Al generar mensaje inicial:', error.message);
    return null;
  }
}

// ----------------------------------------------------
// 7. Función principal MEJORADA para responder con GPT Assistant
// ----------------------------------------------------

async function responderConGPT(userId, message, msg) {
  if (!openai) {
    return añadirFirmaAsistente('Lo siento, el servicio de asistencia no está disponible en este momento.');
  }

  try {
    console.log(`🚀 [Respuesta] Procesando mensaje de ${userId.substring(0, 10)}...`);
    
    if (OPENAI_ASSISTANT_ID) {
      let threadId = chatThreads.get(userId);
      if (!threadId) {
        const thread = await openai.beta.threads.create();
        threadId = thread.id;
        chatThreads.set(userId, threadId);
        threadLocks.set(threadId, false);
        console.log(`🆕 [Thread] Creado para ${userId.substring(0, 10)}`);
      } else {
        threadId = await limpiarThreadAntiguo(threadId);
        chatThreads.set(userId, threadId);
      }

      if (threadEstaBloqueado(threadId)) {
        console.log(`⚠️ [Bloqueado] Thread ocupado para ${userId.substring(0, 10)}`);
        const desbloqueado = await esperarDesbloqueoThread(threadId);
        if (!desbloqueado) {
          return añadirFirmaAsistente('El sistema está procesando tu consulta anterior. Por favor espera un momento.');
        }
      }
      
      bloquearThread(threadId);

      try {
        if (tieneRunActivo(userId)) {
          const runActivo = activeRuns.get(userId);
          await cancelarRunSeguro(runActivo.threadId, runActivo.runId);
          activeRuns.delete(userId);
        }

        await openai.beta.threads.messages.create(threadId, {
          role: "user",
          content: message
        });

        const runParams = {
          assistant_id: OPENAI_ASSISTANT_ID,
          temperature: ASSISTANT_CONFIG.temperature
        };
        const run = await openai.beta.threads.runs.create(threadId, runParams);
        
        activeRuns.set(userId, {
          runId: run.id,
          threadId: threadId,
          timestamp: Date.now()
        });

        console.log(`⏳ [Run] Esperando respuesta ${run.id.substring(0, 15)} (${TIMEOUT_DEFAULT}s)`);
        
        let runStatus = await verificarEstadoRun(threadId, run.id);
        let attempts = 0;

        while (runStatus !== "completed" && runStatus !== "failed" && runStatus !== "cancelled" && runStatus !== "error" && attempts < TIMEOUT_DEFAULT) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          runStatus = await verificarEstadoRun(threadId, run.id);
          attempts++;
          
          if (attempts % 10 === 0) {
            console.log(`⏳ [Progreso] ${attempts}/${TIMEOUT_DEFAULT}s - Estado: ${runStatus}`);
          }
        }

        activeRuns.delete(userId);
        desbloquearThread(threadId);

        if (runStatus !== "completed") {
          await cancelarRunSeguro(threadId, run.id);
          console.log(`❌ [Timeout] Run ${run.id.substring(0, 15)} falló en ${attempts}s`);
          stats.errores++;
          
          const failed = userFaileds.get(userId) || 0;
          if (failed < MAX_REINTENTOS) {
            console.log(`🔄 [Reintento] Intentando reintento ${failed + 1}/${MAX_REINTENTOS}`);
            return await reintentarConsulta(msg, threadId, run.id, message);
          }
          
          return añadirFirmaAsistente('Lo siento, la consulta está tomando demasiado tiempo. Por favor, intenta con una pregunta más específica.');
        }

        const messages = await openai.beta.threads.messages.list(threadId);
        const assistantMessages = messages.data.filter(msg => msg.role === "assistant");
        
        if (assistantMessages.length > 0 && assistantMessages[0].content.length > 0) {
          const respuesta = assistantMessages[0].content[0].text.value;
          console.log(`✅ [Success] Respuesta del Assistant obtenida (${respuesta.length} chars)`);
          stats.respuestas_enviadas++;
          
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
      console.log(`🔄 [Fallback] Usando chat.completions para ${userId.substring(0, 10)}`);
      const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: message }
        ],
        temperature: ASSISTANT_CONFIG.temperature,
        max_tokens: ASSISTANT_CONFIG.max_tokens
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
    
    const threadId = chatThreads.get(userId);
    if (threadId && threadEstaBloqueado(threadId)) {
      desbloquearThread(threadId);
    }
    activeRuns.delete(userId);
    
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

async function reintentarConsulta(msg, threadId, runId, message) {
  console.log(`🔄 [Reintento] Usuario: ${msg.from.substring(0, 10)}, Mensaje: "${message.substring(0, 30)}..."`);
  
  try {
    if (threadEstaBloqueado(threadId)) {
      const desbloqueado = await esperarDesbloqueoThread(threadId);
      if (!desbloqueado) {
        return añadirFirmaAsistente('El sistema está ocupado. Por favor, intenta nuevamente en unos momentos.');
      }
    }
    
    bloquearThread(threadId);
    await cancelarRunSeguro(threadId, runId);
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log(`🆕 [Reintento] Creando nuevo run optimizado en thread ${threadId}`);
    const newRun = await openai.beta.threads.runs.create(threadId, {
      assistant_id: OPENAI_ASSISTANT_ID,
      temperature: ASSISTANT_CONFIG.temperature
    });
    
    activeRuns.set(msg.from, {
      runId: newRun.id,
      threadId: threadId,
      timestamp: Date.now()
    });
    
    let runStatus = await verificarEstadoRun(threadId, newRun.id);
    let attempts = 0;
    
    while (runStatus !== "completed" && runStatus !== "failed" && runStatus !== "cancelled" && runStatus !== "error" && attempts < TIMEOUT_REINTENTO) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      runStatus = await verificarEstadoRun(threadId, newRun.id);
      attempts++;
    }
    
    activeRuns.delete(msg.from);
    desbloquearThread(threadId);
    
    if (runStatus !== "completed") {
      await cancelarRunSeguro(threadId, newRun.id);
      setTimeout(() => procesarMensajesPendientes(msg.from), 1000);
      return añadirFirmaAsistente('Lo siento, esta consulta es demasiado compleja. ¿Podrías reformularla de manera más específica?');
    }
    
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

async function procesarMensajesPendientes(userId) {
  if (pendingMessages.has(userId) && pendingMessages.get(userId).length > 0) {
    if (tieneRunActivo(userId)) {
      console.log(`⏳ [Cola] Usuario ${userId.substring(0, 10)} tiene un run activo, posponiendo procesamiento`);
      return;
    }
    
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
// 8. ✅ Función MEJORADA para procesar mensajes con detección de usuarios nuevos
// ----------------------------------------------------

async function procesarMensaje(userId, message, msgObj) {
  stats.mensajes_recibidos++;
  console.log(`📥 [${stats.mensajes_recibidos}] ${userId.substring(0, 15)}: "${message.substring(0, 30)}${message.length > 30 ? '...' : ''}"`);
  
  // ✅ NUEVO: Detectar usuario nuevo y enviar mensaje inicial
  if (esUsuarioNuevo(userId)) {
    console.log(`🆕 [USUARIO NUEVO] Detectado: ${userId.substring(0, 15)}`);
    marcarUsuarioConocido(userId);
    stats.usuarios_nuevos++;
    
    // Enviar mensaje inicial automáticamente
    const mensajeInicialEnviado = await enviarMensajeInicial(userId, msgObj);
    
    if (mensajeInicialEnviado) {
      // Esperar un poco antes de procesar el mensaje del usuario
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  // Verificar run activo con sistema de cola mejorado
  if (tieneRunActivo(userId)) {
    console.log(`⏳ [Cola] Usuario ${userId.substring(0, 10)} tiene run activo, encolando`);
    
    if (!pendingMessages.has(userId)) {
      pendingMessages.set(userId, []);
    }
    
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
  console.log(`👋 [MENSAJE INICIAL] Mensaje automático: ${MENSAJE_INICIAL.activo ? 'ACTIVADO' : 'DESACTIVADO'}`);
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

  if (esGrupoWhatsApp(userId)) {
    return;
  }

  if (msg.fromMe) {
    return;
  }

  if (incoming.toLowerCase() === '/stats' && process.env.DEBUG_MODE === 'true') {
    const uptime = Math.floor((Date.now() - stats.inicio) / 1000);
    const horas = Math.floor(uptime / 3600);
    const minutos = Math.floor((uptime % 3600) / 60);
    
    const statsMessage = `📊 *Bot Statistics*\n` +
                        `🕐 Uptime: ${horas}h ${minutos}m\n` +
                        `📥 Mensajes recibidos: ${stats.mensajes_recibidos}\n` +
                        `📤 Respuestas enviadas: ${stats.respuestas_enviadas}\n` +
                        `👋 Usuarios nuevos: ${stats.usuarios_nuevos}\n` +
                        `❌ Errores: ${stats.errores}\n` +
                        `🧠 Assistant: ${OPENAI_ASSISTANT_ID ? 'Activo' : 'Fallback'}\n` +
                        `⚡ Threads activos: ${chatThreads.size}\n` +
                        `⏳ Runs activos: ${activeRuns.size}\n` +
                        `📋 Mensajes en cola: ${Array.from(pendingMessages.values()).reduce((sum, arr) => sum + arr.length, 0)}`;
    
    await msg.reply(añadirFirmaAsistente(statsMessage));
    return;
  }

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

  if (humanModeUsers.has(userId)) {
    return;
  }

  await procesarMensaje(userId, incoming, msg);
});

// ----------------------------------------------------
// 10. Inicialización y tareas de mantenimiento
// ----------------------------------------------------

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

process.on('uncaughtException', (error) => {
  console.error('❌ [UNCAUGHT] Error no capturado:', error.message);
  stats.errores++;
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ [UNHANDLED] Promesa rechazada:', reason);
  stats.errores++;
});

setInterval(limpiarRunsAbandonados, INTERVALO_LIMPIEZA);
setInterval(optimizarSistema, 15 * 60 * 1000);  
setInterval(mostrarStats, 10 * 60 * 1000);      

client.initialize();

console.log('🚀 [INICIANDO] Bot WhatsApp con MENSAJE INICIAL del Asistente');
console.log('🤖 [ASISTENTE] Solo respuestas del Asistente de OpenAI con firma identificatoria');
console.log('👋 [BIENVENIDA] Mensaje inicial automático para usuarios nuevos');
console.log('🔧 [OPTIMIZADO] Velocidad, estabilidad y manejo de errores mejorados');
console.log(`⚙️ [CONFIG] Assistant: ${OPENAI_ASSISTANT_ID ? 'CONFIGURADO' : 'FALLBACK'}`);
console.log(`⏱️ [TIMEOUTS] Default: ${TIMEOUT_DEFAULT}s, Reintento: ${TIMEOUT_REINTENTO}s, Max reintentos: ${MAX_REINTENTOS}`);
console.log(`🎭 [FIRMA] "${FIRMA_ASISTENTE.sufijo}"`);
console.log(`👋 [INICIAL] Prompt: "${MENSAJE_INICIAL.prompt_inicial}"`);
