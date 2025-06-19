// functions-handler.js - Funciones auxiliares para clima y efemérides

// const cheerio = require('cheerio'); // No longer used by getWeather
// const fetch = require('node-fetch'); // No longer used by getWeather
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

async function getWeather() { // The async keyword can be removed if no await is used, but it's harmless.
  console.log('[getWeather] Devolviendo respuesta temporal. Fuente de datos original no disponible.');
  return `🌦️ Lo siento, el servicio de información meteorológica no está disponible en este momento. Por favor, intenta más tarde.\n\n🤖 Asistente IA\nMunicipalidad de General San Martín.`;
}

module.exports = {
  getEfemeride,
  getWeather,
  getCurrentTime
};
