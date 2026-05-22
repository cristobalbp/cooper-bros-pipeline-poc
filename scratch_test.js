require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

async function testStructuredCall() {
  const aiStudio = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  console.log("Calling gemini-3.5-flash with systemInstruction and JSON output...");
  
  const systemInstruction = `
    Eres un analista de cumplimiento para Cooper Bros. Evalúa el caso provisto bajo la normativa interna.
    Responde estrictamente en formato JSON con la siguiente estructura:
    {
      "severidad": "ROJO" | "AMARILLO" | "VERDE",
      "justificacion": "Explicación detallada en español del motivo legal o regulatorio.",
      "regla_violada": "La regla específica infringida."
    }
  `;

  const userMessage = "ALERTA: Detectamos una transferencia bancaria no autorizada de $45,000 USD desde la cuenta operativa de Cooper Bros hacia un banco offshore no registrado.";

  try {
    const response = await aiStudio.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: userMessage,
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: 'application/json',
      }
    });

    console.log("Response text:");
    console.log(response.text);
    
    // Test parsing
    const parsed = JSON.parse(response.text);
    console.log("Successfully parsed JSON:", parsed);
  } catch (err) {
    console.error("Error during structured call:", err);
  }
}

testStructuredCall();
