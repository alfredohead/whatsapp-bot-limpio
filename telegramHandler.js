// telegramHandler.js
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const { sendToAssistant } = require('./messageHandler');
const { handleMediaFromTelegram } = require('./telegram-media');
const { hasGreeted, setGreeted } = require('./utils/storage');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
if (!TELEGRAM_TOKEN) {
  console.error('❌ Falta TELEGRAM_TOKEN en .env');
  process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

console.log('✅ Bot de Telegram iniciado');

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = `tg_${chatId}`;
  const { text, photo, video, voice, document } = msg;

  try {
    if (text) {
      const lower = text.trim().toLowerCase();

      if (!hasGreeted(userId)) {
        const bienvenida = `¡Hola! 👋 Soy tu asistente virtual de la Municipalidad de General San Martín. Estoy acá para ayudarte con información sobre cursos, programas, turnos y más. 📲`;
        await bot.sendMessage(chatId, `${bienvenida}

— Municipalidad de General San Martín 🏛️`);
        setGreeted(userId);
      }

      if (lower === 'bot') {
        const mensaje = `🤖 El asistente virtual ha sido reactivado. ¿En qué puedo ayudarte?`;
        return await bot.sendMessage(chatId, `${mensaje}

— Municipalidad de General San Martín 🏛️`);
      }

      if (lower === 'operador') {
        const mensaje = `👤 Has sido derivado a un operador humano. Pronto recibirás una respuesta.`;
        return await bot.sendMessage(chatId, `${mensaje}

— Municipalidad de General San Martín 🏛️`);
      }

      const respuesta = await sendToAssistant(userId, text);
      const respuestaFinal = `${respuesta.trim()}

— Municipalidad de General San Martín 🏛️`;
      return await bot.sendMessage(chatId, respuestaFinal);
    }

    if (photo || video || voice || document) {
      return await handleMediaFromTelegram(bot, msg, userId);
    }

    await bot.sendMessage(chatId, `⚠️ Solo se admiten texto, imagen, video, audio o documentos.

— Municipalidad de General San Martín 🏛️`);
  } catch (err) {
    console.error('❌ Error en mensaje de Telegram:', err);
    await bot.sendMessage(chatId, '❌ Hubo un error procesando tu mensaje.

— Municipalidad de General San Martín 🏛️');
  }
});
