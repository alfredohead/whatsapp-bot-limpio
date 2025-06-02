import dialogflow from '@google-cloud/dialogflow';

const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
const sessionClient = new dialogflow.SessionsClient({ credentials });
const projectId = credentials.project_id;

async function sendTextToDialogflow(userId, messageText, userData = {}) {
  const sessionPath = sessionClient.projectAgentSessionPath(projectId, userId);

  const request = {
    session: sessionPath,
    queryInput: {
      text: {
        text: messageText,
        languageCode: 'es',
      },
    },
    queryParams: {
      payload: {
        data: userData,
      },
    },
  };

  try {
    const responses = await sessionClient.detectIntent(request);
    const result = responses[0].queryResult;

    const contextData = result.outputContexts?.[0]?.parameters?.fields || {};
    const replyText = result.fulfillmentText || 'No entendí eso. ¿Podés repetirlo?';

    return { replyText, contextData };
  } catch (error) {
    console.error('Error sending message to Dialogflow:', error);
    throw error;
  }
}

export default { sendTextToDialogflow };