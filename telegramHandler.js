const TelegramBot = require('node-telegram-bot-api');

// Solo carga .env si estás en desarrollo local
if (!process.env.FLY_APP_NAME) {
  require('dotenv').config();
}

const token = process.env.TELEGRAM_TOKEN;

if (!token) {
  console.error('❌ TELEGRAM_TOKEN no definido en process.env');
  process.exit(1);
} else {
  // Log a portion of the token to verify it's loaded, without exposing the whole token.
  const tokenPreview = `${token.substring(0, 5)}...${token.substring(token.length - 5)}`;
  console.log(`✅ TELEGRAM_TOKEN cargado correctamente. Preview: ${tokenPreview}`);
}

const bot = new TelegramBot(token, { polling: true });

console.log('✅ Bot de Telegram iniciado correctamente.');

// Comando /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '👋 ¡Hola! Soy el bot de la Municipalidad de San Martín por Telegram.');
});

// Cualquier mensaje
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  console.log(`[Telegram] Mensaje recibido de ${chatId}:`, JSON.stringify(msg, null, 2));

  // Asegurarse de que msg.text exista y sea un string antes de usar startsWith
  const messageText = msg.text || "";

  if (msg.text && typeof msg.text === 'string' && msg.text.startsWith('/start')) {
    // El comando /start ya tiene su propio handler: bot.onText(/\/start/, ...)
    // No es necesario hacer nada aquí a menos que quieras un comportamiento adicional.
    console.log(`[Telegram] Comando /start detectado y manejado por su propio listener para ${chatId}.`);
  } else {
    // Para todos los demás mensajes (incluyendo los que no son de texto o están vacíos después del /start)
    console.log(`[Telegram] Procesando mensaje general de ${chatId}. Texto: "${messageText}"`);
    try {
      bot.sendMessage(chatId, '📩 Recibido. Gracias por tu mensaje. Estoy procesándolo.');
      console.log(`[Telegram] Mensaje de acuse de recibo enviado a ${chatId}.`);
    } catch (error) {
      console.error(`[Telegram] Error al enviar mensaje de acuse de recibo a ${chatId}:`, error);
    }
  }
});
