// index.js – Versión final del bot de WhatsApp con funciones completas

require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { OpenAI } = require('openai');
const { getWeather, getEfemeride } = require('./functions-handler');

const SESSION_PATH = './session';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: SESSION_PATH }),
  puppeteer: {
    headless: true,
    executablePath: '/usr/bin/chromium', // O process.env.PUPPETEER_EXECUTABLE_PATH si se prefiere y está configurado en Dockerfile
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu'
      // Considerar '--single-process' solo si hay problemas de recursos extremos,
      // pero puede tener otros efectos secundarios. Por ahora, lo omitimos.
    ],
    dumpio: true // Añadir esta línea
  }
});

client.on('qr', (qr) => {
  console.log('🔹 Escanea este QR para iniciar sesión:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ Bot listo y conectado.');
});

client.on('message', async (msg) => {
  const { from, body, type, isStatus, isGroupMsg } = msg;

  // Ignorar mensajes de estados o grupos
  if (isStatus || from.endsWith('@g.us')) return;

  // Log básico
  console.log(`[📩] Mensaje de ${from}:`, body);

  try {
    const texto = body.toLowerCase();

    // Comando especial: Clima
    if (texto.includes('clima')) {
      const clima = await getWeather();
      return msg.reply(clima);
    }

    // Comando especial: Efemérides
    if (texto.includes('efeméride') || texto.includes('efemeride') || texto.includes('pasó un día como hoy')) {
      const info = getEfemeride();
      return msg.reply(info);
    }

    // Respuesta general con asistente OpenAI
    const respuesta = await openai.beta.threads.createAndRun({
      assistant_id: ASSISTANT_ID,
      thread: { messages: [{ role: 'user', content: body }] },
    });

    const partes = respuesta?.data?.latest_run?.step_details?.tool_calls;
    const content = partes?.[0]?.output?.text ?? '🤖 Lo siento, no tengo una respuesta clara en este momento.';

    return msg.reply(`${content}

🤖 Asistente Virtual
Municipalidad de General San Martín.`);
  } catch (error) {
    console.error('❌ Error:', error.message);
    return msg.reply('⚠️ Hubo un error procesando tu mensaje. Intenta nuevamente más tarde.');
  }
});

client.initialize();
