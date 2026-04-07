
const token = 'EAAbXTPKf7yQBRPO5huFuLZBBqY7bZAB262U0uFMHzCxDQr6eVccRW6QOajAZAG0Cp5t9Os1keuHjOcAjpZBw8EuVjnZA0QnFo8fDT0ZCeUtwJfgHLGz6erzlY89aiRTktmd7SoGcPb8248ZBKZBmPGZAaVfZAPsEVm5N5x4ln8FhjpSIgV2031ZCQBytzRgfaHrmwZDZD';

async function getInfo() {
    const response = await fetch('https://graph.facebook.com/v21.0/me?fields=whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number}}', {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });
    
    const data = await response.json();
    console.log(JSON.stringify(data, null, 2));
}

getInfo();
