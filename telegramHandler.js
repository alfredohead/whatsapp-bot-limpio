const TelegramBot = require('node-telegram-bot-api');

// Solo carga .env si estás en desarrollo local
if (!process.env.FLY_APP_NAME) {
  require('dotenv').config();
}

const token = process.env.TELEGRAM_TOKEN;

if (!token) {
  console.error('❌ TELEGRAM_TOKEN no definido en process.env');
  process.exit(1);
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
  if (!msg.text.startsWith('/start')) {
    bot.sendMessage(chatId, '📩 Recibido. Pronto responderé con más información.');
  }
});
