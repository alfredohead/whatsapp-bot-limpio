// Módulo para integrar OpenAI GPT como fallback para Dialogflow
const { OpenAI } = require('openai');

// Configuración de OpenAI
let openai;
try {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    console.log('✅ [OpenAI] API configurada correctamente');
  } else {
    console.warn('⚠️ [OpenAI] API no configurada. El fallback a GPT no estará disponible.');
  }
} catch (error) {
  console.error('❌ [OpenAI] Error al configurar API:', error);
}

// Mapa para historiales de chat con GPT
const chatHistories = new Map();

// Mensaje del sistema personalizado para GPT
const SYSTEM_PROMPT = `Eres un asistente virtual de la Municipalidad de San Martín. Atiendes consultas ciudadanas relacionadas con distintas áreas:

- Economía Social y Asociativismo
- Punto Digital
- Incubadora de Empresas
- Escuela de Oficios Manuel Belgrano
- Programas Nacionales
- Trámites y contacto general con el municipio

Responde en español con un lenguaje claro, humano y accesible. Usa emojis ocasionalmente para hacer la conversación más amigable.`;

/**
 * Responde a un mensaje usando GPT cuando Dialogflow no puede entender la consulta
 * @param {string} userId - ID del usuario (número de WhatsApp)
 * @param {string} message - Mensaje del usuario
 * @param {Object} dialogflowData - Datos de contexto de Dialogflow
 * @returns {Promise<string>} - Respuesta generada por GPT
 */
async function responderConGPT(userId, message, dialogflowData = {}) {
  if (!openai) {
    return 'Lo siento, el servicio de asistencia avanzada no está disponible en este momento. Por favor, intenta con una consulta más específica o escribe "operador" para hablar con una persona.';
  }

  try {
    // Obtener o inicializar historial de chat
    let history = chatHistories.get(userId) || [];
    if (history.length === 0) {
      history.push({ role: 'system', content: SYSTEM_PROMPT });
    }

    // Añadir contexto de Dialogflow si está disponible
    if (dialogflowData && Object.keys(dialogflowData).length > 0) {
      const contextInfo = `Contexto de la conversación: ${JSON.stringify(dialogflowData)}`;
      history.push({ role: 'system', content: contextInfo });
    }

    // Añadir el mensaje del usuario
    history.push({ role: 'user', content: message });

    // Llamar a la API de OpenAI
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: history,
      temperature: 0.7,
      max_tokens: 500
    });

    const reply = response.choices[0]?.message?.content?.trim() || 
                 'Disculpa, no pude procesar tu consulta.';

    // Guardar respuesta en el historial
    history.push({ role: 'assistant', content: reply });

    // Limitar el tamaño del historial para evitar tokens excesivos
    if (history.length > 12) {
      history = [history[0], ...history.slice(-11)];
    }
    chatHistories.set(userId, history);

    return reply;
  } catch (error) {
    console.error('❌ [Error GPT]', error);
    return 'Lo siento, ocurrió un error al procesar tu consulta. Por favor, intenta más tarde o escribe "operador" para hablar con una persona.';
  }
}

/**
 * Responde usando un asistente específico de OpenAI
 * @param {string} userId - ID del usuario (número de WhatsApp)
 * @param {string} message - Mensaje del usuario
 * @param {Object} dialogflowData - Datos de contexto de Dialogflow
 * @returns {Promise<string>} - Respuesta generada por el asistente específico
 */
async function responderConAsistenteEspecifico(userId, message, dialogflowData = {}) {
  if (!openai) {
    return 'Lo siento, el servicio de asistencia avanzada no está disponible en este momento.';
  }

  try {
    // ID del asistente específico (reemplazar con el ID real)
    const assistantId = process.env.OPENAI_ASSISTANT_ID || 'g-682b9d0a319c81919fc3c444a8b25f3d';
    
    // Crear o recuperar un thread para el usuario
    let threadId = await getThreadForUser(userId);
    if (!threadId) {
      const thread = await openai.beta.threads.create();
      threadId = thread.id;
      // Guardar el threadId para este usuario
      saveThreadForUser(userId, threadId);
    }

    // Añadir el mensaje del usuario al thread
    await openai.beta.threads.messages.create(threadId, {
      role: 'user',
      content: message
    });

    // Ejecutar el asistente
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId
    });

    // Esperar a que termine la ejecución
    let runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
    
    // Esperar hasta que el run esté completo (con timeout)
    const startTime = Date.now();
    const timeout = 30000; // 30 segundos máximo
    
    while (runStatus.status !== 'completed' && runStatus.status !== 'failed' && 
           Date.now() - startTime < timeout) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // Esperar 1 segundo
      runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
    }

    if (runStatus.status !== 'completed') {
      throw new Error(`Run no completado: ${runStatus.status}`);
    }

    // Obtener los mensajes del thread
    const messages = await openai.beta.threads.messages.list(threadId);
    
    // Obtener la última respuesta del asistente
    const assistantMessages = messages.data.filter(msg => msg.role === 'assistant');
    if (assistantMessages.length === 0) {
      throw new Error('No se encontró respuesta del asistente');
    }
    
    const latestMessage = assistantMessages[0];
    let reply = '';
    
    // Extraer el texto de la respuesta
    if (latestMessage.content && latestMessage.content.length > 0) {
      for (const content of latestMessage.content) {
        if (content.type === 'text') {
          reply += content.text.value;
        }
      }
    }

    return reply || 'No pude generar una respuesta.';
  } catch (error) {
    console.error('❌ [Error Asistente Específico]', error);
    return 'Lo siento, ocurrió un error al procesar tu consulta con el asistente especializado.';
  }
}

// Funciones auxiliares para manejar threads de usuarios
const userThreads = new Map();

async function getThreadForUser(userId) {
  return userThreads.get(userId);
}

function saveThreadForUser(userId, threadId) {
  userThreads.set(userId, threadId);
}

module.exports = {
  responderConGPT,
  responderConAsistenteEspecifico
};
