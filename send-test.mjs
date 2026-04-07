
const token = 'EAA58NLKGiTkBRPLRg15hSIfrAmrT7htAoq6cjgIUepAeqmQ67JsKW6BZAf6NGIji2CEZBfNiSA38Ayz9tWtkWVpq7VPBVKX31BYAUb4r7B97ZB8dISkYHO4PzZBtcIHPFeIz9dCV3iM30ZAq45WEzUZBSpnylni4cscqEWHUSp97jJMDLDDajYqtUjfJuKh0eCTp6IafLHuR3MewqlltXA80kgypNq1EGYptsquGtmsQfxVAHP2jORnnaTpcXQy04C63CetO6Tlhko9acB1EQZD';
const phoneId = '1137759422746203';
const to = '15705356119';

async function send() {
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: to,
      type: "template",
      template: {
        name: "hello_world",
        language: { code: "en_US" }
      }
    })
  });
  console.log(await res.json());
}

send();
