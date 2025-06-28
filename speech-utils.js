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
 * Transcribe un archivo de audio usando la API de OpenAI (Whisper).
 * @param {object} openai - Instancia del cliente de OpenAI.
 * @param {string} audioFile - Ruta del archivo de audio.
 * @returns {Promise<string>} Texto transcripto.
 */
async function speechToText(openai, audioFile) {
  if (!openai) throw new Error('Instancia de OpenAI no proporcionada');

  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioFile),
      model: "whisper-1",
    });
    return transcription.text || '';
  } catch (error) {
    console.error("Error en la transcripción con OpenAI Whisper:", error);
    // Re-lanzar el error para que sea manejado por el llamador
    throw new Error(`OpenAI Whisper error: ${error.message}`);
  }
}

module.exports = { textToSpeech, speechToText };
