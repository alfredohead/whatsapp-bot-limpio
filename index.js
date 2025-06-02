// Versión ultra-minimalista con configuración optimizada para Fly.io
require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// Configuración de OpenAI para fallback
const { OpenAI } = require('openai');
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
let openai;

if (OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  console.log('✅ [OpenAI] API configurada correctamente');
} else {
  console.warn('⚠️ [OpenAI] API no configurada. El fallback a GPT no estará disponible.');
}

// Mapa para historiales de chat con GPT
const chatHistories = new Map();
const userFailedAttempts = new Map();
const humanModeUsers = new Set();

// Mensaje del sistema personalizado para GPT
const SYSTEM_PROMPT = `Eres un asistente virtual de la Municipalidad de San Martín. Atiendes consultas ciudadanas relacionadas con distintas áreas:

- Economía Social y Asociativismo
- Punto Digital
- Incubadora de Empresas
- Escuela de Oficios Manuel Belgrano
- Programas Nacionales
- Trámites y contacto general con el municipio

Responde en español con un lenguaje claro, humano y accesible. Usa emojis ocasionalmente para hacer la conversación más amigable.`;

// Configuración optimizada de Puppeteer para entornos cloud/serverless
const puppeteerOptions = {
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--single-process',
    '--disable-gpu'
  ],
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  timeout: 60000 // 60 segundos
};

// Configuración del cliente WhatsApp
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: '/app/session' }),
  puppeteer: puppeteerOptions
});

// Eventos de WhatsApp
client.on('qr', qr => {
  console.log('📸 QR recibido:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ [WhatsApp] Cliente listo y conectado');
});

client.on('authenticated', () => {
  console.log('🔐 [WhatsApp] Autenticado');
});

client.on('auth_failure', msg => {
  console.error('🚨 [WhatsApp] Error de autenticación:', msg);
  setTimeout(() => client.initialize(), 10000);
});

client.on('disconnected', reason => {
  console.warn('🔌 [WhatsApp] Desconectado:', reason);
  setTimeout(() => client.initialize(), 5000);
});

// Función para responder con GPT
async function responderConGPT(userId, message) {
  if (!openai) {
    return 'Lo siento, el servicio de asistencia avanzada no está disponible en este momento.';
  }

  try {
    // Obtener o inicializar historial de chat
    let history = chatHistories.get(userId) || [];
    if (history.length === 0) {
      history.push({ role: 'system', content: SYSTEM_PROMPT });
    }

    // Añadir el mensaje del usuario
    history.push({ role: 'user', content: message });

    // Llamar a la API de OpenAI
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: history,
      temperature: 0.7,
      max_tokens: 500
    });

    const reply = response.choices[0]?.message?.content?.trim() || 
                 'Disculpa, no pude procesar tu consulta.';

    // Guardar respuesta en el historial
    history.push({ role: 'assistant', content: reply });

    // Limitar el tamaño del historial
    if (history.length > 12) {
      history = [history[0], ...history.slice(-11)];
    }
    chatHistories.set(userId, history);

    return reply;
  } catch (error) {
    console.error('❌ [GPT] Error:', error);
    return 'Lo siento, ocurrió un error al procesar tu consulta.';
  }
}

// Procesamiento de mensajes entrantes
client.on('message', async msg => {
  const userId = msg.from;
  const incoming = msg.body;
  console.log(`📥 [Mensaje] ${userId}: ${incoming}`);

  try {
    // Procesamiento normal con GPT
    if (!openai) {
      await msg.reply('Lo siento, el servicio de asistencia avanzada no está disponible en este momento.');
      // Solo en caso de error técnico, ofrecer operador
      await msg.reply('¿Te gustaría hablar con un operador humano? Escribe "operador" para ser derivado.');
      return;
    }

    // Verificar comandos de transferencia a humano/bot
    if (incoming.toLowerCase() === 'operador') {
      humanModeUsers.add(userId);
      await msg.reply('Te paso con un operador. Cuando quieras volver a hablar con el bot, escribí "bot".');
      return;
    }
    
    if (incoming.toLowerCase() === 'bot') {
      humanModeUsers.delete(userId);
      await msg.reply('Volviste con el bot 🤖. ¿En qué puedo ayudarte?');
      return;
    }
    
    // Si está en modo humano, no procesar
    if (humanModeUsers.has(userId)) return;
    
    // Contador de intentos fallidos
    let failedAttempts = userFailedAttempts.get(userId) || 0;
    
    // Intentar con GPT
    try {
      const reply = await responderConGPT(userId, incoming);
      await msg.reply(reply);
      console.log(`📤 [Respuesta GPT] ${userId}: ${reply}`);
    } catch (error) {
      console.error('❌ [Error al procesar con GPT]', error);
      await msg.reply('Lo siento, ocurrió un error al procesar tu consulta.');
    }
  } catch (error) {
    console.error('❌ [Error General]', error);
    await msg.reply('Lo siento, ocurrió un error. Por favor, intenta más tarde.');
    // Solo en caso de error técnico, ofrecer operador
    await msg.reply('¿Te gustaría hablar con un operador humano? Escribe "operador" para ser derivado.');
  }
});

// Servidor HTTP dummy para Fly.io (mantiene el contenedor "vivo")
const http = require('http');
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot de WhatsApp activo\n');
}).listen(3000, '0.0.0.0', () => {
  console.log('🌐 [HTTP] Servidor dummy escuchando en 0.0.0.0:3000');
});

// Capturar promesas no manejadas
process.on('unhandledRejection', reason => {
  console.error('❌ [Error] Promesa no manejada:', reason);
});

// Inicializar cliente
console.log('🚀 [Iniciando] Bot de WhatsApp con GPT...');
client.initialize().catch(err => {
  console.error('❌ [Error de inicialización]', err);
  // Reintentar después de un tiempo
  setTimeout(() => {
    console.log('🔄 Reintentando inicialización...');
    client.initialize();
  }, 30000);
});
