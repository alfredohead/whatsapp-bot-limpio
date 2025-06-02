// Versión ultra-minimalista con configuración optimizada para Fly.io
require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// Configuración de Dialogflow (integrado directamente)
const dialogflow = require('@google-cloud/dialogflow');
let sessionClient;
let projectId;

try {
  const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || '{}');
  projectId = GOOGLE_CREDENTIALS.project_id;
  sessionClient = new dialogflow.SessionsClient({ credentials: GOOGLE_CREDENTIALS });
  console.log('✅ [Dialogflow] Configurado correctamente');
} catch (error) {
  console.error('❌ [Dialogflow] Error de configuración:', error);
}

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
  authStrategy: new LocalAuth({ dataPath: './session' }),
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

// Función para enviar texto a Dialogflow
async function sendTextToDialogflow(userId, messageText) {
  if (!sessionClient || !projectId) {
    throw new Error('Dialogflow no está configurado correctamente');
  }

  const sessionPath = sessionClient.projectAgentSessionPath(projectId, userId);
  const request = {
    session: sessionPath,
    queryInput: {
      text: {
        text: messageText,
        languageCode: 'es',
      },
    }
  };

  try {
    const responses = await sessionClient.detectIntent(request);
    const result = responses[0].queryResult;
    const replyText = result.fulfillmentText || 'No entendí eso. ¿Podés repetirlo?';
    return { replyText, isFallback: result.intent.isFallback };
  } catch (error) {
    console.error('❌ [Dialogflow] Error:', error);
    throw error;
  }
}

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
    
    // Primero intentar con Dialogflow
    try {
      const { replyText, isFallback } = await sendTextToDialogflow(userId, incoming);
      
      // Si Dialogflow devuelve una respuesta válida (no es un fallback)
      if (!isFallback) {
        // Resetear contador de intentos fallidos si hubo éxito
        if (failedAttempts > 0) {
          userFailedAttempts.set(userId, 0);
        }
        
        await msg.reply(replyText);
        console.log(`📤 [Respuesta Dialogflow] ${userId}: ${replyText}`);
        return;
      }
      
      // Si llegamos aquí, Dialogflow no entendió la consulta
      console.log(`⚠️ [Dialogflow] No entendió la consulta: ${incoming}`);
      
      // Incrementar contador de intentos fallidos
      failedAttempts++;
      userFailedAttempts.set(userId, failedAttempts);
      
      // Si hay demasiados intentos fallidos, sugerir hablar con un humano
      if (failedAttempts >= 3) {
        await msg.reply('Parece que estoy teniendo dificultades para entender tu consulta. ¿Te gustaría hablar con un operador humano? Escribe "operador" para ser derivado.');
        return;
      }
      
      // Intentar con GPT como fallback
      if (openai) {
        const reply = await responderConGPT(userId, incoming);
        await msg.reply(reply);
        console.log(`📤 [Respuesta GPT] ${userId}: ${reply}`);
      } else {
        // Si no hay OpenAI configurado, usar respuesta de fallback de Dialogflow
        await msg.reply(replyText);
      }
    } catch (dialogflowError) {
      console.error('❌ [Error Dialogflow]', dialogflowError);
      
      // Si falla Dialogflow y tenemos OpenAI, intentar con GPT
      if (openai) {
        const reply = await responderConGPT(userId, incoming);
        await msg.reply(reply);
        console.log(`📤 [Respuesta GPT (fallback)] ${userId}: ${reply}`);
      } else {
        // Si no hay OpenAI, enviar mensaje de error genérico
        await msg.reply('Lo siento, estamos experimentando dificultades técnicas. Por favor, intenta más tarde o escribe "operador" para hablar con una persona.');
      }
    }
  } catch (error) {
    console.error('❌ [Error General]', error);
    await msg.reply('Lo siento, ocurrió un error. Por favor, intenta más tarde o escribe "operador" para hablar con una persona.');
  }
});

// Capturar promesas no manejadas
process.on('unhandledRejection', reason => {
  console.error('❌ [Error] Promesa no manejada:', reason);
});

// Inicializar cliente
console.log('🚀 [Iniciando] Bot de WhatsApp con Dialogflow y GPT...');
client.initialize().catch(err => {
  console.error('❌ [Error de inicialización]', err);
  // Reintentar después de un tiempo
  setTimeout(() => {
    console.log('🔄 Reintentando inicialización...');
    client.initialize();
  }, 30000);
});
