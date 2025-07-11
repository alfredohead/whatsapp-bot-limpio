// functions-handler.js - Funciones auxiliares para clima y efemérides
const axios = require('axios');
const { procesarConAssistant, obtenerOCrearThread } = require('./index');
const efemerides = require('./efemerides.json');

function getCurrentDate() {
  const now = new Date();
  const day = now.getDate().toString().padStart(2, '0');
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  return `${day}-${month}`;
}

function getCurrentTime() {
  const now = new Date();
  const optionsDate = {
    timeZone: 'America/Argentina/Mendoza',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  };
  const fechaFormateada = now.toLocaleDateString('es-AR', optionsDate);

  const optionsTime = {
    timeZone: 'America/Argentina/Mendoza',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  };
  const horaFormateada = now.toLocaleTimeString('es-AR', optionsTime);

  return `🕒 Son las ${horaFormateada} del ${fechaFormateada}${BOT_SIGNATURE}`;
}

function getEfemeride() {
  const today = getCurrentDate();
  const evento = efemerides[today];
  if (evento) {
    return `📅 ${evento}\n\n🤖 Asistente IA\nMunicipalidad de General San Martín.`;
  } else {
    return `📅 Hoy no hay efemérides destacadas registradas.\n\n🤖 Asistente IA\nMunicipalidad de General San Martín.`;
  }
}

async function getWeather() {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  const lat = SAN_MARTIN_LAT;
  const lon = SAN_MARTIN_LON;

  try {
    const response = await axios.get('https://api.openweathermap.org/data/2.5/weather', {
      params: {
        lat,
        lon,
        appid: apiKey,
        units: 'metric',
        lang: 'es'
      }
    });

    const data = response.data;
    const temp = data.main?.temp;
    const desc = data.weather?.[0]?.description;

    return `🌤️ En San Martín (Mendoza), la temperatura actual es de ${temp}°C, con ${desc}.\n\n🤖 Asistente IA\nMunicipalidad de General San Martín.`;

  } catch (error) {
    console.error('❌ Error al obtener el clima:', error.response?.data || error.message);
    return `⚠️ No pude obtener el clima actual. Verificá tu clave o conexión.\n\n🤖 Asistente IA\nMunicipalidad de General San Martín.`;
  }
}

async function sendToAssistant(userId, text) {
  try {
    const message = {
      from: userId,
      body: text
    };
    const respuesta = await procesarConAssistant(message, await obtenerOCrearThread(userId));
    return respuesta;
  } catch (error) {
    console.error('❌ [ERROR-sendToAssistant]', error);
    return '❌ Ocurrió un error al procesar tu mensaje. Por favor, intenta nuevamente.';
  }
}

module.exports = {
  getEfemeride,
  getWeather,
  getCurrentTime,
  sendToAssistant
};
