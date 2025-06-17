// index.js - Bot de WhatsApp conectado a Assistant OpenAI
require('dotenv').config();
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const app = express();

// Configurar el servidor Express
app.get('/', (req, res) => {
    res.send('WhatsApp Bot is running!');
});

// Iniciar el servidor
const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port}`);
});

// Iniciar el cliente de WhatsApp
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox']
    }
});

client.on('qr', (qr) => {
  console.log('🔷 Escanea el siguiente QR para iniciar sesión:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ Bot de WhatsApp conectado correctamente.');
});

client.on('message', async (msg) => {
  if (msg.from.includes('@g.us')) return;  // Ignora grupos
  if (msg.type === 'status') return;       // Ignora estados

  const body = msg.body.toLowerCase().trim();

  if (body.includes('efeméride')) {
    const efem = getEfemeride();
    client.sendMessage(msg.from, `📅 ${efem}`);
    return;
  }

  if (body.includes('clima')) {
    const clima = await getWeather();
    client.sendMessage(msg.from, clima);
    return;
  }

  try {
    const threadId = `wa_${msg.from.replace(/[^a-zA-Z0-9]/g, '')}`;
    const response = await openai.beta.threads.messages.create(
      threadId,
      {
        role: 'user',
        content: msg.body
      },
      { assistant_id: ASSISTANT_ID }
    );

    const reply = response.data?.[0]?.content?.[0]?.text?.value;
    if (reply) {
      client.sendMessage(msg.from, reply);
    } else {
      client.sendMessage(msg.from, '⚠️ No entendí tu mensaje.');
    }
  } catch (err) {
    console.error('❌ Error al enviar mensaje al Assistant:', err.message);
    client.sendMessage(msg.from, '⚠️ Ocurrió un error al procesar tu mensaje.');
  }
});

client.initialize();