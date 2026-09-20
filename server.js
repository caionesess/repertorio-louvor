require('dotenv').config();

const express = require('express');
const path = require('path');
const axios = require('axios');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Função utilitária para extrair ID do YouTube a partir de links variados
function extrairYoutubeId(urlOuTermo) {
  if (!urlOuTermo) return null;
  const match = urlOuTermo.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/);
  return match ? match[1] : null;
}

// ---------------- ROTA: LISTAGEM DE REPERTÓRIOS ----------------
app.get('/', (req, res) => {
  const repertorios = db.prepare(`
    SELECT r.*, COUNT(m.id) as total_musicas 
    FROM repertorios r 
    LEFT JOIN musicas m ON m.repertorio_id = r.id 
    GROUP BY r.id 
    ORDER BY r.data DESC
  `).all();

  res.render('index', { repertorios });
});

// Criar repertório
app.post('/repertorios', (req, res) => {
  const { nome, data } = req.body;
  if (nome && data) {
    db.prepare('INSERT INTO repertorios (nome, data) VALUES (?, ?)').run(nome.trim(), data);
  }
  res.redirect('/');
});

// Editar repertório (nome e/ou data)
app.post('/repertorios/:id/edit', (req, res) => {
  const { nome, data, redirect_to } = req.body;
  if (nome && data) {
    db.prepare('UPDATE repertorios SET nome = ?, data = ? WHERE id = ?').run(
      nome.trim(),
      data,
      req.params.id
    );
  }
  
  if (redirect_to === 'detalhes') {
    return res.redirect(`/repertorios/${req.params.id}`);
  }
  res.redirect('/');
});

// Deletar repertório
app.post('/repertorios/:id/delete', (req, res) => {
  db.prepare('DELETE FROM repertorios WHERE id = ?').run(req.params.id);
  res.redirect('/');
});

// ---------------- ROTA: GERENCIAMENTO DE MINISTRANTES ----------------
app.get('/ministrantes', (req, res) => {
  const ministrantes = db.prepare(`
    SELECT m.*, COUNT(mm.musica_id) as total_cancoes
    FROM ministrantes m
    LEFT JOIN musica_ministrantes mm ON mm.ministrante_id = m.id
    GROUP BY m.id
    ORDER BY m.nome ASC
  `).all();

  res.render('ministrantes', { ministrantes, erro: req.query.erro || null });
});

app.post('/ministrantes', (req, res) => {
  const nome = req.body.nome?.trim();
  if (nome) {
    try {
      db.prepare('INSERT INTO ministrantes (nome) VALUES (?)').run(nome);
    } catch (err) {
      if (err.message && err.message.includes('UNIQUE')) {
        return res.redirect('/ministrantes?erro=duplicado');
      }
      return res.redirect('/ministrantes?erro=desconhecido');
    }
  }
  res.redirect('/ministrantes');
});

app.post('/ministrantes/:id/delete', (req, res) => {
  try {
    db.prepare('DELETE FROM ministrantes WHERE id = ?').run(req.params.id);
    res.redirect('/ministrantes');
  } catch (err) {
    res.redirect('/ministrantes?erro=em_uso');
  }
});

// ---------------- ROTA: DETALHES DO REPERTÓRIO ----------------
app.get('/repertorios/:id', (req, res) => {
  const repertorio = db.prepare('SELECT * FROM repertorios WHERE id = ?').get(req.params.id);
  if (!repertorio) return res.status(404).send('Repertório não encontrado');

  const musicas = db.prepare(`
    SELECT m.*, 
      COALESCE(
        (SELECT json_group_array(json_object('id', min.id, 'nome', min.nome))
         FROM musica_ministrantes mm
         JOIN ministrantes min ON min.id = mm.ministrante_id
         WHERE mm.musica_id = m.id), '[]'
      ) as ministrantes_json
    FROM musicas m 
    WHERE m.repertorio_id = ? 
    ORDER BY m.id ASC
  `).all(req.params.id).map(m => ({
    ...m,
    ministrantes: JSON.parse(m.ministrantes_json)
  }));

  const ministrantes = db.prepare('SELECT * FROM ministrantes ORDER BY nome ASC').all();

  res.render('repertorio', { repertorio, musicas, ministrantes });
});

// API de busca do YouTube
app.get('/api/youtube-search', async (req, res) => {
  const query = req.query.q?.trim();
  if (!query) return res.json([]);

  if (!YOUTUBE_API_KEY || YOUTUBE_API_KEY === 'SUA_CHAVE_API_YOUTUBE_AQUI') {
    return res.status(400).json({ 
      error: 'Chave do YouTube API não configurada. Preencha os campos manualmente.' 
    });
  }

  const videoId = extrairYoutubeId(query);

  try {
    if (videoId) {
      const response = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
        params: {
          part: 'snippet',
          id: videoId,
          key: YOUTUBE_API_KEY
        }
      });

      const item = response.data.items?.[0];
      if (!item) return res.json([]);

      const publishDate = item.snippet.publishedAt;
      return res.json([{
        youtube_id: item.id,
        titulo: item.snippet.title,
        canal: item.snippet.channelTitle,
        ano: publishDate ? new Date(publishDate).getFullYear() : null,
        thumb: item.snippet.thumbnails?.default?.url || ''
      }]);
    }

    const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: {
        part: 'snippet',
        q: query,
        type: 'video',
        maxResults: 5,
        key: YOUTUBE_API_KEY
      }
    });

    const items = response.data.items.map(item => {
      const publishDate = item.snippet.publishedAt;
      return {
        youtube_id: item.id.videoId,
        titulo: item.snippet.title,
        canal: item.snippet.channelTitle,
        ano: publishDate ? new Date(publishDate).getFullYear() : null,
        thumb: item.snippet.thumbnails?.default?.url || ''
      };
    });

    res.json(items);
  } catch (error) {
    res.status(500).json({ error: 'Falha ao buscar no YouTube.' });
  }
});

// Adicionar música
app.post('/repertorios/:id/musicas', (req, res) => {
  let { titulo, artista, ano, ministrantes_ids, youtube_url } = req.body;
  const repertorioId = req.params.id;

  if (!Array.isArray(ministrantes_ids)) {
    ministrantes_ids = ministrantes_ids ? [ministrantes_ids] : [];
  }

  const youtubeId = extrairYoutubeId(youtube_url) || youtube_url;

  if (titulo && artista && ministrantes_ids.length > 0) {
    const info = db.prepare(`
      INSERT INTO musicas (repertorio_id, titulo, artista, ano, youtube_id) 
      VALUES (?, ?, ?, ?, ?)
    `).run(
      repertorioId, 
      titulo.trim(), 
      artista.trim(), 
      ano ? parseInt(ano) : null, 
      youtubeId || null
    );

    const musicaId = Number(info.lastInsertRowid);
    const insertMm = db.prepare('INSERT INTO musica_ministrantes (musica_id, ministrante_id) VALUES (?, ?)');
    for (const minId of ministrantes_ids) {
      insertMm.run(musicaId, parseInt(minId));
    }
  }

  res.redirect(`/repertorios/${repertorioId}`);
});

// Editar música
app.post('/musicas/:id/edit', (req, res) => {
  const musicaId = req.params.id;
  let { repertorio_id, titulo, artista, ano, ministrantes_ids, youtube_url } = req.body;

  if (!Array.isArray(ministrantes_ids)) {
    ministrantes_ids = ministrantes_ids ? [ministrantes_ids] : [];
  }

  const youtubeId = extrairYoutubeId(youtube_url) || youtube_url;

  if (titulo && artista && ministrantes_ids.length > 0) {
    db.prepare(`
      UPDATE musicas 
      SET titulo = ?, artista = ?, ano = ?, youtube_id = ?
      WHERE id = ?
    `).run(
      titulo.trim(),
      artista.trim(),
      ano ? parseInt(ano) : null,
      youtubeId || null,
      musicaId
    );

    db.prepare('DELETE FROM musica_ministrantes WHERE musica_id = ?').run(musicaId);
    const insertMm = db.prepare('INSERT INTO musica_ministrantes (musica_id, ministrante_id) VALUES (?, ?)');
    for (const minId of ministrantes_ids) {
      insertMm.run(musicaId, parseInt(minId));
    }
  }

  res.redirect(`/repertorios/${repertorio_id}`);
});

// Remover música
app.post('/musicas/:id/delete', (req, res) => {
  const { repertorio_id } = req.body;
  db.prepare('DELETE FROM musicas WHERE id = ?').run(req.params.id);
  res.redirect(`/repertorios/${repertorio_id}`);
});

// ---------------- ROTA: ANALYTICS ----------------
app.get('/analytics', (req, res) => {
  // 1. Quem mais ministrou
  const topMinistrantes = db.prepare(`
    SELECT min.nome as ministrante, COUNT(mm.musica_id) as total 
    FROM musica_ministrantes mm
    JOIN ministrantes min ON min.id = mm.ministrante_id
    GROUP BY min.id 
    ORDER BY total DESC 
    LIMIT 10
  `).all();

  // 2. Músicas mais tocadas
  const topMusicas = db.prepare(`
    SELECT titulo, artista, COUNT(*) as total 
    FROM musicas 
    GROUP BY LOWER(TRIM(titulo)), LOWER(TRIM(artista)) 
    ORDER BY total DESC 
    LIMIT 10
  `).all();

  // 3. Artistas / Bandas mais tocados
  const topArtistas = db.prepare(`
    SELECT artista, COUNT(*) as total 
    FROM musicas 
    WHERE artista IS NOT NULL AND TRIM(artista) != ''
    GROUP BY LOWER(TRIM(artista)) 
    ORDER BY total DESC 
    LIMIT 10
  `).all();

  // 4. Distribuição por décadas
  const decadas = db.prepare(`
    SELECT 
      CAST((ano / 10) * 10 AS TEXT) || 's' AS decada, 
      COUNT(*) AS total 
    FROM musicas 
    WHERE ano IS NOT NULL AND ano > 1900 
    GROUP BY decada 
    ORDER BY decada ASC
  `).all();

  const totalMusicas = db.prepare('SELECT COUNT(*) as count FROM musicas').get().count;
  const totalRepertorios = db.prepare('SELECT COUNT(*) as count FROM repertorios').get().count;
  const totalMinistrantes = db.prepare('SELECT COUNT(*) as count FROM ministrantes').get().count;

  res.render('analytics', {
    topMinistrantes,
    topMusicas,
    topArtistas,
    decadas,
    totalMusicas,
    totalRepertorios,
    totalMinistrantes
  });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});