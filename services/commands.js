const firestoreService = require('./firestore');

async function handleHumanTransfer(msg, userData) {
  if (msg.body.toLowerCase() === 'operador') {
    await firestoreService.updateUserData(msg.from, { ...userData, human: true });
    await msg.reply('Te paso con un operador. Cuando quieras volver a hablar con el bot, escribí "bot".');
    return true;
  }
  return false;
}

async function handleBotReturn(msg, userData) {
  if (msg.body.toLowerCase() === 'bot') {
    await firestoreService.updateUserData(msg.from, { ...userData, human: false });
    await msg.reply('Volviste con el bot 🤖. ¿En qué puedo ayudarte?');
    return true;
  }
  return false;
}

module.exports = {
  handleHumanTransfer,
  handleBotReturn,
};