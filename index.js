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
const chatHistories    = new Map();   // Map<userId, Array<{ role, content }>>
const humanModeUsers   = new Set();   // Set<userId> usuarios en modo “operador humano”
const userFaileds      = new Map();   // Map<userId, número de intentos fallidos

// ----------------------------------------------------
// 4. Función para responder (siempre usa Assistant ID)
// ----------------------------------------------------
async function responderConGPT(userId, message) {
  if (!openai) {
    return 'Lo siento, el servicio de asistencia avanzada no está disponible en este momento.';
  }

  // Construir historial
  let history = chatHistories.get(userId) || [];
  if (history.length === 0 || history[0].role !== 'system') {
    history = [{ role: 'system', content: SYSTEM_PROMPT }];
  }
  history.push({ role: 'user', content: message });
  if (history.length > 7) {
    history = [history[0], ...history.slice(-6)];
  }

  try {
    // Si existe Assistant ID, lo usamos (y nunca model genérico)
    if (OPENAI_ASSISTANT_ID) {
      const response = await openai.chat.completions.create({
        assistant: OPENAI_ASSISTANT_ID,
        messages: history,
        temperature: 0.5,
        max_tokens: 400
      });

      const reply = response.choices[0]?.message?.content?.trim() ||
                    'Disculpa, no pude procesar tu consulta.';

      // Actualizar historial
      history.push({ role: 'assistant', content: reply });
      if (history.length > 7) {
        history = [history[0], ...history.slice(-6)];
      }
      chatHistories.set(userId, history);
      return reply;
    }

    // (Rama de fallback, solo si por alguna razón falta OPENAI_ASSISTANT_ID)
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
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

  try {
    // Si OpenAI no está listo, informamos y ofrecemos operador humano
    if (!openai) {
      await msg.reply('Lo siento, el servicio de asistencia avanzada no está disponible en este momento.');
      await msg.reply('¿Te gustaría hablar con un operador humano? Escribe "operador" para ser derivado.');
      return;
    }

    // Comando “operador” / “bot”
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
      const reply = await responderConGPT(userId, incoming);
      await msg.reply(reply);
      console.log(`📤 [Respuesta GPT] ${userId}: ${reply}`);
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
