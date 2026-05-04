
console.log("--- WhatsApp SIMULATOR ---");
console.log("Simulating messages as if they came from a phone...");
console.log("---------------------------");

testCases.forEach(c => {
  const result = parseWhatsAppMessage(c);
  console.log(`📱 Phone sends: "${c}"`);
  console.log(`🧠 System parses:`, JSON.stringify(result, null, 2));
  console.log("---------------------------");
});
