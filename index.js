// Versión completa de index.js con todas las modificaciones necesarias:
// - Uso de OPENAI_ASSISTANT_ID para invocar al assistant en lugar del modelo genérico.
// - Configuración de Puppeteer para permitir ejecución en Fly.io (flags --no-sandbox y --disable-setuid-sandbox).
// - Toda la lógica original preservada.

require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// Configuración de OpenAI para fallback
const { OpenAI } = require('openai');
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;
let openai;

if (OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  console.log('✅ [OpenAI] API configurada correctamente');
  if (!OPENAI_ASSISTANT_ID) {
    console.warn('⚠️ [OpenAI] No se encontró OPENAI_ASSISTANT_ID en .env. Se usará fallback a modelo genérico si fuera necesario.');
  } else {
    console.log(`✅ [OpenAI] Assistant ID configurado: ${OPENAI_ASSISTANT_ID}`);
  }
} else {
  console.warn('⚠️ [OpenAI] API no configurada. El fallback a GPT no estará disponible.');
}

// ---------------------------------------------
// Parámetros y estructuras para el bot de WhatsApp
// ---------------------------------------------
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

const SYSTEM_PROMPT = `Eres un asistente amable y profesional que ayuda a los usuarios de la Municipalidad de San Martín (Área Programas Nacionales). Responde con claridad y brevedad.`;
const chatHistories = new Map();        // { userId: [ {role, content}, ... ] }
const humanModeUsers = new Set();       // usuarios en modo “operador humano”
const userFailedAttempts = new Map();   // contador de errores por usuario

// ---------------------------------------------
// Función para responder con GPT (ahora con Assistant)
// ---------------------------------------------
async function responderConGPT(userId, message) {
  if (!openai) {
    return 'Lo siento, el servicio de asistencia avanzada no está disponible en este momento.';
  }

  if (!OPENAI_ASSISTANT_ID) {
    return 'Lo siento, el asistente no está correctamente configurado. Intenta de nuevo más tarde.';
  }

  try {
    let history = chatHistories.get(userId) || [];
    if (history.length === 0 || history[0].role !== 'system') {
      history = [{ role: 'system', content: SYSTEM_PROMPT }];
    }

    history.push({ role: 'user', content: message });
    if (history.length > 7) {
      history = [history[0], ...history.slice(-6)];
    }

    const response = await openai.chat.completions.create({
      assistant: OPENAI_ASSISTANT_ID,
      messages: history,
      temperature: 0.5,
      max_tokens: 400
    });

    const reply = response.choices[0]?.message?.content?.trim() ||
                  'Disculpa, no pude procesar tu consulta.';

    history.push({ role: 'assistant', content: reply });
    if (history.length > 7) {
      history = [history[0], ...history.slice(-6)];
    }
    chatHistories.set(userId, history);

    return reply;

  } catch (error) {
    console.error('❌ [GPT] Error:', error);
    return 'Lo siento, ocurrió un error al procesar tu consulta.';
  }
}

// ---------------------------------------------
// Manejo de eventos del cliente de WhatsApp
// ---------------------------------------------
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

  try {
    if (!openai) {
      await msg.reply('Lo siento, el servicio de asistencia avanzada no está disponible en este momento.');
      await msg.reply('¿Te gustaría hablar con un operador humano? Escribe "operador" para ser derivado.');
      return;
    }

    if (incoming.toLowerCase() === 'operador') {
      humanModeUsers.add(userId);
      await msg.reply('Te paso con un operador. Cuando quieras volver a hablar con el bot, escribí "bot".');
      return;
    }
    if (incoming.toLowerCase() === 'bot') {
      humanModeUsers.delete(userId);
      await msg.reply('✅ El bot ha sido reactivado. ¿En qué puedo ayudarte?');
      return;
    }

    if (humanModeUsers.has(userId)) return;

    let failedAttempts = userFailedAttempts.get(userId) || 0;

    try {
      const reply = await responderConGPT(userId, incoming);
      await msg.reply(reply);
      console.log(`📤 [Respuesta GPT] ${userId}: ${reply}`);
      userFailedAttempts.set(userId, 0);

    } catch (error) {
      console.error('❌ [Error interno al responderConGPT]', error);
      failedAttempts++;
      userFailedAttempts.set(userId, failedAttempts);

      if (failedAttempts < 3) {
        await msg.reply('Lo siento, ocurrió un problema al procesar tu mensaje. Por favor, inténtalo de nuevo.');
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

// ---------------------------------------------
// Inicializar cliente
// ---------------------------------------------
console.log('🚀 [Iniciando] Bot de WhatsApp con GPT (Assistant)...');
console.log('🟢 [DEBUG] Antes de client.initialize()');
client.initialize()
  .then(() => {
    console.log('🟢 [DEBUG] client.initialize() resuelto');
  })
  .catch(err => {
    console.error('❌ [Error de inicialización]', err);
    setTimeout(() => {
      console.log('🔄 Reintentando inicialización...');
      client.initialize();
    }, 30000);
  });

// ---------------------------------------------
// Servidor HTTP dummy para Fly.io (mantiene el contenedor “vivo”)
// ---------------------------------------------
const http = require('http');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot de WhatsApp activo\n');
}).listen(3000, '0.0.0.0', () => {
  console.log('🌐 [HTTP] Servidor dummy escuchando en 0.0.0.0:3000');
});

// ---------------------------------------------
// Capturar promesas no manejadas
// ---------------------------------------------
process.on('unhandledRejection', reason => {
  console.error('❌ [Error] Promesa no manejada:', reason);
});

// ---------------------------------------------
// Manejo de señales para apagado limpio
// ---------------------------------------------
function shutdown(signal) {
  console.log(`\n🛑 [Sistema] Señal recibida: ${signal}. Cerrando bot y servidor HTTP...`);
  try {
    client.destroy();
  } catch (e) {
    console.error('❌ [Error] al cerrar cliente WhatsApp:', e);
  }
  try {
    server.close(() => {
      console.log('🌐 [HTTP] Servidor cerrado.');
      process.exit(0);
    });
  } catch (e) {
    console.error('❌ [Error] al cerrar servidor HTTP:', e);
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
