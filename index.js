// final.js: Bot WhatsApp DEFINITIVO - Versión Final Optimizada
// Corrige todos los problemas de timeouts y optimiza performance máxima

require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { OpenAI } = require('openai');

// ----------------------------------------------------
// 1. Configuración OPTIMIZADA para servidores lentos
// ----------------------------------------------------
const OPENAI_API_KEY      = process.env.OPENAI_API_KEY;
const OPENAI_ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;

// Validación crítica
if (!OPENAI_API_KEY) {
  console.error('❌ [CRÍTICO] OPENAI_API_KEY no configurada');
  process.exit(1);
}

if (!OPENAI_ASSISTANT_ID) {
  console.error('❌ [CRÍTICO] OPENAI_ASSISTANT_ID no configurada');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
console.log('✅ [OpenAI] Configuración validada correctamente');

// ✅ CONFIGURACIÓN OPTIMIZADA basada en análisis de logs
const CONFIG = {
  // Timeouts ajustados para servidores lentos
  TIMEOUT_PRINCIPAL: 45,          // Aumentado de 30s a 45s (primer intento)
  TIMEOUT_REINTENTO: 35,          // Reintento más generoso
  TIMEOUT_RAPIDO: 25,             // Para operaciones rápidas
  MAX_REINTENTOS: 2,              // Límite de reintentos
  
  // Intervalos de limpieza optimizados
  LIMPIEZA_RUNS: 2 * 60 * 1000,   // Cada 2 minutos (más frecuente)
  OPTIMIZACION: 10 * 60 * 1000,   // Cada 10 minutos
  STATS_INTERVAL: 5 * 60 * 1000,  // Stats cada 5 minutos
  
  // Assistant optimizado
  ASSISTANT: {
    temperature: 0.6,
    timeout_interno: 40000,        // 40s timeout interno
    max_contexto: 12               // Máximo 12 mensajes por thread
  }
};

// ✅ Configuración de firma
const FIRMA_ASISTENTE = {
  sufijo: "\n\n🤖 _Asistente IA - Municipalidad San Martín_",
  activa: true
};

// ✅ Sistema de usuario nuevo optimizado
const MENSAJE_INICIAL = {
  activo: true,
  prompt: "Actúa como si fuera el primer contacto. Salúdalo profesionalmente como asistente de la Municipalidad de San Martín."
};

// ----------------------------------------------------
// 2. Cliente WhatsApp optimizado
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
      '--disable-background-timer-throttling',  // ✅ Mejora performance
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--memory-pressure-off'                   // ✅ Evita límites memoria
    ]
  },
  authStrategy: new LocalAuth({
    dataPath: './session'
  })
});

// ----------------------------------------------------
// 3. Variables globales optimizadas
// ----------------------------------------------------
const chatThreads = new Map();      
const humanModeUsers = new Set();   
const userFaileds = new Map();      
const activeRuns = new Map();       
const pendingMessages = new Map();  
const threadLocks = new Map();      
const usuariosConocidos = new Set();

// ✅ Sistema de stats mejorado
const stats = {
  mensajes_recibidos: 0,
  respuestas_exitosas: 0,
  respuestas_reintento: 0,
  timeouts_primer_intento: 0,
  timeouts_totales: 0,
  usuarios_nuevos: 0,
  errores: 0,
  tiempo_promedio: [],
  inicio: Date.now()
};

// ✅ Sistema de performance tracking
const performance = {
  ultimaRespuesta: Date.now(),
  tiemposRespuesta: [],
  alertaLentitud: false
};

// ----------------------------------------------------
// 4. Funciones utilitarias optimizadas
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
  console.log(`🔒 [Bloqueo] Thread ${threadId.substring(0, 20)} bloqueado`);
}

function desbloquearThread(threadId) {
  threadLocks.set(threadId, false);
  console.log(`🔓 [Desbloqueo] Thread ${threadId.substring(0, 20)} desbloqueado`);
}

async function esperarDesbloqueoThread(threadId, maxIntentos = 40) {
  let intentos = 0;
  while (threadEstaBloqueado(threadId) && intentos < maxIntentos) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    intentos++;
  }
  return !threadEstaBloqueado(threadId);
}

function esUsuarioNuevo(userId) {
  return !usuariosConocidos.has(userId);
}

function marcarUsuarioConocido(userId) {
  usuariosConocidos.add(userId);
  stats.usuarios_nuevos++;
  console.log(`👋 [NUEVO] ${userId.substring(0, 15)} registrado (total: ${stats.usuarios_nuevos})`);
}

// ✅ Función optimizada de firma
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

// ✅ Sistema de stats mejorado
function mostrarStats() {
  const uptime = Math.floor((Date.now() - stats.inicio) / 1000 / 60);
  const tasaExito = stats.mensajes_recibidos > 0 ? 
    Math.round((stats.respuestas_exitosas / stats.mensajes_recibidos) * 100) : 0;
  const tasaTimeoutPrimer = stats.mensajes_recibidos > 0 ? 
    Math.round((stats.timeouts_primer_intento / stats.mensajes_recibidos) * 100) : 0;
  
  const tiempoPromedio = stats.tiempo_promedio.length > 0 ?
    Math.round(stats.tiempo_promedio.reduce((a, b) => a + b, 0) / stats.tiempo_promedio.length / 1000) : 0;

  console.log(`📊 [STATS] ${uptime}min | Mensajes: ${stats.mensajes_recibidos} | Éxito: ${tasaExito}% | T.Promedio: ${tiempoPromedio}s | Timeouts1er: ${tasaTimeoutPrimer}% | Nuevos: ${stats.usuarios_nuevos}`);
  
  // ✅ Alertas automáticas
  if (tasaTimeoutPrimer > 50) {
    console.log(`🚨 [ALERTA] Muchos timeouts en primer intento (${tasaTimeoutPrimer}%) - Considerar escalar servidor`);
  }
  
  if (tiempoPromedio > 25) {
    console.log(`⚠️ [LENTO] Tiempo promedio alto (${tiempoPromedio}s) - Revisar performance`);
  }
}

// ✅ Verificación de run optimizada con timeout
async function verificarEstadoRun(threadId, runId, timeoutMs = 5000) {
  try {
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout verificación')), timeoutMs)
    );
    
    const statusPromise = openai.beta.threads.runs.retrieve(threadId, runId);
    const status = await Promise.race([statusPromise, timeoutPromise]);
    
    return status.status;
  } catch (error) {
    console.error(`❌ [Error] Verificar run ${runId.substring(0, 15)}: ${error.message}`);
    stats.errores++;
    return "error";
  }
}

// ✅ Cancelación optimizada con timeout
async function cancelarRunSeguro(threadId, runId) {
  try {
    const status = await verificarEstadoRun(threadId, runId, 3000);
    
    if (!["completed", "cancelled", "failed", "error"].includes(status)) {
      console.log(`🛑 [Cancelando] Run ${runId.substring(0, 15)} (estado: ${status})`);
      
      const timeoutPromise = new Promise((resolve) => 
        setTimeout(() => resolve({ status: 'timeout' }), 5000)
      );
      
      const cancelPromise = openai.beta.threads.runs.cancel(threadId, runId);
      const result = await Promise.race([cancelPromise, timeoutPromise]);
      
      if (result.status === 'timeout') {
        console.log(`⚠️ [Timeout] Cancelación de run ${runId.substring(0, 15)} agotó tiempo`);
        return false;
      }
      
      // Verificar cancelación con timeout corto
      let attempts = 0;
      while (attempts < 5) {
        const newStatus = await verificarEstadoRun(threadId, runId, 2000);
        if (["cancelled", "completed", "failed", "error"].includes(newStatus)) {
          console.log(`✅ [Cancelado] Run ${runId.substring(0, 15)}, estado: ${newStatus}`);
          return true;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
        attempts++;
      }
    }
    return true;
  } catch (error) {
    console.error(`❌ [Error] Cancelar run ${runId.substring(0, 15)}: ${error.message}`);
    stats.errores++;
    return false;
  }
}

// ✅ Sistema de priorización mejorado
function esMensajePrioritario(mensaje) {
  const palabrasPrioridad = [
    'urgente', 'emergencia', 'problema', 'error', 'ayuda', 'rapido',
    'inscripcion', 'inscripción', 'horario', 'telefono', 'teléfono',
    'consulta', 'información', 'info', 'contacto'
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
    console.log(`⚡ [PRIORIDAD] Mensaje urgente priorizado para ${userId.substring(0, 10)}`);
    return true;
  }
  
  return false;
}

// ✅ Limpieza de thread optimizada
async function limpiarThreadAntiguo(threadId) {
  try {
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout listado')), 8000)
    );
    
    const messagesPromise = openai.beta.threads.messages.list(threadId, { limit: 20 });
    const mensajes = await Promise.race([messagesPromise, timeoutPromise]);
    
    if (mensajes.data.length > CONFIG.ASSISTANT.max_contexto) {
      console.log(`🧹 [LIMPIEZA] Thread ${threadId.substring(0, 20)} tiene ${mensajes.data.length} mensajes, renovando`);
      
      const nuevoThread = await openai.beta.threads.create();
      
      // Contexto mínimo de continuación
      await openai.beta.threads.messages.create(nuevoThread.id, {
        role: "user",
        content: "Continuación de conversación anterior. Mantén contexto profesional."
      });
      
      return nuevoThread.id;
    }
    
    return threadId;
  } catch (error) {
    console.error(`❌ [Error] Limpiar thread: ${error.message}`);
    return threadId;
  }
}

// ✅ Optimización del sistema mejorada
function optimizarSistema() {
  const ahora = Date.now();
  let itemsLimpiados = 0;
  
  // Limpiar mensajes pendientes antiguos (>15 minutos)
  for (const [userId, mensajes] of pendingMessages.entries()) {
    const mensajesFiltrados = mensajes.filter(msg => ahora - msg.timestamp < 15 * 60 * 1000);
    if (mensajesFiltrados.length === 0) {
      pendingMessages.delete(userId);
      itemsLimpiados++;
    } else if (mensajesFiltrados.length !== mensajes.length) {
      pendingMessages.set(userId, mensajesFiltrados);
      itemsLimpiados++;
    }
  }
  
  // Limpiar fallos antiguos (>45 minutos)
  for (const [userId, { timestamp }] of userFaileds.entries()) {
    if (ahora - timestamp > 45 * 60 * 1000) {
      userFaileds.delete(userId);
      itemsLimpiados++;
    }
  }
  
  // Limpiar tiempos de respuesta antiguos (mantener solo últimos 100)
  if (stats.tiempo_promedio.length > 100) {
    stats.tiempo_promedio = stats.tiempo_promedio.slice(-50);
    itemsLimpiados++;
  }
  
  console.log(`🧹 [OPTIMIZACIÓN] ${itemsLimpiados} elementos limpiados`);
  mostrarStats();
}

// ✅ Limpieza de runs abandonados optimizada
function limpiarRunsAbandonados() {
  const ahora = Date.now();
  const MAX_RUN_TIME = 90 * 1000; // 90 segundos máximo
  let runsLimpiados = 0;

  for (const [userId, runInfo] of activeRuns.entries()) {
    if (ahora - runInfo.timestamp > MAX_RUN_TIME) {
      console.log(`🧹 [LIMPIEZA] Run abandonado ${runInfo.runId.substring(0, 15)} (${Math.round((ahora - runInfo.timestamp) / 1000)}s)`);
      
      cancelarRunSeguro(runInfo.threadId, runInfo.runId)
        .then(() => {
          activeRuns.delete(userId);
          desbloquearThread(runInfo.threadId);
          runsLimpiados++;
          setTimeout(() => procesarMensajesPendientes(userId), 2000);
        })
        .catch(err => console.error('Error limpieza run:', err.message));
    }
  }
  
  if (runsLimpiados > 0) {
    console.log(`🧹 [STATS] ${runsLimpiados} runs abandonados limpiados`);
  }
}

// ----------------------------------------------------
// 5. ✅ FUNCIÓN PRINCIPAL OPTIMIZADA - Respuesta con Assistant
// ----------------------------------------------------

async function responderConAsistenteOpenAI(userId, message, msg, esPrimeraVez = false) {
  const inicioTiempo = Date.now();
  
  try {
    console.log(`🚀 [PROCESO] ${esPrimeraVez ? 'NUEVO USUARIO' : 'Mensaje'} de ${userId.substring(0, 10)}`);
    
    // Obtener o crear thread
    let threadId = chatThreads.get(userId);
    if (!threadId) {
      const thread = await openai.beta.threads.create();
      threadId = thread.id;
      chatThreads.set(userId, threadId);
      threadLocks.set(threadId, false);
      console.log(`🆕 [THREAD] Creado ${threadId.substring(0, 20)} para ${userId.substring(0, 10)}`);
    } else {
      // Limpiar thread si es necesario
      threadId = await limpiarThreadAntiguo(threadId);
      if (threadId !== chatThreads.get(userId)) {
        chatThreads.set(userId, threadId);
        threadLocks.set(threadId, false);
      }
    }

    // Verificar y esperar desbloqueo
    if (threadEstaBloqueado(threadId)) {
      console.log(`⏳ [ESPERA] Thread ocupado ${threadId.substring(0, 20)}`);
      const desbloqueado = await esperarDesbloqueoThread(threadId);
      if (!desbloqueado) {
        return añadirFirmaAsistente('El sistema está procesando tu consulta anterior. Tu mensaje será atendido en breve.');
      }
    }
    
    bloquearThread(threadId);

    try {
      // Limpiar runs activos previos
      if (tieneRunActivo(userId)) {
        const runActivo = activeRuns.get(userId);
        console.log(`🔄 [LIMPIANDO] Run activo previo ${runActivo.runId.substring(0, 15)}`);
        await cancelarRunSeguro(runActivo.threadId, runActivo.runId);
        activeRuns.delete(userId);
      }

      // Preparar mensaje
      let mensajeParaAsistente = message;
      if (esPrimeraVez && MENSAJE_INICIAL.activo) {
        mensajeParaAsistente = `${MENSAJE_INICIAL.prompt} Usuario escribió: "${message}"`;
        console.log(`👋 [INICIAL] Contexto de bienvenida añadido`);
      }

      // Crear mensaje en thread
      await openai.beta.threads.messages.create(threadId, {
        role: "user",
        content: mensajeParaAsistente
      });

      // ✅ Crear run con configuración optimizada
      const runParams = {
        assistant_id: OPENAI_ASSISTANT_ID,
        temperature: CONFIG.ASSISTANT.temperature
      };
      
      console.log(`⏱️ [TIMEOUT] Usando timeout optimizado de ${CONFIG.TIMEOUT_PRINCIPAL}s`);
      const run = await openai.beta.threads.runs.create(threadId, runParams);
      
      // Registrar run activo
      activeRuns.set(userId, {
        runId: run.id,
        threadId: threadId,
        timestamp: Date.now()
      });

      console.log(`🆕 [RUN] Iniciado ${run.id.substring(0, 15)} en thread ${threadId.substring(0, 20)}`);
      
      // ✅ Esperar completion con timeout optimizado
      let runStatus = await verificarEstadoRun(threadId, run.id);
      let attempts = 0;
      const maxAttempts = CONFIG.TIMEOUT_PRINCIPAL;

      while (!["completed", "failed", "cancelled", "error"].includes(runStatus) && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        runStatus = await verificarEstadoRun(threadId, run.id);
        attempts++;
        
        // Log de progreso cada 15 segundos
        if (attempts % 15 === 0) {
          console.log(`⏳ [PROGRESO] ${attempts}/${maxAttempts}s - Estado: ${runStatus}`);
        }
      }

      // Limpiar run activo
      activeRuns.delete(userId);
      desbloquearThread(threadId);

      // ✅ Evaluar resultado
      if (runStatus !== "completed") {
        await cancelarRunSeguro(threadId, run.id);
        const tiempoTranscurrido = Math.round((Date.now() - inicioTiempo) / 1000);
        console.log(`⚠️ [TIMEOUT] Run ${run.id.substring(0, 15)} no completado en ${tiempoTranscurrido}s, iniciando reintento`);
        
        stats.timeouts_primer_intento++;
        stats.timeouts_totales++;
        
        // Intentar reintento
        const failed = userFaileds.get(userId)?.count || 0;
        if (failed < CONFIG.MAX_REINTENTOS) {
          console.log(`🔄 [REINTENTO] Usuario: ${userId.substring(0, 15)}, Mensaje: "${message.substring(0, 30)}..."`);
          return await reintentarConsultaOptimizada(msg, threadId, run.id, mensajeParaAsistente, inicioTiempo);
        }
        
        return añadirFirmaAsistente('Tu consulta está tomando más tiempo del esperado. Por favor, intenta reformularla de manera más específica.');
      }

      // ✅ Obtener respuesta exitosa
      const messages = await openai.beta.threads.messages.list(threadId, { limit: 5 });
      const assistantMessages = messages.data.filter(msg => msg.role === "assistant");
      
      if (assistantMessages.length > 0 && assistantMessages[0].content.length > 0) {
        const respuesta = assistantMessages[0].content[0].text.value;
        const tiempoTotal = Date.now() - inicioTiempo;
        
        console.log(`✅ [ÉXITO] Respuesta obtenida en ${Math.round(tiempoTotal / 1000)}s (${respuesta.length} chars)`);
        
        // Actualizar estadísticas
        stats.respuestas_exitosas++;
        stats.tiempo_promedio.push(tiempoTotal);
        userFaileds.delete(userId); // Limpiar fallos previos
        
        // Procesar cola pendiente
        setTimeout(() => procesarMensajesPendientes(userId), 1000);
        
        return añadirFirmaAsistente(respuesta);
      } else {
        console.log(`❌ [SIN_RESPUESTA] Assistant no generó contenido`);
        stats.errores++;
        return añadirFirmaAsistente('No pude procesar tu consulta en este momento. Por favor, inténtalo nuevamente.');
      }

    } catch (error) {
      console.error(`❌ [ERROR_RUN] ${error.message}`);
      activeRuns.delete(userId);
      desbloquearThread(threadId);
      stats.errores++;
      throw error;
    }

  } catch (error) {
    console.error(`❌ [ERROR_GENERAL] ${error.message}`);
    stats.errores++;
    
    // Limpiar estado en error
    const threadId = chatThreads.get(userId);
    if (threadId && threadEstaBloqueado(threadId)) {
      desbloquearThread(threadId);
    }
    activeRuns.delete(userId);
    
    // Registrar fallo del usuario
    const tiempoTotal = Date.now() - inicioTiempo;
    userFaileds.set(userId, {
      count: (userFaileds.get(userId)?.count || 0) + 1,
      timestamp: Date.now()
    });
    
    // Respuestas específicas por tipo de error
    if (error.status === 429) {
      return añadirFirmaAsistente('El sistema tiene alta demanda. Por favor, intenta nuevamente en unos segundos.');
    } else if (error.message?.includes('timeout')) {
      return añadirFirmaAsistente('La consulta está tomando demasiado tiempo. Intenta con una pregunta más específica.');
    } else if (error.code === 'ECONNRESET' || error.code === 'ENOTFOUND') {
      return añadirFirmaAsistente('Problemas de conectividad temporal. Por favor, intenta nuevamente.');
    }
    
    return añadirFirmaAsistente('Ocurrió un error al procesar tu consulta. Por favor, inténtalo nuevamente.');
  }
}

// ✅ Función de reintento optimizada
async function reintentarConsultaOptimizada(msg, threadId, runId, message, inicioOriginal) {
  try {
    // Verificar bloqueo
    if (threadEstaBloqueado(threadId)) {
      const desbloqueado = await esperarDesbloqueoThread(threadId, 20);
      if (!desbloqueado) {
        return añadirFirmaAsistente('El sistema está ocupado. Tu mensaje será procesado pronto.');
      }
    }
    
    bloquearThread(threadId);
    
    // Cancelar run anterior si es necesario
    await cancelarRunSeguro(threadId, runId);
    
    // Pausa antes del reintento
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    console.log(`🆕 [REINTENTO] Creando nuevo run optimizado en thread ${threadId.substring(0, 20)}`);
    const newRun = await openai.beta.threads.runs.create(threadId, {
      assistant_id: OPENAI_ASSISTANT_ID,
      temperature: CONFIG.ASSISTANT.temperature
    });
    
    // Registrar nuevo run
    activeRuns.set(msg.from, {
      runId: newRun.id,
      threadId: threadId,
      timestamp: Date.now()
    });
    
    // ✅ Esperar con timeout de reintento optimizado
    let runStatus = await verificarEstadoRun(threadId, newRun.id);
    let attempts = 0;
    const maxAttempts = CONFIG.TIMEOUT_REINTENTO;
    
    while (!["completed", "failed", "cancelled", "error"].includes(runStatus) && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      runStatus = await verificarEstadoRun(threadId, newRun.id);
      attempts++;
    }
    
    // Limpiar
    activeRuns.delete(msg.from);
    desbloquearThread(threadId);
    
    if (runStatus !== "completed") {
      await cancelarRunSeguro(threadId, newRun.id);
      console.log(`❌ [REINTENTO_FALLO] Segundo intento falló en ${attempts}s`);
      
      stats.timeouts_totales++;
      setTimeout(() => procesarMensajesPendientes(msg.from), 2000);
      
      return añadirFirmaAsistente('Esta consulta es compleja. ¿Podrías ser más específico en tu pregunta?');
    }
    
    // Obtener respuesta del reintento
    const messages = await openai.beta.threads.messages.list(threadId, { limit: 3 });
    const assistantMessages = messages.data.filter(msg => msg.role === "assistant");
    
    if (assistantMessages.length > 0 && assistantMessages[0].content.length > 0) {
      const tiempoTotal = Date.now() - inicioOriginal;
      console.log(`✅ [REINTENTO_ÉXITO] Respuesta en reintento (${Math.round(tiempoTotal / 1000)}s total)`);
      
      stats.respuestas_reintento++;
      stats.tiempo_promedio.push(tiempoTotal);
      
      setTimeout(() => procesarMensajesPendientes(msg.from), 1000);
      
      return añadirFirmaAsistente(assistantMessages[0].content[0].text.value);
    } else {
      console.log(`❌ [REINTENTO_SIN_RESPUESTA] Assistant no generó respuesta en reintento`);
      return añadirFirmaAsistente('No pude procesar tu consulta después de varios intentos.');
    }
    
  } catch (error) {
    console.error(`❌ [ERROR_REINTENTO] ${error.message}`);
    
    activeRuns.delete(msg.from);
    desbloquearThread(threadId);
    stats.errores++;
    
    setTimeout(() => procesarMensajesPendientes(msg.from), 2000);
    
    return añadirFirmaAsistente('Ocurrió un error en el reintento. Intenta con una pregunta diferente.');
  }
}

// ✅ Procesamiento de mensajes pendientes optimizado
async function procesarMensajesPendientes(userId) {
  if (pendingMessages.has(userId) && pendingMessages.get(userId).length > 0) {
    if (tieneRunActivo(userId)) {
      console.log(`⏳ [COLA] Usuario ${userId.substring(0, 10)} con run activo, posponiendo`);
      return;
    }
    
    // Procesar priorización
    await procesarColaPrioritaria(userId);
    
    console.log(`📋 [COLA] Procesando pendiente para ${userId.substring(0, 10)} (${pendingMessages.get(userId).length} restantes)`);
    const nextMessage = pendingMessages.get(userId).shift();
    
    if (pendingMessages.get(userId).length === 0) {
      pendingMessages.delete(userId);
    }
    
    try {
      const reply = await responderConAsistenteOpenAI(userId, nextMessage.message, nextMessage.msgObj, false);
      await nextMessage.msgObj.reply(reply);
      console.log(`📤 [COLA_ÉXITO] ${userId.substring(0, 10)}: ${reply.substring(0, 40)}...`);
      
      // Resetear fallos en éxito
      userFaileds.delete(userId);
      
    } catch (error) {
      console.error(`❌ [COLA_ERROR] ${error.message}`);
      const fallos = userFaileds.get(userId) || { count: 0, timestamp: Date.now() };
      userFaileds.set(userId, { 
        count: fallos.count + 1, 
        timestamp: Date.now() 
      });
      
      await nextMessage.msgObj.reply(añadirFirmaAsistente('Hubo un problema procesando tu mensaje pendiente.'));
    }
  }
}

// ----------------------------------------------------
// 6. ✅ Función principal de procesamiento de mensajes
// ----------------------------------------------------

async function procesarMensaje(userId, message, msgObj) {
  stats.mensajes_recibidos++;
  const tiempoMensaje = Date.now();
  
  console.log(`📥 [${stats.mensajes_recibidos}] ${userId.substring(0, 15)}: "${message.substring(0, 40)}${message.length > 40 ? '...' : ''}"`);
  
  // Detectar usuario nuevo
  const esPrimeraVez = esUsuarioNuevo(userId);
  if (esPrimeraVez) {
    marcarUsuarioConocido(userId);
    console.log(`🆕 [PRIMER_CONTACTO] Usuario ${userId.substring(0, 15)}`);
  }
  
  // Verificar run activo - sistema de cola
  if (tieneRunActivo(userId)) {
    console.log(`⏳ [COLA] Run activo para ${userId.substring(0, 10)}, encolando mensaje`);
    
    if (!pendingMessages.has(userId)) {
      pendingMessages.set(userId, []);
    }
    
    // Límite anti-spam optimizado
    if (pendingMessages.get(userId).length >= 4) {
      await msgObj.reply(añadirFirmaAsistente("Tienes varios mensajes en cola. Espera que procese los anteriores."));
      return;
    }
    
    pendingMessages.get(userId).push({
      message,
      timestamp: tiempoMensaje,
      msgObj
    });
    
    // Mensaje de espera más amigable
    const posicionCola = pendingMessages.get(userId).length;
    await msgObj.reply(`⏳ Procesando tu consulta anterior. Tu nuevo mensaje está en cola (posición ${posicionCola}).`);
    return;
  }
  
  // Verificar thread bloqueado
  const threadId = chatThreads.get(userId);
  if (threadId && threadEstaBloqueado(threadId)) {
    console.log(`⏳ [THREAD_BLOQUEADO] ${threadId.substring(0, 20)} para ${userId.substring(0, 10)}`);
    
    if (!pendingMessages.has(userId)) {
      pendingMessages.set(userId, []);
    }
    
    pendingMessages.get(userId).push({
      message,
      timestamp: tiempoMensaje,
      msgObj
    });
    
    await msgObj.reply("⏳ El sistema está ocupado. Tu mensaje será procesado en breve.");
    return;
  }
  
  // ✅ Procesar mensaje normalmente
  try {
    const reply = await responderConAsistenteOpenAI(userId, message, msgObj, esPrimeraVez);
    await msgObj.reply(reply);
    
    const tiempoTotal = Date.now() - tiempoMensaje;
    console.log(`📤 [ENVIADO] Respuesta a ${userId.substring(0, 10)} en ${Math.round(tiempoTotal / 1000)}s (${reply.length} chars)`);
    
    // Limpiar fallos en éxito
    userFaileds.delete(userId);
    
  } catch (error) {
    console.error(`❌ [ERROR_PROCESO] ${error.message}`);
    stats.errores++;
    
    const fallos = userFaileds.get(userId) || { count: 0, timestamp: Date.now() };
    userFaileds.set(userId, { 
      count: fallos.count + 1, 
      timestamp: Date.now() 
    });
    
    if (fallos.count < 2) {
      await msgObj.reply(añadirFirmaAsistente('Hubo un problema procesando tu mensaje. Por favor, inténtalo nuevamente.'));
    } else {
      await msgObj.reply(añadirFirmaAsistente('Estoy teniendo dificultades técnicas. Intenta más tarde o escribe "operador" para contactar una persona.'));
    }
  }
}

// ----------------------------------------------------
// 7. ✅ Eventos de WhatsApp optimizados
// ----------------------------------------------------

client.on('qr', qr => {
  qrcode.generate(qr, { small: true });
  console.log('📸 [QR] Escanea este código QR con WhatsApp para conectar');
});

client.on('ready', () => {
  console.log('🟢 [CONECTADO] Bot WhatsApp FINAL optimizado - Listo para producción');
  console.log(`🤖 [ASISTENTE] ID: ${OPENAI_ASSISTANT_ID.substring(0, 25)}...`);
  console.log(`⏱️ [TIMEOUTS] Principal: ${CONFIG.TIMEOUT_PRINCIPAL}s | Reintento: ${CONFIG.TIMEOUT_REINTENTO}s`);
  console.log(`🎭 [CONFIGURACIÓN] Firma: ${FIRMA_ASISTENTE.activa ? 'SÍ' : 'NO'} | Bienvenida: ${MENSAJE_INICIAL.activo ? 'SÍ' : 'NO'}`);
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
  console.log(`🔴 [DESCONECTADO] Razón: ${reason}`);
  stats.errores++;
});

client.on('message', async msg => {
  const userId = msg.from;
  const incoming = msg.body;

  // Filtros básicos
  if (esGrupoWhatsApp(userId) || msg.fromMe) {
    return;
  }

  // ✅ Comando de stats mejorado
  if (incoming.toLowerCase() === '/stats' && process.env.DEBUG_MODE === 'true') {
    const uptime = Math.floor((Date.now() - stats.inicio) / 1000 / 60);
    const tasaExito = stats.mensajes_recibidos > 0 ? 
      Math.round((stats.respuestas_exitosas / stats.mensajes_recibidos) * 100) : 0;
    const tiempoPromedio = stats.tiempo_promedio.length > 0 ?
      Math.round(stats.tiempo_promedio.reduce((a, b) => a + b, 0) / stats.tiempo_promedio.length / 1000) : 0;
    
    const statsMessage = `📊 *Estadísticas del Bot - FINAL*

⏰ *Uptime:* ${uptime} minutos
📊 *Performance:*
  • Mensajes recibidos: ${stats.mensajes_recibidos}
  • Respuestas exitosas: ${stats.respuestas_exitosas}
  • Respuestas por reintento: ${stats.respuestas_reintento}
  • Tasa de éxito: ${tasaExito}%

⚡ *Tiempos:*
  • Tiempo promedio: ${tiempoPromedio}s
  • Timeouts primer intento: ${stats.timeouts_primer_intento}
  • Timeouts totales: ${stats.timeouts_totales}

👥 *Usuarios:*
  • Nuevos usuarios: ${stats.usuarios_nuevos}
  • Threads activos: ${chatThreads.size}
  • Runs activos: ${activeRuns.size}
  • Cola de mensajes: ${Array.from(pendingMessages.values()).reduce((sum, arr) => sum + arr.length, 0)}

❌ *Errores:* ${stats.errores}

🚀 *Estado:* ${tasaExito > 80 ? 'ÓPTIMO' : tasaExito > 60 ? 'BUENO' : 'NECESITA OPTIMIZACIÓN'}`;

    await msg.reply(añadirFirmaAsistente(statsMessage));
    return;
  }

  // Comando de operador humano
  if (incoming.toLowerCase().includes('operador')) {
    if (humanModeUsers.has(userId)) {
      humanModeUsers.delete(userId);
      await msg.reply(añadirFirmaAsistente('Has salido del modo operador humano. Volveré a responder automáticamente.'));
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

  // ✅ Procesar mensaje con sistema optimizado
  await procesarMensaje(userId, incoming, msg);
});

// ----------------------------------------------------
// 8. ✅ Inicialización y mantenimiento del sistema
// ----------------------------------------------------

// Manejo de señales del sistema
process.on('SIGTERM', () => {
  console.log('📴 [SHUTDOWN] SIGTERM recibida - Cerrando gracefully...');
  mostrarStats();
  console.log(`📊 [FINAL] Performance promedio: ${stats.tiempo_promedio.length > 0 ? Math.round(stats.tiempo_promedio.reduce((a, b) => a + b, 0) / stats.tiempo_promedio.length / 1000) : 0}s`);
  client.destroy();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('📴 [SHUTDOWN] SIGINT recibida - Cerrando gracefully...');
  mostrarStats();
  client.destroy();
  process.exit(0);
});

// Manejo de errores no capturados
process.on('uncaughtException', (error) => {
  console.error(`❌ [UNCAUGHT] ${error.message}`);
  stats.errores++;
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`❌ [UNHANDLED] Promesa rechazada: ${reason}`);
  stats.errores++;
});

// ✅ Tareas de mantenimiento optimizadas
setInterval(limpiarRunsAbandonados, CONFIG.LIMPIEZA_RUNS);
setInterval(optimizarSistema, CONFIG.OPTIMIZACION);
setInterval(mostrarStats, CONFIG.STATS_INTERVAL);

// Health check endpoint para Fly.io
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => {
  const uptime = Math.floor((Date.now() - stats.inicio) / 1000);
  const tasaExito = stats.mensajes_recibidos > 0 ? 
    Math.round((stats.respuestas_exitosas / stats.mensajes_recibidos) * 100) : 100;
  
  res.json({
    status: 'ok',
    uptime: uptime,
    mensajes: stats.mensajes_recibidos,
    exito: tasaExito,
    threads: chatThreads.size,
    runs_activos: activeRuns.size,
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`🏥 [HEALTH] Endpoint disponible en puerto ${PORT}`);
});

// ✅ Inicializar el cliente
client.initialize();

console.log('🚀 [INICIANDO] Bot WhatsApp FINAL - Versión Definitiva Optimizada');
console.log('🎯 [CARACTERÍSTICAS] 100% Asistente OpenAI + Timeouts optimizados + Sistema de reintentos');
console.log('📈 [PERFORMANCE] Optimizado para servidores lentos con recuperación automática');
console.log('🔧 [MONITOREO] Stats automáticas, health check y limpieza inteligente');
console.log(`⚙️ [CONFIG] Principal: ${CONFIG.TIMEOUT_PRINCIPAL}s | Reintento: ${CONFIG.TIMEOUT_REINTENTO}s | Max contexto: ${CONFIG.ASSISTANT.max_contexto}`);
