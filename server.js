require('dotenv').config();

const express = require('express');
const path = require('path');
const axios = require('axios');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

function extrairYoutubeId(urlOuTermo) {
  if (!urlOuTermo) return null;
  const match = urlOuTermo.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/);
  return match ? match[1] : null;
}

// ---------------- REPERTÓRIOS ----------------
app.get('/', async (req, res) => {
  try {
    const result = await db.execute(`
      SELECT r.*, COUNT(m.id) as total_musicas 
      FROM repertorios r 
      LEFT JOIN musicas m ON m.repertorio_id = r.id 
      GROUP BY r.id 
      ORDER BY r.data DESC
    `);
    res.render('index', { repertorios: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).send('Erro ao carregar repertórios');
  }
});

app.post('/repertorios', async (req, res) => {
  const { nome, data } = req.body;
  if (nome && data) {
    await db.execute({
      sql: 'INSERT INTO repertorios (nome, data) VALUES (?, ?)',
      args: [nome.trim(), data]
    });
  }
  res.redirect('/');
});

app.post('/repertorios/:id/edit', async (req, res) => {
  const { nome, data, redirect_to } = req.body;
  if (nome && data) {
    await db.execute({
      sql: 'UPDATE repertorios SET nome = ?, data = ? WHERE id = ?',
      args: [nome.trim(), data, req.params.id]
    });
  }
  if (redirect_to === 'detalhes') {
    return res.redirect(`/repertorios/${req.params.id}`);
  }
  res.redirect('/');
});

app.post('/repertorios/:id/delete', async (req, res) => {
  await db.execute({
    sql: 'DELETE FROM repertorios WHERE id = ?',
    args: [req.params.id]
  });
  res.redirect('/');
});

// ---------------- MINISTRANTES ----------------
app.get('/ministrantes', async (req, res) => {
  try {
    const result = await db.execute(`
      SELECT m.*, COUNT(mm.musica_id) as total_cancoes
      FROM ministrantes m
      LEFT JOIN musica_ministrantes mm ON mm.ministrante_id = m.id
      GROUP BY m.id
      ORDER BY m.nome ASC
    `);
    res.render('ministrantes', { ministrantes: result.rows, erro: req.query.erro || null });
  } catch (err) {
    console.error(err);
    res.status(500).send('Erro ao carregar ministrantes');
  }
});

app.post('/ministrantes', async (req, res) => {
  const nome = req.body.nome?.trim();
  if (nome) {
    try {
      await db.execute({
        sql: 'INSERT INTO ministrantes (nome) VALUES (?)',
        args: [nome]
      });
    } catch (err) {
      if (err.message && (err.message.includes('UNIQUE') || err.message.includes('constraint'))) {
        return res.redirect('/ministrantes?erro=duplicado');
      }
      return res.redirect('/ministrantes?erro=desconhecido');
    }
  }
  res.redirect('/ministrantes');
});

app.post('/ministrantes/:id/delete', async (req, res) => {
  try {
    await db.execute({
      sql: 'DELETE FROM ministrantes WHERE id = ?',
      args: [req.params.id]
    });
    res.redirect('/ministrantes');
  } catch (err) {
    res.redirect('/ministrantes?erro=em_uso');
  }
});

// ---------------- DETALHES DO REPERTÓRIO ----------------
app.get('/repertorios/:id', async (req, res) => {
  try {
    const repRes = await db.execute({
      sql: 'SELECT * FROM repertorios WHERE id = ?',
      args: [req.params.id]
    });
    const repertorio = repRes.rows[0];
    if (!repertorio) return res.status(404).send('Repertório não encontrado');

    const musicasRes = await db.execute({
      sql: `
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
      `,
      args: [req.params.id]
    });

    const musicas = musicasRes.rows.map(m => ({
      ...m,
      ministrantes: JSON.parse(m.ministrantes_json)
    }));

    const minRes = await db.execute('SELECT * FROM ministrantes ORDER BY nome ASC');

    res.render('repertorio', { repertorio, musicas, ministrantes: minRes.rows });
  } catch (err) {
    console.error(err);
    res.status(500).send('Erro ao buscar repertório');
  }
});

// API YouTube
app.get('/api/youtube-search', async (req, res) => {
  const query = req.query.q?.trim();
  if (!query) return res.json([]);
  if (!YOUTUBE_API_KEY) {
    return res.status(400).json({ error: 'Chave de API do YouTube não configurada.' });
  }

  const videoId = extrairYoutubeId(query);
  try {
    if (videoId) {
      const response = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
        params: { part: 'snippet', id: videoId, key: YOUTUBE_API_KEY }
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
      params: { part: 'snippet', q: query, type: 'video', maxResults: 5, key: YOUTUBE_API_KEY }
    });

    const items = response.data.items.map(item => ({
      youtube_id: item.id.videoId,
      titulo: item.snippet.title,
      canal: item.snippet.channelTitle,
      ano: item.snippet.publishedAt ? new Date(item.snippet.publishedAt).getFullYear() : null,
      thumb: item.snippet.thumbnails?.default?.url || ''
    }));

    res.json(items);
  } catch (error) {
    res.status(500).json({ error: 'Falha ao buscar no YouTube.' });
  }
});

// Músicas
app.post('/repertorios/:id/musicas', async (req, res) => {
  let { titulo, artista, ano, ministrantes_ids, youtube_url } = req.body;
  const repertorioId = req.params.id;

  if (!Array.isArray(ministrantes_ids)) {
    ministrantes_ids = ministrantes_ids ? [ministrantes_ids] : [];
  }
  const youtubeId = extrairYoutubeId(youtube_url) || youtube_url;

  if (titulo && artista && ministrantes_ids.length > 0) {
    const insertRes = await db.execute({
      sql: 'INSERT INTO musicas (repertorio_id, titulo, artista, ano, youtube_id) VALUES (?, ?, ?, ?, ?)',
      args: [repertorioId, titulo.trim(), artista.trim(), ano ? parseInt(ano) : null, youtubeId || null]
    });

    const musicaId = Number(insertRes.lastInsertRowid);
    for (const minId of ministrantes_ids) {
      await db.execute({
        sql: 'INSERT INTO musica_ministrantes (musica_id, ministrante_id) VALUES (?, ?)',
        args: [musicaId, parseInt(minId)]
      });
    }
  }

  res.redirect(`/repertorios/${repertorioId}`);
});

app.post('/musicas/:id/edit', async (req, res) => {
  const musicaId = req.params.id;
  let { repertorio_id, titulo, artista, ano, ministrantes_ids, youtube_url } = req.body;

  if (!Array.isArray(ministrantes_ids)) {
    ministrantes_ids = ministrantes_ids ? [ministrantes_ids] : [];
  }
  const youtubeId = extrairYoutubeId(youtube_url) || youtube_url;

  if (titulo && artista && ministrantes_ids.length > 0) {
    await db.execute({
      sql: 'UPDATE musicas SET titulo = ?, artista = ?, ano = ?, youtube_id = ? WHERE id = ?',
      args: [titulo.trim(), artista.trim(), ano ? parseInt(ano) : null, youtubeId || null, musicaId]
    });

    await db.execute({
      sql: 'DELETE FROM musica_ministrantes WHERE musica_id = ?',
      args: [musicaId]
    });

    for (const minId of ministrantes_ids) {
      await db.execute({
        sql: 'INSERT INTO musica_ministrantes (musica_id, ministrante_id) VALUES (?, ?)',
        args: [musicaId, parseInt(minId)]
      });
    }
  }

  res.redirect(`/repertorios/${repertorio_id}`);
});

app.post('/musicas/:id/delete', async (req, res) => {
  const { repertorio_id } = req.body;
  await db.execute({
    sql: 'DELETE FROM musicas WHERE id = ?',
    args: [req.params.id]
  });
  res.redirect(`/repertorios/${repertorio_id}`);
});

// ---------------- ANALYTICS ----------------
app.get('/analytics', async (req, res) => {
  try {
    const topMinRes = await db.execute(`
      SELECT min.nome as ministrante, COUNT(mm.musica_id) as total 
      FROM musica_ministrantes mm
      JOIN ministrantes min ON min.id = mm.ministrante_id
      GROUP BY min.id 
      ORDER BY total DESC 
      LIMIT 10
    `);

    const topMusRes = await db.execute(`
      SELECT titulo, artista, COUNT(*) as total 
      FROM musicas 
      GROUP BY LOWER(TRIM(titulo)), LOWER(TRIM(artista)) 
      ORDER BY total DESC 
      LIMIT 10
    `);

    const topArtRes = await db.execute(`
      SELECT artista, COUNT(*) as total 
      FROM musicas 
      WHERE artista IS NOT NULL AND TRIM(artista) != ''
      GROUP BY LOWER(TRIM(artista)) 
      ORDER BY total DESC 
      LIMIT 10
    `);

    const decadasRes = await db.execute(`
      SELECT 
        CAST((ano / 10) * 10 AS TEXT) || 's' AS decada, 
        COUNT(*) AS total 
      FROM musicas 
      WHERE ano IS NOT NULL AND ano > 1900 
      GROUP BY decada 
      ORDER BY decada ASC
    `);

    const totMusRes = await db.execute('SELECT COUNT(*) as count FROM musicas');
    const totRepRes = await db.execute('SELECT COUNT(*) as count FROM repertorios');
    const totMinRes = await db.execute('SELECT COUNT(*) as count FROM ministrantes');

    res.render('analytics', {
      topMinistrantes: topMinRes.rows,
      topMusicas: topMusRes.rows,
      topArtistas: topArtRes.rows,
      decadas: decadasRes.rows,
      totalMusicas: totMusRes.rows[0].count,
      totalRepertorios: totRepRes.rows[0].count,
      totalMinistrantes: totMinRes.rows[0].count
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Erro ao carregar analytics');
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});