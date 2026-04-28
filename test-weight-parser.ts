
/**
 * LABORATORIO DE PRUEBAS: PARSER INTELIGENTE DE PESOS Y FRACCIONES
 * Este script simula cómo el bot entendería las cantidades difíciles
 * SIN afectar al cliente actual.
 */

interface ParsedResult {
  original: string;
  detectedQty: number;
  detectedUnit: string;
  productName: string;
}

function smartWeightParser(text: string): ParsedResult {
  let cleanText = text.toLowerCase().trim();
  
  // 1. DICCIONARIO DE FRACCIONES
  const fractions: { [key: string]: number } = {
    'medio': 0.5,
    'un medio': 0.5,
    '1/2': 0.5,
    'un cuarto': 0.25,
    '1/4': 0.25,
    'tres cuartos': 0.75,
    '3/4': 0.75
  };

  let qty = 1; // Default
  let unit = 'pza';

  // --- PASO 1: Buscar Gramos (ej: 300g, 300 gramos) ---
  const gramMatch = cleanText.match(/(\d+)\s*(g|gr|gramos)/);
  if (gramMatch) {
    qty = parseInt(gramMatch[1]) / 1000; // Convertir a Kg
    unit = 'kg';
    // Limpiar el texto para encontrar el nombre del producto
    cleanText = cleanText.replace(gramMatch[0], '');
  } 
  
  // --- PASO 2: Buscar Fracciones (ej: medio kilo, 1/2 kilo) ---
  else {
    let foundFraction = false;
    for (const [key, value] of Object.entries(fractions)) {
      if (cleanText.includes(key)) {
        qty = value;
        unit = 'kg'; // Asumimos kg si hay fracciones de este tipo
        cleanText = cleanText.replace(key, '');
        foundFraction = true;
        break;
      }
    }

    // --- PASO 3: Buscar Números con Kilo (ej: 1.5 kilos, 2kg) ---
    if (!foundFraction) {
      const kiloMatch = cleanText.match(/(\d+(\.\d+)?)\s*(kg|kilo|kilos)/);
      if (kiloMatch) {
        qty = parseFloat(kiloMatch[1]);
        unit = 'kg';
        cleanText = cleanText.replace(kiloMatch[0], '');
      } else {
        // Fallback: Buscar número normal (piezas)
        const numMatch = cleanText.match(/^(\d+)/);
        if (numMatch) {
          qty = parseFloat(numMatch[1]);
          cleanText = cleanText.replace(numMatch[0], '');
        }
      }
    }
  }

  // Limpiar conectores y extraer nombre
  const productName = cleanText
    .replace(/^(venta|de|de un|un|una)\s+/g, '')
    .trim();

  return { original: text, detectedQty: qty, detectedUnit: unit, productName };
}

// --- CASOS DE PRUEBA ---
const testCases = [
  "Venta 1/2 de frijol",
  "Venta medio kilo de jitomate",
  "Venta 300g de chiles",
  "Venta 1.5 kilos de cebolla",
  "Venta 2 cocas", // Caso normal para asegurar que no se rompe
  "Venta un cuarto de queso"
];

console.log("🧪 RESULTADOS DEL NUEVO PARSER INTELIGENTE:");
console.log("-------------------------------------------");
testCases.forEach(t => {
  const res = smartWeightParser(t);
  console.log(`Entrada: "${res.original}"`);
  console.log(`-> Producto: [${res.productName}]`);
  console.log(`-> Cantidad calculada: ${res.detectedQty} ${res.detectedUnit}`);
  console.log("-------------------------------------------");
});
