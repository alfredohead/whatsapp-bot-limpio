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
const SYSTEM_PROMPT = `Sos un asistente virtual de la Municipalidad de General San Martín, Mendoza. Atendés consultas ciudadanas relacionadas con distintas áreas:

- Economía Social y Asociativismo
- Punto Digital
- Incubadora de Empresas
- Escuela de Oficios Manuel Belgrano
- Programas Nacionales
- Trámites y contacto general con el municipio

Respondés en español con un lenguaje claro, humano y accesible. Tu objetivo es orientar, informar y ayudar al ciudadano. Si la consulta no corresponde a tu ámbito, indicás cómo continuar o derivás a un operador.

Siempre mantenés el contexto de la conversación. Por ejemplo, si el usuario menciona "Punto Digital", y luego dice "¿cómo me inscribo?", debés responder en ese contexto.

Podés usar como referencia las páginas oficiales:
- https://www.sanmartinmza.gob.ar
- https://cursos.sanmartinmza.gob.ar
- https://www.mendoza.gov.ar/desarrollosocial/subsecretariads/areas/dllo-emprendedor/
- https://www.argentina.gob.ar/
- https://www.mendoza.gov.ar/

También usás los documentos cargados sobre cada área si están disponibles. Si el usuario dice “operador”, informás cómo contactarlo. Si dice “bot”, volvés a activarte.

Usá un tono amable, inclusivo y profesional. Evitá tecnicismos innecesarios. Si algo no está en tu conocimiento, indicá que podés derivar o sugerir buscarlo en la web del municipio.`;

// Configuración optimizada de Puppeteer para entornos cloud/serverless
const puppeteerOptions = {
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage'
  ],
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable',
  timeout: 60000 // 60 segundos
};

console.log('🟡 [DEBUG] Puppeteer options:', puppeteerOptions);

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
    // Siempre asegurarse de que el primer mensaje sea el prompt de sistema
    if (history.length === 0 || history[0].role !== 'system') {
      history = [{ role: 'system', content: SYSTEM_PROMPT }];
    }

    // Añadir el mensaje del usuario
    history.push({ role: 'user', content: message });

    // Limitar historial a los últimos 6 mensajes + prompt de sistema
    if (history.length > 7) {
      history = [history[0], ...history.slice(-6)];
    }

    // Llamar a la API de OpenAI
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo', // Modelo estándar y accesible
      messages: history,
      temperature: 0.5, // Más precisión y menos inventos
      max_tokens: 400
    });

    const reply = response.choices[0]?.message?.content?.trim() || 
                 'Disculpa, no pude procesar tu consulta.';

    // Guardar respuesta en el historial
    history.push({ role: 'assistant', content: reply });

    // Limitar historial a los últimos 6 mensajes + prompt de sistema
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
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot de WhatsApp activo\n');
}).listen(3000, '0.0.0.0', () => {
  console.log('🌐 [HTTP] Servidor dummy escuchando en 0.0.0.0:3000');
});

// Capturar promesas no manejadas
process.on('unhandledRejection', reason => {
  console.error('❌ [Error] Promesa no manejada:', reason);
});

// Manejo de señales para apagado limpio
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
    process.exit(1);
  }
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Inicializar cliente
console.log('🚀 [Iniciando] Bot de WhatsApp con GPT...');
console.log('🟢 [DEBUG] Antes de client.initialize()');
// Inicializar cliente
client.initialize().then(() => {
  console.log('🟢 [DEBUG] client.initialize() resuelto');
}).catch(err => {
  console.error('❌ [Error de inicialización]', err);
  // Reintentar después de un tiempo
  setTimeout(() => {
    console.log('🔄 Reintentando inicialización...');
    client.initialize();
  }, 30000);
});
