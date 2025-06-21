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
  const apiKey = process.env.ACCUWEATHER_API_KEY;
  const locationKey = '7880_AR'; // San Martín, Mendoza

  try {
    const response = await axios.get(`http://dataservice.accuweather.com/currentconditions/v1/${locationKey}`, {
      params: {
        apikey: apiKey,
        language: 'es-ar',
        details: true
      }
    });

    const data = response.data[0];
    const temp = data.Temperature.Metric.Value;
    const desc = data.WeatherText;

    return `🌤️ En San Martín (Mendoza), la temperatura actual es de ${temp}°C, con ${desc.toLowerCase()}.\n\n🤖 Asistente IA\nMunicipalidad de General San Martín.`;

  } catch (error) {
    console.error("❌ Error al obtener el clima desde AccuWeather:", error.response?.data || error.message);
    return `⚠️ No pude obtener el clima actual. Verificá la conexión o la clave API.\n\n🤖 Asistente IA\nMunicipalidad de General San Martín.`;
  }
}

module.exports = {
  getEfemeride,
  getWeather,
  getCurrentTime
};