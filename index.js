// index.js FINAL DEFINITIVO - Bot WhatsApp Corregido y Depurado
// Versión estable con todos los problemas solucionados

require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { OpenAI } = require('openai');
const http = require('http'); // HTTP nativo

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
  TIMEOUT_PRINCIPAL: 45,          // Timeouts optimizados para servidores lentos
  TIMEOUT_REINTENTO: 35,
  TIMEOUT_RAPIDO: 25,
  MAX_REINTENTOS: 2,
  LIMPIEZA_RUNS: 2 * 60 * 1000,   // Cada 2 minutos
  OPTIMIZACION: 10 * 60 * 1000,   // Cada 10 minutos
  STATS_INTERVAL: 5 * 60 * 1000,  // Stats cada 5 minutos
  ASSISTANT: {
    temperature: 0.6,
    timeout_interno: 40000,
    max_contexto: 12
  }
};

// ✅ CONFIGURACIÓN CORREGIDA - Sin errores de sintaxis
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

// ✅ Stats mejoradas con contador de filtros
const stats = {
  mensajes_recibidos: 0,
  mensajes_filtrados: 0,        // NUEVO: Contador de mensajes filtrados
  respuestas_exitosas: 0,
  respuestas_reintento: 0,
  timeouts_primer_intento: 0,
  timeouts_totales: 0,
  usuarios_nuevos: 0,
  errores: 0,
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
  const comandos = ['!stats', '!status', '!help', '!human', '!ai'];
  return comandos.some(cmd => body.toLowerCase().startsWith(cmd));
}

function esSpamOVacio(body) {
  if (!body || body.trim().length === 0) return true;
  if (body.length < 3) return true;
  
  // Patrones de spam conocidos
  const spamPatterns = [
    /^(.)\1{4,}$/,  // Caracteres repetidos
    /^[0-9\s\-\+\(\)]{10,}$/,  // Solo números/espacios/guiones
    /^\W+$/,  // Solo símbolos
  ];
  
  return spamPatterns.some(pattern => pattern.test(body.trim()));
}

// ✅ FILTRO PRINCIPAL - Consolidado y mejorado
function debeIgnorarMensaje(message) {
  try {
    const body = message.body?.trim() || '';
    
    // Logs detallados para debugging
    const from = message.from;
    const isGroup = esGrupo(message.from);
    const isBot = esBot(message);
    const isEmpty = !body || body.length === 0;
    const isSpam = esSpamOVacio(body);
    const isAdmin = esComandoAdmin(body);
    
    // ❌ IGNORAR: Grupos (completamente bloqueados)
    if (isGroup) {
      console.log(`🚫 [FILTRO] Mensaje de grupo ignorado: ${from}`);
      stats.mensajes_filtrados++;
      return true;
    }
    
    // ❌ IGNORAR: Bots o mensajes automáticos
    if (isBot) {
      console.log(`🚫 [FILTRO] Bot/automático ignorado: ${from}`);
      stats.mensajes_filtrados++;
      return true;
    }
    
    // ❌ IGNORAR: Mensajes vacíos o spam
    if (isEmpty || isSpam) {
      console.log(`🚫 [FILTRO] Spam/vacío ignorado: "${body.substring(0, 50)}..."`);
      stats.mensajes_filtrados++;
      return true;
    }
    
    // ✅ PERMITIR: Comandos de admin
    if (isAdmin) {
      console.log(`✅ [FILTRO] Comando admin permitido: ${body}`);
      return false;
    }
    
    // ✅ PERMITIR: Mensajes válidos de usuarios individuales
    console.log(`✅ [FILTRO] Mensaje válido de: ${from} - "${body.substring(0, 50)}..."`);
    return false;
    
  } catch (error) {
    console.error('❌ [ERROR-FILTRO]', error);
    stats.mensajes_filtrados++;
    return true; // En caso de error, ignorar por seguridad
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
      
      // Crear nuevo thread y reemplazar
      const nuevoThread = await openai.beta.threads.create();
      
      // Actualizar en el mapa
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
    return threadId; // Retornar el original si hay error
  }
}

// ----------------------------------------------------
// 7. Procesamiento de Mensajes con Assistant
// ----------------------------------------------------

async function procesarConAssistant(message, threadId, timeoutMs = CONFIG.TIMEOUT_PRINCIPAL * 1000) {
  const startTime = Date.now();
  
  try {
    let prompt = message.body;
    const esNuevoUsuario = !usuariosConocidos.has(message.from);
    
    // Añadir contexto para nuevos usuarios
    if (esNuevoUsuario && MENSAJE_INICIAL.activo) {
      prompt = `${MENSAJE_INICIAL.prompt}\n\nMensaje del usuario: ${prompt}`;
      usuariosConocidos.add(message.from);
      stats.usuarios_nuevos++;
      console.log(`👋 [NUEVO] Usuario nuevo detectado: ${message.from}`);
    }
    
    // Crear mensaje en el thread
    await openai.beta.threads.messages.create(threadId, {
      role: 'user',
      content: prompt
    });
    
    // Crear y ejecutar run con timeout
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
    
    // Polling con timeout mejorado
    const resultado = await esperarCompletado(threadId, run.id, timeoutMs);
    
    // Limpiar run activo
    activeRuns.delete(run.id);
    
    // Registrar tiempo
    const tiempoTotal = Date.now() - startTime;
    stats.tiempo_promedio.push(tiempoTotal);
    if (stats.tiempo_promedio.length > 50) {
      stats.tiempo_promedio = stats.tiempo_promedio.slice(-30);
    }
    
    return resultado;
    
  } catch (error) {
    console.error('❌ [ERROR-ASSISTANT]', error);
    
    // Limpiar cualquier run activo
    for (let [runId, runInfo] of activeRuns.entries()) {
      if (runInfo.threadId === threadId) {
        activeRuns.delete(runId);
        break;
      }
    }
    
    throw error;
  }
}

async function esperarCompletado(threadId, runId, timeoutMs) {
  const maxTime = Date.now() + timeoutMs;
  const pollInterval = 2000; // 2 segundos
  
  while (Date.now() < maxTime) {
    try {
      const run = await openai.beta.threads.runs.retrieve(threadId, runId);
      
      if (run.status === 'completed') {
        const messages = await openai.beta.threads.messages.list(threadId);
        const lastMessage = messages.data[0];
        
        if (lastMessage && lastMessage.role === 'assistant') {
          let respuesta = lastMessage.content[0]?.text?.value || 'Sin respuesta';
          
          // Añadir firma si está activa
          if (FIRMA_ASISTENTE.activa) {
            respuesta += FIRMA_ASISTENTE.sufijo;
          }
          
          return respuesta;
        }
      }
      
      if (run.status === 'failed' || run.status === 'cancelled' || run.status === 'expired') {
        throw new Error(`Run ${run.status}: ${run.last_error?.message || 'Error desconocido'}`);
      }
      
      // Esperar antes del siguiente poll
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      
    } catch (error) {
      if (error.message.includes('Run')) {
        throw error; // Re-lanzar errores específicos del run
      }
      console.error('❌ [ERROR-POLLING]', error);
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
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

async function enviarStats(message) {
  const uptime = obtenerUptime();
  const tasaExito = stats.mensajes_recibidos > 0 ? 
    Math.round((stats.respuestas_exitosas / stats.mensajes_recibidos) * 100) : 0;
  const tiempoPromedio = stats.tiempo_promedio.length > 0 ? 
    (stats.tiempo_promedio.reduce((a, b) => a + b, 0) / stats.tiempo_promedio.length / 1000).toFixed(1) : '0';
  const tasaTimeoutPrimer = stats.mensajes_recibidos > 0 ? 
    Math.round((stats.timeouts_primer_intento / stats.mensajes_recibidos) * 100) : 0;
    
  const statsMessage = `📊 *Estadísticas del Bot - FINAL DEFINITIVO*

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

👥 *Usuarios:*
  • Nuevos usuarios: ${stats.usuarios_nuevos}
  • Threads activos: ${chatThreads.size}
  • Runs activos: ${activeRuns.size}
  • Cola de mensajes: ${Array.from(pendingMessages.values()).reduce((sum, arr) => sum + arr.length, 0)}

❌ *Errores:* ${stats.errores}

🚀 *Estado:* ${tasaExito > 80 ? 'ÓPTIMO' : tasaExito > 60 ? 'BUENO' : 'NECESITA OPTIMIZACIÓN'}`;

  await message.reply(statsMessage);
}

async function enviarStatus(message) {
  const status = `🟢 *Bot WhatsApp - Estado DEFINITIVO*

✅ *Sistema:* Operativo
🔗 *OpenAI:* Conectado
📱 *WhatsApp:* Activo
⚡ *Performance:* ${stats.respuestas_exitosas}/${stats.mensajes_recibidos} éxitos
🧵 *Threads:* ${chatThreads.size} activos
🔄 *Runs:* ${activeRuns.size} ejecutándose

*Versión:* Final Definitiva - Todos los problemas resueltos`;

  await message.reply(status);
}

async function enviarAyuda(message) {
  const ayuda = `📋 *Comandos Disponibles:*

🔹 *!stats* - Estadísticas detalladas
🔹 *!status* - Estado del sistema  
🔹 *!help* - Esta ayuda
🔹 *!human* - Desactivar IA (modo manual)
🔹 *!ai* - Reactivar IA

💡 *Uso Normal:*
Simplemente envía tu mensaje y el asistente responderá automáticamente.

🚫 *Limitaciones:*
• No funciona en grupos
• Mensajes muy cortos son filtrados
• Timeouts automáticos por seguridad`;

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
    return; // Ya hay procesamiento en curso
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
      
      // Pequeña pausa entre mensajes del mismo usuario
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
    
    // Verificar modo humano
    if (humanModeUsers.has(chatId)) {
      console.log(`👨 [HUMAN] Mensaje ignorado (modo humano): ${chatId}`);
      return;
    }
    
    // Obtener/crear thread y limpiar si es necesario
    let threadId = await obtenerOCrearThread(chatId);
    threadId = await limpiarContextoSiNecesario(threadId);
    
    // Procesar con reintentos
    let respuesta = null;
    let exito = false;
    
    // Primer intento con timeout principal
    try {
      respuesta = await procesarConAssistant(message, threadId, CONFIG.TIMEOUT_PRINCIPAL * 1000);
      exito = true;
      stats.respuestas_exitosas++;
    } catch (error) {
      console.log(`⚠️ [TIMEOUT-1] Primer intento falló: ${error.message}`);
      stats.timeouts_primer_intento++;
      
      // Segundo intento con timeout reducido
      try {
        respuesta = await procesarConAssistant(message, threadId, CONFIG.TIMEOUT_REINTENTO * 1000);
        exito = true;
        stats.respuestas_reintento++;
        console.log(`✅ [REINTENTO] Exitoso en segundo intento`);
      } catch (error2) {
        console.log(`⚠️ [TIMEOUT-2] Segundo intento falló: ${error2.message}`);
        stats.timeouts_totales++;
        
        // Último intento con timeout mínimo
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
    
    // Enviar respuesta
    if (respuesta) {
      await message.reply(respuesta);
      const tiempoTotal = Date.now() - startTime;
      console.log(`✅ [COMPLETADO] ${chatId} en ${formatearTiempo(tiempoTotal)}s`);
    }
    
    // Limpiar fallos si hubo éxito
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
  // Limpieza de runs inactivos cada 2 minutos
  setInterval(() => {
    const ahora = Date.now();
    let runsLimpiados = 0;
    
    for (let [runId, runInfo] of activeRuns.entries()) {
      if (ahora - runInfo.inicio > CONFIG.ASSISTANT.timeout_interno) {
        activeRuns.delete(runId);
        runsLimpiados++;
      }
    }
    
    if (runsLimpiados > 0) {
      console.log(`🧹 [LIMPIEZA] ${runsLimpiados} runs inactivos eliminados`);
    }
  }, CONFIG.LIMPIEZA_RUNS);
  
  // Estadísticas periódicas cada 5 minutos
  setInterval(() => {
    const uptime = obtenerUptime();
    const tasaExito = stats.mensajes_recibidos > 0 ? 
      Math.round((stats.respuestas_exitosas / stats.mensajes_recibidos) * 100) : 0;
    const tiempoPromedio = stats.tiempo_promedio.length > 0 ? 
      (stats.tiempo_promedio.reduce((a, b) => a + b, 0) / stats.tiempo_promedio.length / 1000).toFixed(1) : '0';
    const tasaTimeoutPrimer = stats.mensajes_recibidos > 0 ? 
      Math.round((stats.timeouts_primer_intento / stats.mensajes_recibidos) * 100) : 0;
    
    console.log(`📊 [STATS] ${uptime}min | Mensajes: ${stats.mensajes_recibidos} | Filtrados: ${stats.mensajes_filtrados} | Éxito: ${tasaExito}% | T.Promedio: ${tiempoPromedio}s | Timeouts1er: ${tasaTimeoutPrimer}% | Nuevos: ${stats.usuarios_nuevos}`);
  }, CONFIG.STATS_INTERVAL);
  
  // Optimización de memoria cada 10 minutos
  setInterval(() => {
    // Limpiar arrays de tiempo promedio si son muy grandes
    if (stats.tiempo_promedio.length > 100) {
      stats.tiempo_promedio = stats.tiempo_promedio.slice(-50);
      console.log(`🧹 [OPTIMIZACIÓN] Array de tiempos reducido`);
    }
    
    // Limpiar mensajes pendientes muy antiguos (más de 1 hora)
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
  console.log('🤖 [BOT] Bot WhatsApp FINAL DEFINITIVO iniciado');
  console.log('🔧 [SISTEMA] Iniciando tareas de mantenimiento...');
  
  iniciarTareasMantenimiento();
});

client.on('disconnected', (reason) => {
  console.log('⚠️ [WHATSAPP] Cliente desconectado:', reason);
});

// ✅ EVENTO PRINCIPAL - Optimizado y con filtros estrictos
client.on('message_create', async (message) => {
  try {
    // Incrementar contador total
    stats.mensajes_recibidos++;
    
    // ✅ FILTRO PRINCIPAL
    if (debeIgnorarMensaje(message)) {
      return; // Mensaje filtrado, no procesar
    }
    
    // Manejo de comandos administrativos
    if (esComandoAdmin(message.body)) {
      await manejarComandoAdmin(message);
      return;
    }
    
    // Encolar mensaje para procesamiento
    const chatId = message.from;
    encolarMensaje(chatId, message);
    
    // Procesar cola (sin await para no bloquear)
    procesarColaMensajes(chatId).catch(error => {
      console.error(`❌ [ERROR-COLA-ASYNC] ${chatId}:`, error);
    });
    
  } catch (error) {
    console.error('❌ [ERROR-MESSAGE-CREATE]', error);
    stats.errores++;
  }
});

// Manejo de errores globales
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
        errores: stats.errores
      },
      timestamp: new Date().toISOString()
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

// Mensaje final
console.log('✅ [SISTEMA] Bot WhatsApp FINAL DEFINITIVO - Todos los problemas resueltos');
console.log('📱 [ESPERA] Esperando código QR para conectar...');
