/**
 * Cooper Bros. Compliance Pipeline POC - Local Dev Server & Write-Back API
 * 
 * Este servidor reemplaza a `npx serve` en desarrollo local para proporcionar:
 * 1. Servidor de archivos estáticos para la carpeta `/public` (HTML, CSS, JS, imágenes, etc.).
 * 2. API endpoint `POST /api/save-case` para añadir casos en tiempo real al archivo resultados-finales.json.
 * 3. API endpoint `POST /api/save-database` para sobreescribir la base de datos completa.
 * 
 * Escrito en Node.js nativo sin dependencias externas para garantizar máxima velocidad y portabilidad.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const RESULTADOS_FILE = path.join(PUBLIC_DIR, 'storage', 'resultados-finales.json');

// Diccionario de tipos MIME para servir archivos estáticos con la cabecera correcta
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

const server = http.createServer((req, res) => {
  // Configuración de cabeceras CORS para desarrollo
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Responder a peticiones Preflight de CORS inmediatamente
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Parsear URL de forma segura eliminando query strings y hashes
  let pathname = '/';
  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    pathname = parsedUrl.pathname;
  } catch (err) {
    pathname = req.url.split('?')[0].split('#')[0];
  }

  // --- API ROUTE: Guardar un caso individual (Append/Unshift) ---
  if (pathname === '/api/save-case' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const newRecord = JSON.parse(body);
        
        // Validar esquema básico del caso
        if (!newRecord.id || !newRecord.analisis || !newRecord.texto_crudo) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Esquema de caso inválido. Faltan campos requeridos.' }));
          return;
        }

        let records = [];
        
        // Leer base de datos existente o crearla si no existe
        if (fs.existsSync(RESULTADOS_FILE)) {
          const content = fs.readFileSync(RESULTADOS_FILE, 'utf8');
          try {
            records = JSON.parse(content || '[]');
          } catch (jsonErr) {
            console.error('⚠️ El archivo JSON de resultados está corrupto. Inicializando nuevo array.', jsonErr);
            records = [];
          }
        }

        // Agregar al inicio del array (Unshift) tal como hace la UI para mantener el orden cronológico inverso
        records.unshift(newRecord);

        // Escribir cambios formateados de vuelta al archivo
        fs.writeFileSync(RESULTADOS_FILE, JSON.stringify(records, null, 2), 'utf8');
        
        console.log(`💾 [API] Caso guardado en disco con éxito. ID: ${newRecord.id}. Total registros: ${records.length}`);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Caso guardado físicamente en disco', count: records.length }));
      } catch (err) {
        console.error('❌ Error procesando POST /api/save-case:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Error del servidor al persistir el caso: ' + err.message }));
      }
    });
    return;
  }

  // --- API ROUTE: Sobreescribir base de datos completa ---
  if (pathname === '/api/save-database' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const records = JSON.parse(body);
        
        if (!Array.isArray(records)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'El cuerpo de la petición debe ser un array de registros JSON.' }));
          return;
        }

        // Escribir cambios formateados al disco
        fs.writeFileSync(RESULTADOS_FILE, JSON.stringify(records, null, 2), 'utf8');
        
        console.log(`💾 [API] Base de datos de resultados sobreescrita con éxito. Total registros: ${records.length}`);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Base de datos guardada físicamente en disco', count: records.length }));
      } catch (err) {
        console.error('❌ Error procesando POST /api/save-database:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Error del servidor al persistir la base de datos: ' + err.message }));
      }
    });
    return;
  }

  // --- STATIC FILE SERVING ---
  // Construir ruta absoluta del archivo solicitado dentro de /public
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

  // Seguridad: Evitar Directory Traversal (navegar fuera de la carpeta /public)
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Acceso denegado');
    return;
  }

  // Si la ruta corresponde a un directorio que existe, servir index.html dentro de él
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  // Leer y retornar el archivo estático solicitado
  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        // Archivo no encontrado
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Archivo no encontrado');
      } else {
        // Error de lectura genérico
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Error interno del servidor: ${err.code}`);
      }
    } else {
      // Servir archivo con el tipo MIME correcto
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

// Escuchar peticiones en el puerto e informar al usuario
server.listen(PORT, () => {
  console.log(`\n================================================================`);
  console.log(`🚀 Cooper Bros. Compliance Pipeline POC Dev Server levantado.`);
  console.log(`🔗 URL local de visualización: http://localhost:${PORT}`);
  console.log(`================================================================\n`);
});
