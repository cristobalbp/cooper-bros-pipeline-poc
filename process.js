/**
 * Cooper Bros. - Compliance and Security AI Processing Engine (POC)
 * 
 * Este script se encarga de:
 * 1. Leer los registros unificados en 'storage/database.json' y la normativa corporativa en 'normativa-cooper.md'.
 * 2. Conectarse a la API de Gemini utilizando el nuevo SDK oficial '@google/genai'.
 * 3. Ejecutar un flujo secuencial asíncrono para evaluar cada registro de forma individual.
 * 4. Implementar un patrón de resiliencia de reintentos con retraso exponencial (Exponential Backoff) 
 *    y pausas de cortesía para respetar de forma estricta los límites de velocidad del Free Tier (429 Rate Limits).
 * 5. Analizar semánticamente el texto del caso frente a la normativa para clasificar su severidad 
 *    (ROJO, AMARILLO, VERDE) y justificar legal y normativamente la decisión en español.
 * 6. Consolidar el resultado de la IA con los metadatos de origen y guardarlos en 'storage/resultados-finales.json'.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

// Configuración de rutas
const PATHS = {
  dbFile: path.join(__dirname, 'public', 'storage', 'database.json'),
  normativaFile: path.join(__dirname, 'normativa-cooper.md'),
  outputFile: path.join(__dirname, 'public', 'storage', 'resultados-finales.json')
};

// Función auxiliar para pausas asíncronas
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Función robusta que encapsula las llamadas a la API de Gemini con reintentos automáticos
 * en caso de recibir respuestas de límite de velocidad (HTTP 429 / Quota Exceeded).
 */
async function generateContentWithRetry(aiStudio, options, maxRetries = 3, initialDelayMs = 20000) {
  let delay = initialDelayMs;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await aiStudio.models.generateContent(options);
      return response;
    } catch (err) {
      const errMessage = err.message || '';
      const isRateLimit = errMessage.includes('429') || errMessage.includes('quota') || errMessage.includes('limit') || err.status === 429;
      
      if (isRateLimit && attempt < maxRetries) {
        console.warn(`      ⚠️ [Intento ${attempt}/${maxRetries}] Límite de velocidad (429) alcanzado. Esperando ${delay / 1000}s para reintentar de forma segura...`);
        await sleep(delay);
        delay *= 2; // Duplicar el tiempo de espera exponencialmente
      } else {
        // Si no es un error de rate limit o ya excedimos los reintentos permitidos, propagamos el error
        throw err;
      }
    }
  }
}

async function runProcessing() {
  console.log('================================================================');
  console.log('🧠 Iniciando Motor de Procesamiento y Análisis IA - Cooper Bros.');
  console.log('================================================================\n');

  // ---------------------------------------------------------------------------
  // Paso 1: Carga de archivos y validación de variables de entorno
  // ---------------------------------------------------------------------------
  if (!process.env.GEMINI_API_KEY) {
    console.error('🚨 Error crítico: La variable GEMINI_API_KEY no está definida en el archivo .env');
    process.exit(1);
  }

  if (!fs.existsSync(PATHS.dbFile)) {
    console.error(`🚨 Error crítico: No se encontró la base de datos de ingesta en: ${PATHS.dbFile}`);
    console.error('👉 Por favor, ejecuta primero "node ingest.js" para poblar los registros.');
    process.exit(1);
  }

  if (!fs.existsSync(PATHS.normativaFile)) {
    console.error(`🚨 Error crítico: No se encontró la normativa corporativa en: ${PATHS.normativaFile}`);
    process.exit(1);
  }

  let cases = [];
  let normativa = '';

  try {
    cases = JSON.parse(fs.readFileSync(PATHS.dbFile, 'utf-8'));
    normativa = fs.readFileSync(PATHS.normativaFile, 'utf-8');
    console.log(`📂 Base de datos cargada. Registros a evaluar: ${cases.length}`);
    console.log(`📄 Normativa corporativa cargada correctamente (${normativa.length} caracteres).\n`);
  } catch (err) {
    console.error('🚨 Error cargando o parseando los archivos de entrada:', err.message);
    process.exit(1);
  }

  if (cases.length === 0) {
    console.warn('⚠️ No hay casos para procesar en database.json. Finalizando script.');
    return;
  }

  // ---------------------------------------------------------------------------
  // Paso 2: Instanciar cliente de IA
  // ---------------------------------------------------------------------------
  let aiStudio;
  try {
    aiStudio = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    console.log('🔌 Cliente GoogleGenAI instanciado con éxito.');
  } catch (err) {
    console.error('🚨 Error al instanciar el cliente GoogleGenAI:', err.message);
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // Paso 2.5: Verificación inteligente de disponibilidad de modelo (Fallback)
  // ---------------------------------------------------------------------------
  let selectedModel = 'gemini-3.1-pro';
  console.log(`🔍 Validando disponibilidad y cuotas para el modelo de preferencia: "${selectedModel}"...`);
  
  try {
    // Intento de ping rápido usando nuestro helper con reintentos
    await generateContentWithRetry(aiStudio, {
      model: selectedModel,
      contents: 'Ping test',
    }, 2, 5000);
    console.log(`   ✅ Modelo "${selectedModel}" disponible y listo para producción.\n`);
  } catch (err) {
    const errMessage = err.message || '';
    if (errMessage.includes('429') || errMessage.includes('quota') || errMessage.includes('limit') || errMessage.includes('404') || err.status === 429 || err.status === 404) {
      selectedModel = 'gemini-3.5-flash';
      console.warn(`   ⚠️ Advertencia: El modelo de preferencia gemini-3.1-pro no tiene cuota disponible o no fue encontrado (Free Tier/429/404).`);
      console.info(`   🔄 Aplicando fallback automático al modelo de alta velocidad disponible: "${selectedModel}"\n`);
    } else {
      console.error(`   ❌ Error de conexión de API durante la prueba inicial:`, err.message);
      process.exit(1);
    }
  }

  // ---------------------------------------------------------------------------
  // Paso 3 y 4: Procesamiento secuencial de casos (Ciclo for...of asíncrono)
  // ---------------------------------------------------------------------------
  const finalResults = [];
  let successCount = 0;
  let failCount = 0;

  console.log(`🤖 Iniciando ciclo de análisis con el modelo "${selectedModel}"...\n`);

  for (const record of cases) {
    console.log(`[+] INICIANDO análisis para el caso [ID: ${record.id}] | Origen: [${record.origen}]`);
    
    // Inyectamos las reglas corporativas detalladas mediante systemInstruction
    const systemPrompt = `
      Eres un Analista de Cumplimiento y Oficial de Seguridad de la Información Senior en Cooper Bros.
      Tu tarea es evaluar el caso provisto (procedente de correos o planillas Excel) y realizar un análisis semántico estricto utilizando como única base de conocimiento la siguiente Normativa Interna de Cumplimiento Político y Seguridad:
      
      ================================================================
      NORMATIVA INTERNA DE COOPER BROS:
      ${normativa}
      ================================================================
      
      INSTRUCCIONES DE RESPUESTA:
      - Debes responder exclusivamente con un objeto JSON válido.
      - No agregues markdown adicional (como \`\`\`json ... \`\`\`), texto aclaratorio, ni explicaciones fuera de la estructura JSON.
      - La estructura JSON debe contener estrictamente los siguientes tres campos:
        1. "severidad": Debe tomar exactamente uno de estos tres valores: "ROJO", "AMARILLO" o "VERDE".
           - Clasifica como ROJO para brechas de datos/seguridad, fraudes financieros o demandas legales críticas.
           - Clasifica como AMARILLO para demoras operativas significativas, disputas contractuales menores o casos grises que exigen auditoría o aclaración.
           - Clasifica como VERDE para consultas generales comerciales/soporte normal, spam o saludos de cortesía.
        2. "justificacion": Una justificación analítica redactada siempre en ESPAÑOL. Explica con claridad cuál es el motivo legal, técnico, de seguridad o comercial conforme a la normativa de Cooper Bros. que sustenta esta clasificación.
        3. "regla_violada": Identifica el artículo, sección, término del glosario o política específica infringida o relacionada de la normativa (por ejemplo, "Sección 2 - 🔴 ROJO: Brechas de Seguridad y Datos" o "Glosario Término 5: Disputa contractual"). Si el caso es de operación normal y no viola nada, puedes indicar "Ninguna (Operación Normal)".
    `;

    try {
      // Llamada de inferencia a Gemini con control de reintentos
      const response = await generateContentWithRetry(aiStudio, {
        model: selectedModel,
        contents: record.texto_crudo,
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: 'application/json'
        }
      }, 3, 20000);

      // Parsear la respuesta de la IA
      const aiResponseText = response.text.trim();
      const parsedAnalysis = JSON.parse(aiResponseText);

      // Consolidar metadatos de origen con el análisis de la IA
      const consolidatedRecord = {
        id: record.id,
        origen: record.origen,
        archivo_origen: record.archivo_origen,
        texto_crudo: record.texto_crudo,
        fecha_ingesta: record.fecha_ingesta,
        analisis: {
          severidad: parsedAnalysis.severidad || 'AMARILLO',
          justificacion: parsedAnalysis.justificacion || 'No se proveyó justificación.',
          regla_violada: parsedAnalysis.regla_violada || 'No especificada.'
        },
        fecha_evaluacion: new Date().toISOString()
      };

      finalResults.push(consolidatedRecord);
      successCount++;
      
      console.log(`[-] FINALIZADO análisis para el caso [ID: ${record.id}]. Severidad asignada: [${parsedAnalysis.severidad}]`);
      console.log(`    ↳ Regla relacionada: "${parsedAnalysis.regla_violada}"\n`);

    } catch (caseErr) {
      failCount++;
      console.error(`🚨 ERROR al evaluar el caso [ID: ${record.id}]:`, caseErr.message);
      
      // Creamos un registro de fallo indicando el error de procesamiento
      const fallbackRecord = {
        id: record.id,
        origen: record.origen,
        archivo_origen: record.archivo_origen,
        texto_crudo: record.texto_crudo,
        fecha_ingesta: record.fecha_ingesta,
        analisis: {
          severidad: 'AMARILLO',
          justificacion: `Fallo durante el procesamiento asistido por IA: ${caseErr.message}`,
          regla_violada: 'ERROR_PROCESAMIENTO'
        },
        fecha_evaluacion: new Date().toISOString()
      };
      
      finalResults.push(fallbackRecord);
    }

    // Pausa preventiva de cortesía entre ejecuciones secuenciales para regular la frecuencia de las peticiones
    await sleep(2500);
  }

  // ---------------------------------------------------------------------------
  // Paso 7: Escribir el resultado consolidado final
  // ---------------------------------------------------------------------------
  console.log('💾 Guardando archivo de resultados consolidados...');
  try {
    fs.writeFileSync(PATHS.outputFile, JSON.stringify(finalResults, null, 2), 'utf-8');
    
    console.log(`\n🎉 ¡Procesamiento por IA completado de forma exitosa!`);
    console.log(`📁 Resultados guardados en: ${PATHS.outputFile}`);
    console.log(`------------------------------------------------------------`);
    console.log(`📊 BALANCE DE PROCESAMIENTO:`);
    console.log(`   ✅ Casos evaluados exitosamente: ${successCount}`);
    console.log(`   🚨 Fallos o errores capturados:   ${failCount}`);
    console.log(`   ✨ Total registros analizados:   ${finalResults.length}`);
    console.log(`------------------------------------------------------------\n`);
  } catch (err) {
    console.error(`🚨 Error crítico al escribir los resultados en JSON:`, err.message);
  }
}

// Iniciar proceso global
runProcessing().catch(err => {
  console.error('🚨 Error fatal inesperado en el orquestador de procesamiento:', err);
  process.exit(1);
});
