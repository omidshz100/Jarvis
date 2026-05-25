const express = require('express');
const cors = require('cors');
const googleTTS = require('google-tts-api');
const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const os = require('os');

const app = express();
app.use(cors());
// Increase JSON limit for embeddings
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3000;
const audiosDir = path.join(__dirname, 'audios');
const rhubarbExecutable = os.platform() === 'win32' ? 'rhubarb.exe' : 'rhubarb';
const rhubarbPath = path.join(__dirname, 'bin', rhubarbExecutable);
const uploadsDir = path.join(__dirname, 'uploads');

// Ensure directories exist
fs.mkdir(audiosDir, { recursive: true }).catch(console.error);
fs.mkdir(uploadsDir, { recursive: true }).catch(console.error);

// Serve uploads statically so frontend can display them
app.use('/uploads', express.static(uploadsDir));

// --- Database Setup ---
const dbFile = path.join(__dirname, 'knowledge_base.sqlite');
const db = new sqlite3.Database(dbFile, (err) => {
  if (err) console.error('Error opening database', err);
  else console.log('Connected to SQLite database.');
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    content TEXT,
    youtube_url TEXT,
    images_json TEXT,
    embedding_json TEXT
  )`);
});

// --- Multer Setup ---
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir)
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, uniqueSuffix + path.extname(file.originalname))
  }
});
const upload = multer({ storage: storage });

const execCommand = (command) => {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) reject(error);
      resolve(stdout);
    });
  });
};

// --- RAG Endpoints ---

// Create an Article
app.post('/api/articles', upload.array('images'), (req, res) => {
  const { title, content, youtube_url, embedding_json } = req.body;
  const imagePaths = req.files ? req.files.map(f => '/uploads/' + f.filename) : [];
  
  const query = `INSERT INTO articles (title, content, youtube_url, images_json, embedding_json) VALUES (?, ?, ?, ?, ?)`;
  db.run(query, [title, content, youtube_url || '', JSON.stringify(imagePaths), embedding_json || '[]'], function(err) {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to insert article' });
    }
    res.json({ id: this.lastID, message: 'Article created successfully' });
  });
});

// Get all Articles (without embeddings to save bandwidth)
app.get('/api/articles', (req, res) => {
  db.all(`SELECT id, title, content, youtube_url, images_json FROM articles`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    
    const parsed = rows.map(r => ({
      ...r,
      images: JSON.parse(r.images_json)
    }));
    res.json(parsed);
  });
});

// Helper: Cosine Similarity
function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Search Articles via Vector Similarity
app.post('/api/search', (req, res) => {
  const { query_embedding } = req.body;
  if (!query_embedding || !Array.isArray(query_embedding)) {
    return res.status(400).json({ error: 'Missing or invalid query_embedding' });
  }

  db.all(`SELECT id, title, content, youtube_url, images_json, embedding_json FROM articles`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    const results = [];
    for (const row of rows) {
      try {
        const emb = JSON.parse(row.embedding_json);
        if (emb && emb.length > 0) {
          const sim = cosineSimilarity(query_embedding, emb);
          results.push({
            id: row.id,
            title: row.title,
            content: row.content,
            youtube_url: row.youtube_url,
            images: JSON.parse(row.images_json),
            score: sim
          });
        }
      } catch (e) {
        // ignore malformed embeddings
      }
    }

    // Sort by descending score
    results.sort((a, b) => b.score - a.score);
    // Return top 3 matches
    res.json(results.slice(0, 3));
  });
});

// Delete an Article
app.delete('/api/articles/:id', (req, res) => {
  db.run(`DELETE FROM articles WHERE id = ?`, [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Deleted successfully' });
  });
});

// --- TTS Endpoint ---
app.get('/tts', async (req, res) => {
  try {
    const text = req.query.text || req.query.q; 
    if (!text) {
      return res.status(400).json({ error: 'Text query parameter is required' });
    }

    const timestamp = Date.now();
    const mp3Path = path.join(audiosDir, `${timestamp}.mp3`);
    const wavPath = path.join(audiosDir, `${timestamp}.wav`);
    const jsonPath = path.join(audiosDir, `${timestamp}.json`);

    const audioChunks = await googleTTS.getAllAudioBase64(text, {
      lang: 'en',
      slow: false,
      host: 'https://translate.google.com',
      splitPunct: ',.?',
    });

    const audioBuffers = audioChunks.map(chunk => Buffer.from(chunk.base64, 'base64'));
    const combinedBuffer = Buffer.concat(audioBuffers);
    const base64Audio = combinedBuffer.toString('base64');
    
    await fs.writeFile(mp3Path, combinedBuffer);
    await execCommand(`ffmpeg -y -i "${mp3Path}" "${wavPath}"`);
    await execCommand(`"${rhubarbPath}" -f json -o "${jsonPath}" "${wavPath}" -r phonetic`);

    const jsonContent = await fs.readFile(jsonPath, 'utf8');
    const lipsyncData = JSON.parse(jsonContent);

    Promise.all([
      fs.unlink(mp3Path).catch(() => {}),
      fs.unlink(wavPath).catch(() => {}),
      fs.unlink(jsonPath).catch(() => {})
    ]);

    res.json({
      audio: base64Audio,
      lipsync: lipsyncData
    });

  } catch (error) {
    console.error('TTS/Lipsync Generation Error:', error);
    res.status(500).json({ error: 'Failed to generate speech and lipsync' });
  }
});

app.listen(PORT, () => {
  console.log(`Jarvis Voice Backend is running on http://localhost:${PORT}`);
});
