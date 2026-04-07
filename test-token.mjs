// Node.js v18+ has built-in fetch. No icons used.

const WHATSAPP_ACCESS_TOKEN = 'EAAbXTPKf7yQBRPO5huFuLZBBqY7bZAB262U0uFMHzCxDQr6eVccRW6QOajAZAG0Cp5t9Os1keuHjOcAjpZBw8EuVjnZA0QnFo8fDT0ZCeUtwJfgHLGz6erzlY89aiRTktmd7SoGcPb8248ZBKZBmPGZAaVfZAPsEVm5N5x4ln8FhjpSIgV2031ZCQBytzRgfaHrmwZDZD';
const PHONE_NUMBER_ID = '1019193724617910';
const RECIPIENT_NUMBER = '15705356119';

async function testToken() {
  console.log('Testing WhatsApp Token... (No icons used)');
  
  try {
    const response = await fetch(`https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: RECIPIENT_NUMBER,
        text: { body: "Testing the bot connection..." }
      })
    });

    const data = await response.json();
    console.log('WhatsApp API Response:', JSON.stringify(data, null, 2));

    if (data.error) {
       console.log('FAILED: Token error detected.');
    } else {
       console.log('SUCCESS: Token is valid.');
    }
  } catch (err) {
    console.error('Error during test:', err);
  }
}

testToken();
