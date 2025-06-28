const fs = require('fs');
const { pipeline } = require('stream');
const { promisify } = require('util');

const streamPipeline = promisify(pipeline);

/**
 * Convierte texto en un archivo de audio usando Google TTS.
 * @param {string} text Texto a convertir.
 * @param {string} [lang='es'] Idioma, por defecto espa\u00f1ol.
 * @param {string} outFile Ruta del archivo mp3 de salida.
 * @returns {Promise<string>} Ruta generada.
 */
async function textToSpeech(text, lang = 'es', outFile = 'tts-output.mp3') {
  const query = new URLSearchParams({
    ie: 'UTF-8',
    q: text,
    tl: lang,
    client: 'tw-ob'
  });

  const res = await fetch(`https://translate.google.com/translate_tts?${query.toString()}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });

  if (!res.ok) {
    throw new Error(`TTS request failed: ${res.status}`);
  }

  await streamPipeline(res.body, fs.createWriteStream(outFile));
  return outFile;
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

'Content-Type': 'audio/mpeg'
    },
    body: stream
  });


if (!res.ok) {
  const errorBody = await res.text();
  throw new Error(`Wit.ai error ${res.status}: ${errorBody}`);
}

  const data = await res.json();
  return data.text || '';
}

module.exports = { textToSpeech, speechToText };
