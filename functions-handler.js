// functions-handler.js - Funciones auxiliares para clima y efemérides

const axios = require('axios');
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

  return `🕒 Son las ${horaFormateada} del ${fechaFormateada}.\n\n🤖 Asistente IA\nMunicipalidad de General San Martín.`;
}

function getEfemeride() {
  const today = getCurrentDate();
  const evento = efemerides[today];
  if (evento) {
    return `📅 ${evento}

🤖 Asistente IA
Municipalidad de General San Martín.`;
  } else {
    return `📅 Hoy no hay efemérides destacadas registradas.

🤖 Asistente IA
Municipalidad de General San Martín.`;
  }
}

async function getWeather() {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  const lat = -33.0819;
  const lon = -68.4692;

  try {
    const response = await axios.get("https://api.openweathermap.org/data/3.0/onecall", {
      params: {
        lat,
        lon,
        appid: apiKey,
        units: "metric",
        lang: "es"
      }
    });

    const current = response.data.current;
    const temp = current.temp;
    const description = current.weather[0].description;

    return `🌤️ En San Martín (Mendoza), la temperatura actual es de ${temp}°C, con ${description}.\n\n🤖 Asistente IA\nMunicipalidad de General San Martín.`;

  } catch (error) {
    console.error("❌ Error al obtener el clima desde One Call API 3.0:", error.response?.data || error.message);
    return `⚠️ No pude obtener el clima actual desde OpenWeather. Verificá tu clave o conexión.\n\n🤖 Asistente IA\nMunicipalidad de General San Martín.`;
  }
}

module.exports = {
  getEfemeride,
  getWeather,
  getCurrentTime
};