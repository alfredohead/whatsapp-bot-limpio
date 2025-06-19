// functions-handler.js - Funciones auxiliares para clima y efemérides

const cheerio = require('cheerio');
const efemerides = require('./efemerides.json');

function getCurrentDate() {
  const now = new Date();
  const day = now.getDate().toString().padStart(2, '0');
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  return `${day}-${month}`;
}

// NUEVA FUNCIÓN
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

async function getWeather() {
  try {
    const res = await fetch('https://www.tiempo.com/san-martin_mendoza.htm');
    const html = await res.text();
    const $ = cheerio.load(html);

    const temperatura = $('.datos-actual .dato-temperatura').text().trim();
    const estado = $('.datos-actual .estado').text().trim();

    if (temperatura && estado) {
      return `🌤️ El clima actual en San Martín, Mendoza es: ${estado}, ${temperatura}

🤖 Asistente IA
Municipalidad de General San Martín.`;
    } else {
      return `🌥️ No se pudo obtener el clima actual en este momento.

🤖 Asistente IA
Municipalidad de General San Martín.`;
    }
  } catch (e) {
    console.error('Error al obtener clima:', e.stack); // Mantengo e.stack de una modificación anterior
    return `⚠️ No se pudo obtener el clima actual.

🤖 Asistente IA
Municipalidad de General San Martín.`;
  }
}

module.exports = {
  getEfemeride,
  getWeather,
  getCurrentTime // AÑADIR A EXPORTS
};
