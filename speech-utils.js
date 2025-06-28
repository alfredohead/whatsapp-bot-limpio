const fs = require('fs');
const gTTS = require('gtts');

/**
 * Convierte texto en un archivo de audio usando Google TTS.
 * @param {string} text Texto a convertir.
 * @param {string} [lang='es'] Idioma, por defecto espa\u00f1ol.
 * @param {string} outFile Ruta del archivo mp3 de salida.
 * @returns {Promise<string>} Ruta generada.
 */
function textToSpeech(text, lang = 'es', outFile = 'tts-output.mp3') {
  return new Promise((resolve, reject) => {
    const tts = new gTTS(text, lang);
    tts.save(outFile, err => {
      if (err) return reject(err);
      resolve(outFile);
    });
  });
}

/**
 * Transcribe un archivo de audio usando la API de Wit.ai.
 * Requiere la variable de entorno WITAI_TOKEN.
 * @param {string} audioFile Ruta del archivo de audio (wav/mp3).
 * @returns {Promise<string>} Texto transcripto.
 */
async function speechToText(audioFile) {
  const token = process.env.WITAI_TOKEN;
  if (!token) throw new Error('WITAI_TOKEN no definido');

  const stream = fs.createReadStream(audioFile);
  const res = await fetch('https://api.wit.ai/speech?v=20230215', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'audio/mpeg3'
    },
    body: stream
  });

  if (!res.ok) {
    throw new Error(`Wit.ai error ${res.status}`);
  }
  const data = await res.json();
  return data.text || '';
}

module.exports = { textToSpeech, speechToText };
