// Configurando Menú de Comandos nativo

const WHATSAPP_ACCESS_TOKEN = 'EAAeC3YYYLI8BREhOqN8S9gW8jD03ynb11LFFsDDK2ZCnCU62BdZAmuNMjfjJ9EnAzkqsgXscYOyu5dSmSOdZBRE2miNr5LHdstiwoDpMUBm55DGfZBsClR7lgQZCJDzNvphk4jl56LWDtAM9vJYz6zCddxgBEsVwqwnUxwZA8IAOx6GTPIrCXIxjDW7w06dzABbqLNnjP72epx3OsFXQ9unNNHa3qOPGyHVpZBAaye5FZCUZBOZAFTMP3ntcyL6HghLxA5GYHX9IVeCplYC5lh4AZDZD';
const WHATSAPP_PHONE_ID = '436159679573809';

async function setupMenu() {
  console.log('Configurando Menú de Comandos en WhatsApp...');
  
  const response = await fetch(`https://graph.facebook.com/v22.0/${WHATSAPP_PHONE_ID}/whatsapp_business_profile`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      commands: [
        {
          command: "inventario",
          description: "Ver reporte de stock y productos"
        },
        {
          command: "panel",
          description: "Abrir el Dashboard web de la tienda"
        },
        {
          command: "escanear",
          description: "Abrir la cámara para escanear productos"
        }
      ]
    })
  });

  const data = await response.json();
  console.log('Respuesta de Meta:', JSON.stringify(data, null, 2));
}

setupMenu();
