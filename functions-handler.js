// functions-handler.js
const { procesarConAssistant } = require('./index'); // o al archivo donde realmente esté

async function sendToAssistant(userId, text) {
  try {
    const message = {
      from: userId,
      body: text
    };
    // Llamamos la lógica ya existente
    const respuesta = await procesarConAssistant(message, await obtenerOCrearThread(userId));
    return respuesta;
  } catch (error) {
    console.error("❌ [ERROR-sendToAssistant]", error);
    return "❌ Ocurrió un error al procesar tu mensaje. Por favor, intenta nuevamente.";
  }
}

module.exports = { sendToAssistant };
