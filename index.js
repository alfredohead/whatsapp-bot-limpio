
require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { OpenAI } = require('openai');
const { fetchEfemeride, fetchClima, enviarRespuestaFuncion } = require('./functions-handler');

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { headless: true }
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;

client.on('qr', (qr) => qrcode.generate(qr, { small: true }));

client.on('ready', () => {
  console.log('🟢 WhatsApp conectado');
});

client.on('message', async (message) => {
  try {
    const numero = message.from;
    const texto = message.body;

    const thread = await openai.beta.threads.create();
    const threadId = thread.id;

    await openai.beta.threads.messages.create(threadId, {
      role: 'user',
      content: texto
    });

    const respuesta = await openai.beta.threads.runs.createAndPoll(threadId, {
      assistant_id: ASSISTANT_ID,
      instructions: "Responder como asistente virtual de la Municipalidad de San Martín con acceso contextual."
    });

    if (respuesta?.status === "requires_action" && respuesta.required_action?.type === "submit_tool_outputs") {
      const llamada = respuesta.required_action.submit_tool_outputs.tool_calls[0];
      const args = JSON.parse(llamada.function.arguments);
      let resultado = "";

      if (llamada.function.name === 'get_efemeride') {
        resultado = await fetchEfemeride(args.fecha);
      }

      if (llamada.function.name === 'get_clima_actual') {
        resultado = await fetchClima(args.ubicacion);
      }

      await enviarRespuestaFuncion(
        llamada.function.name,
        resultado,
        threadId,
        openai
      );

      const final = await openai.beta.threads.runs.createAndPoll(threadId, {
        assistant_id: ASSISTANT_ID
      });

      const mensajesFinales = await openai.beta.threads.messages.list(threadId);
      const ultimo = mensajesFinales.data.find(m => m.role === 'assistant');
      const textoFinal = ultimo?.content?.[0]?.text?.value || resultado;
      client.sendMessage(numero, textoFinal);
      return;
    }

    const mensajes = await openai.beta.threads.messages.list(threadId);
    const ultimo = mensajes.data.find(m => m.role === 'assistant');
    const textoFinal = ultimo?.content?.[0]?.text?.value || "No se pudo obtener respuesta.";
    client.sendMessage(numero, textoFinal);
  } catch (err) {
    console.error("❌ Error:", err);
    client.sendMessage(message.from, "Ocurrió un error al procesar tu consulta. Intentá nuevamente más tarde.");
  }
});

client.initialize();
