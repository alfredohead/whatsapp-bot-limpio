import dialogflow from '@google-cloud/dialogflow';

const sessionClient = new dialogflow.SessionsClient();
const projectId = process.env.GOOGLE_CLOUD_PROJECT;

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