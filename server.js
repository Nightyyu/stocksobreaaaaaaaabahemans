const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const app = express();

const DB_PATH = path.resolve(__dirname, 'database.sqlite');

function loadFromDb(category) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH);
    const query = category
      ? 'SELECT name,stock,price,last_updated FROM stock WHERE category = ?'
      : 'SELECT category,name,stock,price,last_updated FROM stock';

    const params = category ? [category] : [];
    db.all(query, params, (err, rows) => {
      db.close();
      if (err) return reject(err);

      if (category) {
        const items = rows.map(r => ({ name: r.name, stock: r.stock, price: r.price }));
        const last = rows.length > 0 ? rows[0].last_updated : null;
        resolve({ items, last });
      } else {
        let data = {};
        rows.forEach(r => {
          if (!data[r.category]) data[r.category] = [];
          data[r.category].push({ name: r.name, stock: r.stock, price: r.price });
          data.last_updated = r.last_updated;
        });
        resolve(data);
      }
    });
  });
}

app.get('/', (req, res) => {
  res.json({
    message: 'API de Estoque Grow a Garden',
    endpoints: {
      '/api/grow-a-garden/stock': 'GET – dados completos ou por category query',
      '/api/grow-a-garden/stock/refresh': 'GET – força refresh'
    },
    categorias_disponíveis: ['seeds', 'gear', 'egg_shop', 'honey', 'cosmetics']
  });
});

app.get('/api/grow-a-garden/stock', async (req, res) => {
  try {
    const cat = req.query.category;
    const data = await loadFromDb(cat);
    if (cat && (!data.items || data.items.length === 0)) return res.status(404).json({ error: 'Categoria não encontrada ou sem dados' });
    res.json(cat ? { [cat]: data.items, last_updated: data.last } : data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/grow-a-garden/stock/refresh', async (req, res) => {
  try {
    const { scrapeAndSave } = require('./scraping');
    await scrapeAndSave();
    const data = await loadFromDb();
    res.json({ message: 'Dados atualizados', last_updated: data.last_updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`Servidor rodando na porta ${port}`));
