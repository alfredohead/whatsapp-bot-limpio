// ARCHIVO MÍNIMO PARA VERIFICACIÓN - Bot WhatsApp
// Usa este archivo si el problema persiste
require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { OpenAI } = require('openai');
const http = require('http');
// Variables de entorno
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;
if (!OPENAI_API_KEY || !OPENAI_ASSISTANT_ID) {
  console.error('❌ [CRÍTICO] Variables de entorno faltantes');
  process.exit(1);
}
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
console.log('✅ [OpenAI] Configuración validada correctamente');
// Configuración simple
const CONFIG = {
  TIMEOUT_PRINCIPAL: 45,
  TIMEOUT_REINTENTO: 35,
  TIMEOUT_RAPIDO: 25
};
// ✅ FIRMA SIN PROBLEMAS DE SINTAXIS
const FIRMA_ASISTENTE = {
  sufijo: "\n\n🤖 _Asistente IA - Municipalidad San Martín_",
  activa: true
};
console.log('✅ [FIRMA] Configuración de firma cargada correctamente');
// Cliente WhatsApp básico
const client = new Client({
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox', 
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  },
  authStrategy: new LocalAuth({
    dataPath: './session'
  })
});
// Variables globales simplificadas
const chatThreads = new Map();
const stats = {
  mensajes_recibidos: 0,
  respuestas_exitosas: 0,
  errores: 0,
  inicio: Date.now()
};
// Función básica para obtener thread
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
// Función básica de procesamiento
async function procesarMensaje(message) {
  try {
    console.log(`📨 [PROCESANDO] ${message.from}: "${message.body?.substring(0, 50)}..."`);
    
    const threadId = await obtenerOCrearThread(message.from);
    
    // Crear mensaje en el thread
    await openai.beta.threads.messages.create(threadId, {
      role: 'user',
      content: message.body
    });
    
    // Crear y ejecutar run
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: OPENAI_ASSISTANT_ID,
      temperature: 0.6
    });
    
    console.log(`🤖 [RUN] Iniciado: ${run.id}`);
    
    // Polling básico
    let completed = false;
    let attempts = 0;
    const maxAttempts = 30;
    
    while (!completed && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
      
      if (runStatus.status === 'completed') {
        const messages = await openai.beta.threads.messages.list(threadId);
        const lastMessage = messages.data[0];
        
        if (lastMessage && lastMessage.role === 'assistant') {
          let respuesta = lastMessage.content[0]?.text?.value || 'Sin respuesta';
          
          if (FIRMA_ASISTENTE.activa) {
            respuesta += FIRMA_ASISTENTE.sufijo;
          }
          
          await message.reply(respuesta);
          stats.respuestas_exitosas++;
          console.log(`✅ [COMPLETADO] Respuesta enviada`);
          completed = true;
        }
      } else if (runStatus.status === 'failed') {
        throw new Error(`Run falló: ${runStatus.last_error?.message}`);
      }
      
      attempts++;
    }
    
    if (!completed) {
      await message.reply("⏰ El sistema está ocupado. Intenta nuevamente en unos momentos.");
      stats.errores++;
    }
    
  } catch (error) {
    console.error(`❌ [ERROR-PROCESAMIENTO]`, error);
    stats.errores++;
    
    try {
      await message.reply("❌ Error interno del sistema. Intenta nuevamente.");
    } catch (replyError) {
      console.error(`❌ [ERROR-REPLY]`, replyError);
    }
  }
}
// Eventos básicos de WhatsApp
client.on('qr', (qr) => {
  console.log('📱 [QR] Código QR generado');
  qrcode.generate(qr, { small: true });
});
client.on('ready', () => {
  console.log('✅ [WHATSAPP] Cliente conectado y listo');
  console.log('🤖 [BOT] Bot WhatsApp SIMPLIFICADO iniciado');
});
client.on('disconnected', (reason) => {
  console.log('⚠️ [WHATSAPP] Cliente desconectado:', reason);
});
// Evento principal simplificado
client.on('message_create', async (message) => {
  try {
    stats.mensajes_recibidos++;
    
    // Filtros básicos
    if (message.fromMe || 
        message.from === 'status@broadcast' ||
        message.from.includes('@g.us') ||
        !message.body || 
        message.body.trim().length < 3) {
      return;
    }
    
    // Comandos básicos
    if (message.body.toLowerCase().startsWith('!status')) {
      const uptime = Math.floor((Date.now() - stats.inicio) / 1000 / 60);
      await message.reply(`🟢 Bot activo - Uptime: ${uptime}min - Mensajes: ${stats.mensajes_recibidos} - Éxitos: ${stats.respuestas_exitosas}`);
      return;
    }
    
    // Procesar mensaje normal
    await procesarMensaje(message);
    
  } catch (error) {
    console.error('❌ [ERROR-MESSAGE-CREATE]', error);
    stats.errores++;
  }
});
// Servidor HTTP básico
const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    const uptime = Math.floor((Date.now() - stats.inicio) / 1000 / 60);
    const health = {
      status: 'OK',
      uptime: `${uptime} minutos`,
      whatsapp: client.info ? 'Conectado' : 'Desconectado',
      stats: {
        mensajes_recibidos: stats.mensajes_recibidos,
        respuestas_exitosas: stats.respuestas_exitosas,
        errores: stats.errores
      },
      timestamp: new Date().toISOString(),
      version: 'SIMPLIFICADO'
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
  console.log(`🔍 [HEALTH] Health check: http://localhost:${PORT}/health`);
});
// Manejo de errores
process.on('unhandledRejection', (error) => {
  console.error('❌ [UNHANDLED-REJECTION]', error);
  stats.errores++;
});
process.on('uncaughtException', (error) => {
  console.error('❌ [UNCAUGHT-EXCEPTION]', error);
  stats.errores++;
});
// Inicialización
console.log('🚀 [INICIO] Iniciando cliente WhatsApp simplificado...');
console.log('📋 [CONFIG] Configuración simplificada cargada');
console.log('✅ [SISTEMA] Bot WhatsApp SIMPLIFICADO - Sin errores de sintaxis');
client.initialize();
console.log('📱 [ESPERA] Esperando código QR para conectar...');