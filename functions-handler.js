
require('dotenv').config();
const fs = require('fs');
const fetch = require('node-fetch');
const path = require('path');

function obtenerFechaHoy() {
  const hoy = new Date();
  const mes = String(hoy.getMonth() + 1).padStart(2, '0');
  const dia = String(hoy.getDate()).padStart(2, '0');
  return `${mes}-${dia}`;
}

function fetchEfemerideLocal() {
  try {
    const ruta = path.join(__dirname, 'efemerides.json');
    const contenido = fs.readFileSync(ruta, 'utf8');
    const efemerides = JSON.parse(contenido);
    const clave = obtenerFechaHoy();
    return efemerides[clave] || "🎖️ No hay efemérides registradas para hoy.";
  } catch (err) {
    return "⚠️ No se pudo leer el archivo de efemérides.";
  }
}

async function fetchClima(ubicacion = "San Martín, Mendoza") {
  try {
    const apiKey = process.env.OPENWEATHER_KEY;
    const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(ubicacion)}&units=metric&lang=es&appid=${apiKey}`);
    const data = await res.json();
    const temp = data.main.temp;
    const desc = data.weather[0].description;
    const humedad = data.main.humidity;
    return `🌡️ ${temp}°C, ${desc}, 💧 Humedad: ${humedad}%`;
  } catch (err) {
    return "⚠️ No se pudo obtener el clima actual.";
  }
}

async function enviarRespuestaFuncion(nombre, contenido, threadId, openai) {
  return await openai.beta.threads.messages.create(threadId, {
    role: "function",
    name: nombre,
    content: contenido
  });
}

module.exports = {
  fetchEfemeride: fetchEfemerideLocal,
  fetchClima,
  enviarRespuestaFuncion
};
