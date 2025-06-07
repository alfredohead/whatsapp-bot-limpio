// index.js optimizado para WhatsApp + OpenAI / Dialogflow con control de errores y sin grupos

const { Client, LocalAuth } = require('whatsapp-web.js'); const qrcode = require('qrcode-terminal'); const OpenAI = require('openai'); require('dotenv').config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const client = new Client({ authStrategy: new LocalAuth() });

client.on('qr', (qr) => { qrcode.generate(qr, { small: true }); });

client.on('ready', () => { console.log('✅ Bot listo. Conectado a WhatsApp.'); });

client.on('message', async (message) => { try { // Filtrar mensajes enviados por el bot, vacíos o de grupo if (message.fromMe || !message.body || message.body.length < 1) return; if (message.isGroupMsg || message.from.includes('@g.us')) return;

const input = message.body.trim();

// Comando: reactivar bot
if (input.toLowerCase() === 'bot') {
  await message.reply('🤖 ¡Bot reactivado! ¿En qué puedo ayudarte hoy?');
  return;
}

// Comando: derivar a humano
if (input.toLowerCase() === 'operador') {
  await message.reply('👩‍💼 Te conecto con un operador humano. También podés escribir a:

📞 Tel: 2634 259 744 📧 Email: programas.nacion@sanmartinmza.gob.ar'); return; }

// Procesar con OpenAI
const completion = await openai.chat.completions.create({
  model: 'gpt-3.5-turbo',
  messages: [
    { role: 'system', content: process.env.SYSTEM_PROMPT },
    { role: 'user', content: input }
  ],
  temperature: 0.4,
});

const respuesta = completion.choices[0].message.content;

await message.reply(`${respuesta}

🤖 Asistente IA - Municipalidad San Martín`); } catch (err) { console.error('❌ Error en procesamiento:', err); await message.reply('⚠️ Ocurrió un error al procesar tu mensaje. Por favor, intentá nuevamente más tarde.'); } });

client.initialize();

