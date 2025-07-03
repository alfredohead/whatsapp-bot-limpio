// telegram-media.js
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { sendToAssistant } = require('./functions-handler');

async function handleMediaFromTelegram(bot, msg, userId) {
  const chatId = msg.chat.id;
  let fileId, fileType;

  if (msg.photo) {
    fileId = msg.photo[msg.photo.length - 1].file_id;
    fileType = 'jpg';
  } else if (msg.video) {
    fileId = msg.video.file_id;
    fileType = 'mp4';
  } else if (msg.voice) {
    fileId = msg.voice.file_id;
    fileType = 'ogg';
  } else if (msg.document) {
    fileId = msg.document.file_id;
    fileType = msg.document.file_name.split('.').pop();
  } else {
    return bot.sendMessage(chatId, `⚠️ No se pudo procesar este archivo.

— Municipalidad de General San Martín 🏛️`);
  }

  try {
    const file = await bot.getFile(fileId);
    const url = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${file.file_path}`;
    const tempDir = path.join(__dirname, 'temp');
    const tempFile = path.join(tempDir, `${userId}.${fileType}`);

    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

    const response = await axios({ url, responseType: 'stream' });
    const writer = fs.createWriteStream(tempFile);
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    const respuesta = await sendToAssistant(userId, tempFile);
    const respuestaFinal = `${respuesta.trim()}

— Municipalidad de General San Martín 🏛️`;
    await bot.sendMessage(chatId, respuestaFinal);

    fs.unlinkSync(tempFile);
  } catch (err) {
    console.error('❌ Error procesando media Telegram:', err);
    await bot.sendMessage(chatId, `❌ No se pudo procesar el archivo.

— Municipalidad de General San Martín 🏛️`);
  }
}

module.exports = { handleMediaFromTelegram };
