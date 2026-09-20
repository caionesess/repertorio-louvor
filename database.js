const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, 'louvor.db'));

// Habilita chaves estrangeiras
db.exec('PRAGMA foreign_keys = ON;');

// Criação das tabelas
db.exec(`
  CREATE TABLE IF NOT EXISTS ministrantes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS repertorios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS musicas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repertorio_id INTEGER NOT NULL,
    titulo TEXT NOT NULL,
    artista TEXT NOT NULL,
    ano INTEGER,
    youtube_id TEXT,
    FOREIGN KEY (repertorio_id) REFERENCES repertorios(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS musica_ministrantes (
    musica_id INTEGER NOT NULL,
    ministrante_id INTEGER NOT NULL,
    PRIMARY KEY (musica_id, ministrante_id),
    FOREIGN KEY (musica_id) REFERENCES musicas(id) ON DELETE CASCADE,
    FOREIGN KEY (ministrante_id) REFERENCES ministrantes(id) ON DELETE CASCADE
  );
`);

module.exports = db;