export const Templates = {
  Global: {
    cancel: "👋 Entendido. He cancelado el proceso actual. ¿En qué más puedo ayudarte?",
    cancelOperation: "❌ Operación cancelada.",
    reset: "🔄 Estado reseteado. Puedes empezar de nuevo con 'nueva tienda'.",
    errorDb: (msg: string) => `❌ Error DB: ${msg}`,
    unrecognized: "🤔 No entendí. Prueba con: 'Inventario' o una lista como '2 cocas'.",
    invalidNumber: "❌ Por favor envía solo el número (ej: 25).",
    invalidNumberAmount: "❌ Envía solo el monto numérico (ej: 10).",
    help: `🤖 *Asistente Shadow Pulsar*\n\nPuedes escribirme de forma natural:\n\n🥤 *Ventas:* "Vendí 2 cocas", "2 sabritas", "1 jugo".\n📦 *Surtido:* "Llegaron 10 cocas", "Surtido de 5 jugos".\n📍 *Sucursales:* "Cambiar" (para moverte de tienda).\n📊 *Consultas:* "Inventario", "Link" (panel web).\n✨ *Nuevos:* Si un producto no existe, te guiaré para crearlo.\n\nEscribe *'Salir'* en cualquier momento para cancelar.`,
    dashboardLink: (storeId: string, userId: string) => `🔗 *Tu Panel de Control:*\n\nhttps://shadow-pulsar.vercel.app/?s=${storeId}&u=${userId}`
  },
  
  Onboarding: {
    newStorePrompt: "✨ *Nueva Sucursal*\n\n¿Cómo se llamará la nueva tienda?",
    newStoreConfirmation: (name: string) => `✨ ¿Confirmas la creación de la tienda **"${name}"**?`,
    storeCreatedProcessing: (name: string) => `✨ Procesando la creación de la tienda *"${name}"*...`,
    storeCreatedSuccess: (name: string) => `✅ ¡Sucursal *"${name}"* registrada!\n\n¿Te gustaría dar de alta tu primer producto? 📦`,
    firstProductPrompt: "✍️ ¡Excelente! ¿Cuál es el **nombre** del producto?\n\n_(Ej: Coca Cola 600ml)_",
    firstProductDecline: "👍 ¡No hay problema! Puedes dar de alta productos en el futuro. Ejemplo: *'Surtido'*, *'Llegaron 10 cocas'*, o *'Surtido de 5 jugos'*.\n\n¿En qué más te ayudo?",
    firstProductQtyPrompt: (name: string) => `📦 ¿Cuántas unidades de **"${name}"** tienes ahora mismo?`,
    newProductPricePrompt: "💰 ¡Bien! ¿A qué **precio de venta** lo vas a dar?",
    newProductCostPrompt: "💰 ¿Y cuánto te **costó** cada unidad?",
    productRegisteredSuccess: (name: string, qty: number, price: number, cost: number) => `✅ *¡Producto Registrado!* ✨\n\nNombre: ${name}\nStock inicial: +${qty}\nPrecio: $${price}\nCosto: $${cost}\n\n¿Qué quieres hacer ahora?\n• Registrar venta\n• Ver inventario\n• Agregar otro producto`,
    postCreationSalePrompt: "✍️ ¡Excelente! Escribe tu venta de forma natural. Ejemplo: *'Vendí 2 cocas'* o *'1 sabritas'*."
  },

  Inventory: {
    restockConfirmation: (qty: number, name: string) => `📦 ¿Confirmas resurtido de **${qty} ${name}**?`,
    restockSuccess: (qty: number, name: string) => `✅ ¡Listo! Registré **${qty} ${name}** en el inventario.`,
    productNotFound: (name: string) => `🔍 No encontré "${name}" en tu inventario.\n\n¿Quieres registrarlo como **producto nuevo**?`,
    newProductFallback: (name: string) => `✨ Entendido. Vamos a registrar **"${name}"** como producto nuevo.\n\n¿A qué **precio de venta** lo vas a dar?`,
    emptyInventory: "📭 Tu inventario está vacío.",
    inventoryList: (listStr: string) => `📊 *Inventario Actual (Top 10):*\n\n${listStr}\n\nEscribe 'Inventario' para ver todo en el panel.`
  },

  Sales: {
    saleConfirmation: (qty: number, name: string, total: number) => `🥤 ¿Confirmas venta de **${qty} ${name}**?\n\nTOTAL: *$${total}*`,
    saleConfirmedPaymentChoice: (total: number) => `🥤 *Venta Confirmada*\nTotal: *$${total}*\n\n¿Deseas registrar el **pago completo** ahora?`,
    saleProductNotFound: (name: string) => `🔍 No encontré el producto "${name}" para venderlo.`,
    fullPaymentSuccess: `✅ *Pago Completo Registrado.*\n\nVenta cerrada con éxito.`,
    partialPaymentPrompt: "👤 *Pago Parcial / Fiado*\n\n¿Cuánto **recibiste** en efectivo ahora mismo?",
    requireYesNoForFullPayment: "¿Deseas registrar el pago completo? (Responde Sí/No)",
    debtRemainingPrompt: (debt: number) => `📝 Quedan *$${debt.toFixed(2)}* pendientes.\n\n¿A qué **cliente** le anotamos esta deuda?`,
    debtRegisteredSuccess: (customerName: string) => `✅ ¡Anotado! Deuda registrada para **${customerName}**.\n\nVenta finalizada.`
  },

  Ledger: {
    ledgerPaymentPrompt: "👤 ¿A qué *cliente* le quieres registrar el abono?",
    ledgerCustomerNotFound: (name: string) => `🔍 No encontré al cliente "${name}". Asegúrate de que tenga una deuda registrada.`,
    ledgerPaymentConfirmation: (amount: number, name: string, balance: number) => `💰 ¿Confirmas abono de **$${amount}** para **${name}**?\n\nSaldo actual: $${balance}`,
    ledgerPaymentSuccess: (name: string) => `✅ ¡Abono registrado! Saldo actualizado para **${name}**.`
  },

  Admin: {
    switchStoreOnlyOne: "📍 Solo tienes una tienda registrada.",
    switchStorePrompt: (storesList: string) => `📍 *Cambiar de Sucursal*\n\nEscribe el nombre de la tienda a la que quieres cambiar:\n\n${storesList}`,
    storeSwitchedSuccess: (name: string) => `📍 Sucursal cambiada a **${name}**.`,
    switchStoreNotFound: "❌ No encontré esa tienda. Escribe el nombre exacto o 'Salir'.",
    
    cashClosePrompt: "💰 *Cierre de Caja Ciego*\n\n¿Cuánto **efectivo físico** tienes ahora mismo en caja?\n\n_(Envía solo el número)_",
    cashCloseSummary: (physical: number, expected: number, diff: number) => {
      let resMsg = `📊 *Resumen de Cierre*\n\n`;
      resMsg += `• Efectivo Real: *$${physical.toFixed(2)}*\n`;
      resMsg += `• Sistema Espera: $${expected.toFixed(2)}\n`;
      resMsg += `---------------------------\n`;
      resMsg += `• Diferencia: *${diff >= 0 ? '+' : ''}$${diff.toFixed(2)}* ${diff === 0 ? '✅' : '⚠️'}\n\n`;
      resMsg += `¿Confirmas el cierre del turno?`;
      return resMsg;
    },
    cashCloseSuccess: "✅ *Caja Cerrada*. El registro ha sido guardado.",
    
    voidSaleNotFound: "🔍 No encontré ninguna venta reciente para anular.",
    voidSaleConfirmation: (name: string, qty: number, total: number) => `🗑️ ¿Confirmas la **anulación** de la última venta?\n\n• Producto: *${name}*\n• Cantidad: ${qty}\n• Total: $${total}`,
    voidSaleSuccess: "✅ *Venta Anulada*. El stock ha sido devuelto.",
    
    auditEmpty: "❌ No hay productos registrados para auditar.",
    auditStart: (name: string) => `📝 *Iniciando Auditoría*\n\nTe preguntaré por cada producto. Escribe el número físico que tienes.\n\n1. **${name}**\n¿Cuántos hay físicamente?`,
    auditNext: (index: number, name: string) => `✅ Guardado. Siguiente:\n\n${index}. **${name}**\n¿Cuántos hay físicamente?`,
    auditFinished: "🏁 *Auditoría Finalizada*. Todos los stocks han sido sincronizados.",
    
    linkStoreNotFound: (search: string) => `🔍 No encontré ninguna tienda que se parezca a "${search}".`,
    linkStoreConfirmation: (name: string) => `🔗 ¿Confirmas que quieres ser el dueño de **${name}**? (Esto sobreescribirá el dueño actual si existe)`,
    linkStoreSuccess: (name: string) => `✅ ¡Vinculación exitosa! Refresca el panel para ver **${name}**.`,
    linkStoreProfileNotFound: "❌ No pude encontrar tu perfil de usuario.",
    linkStoreConfirmedOwner: (name: string) => `✅ Ahora eres el dueño oficial de *${name}*.`
  }
};
