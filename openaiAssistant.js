const { OpenAI } = require('openai');
const { getWeather, getEfemeride, getCurrentTime } = require('./functions-handler');
require('dotenv').config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;
const POLLING_INTERVAL_MS = 2000;
const MAX_POLLING_ATTEMPTS = 30;

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

async function runAssistant(userMessage) {
  let assistantResponseForUser = '🤖 Lo siento, no tengo una respuesta clara en este momento.';

  try {
    let run = await openai.beta.threads.createAndRun({
      assistant_id: ASSISTANT_ID,
      thread: { messages: [{ role: 'user', content: userMessage }] }
    });

    let pollingAttempts = 0;
    while (pollingAttempts < MAX_POLLING_ATTEMPTS) {
      if (run.status === 'completed') {
        const messagesPage = await openai.beta.threads.messages.list(run.thread_id, { limit: 5, order: 'desc' });
        const assistantMessages = messagesPage.data.filter(m => m.role === 'assistant');
        if (assistantMessages.length > 0) {
          const latestAssistantMessage = assistantMessages[0];
          const content = latestAssistantMessage.content?.[0];
          if (content?.type === 'text') {
            assistantResponseForUser = content.text.value;
          } else if (latestAssistantMessage.content?.length > 0) {
            assistantResponseForUser = '🤖 He procesado tu solicitud y tengo una respuesta compleja (no solo texto).';
          }
        } else {
          assistantResponseForUser = '🤖 El asistente procesó tu solicitud pero no generó un mensaje visible. Intenta reformular.';
        }
        break;
      } else if (run.status === 'failed') {
        assistantResponseForUser = `⚠️ Hubo un error con el asistente (Fallo: ${run.last_error?.code || 'UnknownError'}). Intenta nuevamente.`;
        break;
      } else if (run.status === 'requires_action') {
        if (run.required_action?.type === 'submit_tool_outputs') {
          const toolCalls = run.required_action.submit_tool_outputs.tool_calls;
          let toolOutputs = [];
          for (const toolCall of toolCalls) {
            let output = '';
            try {
              switch (toolCall.function.name) {
                case 'get_clima_actual':
                  output = await getWeather();
                  break;
                case 'fetchEfemeride':
                  output = getEfemeride();
                  break;
                case 'get_current_time':
                  output = getCurrentTime();
                  break;
                case 'access_web':
                  output = 'Actualmente no puedo acceder a información web externa para esta solicitud.';
                  break;
                default:
                  output = `Error: Función desconocida '${toolCall.function.name}' solicitada por el asistente.`;
              }
            } catch (err) {
              output = `Error interno al ejecutar la herramienta ${toolCall.function.name}.`;
            }
            toolOutputs.push({ tool_call_id: toolCall.id, output });
          }
          if (toolOutputs.length > 0) {
            run = await openai.beta.threads.runs.submitToolOutputs(run.thread_id, run.id, { tool_outputs: toolOutputs });
          } else {
            assistantResponseForUser = '🤖 El asistente requiere una acción que no se pudo completar.';
            break;
          }
        } else {
          assistantResponseForUser = '🤖 El asistente requiere una acción que no reconozco. Por favor, intenta de nuevo.';
          break;
        }
      } else if (['queued', 'in_progress'].includes(run.status)) {
        await new Promise(r => setTimeout(r, POLLING_INTERVAL_MS));
        run = await openai.beta.threads.runs.retrieve(run.thread_id, run.id);
      } else {
        assistantResponseForUser = `🤖 El procesamiento de tu solicitud terminó con estado: ${run.status}.`;
        break;
      }
      pollingAttempts++;
    }

    if (pollingAttempts >= MAX_POLLING_ATTEMPTS && !['completed','failed','cancelled','expired'].includes(run.status)) {
      assistantResponseForUser = `🤖 El procesamiento de tu solicitud está tardando más de lo esperado (estado final: ${run.status}). Por favor, intenta nuevamente en unos momentos.`;
    }
  } catch (openaiError) {
    let userFacingErrorMessage = '⚠️ Hubo un error al comunicarme con el asistente de IA. Intenta nuevamente más tarde.';
    if (openaiError.status) {
      if (openaiError.status === 429) {
        userFacingErrorMessage = '⚠️ Demasiadas solicitudes al asistente. Por favor, espera un momento y vuelve a intentarlo.';
      } else if (openaiError.status === 401) {
        userFacingErrorMessage = '⚠️ Problema de autenticación con el asistente. Notifica al administrador.';
      } else if (openaiError.status === 400) {
        userFacingErrorMessage = `⚠️ Tu solicitud no pudo ser procesada por el asistente (Error: ${openaiError.code || openaiError.status}). Verifica tu mensaje o intenta de forma diferente.`;
      } else if (openaiError.status >= 500) {
        userFacingErrorMessage = '⚠️ El servicio del asistente de IA está experimentando problemas. Intenta más tarde.';
      }
    }
    assistantResponseForUser = userFacingErrorMessage;
  }

  return assistantResponseForUser;
}

module.exports = { runAssistant };
