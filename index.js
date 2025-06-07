// final_corregido.js: Bot WhatsApp con corrección de Estados
// Soluciona el problema de mensajes vacíos de status@broadcast

require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { OpenAI } = require('openai');
const http = require('http'); // HTTP nativo

// Configuración
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
  sufijo: \"\\n\\n🤖 _Asistente IA - Municipalidad San Martín_\",
  activa: true
};

const MENSAJE_INICIAL = {
  activo: true,
  prompt: \"Actúa como si fuera el primer contacto. Salúdalo profesionalmente como asistente de la Municipalidad de San Martín.\"
};

// Cliente WhatsApp
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

// Variables globales
const chatThreads = new Map();      
const humanModeUsers = new Set();   
const userFaileds = new Map();      
const activeRuns = new Map();       
const pendingMessages = new Map();  
const threadLocks = new Map();      
const usuariosConocidos = new Set();

// Stats mejoradas
const stats = {
  mensajes_recibidos: 0,
  mensajes_filtrados: 0,        // ✅ NUEVO: Contador de filtrados
  respuestas_exitosas: 0,
  respuestas_reintento: 0,
  timeouts_primer_intento: 0,
  timeouts_totales: 0,
  usuarios_nuevos: 0,
  errores: 0,
  tiempo_promedio: [],
  inicio: Date.now()
};

// Funciones utilitarias
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

function añadirFirmaAsistente(respuesta) {
  if (!FIRMA_ASISTENTE.activa || !respuesta) {
    return respuesta;
  }

  let respuestaLimpia = respuesta
    .replace(/\\n\\n🤖.*$/gm, '')
    .replace(/\\n\\n_Asistente.*$/gm, '')
    .replace(/\\n\\n--.*Municipalidad.*$/gm, '')
    .trim();

  if (!respuestaLimpia.includes('🤖') && !respuestaLimpia.includes('Asistente IA')) {
    return respuestaLimpia + FIRMA_ASISTENTE.sufijo;
  }

  return respuestaLimpia;
}

// ✅ NUEVO: Función para validar mensajes
function esMensajeValido(mensaje, userId) {
  // Filtrar estados de WhatsApp
  if (userId.includes('status@broadcast')) {
    stats.mensajes_filtrados++;
    console.log(`📵 [FILTRADO] Estado de WhatsApp: ${userId.substring(0, 25)}`);
    return false;
  }

  // Filtrar mensajes vacíos o solo espacios
  if (!mensaje || mensaje.trim() === '') {
    stats.mensajes_filtrados++;
    console.log(`📵 [FILTRADO] Mensaje vacío de ${userId.substring(0, 15)}`);
    return false;
  }

  // Filtrar mensajes muy cortos sin contenido útil
  if (mensaje.trim().length < 2 && !/[a-zA-Z0-9áéíóúñü]/.test(mensaje)) {
    stats.mensajes_filtrados++;
    console.log(`📵 [FILTRADO] Mensaje de un carácter: \"${mensaje}\" de ${userId.substring(0, 15)}`);
    return false;
  }

  // Filtrar mensajes de sistema
  const mensajesSistema = [
    'message deleted', 'mensaje eliminado', 'this message was deleted',
    'missed voice call', 'missed video call', 'llamada perdida',
    'security code changed', 'código de seguridad cambió'
  ];
  
  const mensajeLower = mensaje.toLowerCase();
  if (mensajesSistema.some(sistema => mensajeLower.includes(sistema))) {
    stats.mensajes_filtrados++;
    console.log(`📵 [FILTRADO] Mensaje de sistema: \"${mensaje.substring(0, 30)}...\"`);\n    return false;\n  }\n\n  return true;\n}\n\n// ✅ Stats mejoradas con filtros\nfunction mostrarStats() {\n  const uptime = Math.floor((Date.now() - stats.inicio) / 1000 / 60);\n  const tasaExito = stats.mensajes_recibidos > 0 ? \n    Math.round((stats.respuestas_exitosas / stats.mensajes_recibidos) * 100) : 0;\n  const tasaTimeoutPrimer = stats.mensajes_recibidos > 0 ? \n    Math.round((stats.timeouts_primer_intento / stats.mensajes_recibidos) * 100) : 0;\n  \n  const tiempoPromedio = stats.tiempo_promedio.length > 0 ?\n    Math.round(stats.tiempo_promedio.reduce((a, b) => a + b, 0) / stats.tiempo_promedio.length / 1000) : 0;\n\n  console.log(`📊 [STATS] ${uptime}min | Mensajes: ${stats.mensajes_recibidos} | Filtrados: ${stats.mensajes_filtrados} | Éxito: ${tasaExito}% | T.Promedio: ${tiempoPromedio}s | Timeouts1er: ${tasaTimeoutPrimer}% | Nuevos: ${stats.usuarios_nuevos}`);\n  \n  // Alertas automáticas\n  if (tasaTimeoutPrimer > 50) {\n    console.log(`🚨 [ALERTA] Muchos timeouts en primer intento (${tasaTimeoutPrimer}%) - Considerar escalar servidor`);\n  }\n  \n  if (tiempoPromedio > 25) {\n    console.log(`⚠️ [LENTO] Tiempo promedio alto (${tiempoPromedio}s) - Revisar performance`);\n  }\n\n  // ✅ NUEVO: Alerta de muchos filtros\n  if (stats.mensajes_filtrados > stats.mensajes_recibidos * 0.3) {\n    console.log(`📵 [INFO] Muchos mensajes filtrados (${stats.mensajes_filtrados}) - Estados de WhatsApp o spam`);\n  }\n}\n\n// Verificación de run optimizada\nasync function verificarEstadoRun(threadId, runId, timeoutMs = 5000) {\n  try {\n    const timeoutPromise = new Promise((_, reject) => \n      setTimeout(() => reject(new Error('Timeout verificación')), timeoutMs)\n    );\n    \n    const statusPromise = openai.beta.threads.runs.retrieve(threadId, runId);\n    const status = await Promise.race([statusPromise, timeoutPromise]);\n    \n    return status.status;\n  } catch (error) {\n    console.error(`❌ [Error] Verificar run ${runId.substring(0, 15)}: ${error.message}`);\n    stats.errores++;\n    return \"error\";\n  }\n}\n\n// Cancelación optimizada\nasync function cancelarRunSeguro(threadId, runId) {\n  try {\n    const status = await verificarEstadoRun(threadId, runId, 3000);\n    \n    if (![\"completed\", \"cancelled\", \"failed\", \"error\"].includes(status)) {\n      console.log(`🛑 [Cancelando] Run ${runId.substring(0, 15)} (estado: ${status})`);\n      \n      const timeoutPromise = new Promise((resolve) => \n        setTimeout(() => resolve({ status: 'timeout' }), 5000)\n      );\n      \n      const cancelPromise = openai.beta.threads.runs.cancel(threadId, runId);\n      const result = await Promise.race([cancelPromise, timeoutPromise]);\n      \n      if (result.status === 'timeout') {\n        console.log(`⚠️ [Timeout] Cancelación de run ${runId.substring(0, 15)} agotó tiempo`);\n        return false;\n      }\n      \n      // Verificar cancelación\n      let attempts = 0;\n      while (attempts < 5) {\n        const newStatus = await verificarEstadoRun(threadId, runId, 2000);\n        if ([\"cancelled\", \"completed\", \"failed\", \"error\"].includes(newStatus)) {\n          console.log(`✅ [Cancelado] Run ${runId.substring(0, 15)}, estado: ${newStatus}`);\n          return true;\n        }\n        await new Promise(resolve => setTimeout(resolve, 500));\n        attempts++;\n      }\n    }\n    return true;\n  } catch (error) {\n    console.error(`❌ [Error] Cancelar run ${runId.substring(0, 15)}: ${error.message}`);\n    stats.errores++;\n    return false;\n  }\n}\n\n// Sistema de priorización\nfunction esMensajePrioritario(mensaje) {\n  const palabrasPrioridad = [\n    'urgente', 'emergencia', 'problema', 'error', 'ayuda', 'rapido',\n    'inscripcion', 'inscripción', 'horario', 'telefono', 'teléfono',\n    'consulta', 'información', 'info', 'contacto'\n  ];\n  \n  const mensajeLower = mensaje.toLowerCase();\n  return palabrasPrioridad.some(palabra => mensajeLower.includes(palabra));\n}\n\nasync function procesarColaPrioritaria(userId) {\n  if (!pendingMessages.has(userId)) return false;\n  \n  const mensajes = pendingMessages.get(userId);\n  const indicePrioritario = mensajes.findIndex(msg => esMensajePrioritario(msg.message));\n  \n  if (indicePrioritario !== -1) {\n    const [mensajePrioritario] = mensajes.splice(indicePrioritario, 1);\n    mensajes.unshift(mensajePrioritario);\n    console.log(`⚡ [PRIORIDAD] Mensaje urgente priorizado para ${userId.substring(0, 10)}`);\n    return true;\n  }\n  \n  return false;\n}\n\n// Limpieza de thread optimizada\nasync function limpiarThreadAntiguo(threadId) {\n  try {\n    const timeoutPromise = new Promise((_, reject) => \n      setTimeout(() => reject(new Error('Timeout listado')), 8000)\n    );\n    \n    const messagesPromise = openai.beta.threads.messages.list(threadId, { limit: 20 });\n    const mensajes = await Promise.race([messagesPromise, timeoutPromise]);\n    \n    if (mensajes.data.length > CONFIG.ASSISTANT.max_contexto) {\n      console.log(`🧹 [LIMPIEZA] Thread ${threadId.substring(0, 20)} tiene ${mensajes.data.length} mensajes, renovando`);\n      \n      const nuevoThread = await openai.beta.threads.create();\n      \n      await openai.beta.threads.messages.create(nuevoThread.id, {\n        role: \"user\",\n        content: \"Continuación de conversación anterior. Mantén contexto profesional.\"\n      });\n      \n      return nuevoThread.id;\n    }\n    \n    return threadId;\n  } catch (error) {\n    console.error(`❌ [Error] Limpiar thread: ${error.message}`);\n    return threadId;\n  }\n}\n\n// Optimización del sistema\nfunction optimizarSistema() {\n  const ahora = Date.now();\n  let itemsLimpiados = 0;\n  \n  // Limpiar mensajes pendientes antiguos\n  for (const [userId, mensajes] of pendingMessages.entries()) {\n    const mensajesFiltrados = mensajes.filter(msg => ahora - msg.timestamp < 15 * 60 * 1000);\n    if (mensajesFiltrados.length === 0) {\n      pendingMessages.delete(userId);\n      itemsLimpiados++;\n    } else if (mensajesFiltrados.length !== mensajes.length) {\n      pendingMessages.set(userId, mensajesFiltrados);\n      itemsLimpiados++;\n    }\n  }\n  \n  // Limpiar fallos antiguos\n  for (const [userId, { timestamp }] of userFaileds.entries()) {\n    if (ahora - timestamp > 45 * 60 * 1000) {\n      userFaileds.delete(userId);\n      itemsLimpiados++;\n    }\n  }\n  \n  // Limpiar tiempos de respuesta antiguos\n  if (stats.tiempo_promedio.length > 100) {\n    stats.tiempo_promedio = stats.tiempo_promedio.slice(-50);\n    itemsLimpiados++;\n  }\n  \n  console.log(`🧹 [OPTIMIZACIÓN] ${itemsLimpiados} elementos limpiados`);\n  mostrarStats();\n}\n\n// Limpieza de runs abandonados\nfunction limpiarRunsAbandonados() {\n  const ahora = Date.now();\n  const MAX_RUN_TIME = 90 * 1000;\n  let runsLimpiados = 0;\n\n  for (const [userId, runInfo] of activeRuns.entries()) {\n    if (ahora - runInfo.timestamp > MAX_RUN_TIME) {\n      console.log(`🧹 [LIMPIEZA] Run abandonado ${runInfo.runId.substring(0, 15)} (${Math.round((ahora - runInfo.timestamp) / 1000)}s)`);\n      \n      cancelarRunSeguro(runInfo.threadId, runInfo.runId)\n        .then(() => {\n          activeRuns.delete(userId);\n          desbloquearThread(runInfo.threadId);\n          runsLimpiados++;\n          setTimeout(() => procesarMensajesPendientes(userId), 2000);\n        })\n        .catch(err => console.error('Error limpieza run:', err.message));\n    }\n  }\n  \n  if (runsLimpiados > 0) {\n    console.log(`🧹 [STATS] ${runsLimpiados} runs abandonados limpiados`);\n  }\n}\n\n// FUNCIÓN PRINCIPAL - Respuesta con Assistant\nasync function responderConAsistenteOpenAI(userId, message, msg, esPrimeraVez = false) {\n  const inicioTiempo = Date.now();\n  \n  try {\n    console.log(`🚀 [PROCESO] ${esPrimeraVez ? 'NUEVO USUARIO' : 'Mensaje'} de ${userId.substring(0, 10)}`);\n    \n    // Obtener o crear thread\n    let threadId = chatThreads.get(userId);\n    if (!threadId) {\n      const thread = await openai.beta.threads.create();\n      threadId = thread.id;\n      chatThreads.set(userId, threadId);\n      threadLocks.set(threadId, false);\n      console.log(`🆕 [THREAD] Creado ${threadId.substring(0, 20)} para ${userId.substring(0, 10)}`);\n    } else {\n      threadId = await limpiarThreadAntiguo(threadId);\n      if (threadId !== chatThreads.get(userId)) {\n        chatThreads.set(userId, threadId);\n        threadLocks.set(threadId, false);\n      }\n    }\n\n    // Verificar y esperar desbloqueo\n    if (threadEstaBloqueado(threadId)) {\n      console.log(`⏳ [ESPERA] Thread ocupado ${threadId.substring(0, 20)}`);\n      const desbloqueado = await esperarDesbloqueoThread(threadId);\n      if (!desbloqueado) {\n        return añadirFirmaAsistente('El sistema está procesando tu consulta anterior. Tu mensaje será atendido en breve.');\n      }\n    }\n    \n    bloquearThread(threadId);\n\n    try {\n      // Limpiar runs activos previos\n      if (tieneRunActivo(userId)) {\n        const runActivo = activeRuns.get(userId);\n        console.log(`🔄 [LIMPIANDO] Run activo previo ${runActivo.runId.substring(0, 15)}`);\n        await cancelarRunSeguro(runActivo.threadId, runActivo.runId);\n        activeRuns.delete(userId);\n      }\n\n      // Preparar mensaje\n      let mensajeParaAsistente = message;\n      if (esPrimeraVez && MENSAJE_INICIAL.activo) {\n        mensajeParaAsistente = `${MENSAJE_INICIAL.prompt} Usuario escribió: \"${message}\"`;\n        console.log(`👋 [INICIAL] Contexto de bienvenida añadido`);\n      }\n\n      // ✅ VALIDACIÓN ADICIONAL: Verificar mensaje no vacío antes de enviarlo\n      if (!mensajeParaAsistente || mensajeParaAsistente.trim() === '') {\n        console.log(`❌ [VALIDACIÓN] Mensaje vacío detectado, usando mensaje por defecto`);\n        mensajeParaAsistente = \"Hola, ¿cómo puedo ayudarte?\";\n      }\n\n      // Crear mensaje en thread\n      await openai.beta.threads.messages.create(threadId, {\n        role: \"user\",\n        content: mensajeParaAsistente\n      });\n\n      // Crear run con configuración optimizada\n      const runParams = {\n        assistant_id: OPENAI_ASSISTANT_ID,\n        temperature: CONFIG.ASSISTANT.temperature\n      };\n      \n      console.log(`⏱️ [TIMEOUT] Usando timeout optimizado de ${CONFIG.TIMEOUT_PRINCIPAL}s`);\n      const run = await openai.beta.threads.runs.create(threadId, runParams);\n      \n      // Registrar run activo\n      activeRuns.set(userId, {\n        runId: run.id,\n        threadId: threadId,\n        timestamp: Date.now()\n      });\n\n      console.log(`🆕 [RUN] Iniciado ${run.id.substring(0, 15)} en thread ${threadId.substring(0, 20)}`);\n      \n      // Esperar completion con timeout optimizado\n      let runStatus = await verificarEstadoRun(threadId, run.id);\n      let attempts = 0;\n      const maxAttempts = CONFIG.TIMEOUT_PRINCIPAL;\n\n      while (![\"completed\", \"failed\", \"cancelled\", \"error\"].includes(runStatus) && attempts < maxAttempts) {\n        await new Promise(resolve => setTimeout(resolve, 1000));\n        runStatus = await verificarEstadoRun(threadId, run.id);\n        attempts++;\n        \n        // Log de progreso cada 15 segundos\n        if (attempts % 15 === 0) {\n          console.log(`⏳ [PROGRESO] ${attempts}/${maxAttempts}s - Estado: ${runStatus}`);\n        }\n      }\n\n      // Limpiar run activo\n      activeRuns.delete(userId);\n      desbloquearThread(threadId);\n\n      // Evaluar resultado\n      if (runStatus !== \"completed\") {\n        await cancelarRunSeguro(threadId, run.id);\n        const tiempoTranscurrido = Math.round((Date.now() - inicioTiempo) / 1000);\n        console.log(`⚠️ [TIMEOUT] Run ${run.id.substring(0, 15)} no completado en ${tiempoTranscurrido}s, iniciando reintento`);\n        \n        stats.timeouts_primer_intento++;\n        stats.timeouts_totales++;\n        \n        // Intentar reintento\n        const failed = userFaileds.get(userId)?.count || 0;\n        if (failed < CONFIG.MAX_REINTENTOS) {\n          console.log(`🔄 [REINTENTO] Usuario: ${userId.substring(0, 15)}, Mensaje: \"${message.substring(0, 30)}...\"`);\n          return await reintentarConsultaOptimizada(msg, threadId, run.id, mensajeParaAsistente, inicioTiempo);\n        }\n        \n        return añadirFirmaAsistente('Tu consulta está tomando más tiempo del esperado. Por favor, intenta reformularla de manera más específica.');\n      }\n\n      // Obtener respuesta exitosa\n      const messages = await openai.beta.threads.messages.list(threadId, { limit: 5 });\n      const assistantMessages = messages.data.filter(msg => msg.role === \"assistant\");\n      \n      if (assistantMessages.length > 0 && assistantMessages[0].content.length > 0) {\n        const respuesta = assistantMessages[0].content[0].text.value;\n        const tiempoTotal = Date.now() - inicioTiempo;\n        \n        console.log(`✅ [ÉXITO] Respuesta obtenida en ${Math.round(tiempoTotal / 1000)}s (${respuesta.length} chars)`);\n        \n        // Actualizar estadísticas\n        stats.respuestas_exitosas++;\n        stats.tiempo_promedio.push(tiempoTotal);\n        userFaileds.delete(userId);\n        \n        // Procesar cola pendiente\n        setTimeout(() => procesarMensajesPendientes(userId), 1000);\n        \n        return añadirFirmaAsistente(respuesta);\n      } else {\n        console.log(`❌ [SIN_RESPUESTA] Assistant no generó contenido`);\n        stats.errores++;\n        return añadirFirmaAsistente('No pude procesar tu consulta en este momento. Por favor, inténtalo nuevamente.');\n      }\n\n    } catch (error) {\n      console.error(`❌ [ERROR_RUN] ${error.message}`);\n      activeRuns.delete(userId);\n      desbloquearThread(threadId);\n      stats.errores++;\n      throw error;\n    }\n\n  } catch (error) {\n    console.error(`❌ [ERROR_GENERAL] ${error.message}`);\n    stats.errores++;\n    \n    // Limpiar estado en error\n    const threadId = chatThreads.get(userId);\n    if (threadId && threadEstaBloqueado(threadId)) {\n      desbloquearThread(threadId);\n    }\n    activeRuns.delete(userId);\n    \n    // Registrar fallo del usuario\n    userFaileds.set(userId, {\n      count: (userFaileds.get(userId)?.count || 0) + 1,\n      timestamp: Date.now()\n    });\n    \n    // Respuestas específicas por tipo de error\n    if (error.status === 429) {\n      return añadirFirmaAsistente('El sistema tiene alta demanda. Por favor, intenta nuevamente en unos segundos.');\n    } else if (error.message?.includes('timeout')) {\n      return añadirFirmaAsistente('La consulta está tomando demasiado tiempo. Intenta con una pregunta más específica.');\n    } else if (error.code === 'ECONNRESET' || error.code === 'ENOTFOUND') {\n      return añadirFirmaAsistente('Problemas de conectividad temporal. Por favor, intenta nuevamente.');\n    }\n    \n    return añadirFirmaAsistente('Ocurrió un error al procesar tu consulta. Por favor, inténtalo nuevamente.');\n  }\n}\n\n// Función de reintento optimizada\nasync function reintentarConsultaOptimizada(msg, threadId, runId, message, inicioOriginal) {\n  try {\n    if (threadEstaBloqueado(threadId)) {\n      const desbloqueado = await esperarDesbloqueoThread(threadId, 20);\n      if (!desbloqueado) {\n        return añadirFirmaAsistente('El sistema está ocupado. Tu mensaje será procesado pronto.');\n      }\n    }\n    \n    bloquearThread(threadId);\n    await cancelarRunSeguro(threadId, runId);\n    await new Promise(resolve => setTimeout(resolve, 1500));\n    \n    console.log(`🆕 [REINTENTO] Creando nuevo run optimizado en thread ${threadId.substring(0, 20)}`);\n    const newRun = await openai.beta.threads.runs.create(threadId, {\n      assistant_id: OPENAI_ASSISTANT_ID,\n      temperature: CONFIG.ASSISTANT.temperature\n    });\n    \n    activeRuns.set(msg.from, {\n      runId: newRun.id,\n      threadId: threadId,\n      timestamp: Date.now()\n    });\n    \n    let runStatus = await verificarEstadoRun(threadId, newRun.id);\n    let attempts = 0;\n    const maxAttempts = CONFIG.TIMEOUT_REINTENTO;\n    \n    while (![\"completed\", \"failed\", \"cancelled\", \"error\"].includes(runStatus) && attempts < maxAttempts) {\n      await new Promise(resolve => setTimeout(resolve, 1000));\n      runStatus = await verificarEstadoRun(threadId, newRun.id);\n      attempts++;\n    }\n    \n    activeRuns.delete(msg.from);\n    desbloquearThread(threadId);\n    \n    if (runStatus !== \"completed\") {\n      await cancelarRunSeguro(threadId, newRun.id);\n      console.log(`❌ [REINTENTO_FALLO] Segundo intento falló en ${attempts}s`);\n      \n      stats.timeouts_totales++;\n      setTimeout(() => procesarMensajesPendientes(msg.from), 2000);\n      \n      return añadirFirmaAsistente('Esta consulta es compleja. ¿Podrías ser más específico en tu pregunta?');\n    }\n    \n    const messages = await openai.beta.threads.messages.list(threadId, { limit: 3 });\n    const assistantMessages = messages.data.filter(msg => msg.role === \"assistant\");\n    \n    if (assistantMessages.length > 0 && assistantMessages[0].content.length > 0) {\n      const tiempoTotal = Date.now() - inicioOriginal;\n      console.log(`✅ [REINTENTO_ÉXITO] Respuesta en reintento (${Math.round(tiempoTotal / 1000)}s total)`);\n      \n      stats.respuestas_reintento++;\n      stats.tiempo_promedio.push(tiempoTotal);\n      \n      setTimeout(() => procesarMensajesPendientes(msg.from), 1000);\n      \n      return añadirFirmaAsistente(assistantMessages[0].content[0].text.value);\n    } else {\n      console.log(`❌ [REINTENTO_SIN_RESPUESTA] Assistant no generó respuesta en reintento`);\n      return añadirFirmaAsistente('No pude procesar tu consulta después de varios intentos.');\n    }\n    \n  } catch (error) {\n    console.error(`❌ [ERROR_REINTENTO] ${error.message}`);\n    \n    activeRuns.delete(msg.from);\n    desbloquearThread(threadId);\n    stats.errores++;\n    \n    setTimeout(() => procesarMensajesPendientes(msg.from), 2000);\n    \n    return añadirFirmaAsistente('Ocurrió un error en el reintento. Intenta con una pregunta diferente.');\n  }\n}\n\n// Procesamiento de mensajes pendientes\nasync function procesarMensajesPendientes(userId) {\n  if (pendingMessages.has(userId) && pendingMessages.get(userId).length > 0) {\n    if (tieneRunActivo(userId)) {\n      console.log(`⏳ [COLA] Usuario ${userId.substring(0, 10)} con run activo, posponiendo`);\n      return;\n    }\n    \n    await procesarColaPrioritaria(userId);\n    \n    console.log(`📋 [COLA] Procesando pendiente para ${userId.substring(0, 10)} (${pendingMessages.get(userId).length} restantes)`);\n    const nextMessage = pendingMessages.get(userId).shift();\n    \n    if (pendingMessages.get(userId).length === 0) {\n      pendingMessages.delete(userId);\n    }\n    \n    try {\n      const reply = await responderConAsistenteOpenAI(userId, nextMessage.message, nextMessage.msgObj, false);\n      await nextMessage.msgObj.reply(reply);\n      console.log(`📤 [COLA_ÉXITO] ${userId.substring(0, 10)}: ${reply.substring(0, 40)}...`);\n      \n      userFaileds.delete(userId);\n      \n    } catch (error) {\n      console.error(`❌ [COLA_ERROR] ${error.message}`);\n      const fallos = userFaileds.get(userId) || { count: 0, timestamp: Date.now() };\n      userFaileds.set(userId, { \n        count: fallos.count + 1, \n        timestamp: Date.now() \n      });\n      \n      await nextMessage.msgObj.reply(añadirFirmaAsistente('Hubo un problema procesando tu mensaje pendiente.'));\n    }\n  }\n}\n\n// Función principal de procesamiento de mensajes\nasync function procesarMensaje(userId, message, msgObj) {\n  stats.mensajes_recibidos++;\n  const tiempoMensaje = Date.now();\n  \n  console.log(`📥 [${stats.mensajes_recibidos}] ${userId.substring(0, 15)}: \"${message.substring(0, 40)}${message.length > 40 ? '...' : ''}\"`);\n  \n  // Detectar usuario nuevo\n  const esPrimeraVez = esUsuarioNuevo(userId);\n  if (esPrimeraVez) {\n    marcarUsuarioConocido(userId);\n    console.log(`🆕 [PRIMER_CONTACTO] Usuario ${userId.substring(0, 15)}`);\n  }\n  \n  // Sistema de cola\n  if (tieneRunActivo(userId)) {\n    console.log(`⏳ [COLA] Run activo para ${userId.substring(0, 10)}, encolando mensaje`);\n    \n    if (!pendingMessages.has(userId)) {\n      pendingMessages.set(userId, []);\n    }\n    \n    if (pendingMessages.get(userId).length >= 4) {\n      await msgObj.reply(añadirFirmaAsistente(\"Tienes varios mensajes en cola. Espera que procese los anteriores.\"));\n      return;\n    }\n    \n    pendingMessages.get(userId).push({\n      message,\n      timestamp: tiempoMensaje,\n      msgObj\n    });\n    \n    const posicionCola = pendingMessages.get(userId).length;\n    await msgObj.reply(`⏳ Procesando tu consulta anterior. Tu nuevo mensaje está en cola (posición ${posicionCola}).`);\n    return;\n  }\n  \n  // Verificar thread bloqueado\n  const threadId = chatThreads.get(userId);\n  if (threadId && threadEstaBloqueado(threadId)) {\n    console.log(`⏳ [THREAD_BLOQUEADO] ${threadId.substring(0, 20)} para ${userId.substring(0, 10)}`);\n    \n    if (!pendingMessages.has(userId)) {\n      pendingMessages.set(userId, []);\n    }\n    \n    pendingMessages.get(userId).push({\n      message,\n      timestamp: tiempoMensaje,\n      msgObj\n    });\n    \n    await msgObj.reply(\"⏳ El sistema está ocupado. Tu mensaje será procesado en breve.\");\n    return;\n  }\n  \n  // Procesar mensaje normalmente\n  try {\n    const reply = await responderConAsistenteOpenAI(userId, message, msgObj, esPrimeraVez);\n    await msgObj.reply(reply);\n    \n    const tiempoTotal = Date.now() - tiempoMensaje;\n    console.log(`📤 [ENVIADO] Respuesta a ${userId.substring(0, 10)} en ${Math.round(tiempoTotal / 1000)}s (${reply.length} chars)`);\n    \n    userFaileds.delete(userId);\n    \n  } catch (error) {\n    console.error(`❌ [ERROR_PROCESO] ${error.message}`);\n    stats.errores++;\n    \n    const fallos = userFaileds.get(userId) || { count: 0, timestamp: Date.now() };\n    userFaileds.set(userId, { \n      count: fallos.count + 1, \n      timestamp: Date.now() \n    });\n    \n    if (fallos.count < 2) {\n      await msgObj.reply(añadirFirmaAsistente('Hubo un problema procesando tu mensaje. Por favor, inténtalo nuevamente.'));\n    } else {\n      await msgObj.reply(añadirFirmaAsistente('Estoy teniendo dificultades técnicas. Intenta más tarde o escribe \"operador\" para contactar una persona.'));\n    }\n  }\n}\n\n// Eventos de WhatsApp\nclient.on('qr', qr => {\n  qrcode.generate(qr, { small: true });\n  console.log('📸 [QR] Escanea este código QR con WhatsApp para conectar');\n});\n\nclient.on('ready', () => {\n  console.log('🟢 [CONECTADO] Bot WhatsApp con filtros de estados - Listo para producción');\n  console.log(`🤖 [ASISTENTE] ID: ${OPENAI_ASSISTANT_ID.substring(0, 25)}...`);\n  console.log(`⏱️ [TIMEOUTS] Principal: ${CONFIG.TIMEOUT_PRINCIPAL}s | Reintento: ${CONFIG.TIMEOUT_REINTENTO}s`);\n  console.log(`🎭 [CONFIGURACIÓN] Firma: ${FIRMA_ASISTENTE.activa ? 'SÍ' : 'NO'} | Bienvenida: ${MENSAJE_INICIAL.activo ? 'SÍ' : 'NO'}`);\n  console.log(`📵 [FILTROS] Estados WhatsApp: ACTIVOS | Mensajes vacíos: FILTRADOS`);\n  mostrarStats();\n});\n\nclient.on('authenticated', () => {\n  console.log('✅ [AUTH] WhatsApp autenticado correctamente');\n});\n\nclient.on('auth_failure', () => {\n  console.log('❌ [AUTH] Fallo de autenticación WhatsApp');\n  stats.errores++;\n});\n\nclient.on('disconnected', (reason) => {\n  console.log(`🔴 [DESCONECTADO] Razón: ${reason}`);\n  stats.errores++;\n});\n\n// ✅ EVENTO PRINCIPAL CON FILTROS MEJORADOS\nclient.on('message', async msg => {\n  const userId = msg.from;\n  const incoming = msg.body;\n\n  // Filtros básicos\n  if (esGrupoWhatsApp(userId) || msg.fromMe) {\n    return;\n  }\n\n  // ✅ NUEVO: Validación de mensaje antes de procesar\n  if (!esMensajeValido(incoming, userId)) {\n    return; // Mensaje filtrado, no procesar\n  }\n\n  // Comando de stats\n  if (incoming.toLowerCase() === '/stats' && process.env.DEBUG_MODE === 'true') {\n    const uptime = Math.floor((Date.now() - stats.inicio) / 1000 / 60);\n    const tasaExito = stats.mensajes_recibidos > 0 ? \n      Math.round((stats.respuestas_exitosas / stats.mensajes_recibidos) * 100) : 0;\n    const tiempoPromedio = stats.tiempo_promedio.length > 0 ?\n      Math.round(stats.tiempo_promedio.reduce((a, b) => a + b, 0) / stats.tiempo_promedio.length / 1000) : 0;\n    \n    const statsMessage = `📊 *Estadísticas del Bot - CORREGIDO*\\n\\n⏰ *Uptime:* ${uptime} minutos\\n📊 *Performance:*\\n  • Mensajes recibidos: ${stats.mensajes_recibidos}\\n  • Mensajes filtrados: ${stats.mensajes_filtrados}\\n  • Respuestas exitosas: ${stats.respuestas_exitosas}\\n  • Respuestas por reintento: ${stats.respuestas_reintento}\\n  • Tasa de éxito: ${tasaExito}%\\n\\n⚡ *Tiempos:*\\n  • Tiempo promedio: ${tiempoPromedio}s\\n  • Timeouts primer intento: ${stats.timeouts_primer_intento}\\n  • Timeouts totales: ${stats.timeouts_totales}\\n\\n👥 *Usuarios:*\\n  • Nuevos usuarios: ${stats.usuarios_nuevos}\\n  • Threads activos: ${chatThreads.size}\\n  • Runs activos: ${activeRuns.size}\\n  • Cola de mensajes: ${Array.from(pendingMessages.values()).reduce((sum, arr) => sum + arr.length, 0)}\\n\\n❌ *Errores:* ${stats.errores}\\n\\n🚀 *Estado:* ${tasaExito > 80 ? 'ÓPTIMO' : tasaExito > 60 ? 'BUENO' : 'NECESITA OPTIMIZACIÓN'}`;\n\n    await msg.reply(añadirFirmaAsistente(statsMessage));\n    return;\n  }\n\n  // Comando de operador humano\n  if (incoming.toLowerCase().includes('operador')) {\n    if (humanModeUsers.has(userId)) {\n      humanModeUsers.delete(userId);\n      await msg.reply(añadirFirmaAsistente('Has salido del modo operador humano. Volveré a responder automáticamente.'));\n    } else {\n      humanModeUsers.add(userId);\n      await msg.reply('👤 *Modo Operador Humano Activado*\\\\n\\\\nUn operador te contactará pronto. Escribe \"operador\" nuevamente para volver al modo automático.');\n    }\n    return;\n  }\n\n  // Verificar modo operador humano\n  if (humanModeUsers.has(userId)) {\n    return;\n  }\n\n  // Procesar mensaje con sistema optimizado\n  await procesarMensaje(userId, incoming, msg);\n});\n\n// Health Check HTTP Nativo\nconst PORT = process.env.PORT || 3000;\n\nconst healthServer = http.createServer((req, res) => {\n  if (req.url === '/health' && req.method === 'GET') {\n    const uptime = Math.floor((Date.now() - stats.inicio) / 1000);\n    const tasaExito = stats.mensajes_recibidos > 0 ? \n      Math.round((stats.respuestas_exitosas / stats.mensajes_recibidos) * 100) : 100;\n    \n    const healthData = {\n      status: 'ok',\n      uptime: uptime,\n      mensajes: stats.mensajes_recibidos,\n      filtrados: stats.mensajes_filtrados,\n      exito: tasaExito,\n      threads: chatThreads.size,\n      runs_activos: activeRuns.size,\n      timestamp: new Date().toISOString()\n    };\n    \n    res.writeHead(200, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify(healthData, null, 2));\n  } else {\n    res.writeHead(404, { 'Content-Type': 'text/plain' });\n    res.end('Not Found');\n  }\n});\n\nhealthServer.listen(PORT, () => {\n  console.log(`🏥 [HEALTH] Endpoint HTTP nativo disponible en puerto ${PORT}`);\n});\n\n// Manejo de señales del sistema\nprocess.on('SIGTERM', () => {\n  console.log('📴 [SHUTDOWN] SIGTERM recibida - Cerrando gracefully...');\n  mostrarStats();\n  console.log(`📊 [FINAL] Performance promedio: ${stats.tiempo_promedio.length > 0 ? Math.round(stats.tiempo_promedio.reduce((a, b) => a + b, 0) / stats.tiempo_promedio.length / 1000) : 0}s`);\n  client.destroy();\n  healthServer.close();\n  process.exit(0);\n});\n\nprocess.on('SIGINT', () => {\n  console.log('📴 [SHUTDOWN] SIGINT recibida - Cerrando gracefully...');\n  mostrarStats();\n  client.destroy();\n  healthServer.close();\n  process.exit(0);\n});\n\nprocess.on('uncaughtException', (error) => {\n  console.error(`❌ [UNCAUGHT] ${error.message}`);\n  stats.errores++;\n});\n\nprocess.on('unhandledRejection', (reason, promise) => {\n  console.error(`❌ [UNHANDLED] Promesa rechazada: ${reason}`);\n  stats.errores++;\n});\n\n// Tareas de mantenimiento\nsetInterval(limpiarRunsAbandonados, CONFIG.LIMPIEZA_RUNS);\nsetInterval(optimizarSistema, CONFIG.OPTIMIZACION);\nsetInterval(mostrarStats, CONFIG.STATS_INTERVAL);\n\n// Inicializar el cliente\nclient.initialize();\n\nconsole.log('🚀 [INICIANDO] Bot WhatsApp CORREGIDO - Estados de WhatsApp filtrados');\nconsole.log('🎯 [CARACTERÍSTICAS] 100% Asistente OpenAI + Filtros avanzados + Sin errores de mensajes vacíos');\nconsole.log('📈 [PERFORMANCE] Optimizado con filtros de estados y mensajes vacíos');\nconsole.log('🔧 [MONITOREO] Stats con contadores de mensajes filtrados');\nconsole.log(`⚙️ [CONFIG] Principal: ${CONFIG.TIMEOUT_PRINCIPAL}s | Reintento: ${CONFIG.TIMEOUT_REINTENTO}s | Max contexto: ${CONFIG.ASSISTANT.max_contexto}`);\nconsole.log('📵 [FILTROS] Estados WhatsApp, mensajes vacíos, mensajes de sistema - TODOS ACTIVOS');"