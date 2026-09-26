require('dotenv').config();

const { createClient } = require('@libsql/client');
const path = require('path');

const url = process.env.TURSO_DATABASE_URL || `file:${path.join(__dirname, 'louvor.db')}`;
const authToken = process.env.TURSO_AUTH_TOKEN || undefined;

const db = createClient({
  url,
  authToken
});

async function initDB() {
  await db.execute('PRAGMA foreign_keys = ON;');

  // Tabelas existentes (preservadas)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS ministrantes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS repertorios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS musicas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repertorio_id INTEGER NOT NULL,
      titulo TEXT NOT NULL,
      artista TEXT NOT NULL,
      ano INTEGER,
      youtube_id TEXT,
      FOREIGN KEY (repertorio_id) REFERENCES repertorios(id) ON DELETE CASCADE
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS musica_ministrantes (
      musica_id INTEGER NOT NULL,
      ministrante_id INTEGER NOT NULL,
      PRIMARY KEY (musica_id, ministrante_id),
      FOREIGN KEY (musica_id) REFERENCES musicas(id) ON DELETE CASCADE,
      FOREIGN KEY (ministrante_id) REFERENCES ministrantes(id) ON DELETE CASCADE
    );
  `);

  // NOVAS TABELAS DE TEMAS (Não apagam nada anterior)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS temas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS musica_temas (
      musica_id INTEGER NOT NULL,
      tema_id INTEGER NOT NULL,
      PRIMARY KEY (musica_id, tema_id),
      FOREIGN KEY (musica_id) REFERENCES musicas(id) ON DELETE CASCADE,
      FOREIGN KEY (tema_id) REFERENCES temas(id) ON DELETE CASCADE
    );
  `);
}

initDB().catch(console.error);

module.exports = db;