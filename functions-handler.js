// functions-handler.js - Funciones auxiliares para clima y efemérides

// TODO: Uncomment cheerio and restore its usage when live weather data fetching in getWeather is reinstated.
// const cheerio = require('cheerio'); // No longer used by getWeather
// TODO: Uncomment node-fetch and restore its usage when live weather data fetching in getWeather is reinstated.
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
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0'); // Los meses son 0-indexados
  const year = now.getFullYear();

  return `🕒 Son las ${hours}:${minutes} del ${day}/${month}/${year}.\n\n🤖 Asistente IA\nMunicipalidad de General San Martín.`;
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
  // TODO: Restore live weather fetching. Original data source (tiempo.com) was unavailable. Consider tracking with an issue ID if applicable.
  console.log('[getWeather] Devolviendo respuesta temporal. Fuente de datos original no disponible.');
  return `🌦️ Lo siento, el servicio de información meteorológica no está disponible en este momento. Por favor, intenta más tarde.\n\n🤖 Asistente IA\nMunicipalidad de General San Martín.`;
}

module.exports = {
  getEfemeride,
  getWeather,
  getCurrentTime
};
