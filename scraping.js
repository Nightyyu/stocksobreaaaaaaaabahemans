const axios = require('axios');
const cheerio = require('cheerio');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.resolve(__dirname, 'database.sqlite');

function initDb() {
  const db = new sqlite3.Database(DB_PATH);
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS stock (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT,
      name TEXT,
      stock INTEGER,
      price INTEGER,
      last_updated TEXT
    )`);
  });
  db.close();
}

async function scrapeAndSave() {
  const url = 'https://vulcanvalues.com/grow-a-garden/stock';
  const resp = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }});
  const $ = cheerio.load(resp.data);

  const now = new Date().toISOString();
  const categories = ['seeds', 'gear', 'egg_shop', 'honey', 'cosmetics'];

  const db = new sqlite3.Database(DB_PATH);
  let statements = [];

  categories.forEach(category => {
    statements.push(new Promise(resolve => {
      db.run(`DELETE FROM stock WHERE category = ?`, [category], resolve);
    }));
  });

  await Promise.all(statements);

  $('.grid div').each((i, el) => {
    const h2 = $(el).find('h2').text().trim().toLowerCase();
    const cat = categories.find(c => h2.includes(c));
    if (!cat) return;

    $(el).find('li').each((j, li) => {
      const txt = $(li).text().trim();
      if (!txt) return;

      let [name, count] = txt.split(/ x/i);
      count = parseInt(count) || 1;
      db.run(`INSERT INTO stock (category,name,stock,price,last_updated) VALUES (?,?,?,?,?)`,
        cat, name.trim(), count, 0, now);
    });
  });

  db.close();
  console.log(`Dados atualizados em ${now}`);
}

module.exports = { initDb, scrapeAndSave };
