/**
 * Cooper Bros. - Data Ingestion and Standardization Engine (POC)
 * 
 * Este script se encarga de escanear los directorios de entrada (emails y archivos excel),
 * unificar y estandarizar la estructura de los datos crudos, y persistir la base de datos
 * consolidada en un formato JSON listo para ser consumido por el procesador de IA.
 * 
 * Estructura de salida por registro:
 * - id: Identificador único estandarizado (EMAIL-xxx o EXCEL-xxx)
 * - origen: Origen unificado ('correo_electronico' o 'fila_excel')
 * - archivo_origen: Nombre del archivo de origen
 * - texto_crudo: Texto normalizado o concatenado dinámicamente
 * - fecha_ingesta: Fecha y hora en formato ISO 8601
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const xlsx = require('xlsx');

// Configuración de rutas de entrada y salida
const PATHS = {
  emailsDir: path.join(__dirname, 'input', 'emails'),
  excelDir: path.join(__dirname, 'input', 'excel'),
  storageDir: path.join(__dirname, 'public', 'storage'),
  dbFile: path.join(__dirname, 'public', 'storage', 'database.json')
};


/**
 * Función principal para orquestar la ingesta y unificación de datos
 */
async function runIngestion() {
  console.log('================================================================');
  console.log('🚀 Iniciando Proceso de Ingesta y Estandarización - Cooper Bros.');
  console.log('================================================================\n');
  
  // Garantizar la existencia de la carpeta de almacenamiento para la BD JSON
  if (!fs.existsSync(PATHS.storageDir)) {
    try {
      fs.mkdirSync(PATHS.storageDir, { recursive: true });
      console.log(`📁 Carpeta de almacenamiento creada exitosamente en: ${PATHS.storageDir}`);
    } catch (err) {
      console.error(`🚨 Error crítico al crear la carpeta de almacenamiento:`, err.message);
      process.exit(1);
    }
  }

  let dbRecords = [];
  let emailsProcessed = 0;
  let excelRowsProcessed = 0;
  let errorsCount = 0;

  // ---------------------------------------------------------------------------
  // Fase 1: Ingesta de Correos Electrónicos (.txt)
  // ---------------------------------------------------------------------------
  console.log('📧 Fase 1: Procesando correos electrónicos (.txt)...');
  
  if (fs.existsSync(PATHS.emailsDir)) {
    try {
      const emailFiles = fs.readdirSync(PATHS.emailsDir)
        .filter(file => file.endsWith('.txt'));

      console.log(`🔍 Se detectaron ${emailFiles.length} archivos de correo para escanear.`);

      for (const file of emailFiles) {
        const filePath = path.join(PATHS.emailsDir, file);
        try {
          // Lectura del correo en texto plano con codificación UTF-8
          const fileContent = fs.readFileSync(filePath, 'utf-8');
          
          // Generar ID único con prefijo 'EMAIL-' usando crypto.randomUUID()
          const uniqueId = `EMAIL-${crypto.randomUUID()}`;
          
          // Estructurar registro unificado
          const record = {
            id: uniqueId,
            origen: 'correo_electronico',
            archivo_origen: file,
            texto_crudo: fileContent.trim(),
            fecha_ingesta: new Date().toISOString()
          };
          
          dbRecords.push(record);
          emailsProcessed++;
          console.log(`   ✅ Procesado: "${file}" -> ID Asignado: ${uniqueId}`);
        } catch (fileErr) {
          errorsCount++;
          console.error(`   ❌ ERROR procesando archivo de correo "${file}":`, fileErr.message);
        }
      }
    } catch (dirErr) {
      errorsCount++;
      console.error(`🚨 Error al escanear el directorio de correos:`, dirErr.message);
    }
  } else {
    console.warn(`⚠️ Advertencia: El directorio de correos no existe: ${PATHS.emailsDir}`);
  }

  // ---------------------------------------------------------------------------
  // Fase 2: Ingesta de Archivos Excel (.xlsx)
  // ---------------------------------------------------------------------------
  console.log('\n📊 Fase 2: Procesando filas de planillas Excel (.xlsx)...');
  
  if (fs.existsSync(PATHS.excelDir)) {
    try {
      const excelFiles = fs.readdirSync(PATHS.excelDir)
        .filter(file => file.endsWith('.xlsx'));

      console.log(`🔍 Se detectaron ${excelFiles.length} archivos Excel para escanear.`);

      for (const file of excelFiles) {
        const filePath = path.join(PATHS.excelDir, file);
        try {
          // Leer libro de trabajo usando SheetJS (xlsx)
          const workbook = xlsx.readFile(filePath);
          
          if (workbook.SheetNames.length === 0) {
            throw new Error('El archivo de Excel no contiene ninguna hoja.');
          }

          // Leer estrictamente la primera hoja de trabajo
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          
          // Convertir la hoja a formato JSON, asegurando un valor por defecto null para celdas vacías
          const rows = xlsx.utils.sheet_to_json(worksheet, { defval: null });
          
          console.log(`   📂 Archivo: "${file}" | Hoja: "${firstSheetName}" | Filas a procesar: ${rows.length}`);

          rows.forEach((row, index) => {
            try {
              // Concatenar dinámicamente "Columna: Valor | Columna2: Valor"
              // Usamos Object.entries para iterar por cada clave-valor de la fila
              const formattedRow = Object.entries(row)
                .map(([column, value]) => {
                  const cleanValue = value !== null && value !== undefined ? String(value).trim() : '';
                  return `${column}: ${cleanValue}`;
                })
                .join(' | ');

              // Generar ID único con prefijo 'EXCEL-' usando crypto.randomUUID()
              const uniqueId = `EXCEL-${crypto.randomUUID()}`;

              // Estructurar registro unificado
              const record = {
                id: uniqueId,
                origen: 'fila_excel',
                archivo_origen: file,
                texto_crudo: formattedRow,
                fecha_ingesta: new Date().toISOString()
              };

              dbRecords.push(record);
              excelRowsProcessed++;
            } catch (rowErr) {
              errorsCount++;
              console.error(`      ❌ ERROR en fila ${index + 1} de "${file}":`, rowErr.message);
            }
          });

          console.log(`   ✅ Procesado completo de Excel: "${file}"`);
        } catch (fileErr) {
          errorsCount++;
          console.error(`   ❌ ERROR procesando archivo Excel "${file}":`, fileErr.message);
        }
      }
    } catch (dirErr) {
      errorsCount++;
      console.error(`🚨 Error al escanear el directorio de Excel:`, dirErr.message);
    }
  } else {
    console.warn(`⚠️ Advertencia: El directorio de Excel no existe: ${PATHS.excelDir}`);
  }

  // ---------------------------------------------------------------------------
  // Fase 3: Consolidación y Persistencia de la Base de Datos
  // ---------------------------------------------------------------------------
  console.log('\n💾 Fase 3: Consolidando y persistiendo base de datos...');
  
  if (dbRecords.length > 0) {
    try {
      // Ordenar el array consolidado de forma alfabética por el ID único asignado
      dbRecords.sort((a, b) => a.id.localeCompare(b.id));

      // Guardar en './storage/database.json' formateado con indentación de 2 espacios
      fs.writeFileSync(PATHS.dbFile, JSON.stringify(dbRecords, null, 2), 'utf-8');
      
      console.log(`\n🎉 ¡Proceso de ingesta finalizado con éxito!`);
      console.log(`📁 Base de datos unificada guardada en: ${PATHS.dbFile}`);
      console.log(`------------------------------------------------------------`);
      console.log(`📊 RESUMEN EJECUTIVO:`);
      console.log(`   📧 Correos electrónicos procesados: ${emailsProcessed}`);
      console.log(`   📊 Filas de Excel unificadas:       ${excelRowsProcessed}`);
      console.log(`   ✨ Total registros consolidados:     ${dbRecords.length}`);
      console.log(`   🚨 Total errores controlados:        ${errorsCount}`);
      console.log(`------------------------------------------------------------\n`);
      
    } catch (dbErr) {
      console.error(`🚨 Error crítico al guardar la base de datos JSON:`, dbErr.message);
    }
  } else {
    console.warn('\n⚠️ Proceso finalizado sin registros unificados. Base de datos vacía.');
  }
}

// Lanzar ejecución
runIngestion().catch(err => {
  console.error('🚨 Error fatal no controlado durante el ciclo de vida del script:', err);
  process.exit(1);
});
