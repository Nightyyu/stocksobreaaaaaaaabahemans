import { parse } from 'node-html-parser'; // Usar cheerio pode ser pesado, usar node-html-parser ou cheerio

const STOCK_URL = 'https://vulcanvalues.com/grow-a-garden/stock';

// Categoria padrão
const CATEGORIES = ['seeds', 'gear', 'egg_shop', 'honey', 'cosmetics'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/') {
      return new Response(JSON.stringify({
        message: 'API de Estoque Grow a Garden',
        endpoints: {
          '/api/grow-a-garden/stock': 'GET - Obter dados de estoque',
          '/api/grow-a-garden/stock?category=CATEGORIA': 'GET - Obter dados de uma categoria específica',
          '/api/grow-a-garden/stock/refresh': 'GET - Forçar atualização dos dados',
        },
        categorias_disponiveis: CATEGORIES
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (url.pathname === '/api/grow-a-garden/stock') {
      const category = url.searchParams.get('category');
      if (category) {
        if (!CATEGORIES.includes(category)) {
          return jsonResponse({ error: 'Categoria não encontrada ou inválida' }, 404);
        }
        const data = await loadFromKV(env, category);
        if (!data) {
          return jsonResponse({ error: 'Sem dados para essa categoria' }, 404);
        }
        return jsonResponse({ [category]: data.items, last_updated: data.last_updated });
      }
      // Retorna tudo
      const allData = {};
      let lastUpdatedGlobal = null;
      for (const cat of CATEGORIES) {
        const data = await loadFromKV(env, cat);
        allData[cat] = data ? data.items : [];
        if (!lastUpdatedGlobal && data?.last_updated) {
          lastUpdatedGlobal = data.last_updated;
        }
      }
      allData['last_updated'] = lastUpdatedGlobal;
      return jsonResponse(allData);
    }

    if (url.pathname === '/api/grow-a-garden/stock/refresh') {
      // Forçar atualização
      const result = await scrapeAndSave(env);
      return jsonResponse({ message: 'Dados atualizados', last_updated: result.last_updated });
    }

    return new Response('Not Found', { status: 404 });
  }
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function scrapeAndSave(env) {
  console.log('Iniciando scraping...');
  try {
    const response = await fetch(STOCK_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 10000,
    });
    if (!response.ok) throw new Error(`HTTP error ${response.status}`);

    const html = await response.text();

    // Parse com node-html-parser
    const root = parse(html);

    // Vamos buscar a grid principal pelo seletor que você usou no Python
    let stockGrid = root.querySelector('div.grid.grid-cols-1.md\\:grid-cols-3.gap-6.px-6.text-left.max-w-screen-lg.mx-auto');
    if (!stockGrid) {
      stockGrid = root.querySelector('div.grid') || root.querySelector('main') || root.querySelector('section');
    }
    if (!stockGrid) {
      throw new Error('Seção de estoque não encontrada');
    }

    const newData = {
      seeds: [],
      gear: [],
      egg_shop: [],
      honey: [],
      cosmetics: []
    };

    // Função para extrair tempo em segundos do texto tipo "03m 56s"
    function parseUpdateTime(text) {
      text = text.toLowerCase();
      const regex = /(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?/;
      const m = text.match(regex);
      if (!m) return 300;
      const h = m[1] ? parseInt(m[1]) : 0;
      const min = m[2] ? parseInt(m[2]) : 0;
      const s = m[3] ? parseInt(m[3]) : 0;
      return Math.max(h * 3600 + min * 60 + s, 30);
    }

    // Iterar pelas seções filhas de stockGrid que contenham h2 com categoria
    const sections = stockGrid.querySelectorAll('div');
    let lastUpdated = new Date().toISOString();

    for (const section of sections) {
      const h2 = section.querySelector('h2');
      if (!h2) continue;
      const categoryRaw = h2.text.trim().toLowerCase();

      let categoryKey;
      if (categoryRaw.includes('gear')) categoryKey = 'gear';
      else if (categoryRaw.includes('egg')) categoryKey = 'egg_shop';
      else if (categoryRaw.includes('seeds')) categoryKey = 'seeds';
      else if (categoryRaw.includes('honey')) categoryKey = 'honey';
      else if (categoryRaw.includes('cosmetics')) categoryKey = 'cosmetics';
      else continue;

      // Procurar texto "UPDATES IN:"
      const updateText = Array.from(section.querySelectorAll('p, div, span'))
        .map(el => el.text)
        .find(t => t && t.toLowerCase().includes('updates in:'));
      // Para controle, pode usar parseUpdateTime(updateText) se precisar guardar

      // Procurar lista de itens <ul>
      const ul = section.querySelector('ul');
      if (!ul) continue;

      const items = [];
      for (const li of ul.querySelectorAll('li')) {
        const text = li.text.trim();
        if (!text) continue;

        let name = text;
        let stock = 1;
        // Tenta extrair "Nome x123"
        const m = text.match(/^(.*) x(\d+)$/);
        if (m) {
          name = m[1].trim();
          stock = parseInt(m[2]);
        }
        items.push({ name, stock, price: 0 });
      }

      newData[categoryKey] = items;

      // Salvar no KV
      await saveToKV(env, categoryKey, items, lastUpdated);
    }

    console.log('Scraping finalizado e dados salvos.');

    return { last_updated: lastUpdated };

  } catch (error) {
    console.error('Erro no scraping:', error);
    throw error;
  }
}

// Salva dados no KV
async function saveToKV(env, category, items, last_updated) {
  const value = JSON.stringify({ items, last_updated });
  await env.STOCK_KV.put(`stock:${category}`, value);
}

// Lê dados do KV
async function loadFromKV(env, category) {
  const value = await env.STOCK_KV.get(`stock:${category}`);
  if (!value) return null;
  return JSON.parse(value);
}
