const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = path.join(__dirname, 'data', 'notes.json');

// ========== MIME Types ==========
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// ========== Notes Storage ==========
function loadNotes() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      fs.writeFileSync(DATA_FILE, '[]', 'utf-8');
      return [];
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to load notes:', e.message);
    return [];
  }
}

function saveNotes(notes) {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(notes, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to save notes:', e.message);
  }
}

function generateId() {
  return Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

// ========== Static File Serving ==========
function serveStatic(req, res) {
  let filePath = path.join(PUBLIC_DIR, req.url === '/' ? 'index.html' : req.url);

  // Security: prevent directory traversal
  filePath = path.normalize(filePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';

  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const data = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=3600' });
      res.end(data);
    } else {
      // SPA fallback: serve index.html for unknown routes
      const indexPath = path.join(PUBLIC_DIR, 'index.html');
      if (fs.existsSync(indexPath)) {
        const indexData = fs.readFileSync(indexPath);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(indexData);
      } else {
        res.writeHead(404);
        res.end('404 Not Found');
      }
    }
  } catch (e) {
    res.writeHead(500);
    res.end('Internal Server Error');
  }
}

// ========== Request Body Parser ==========
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      // Limit body size to 50MB (for images)
      if (body.length > 50 * 1024 * 1024) {
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, statusCode, data) {
  const json = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(json);
}

// ========== API Router ==========
async function handleAPI(req, res) {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method.toUpperCase();

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // GET /api/notes - List all notes
  if (method === 'GET' && pathname === '/api/notes') {
    const notes = loadNotes();
    sendJSON(res, 200, notes);
    return;
  }

  // POST /api/notes - Create a note
  if (method === 'POST' && pathname === '/api/notes') {
    try {
      const body = await parseBody(req);
      if (!body.title || !body.column) {
        sendJSON(res, 400, { error: 'title and column are required' });
        return;
      }
      const notes = loadNotes();
      const now = new Date().toISOString();
      const note = {
        id: generateId(),
        title: body.title || '',
        content: body.content || '',
        column: body.column,
        chapter: body.chapter || '',
        section: body.section || '',
        image: body.image || null,
        createdAt: now,
        updatedAt: now,
      };
      notes.push(note);
      saveNotes(notes);
      sendJSON(res, 201, note);
    } catch (e) {
      sendJSON(res, 400, { error: e.message });
    }
    return;
  }

  // PUT /api/notes/:id - Update a note
  const putMatch = pathname.match(/^\/api\/notes\/([a-zA-Z0-9]+)$/);
  if (method === 'PUT' && putMatch) {
    try {
      const id = putMatch[1];
      const body = await parseBody(req);
      const notes = loadNotes();
      const idx = notes.findIndex(n => n.id === id);
      if (idx === -1) {
        sendJSON(res, 404, { error: 'Note not found' });
        return;
      }
      notes[idx] = {
        ...notes[idx],
        title: body.title ?? notes[idx].title,
        content: body.content ?? notes[idx].content,
        column: body.column ?? notes[idx].column,
        chapter: body.chapter ?? notes[idx].chapter,
        section: body.section ?? notes[idx].section,
        image: body.image !== undefined ? body.image : notes[idx].image,
        updatedAt: new Date().toISOString(),
      };
      saveNotes(notes);
      sendJSON(res, 200, notes[idx]);
    } catch (e) {
      sendJSON(res, 400, { error: e.message });
    }
    return;
  }

  // DELETE /api/notes/:id - Delete a note
  const deleteMatch = pathname.match(/^\/api\/notes\/([a-zA-Z0-9]+)$/);
  if (method === 'DELETE' && deleteMatch) {
    const id = deleteMatch[1];
    let notes = loadNotes();
    const idx = notes.findIndex(n => n.id === id);
    if (idx === -1) {
      sendJSON(res, 404, { error: 'Note not found' });
      return;
    }
    notes.splice(idx, 1);
    saveNotes(notes);
    sendJSON(res, 200, { success: true });
    return;
  }

  // 404 for unknown API routes
  sendJSON(res, 404, { error: 'API route not found' });
}

// ========== Main Server ==========
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);

  // API routes
  if (parsedUrl.pathname.startsWith('/api/')) {
    await handleAPI(req, res);
  } else {
    serveStatic(req, res);
  }
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
  console.log(`Notes stored in: ${DATA_FILE}`);
});