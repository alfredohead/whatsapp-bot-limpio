const cheerio = require('cheerio');
const fetch = require('node-fetch');

async function getEfemerides() {
  try {
    const res = await fetch('https://www.efemeridesargentina.com.ar/');
    const html = await res.text();
    const $ = cheerio.load(html);
    let efemerides = [];

    $('ul.list-efemerides li').each((i, el) => {
      const texto = $(el).text().trim();
      if (texto.length > 0) efemerides.push(`✅ ${texto}`);
    });

    if (efemerides.length === 0) {
      return 'No se encontraron efemérides para hoy. 🌤️';
    }

    return `📅 *Efemérides del día:*

${efemerides.slice(0, 10).join('\n')}`;
  } catch (err) {
    console.error("Error al obtener efemérides:", err);
    return "Lo siento, no pude obtener las efemérides en este momento.";
  }
}

module.exports = {
  getEfemerides
};