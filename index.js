export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const category = url.searchParams.get('category');

    if (path === '/api/grow-a-garden/stock') {
      if (category) {
        const data = await env.STOCK_KV.get(category, { type: "json" });
        if (!data) {
          return new Response(JSON.stringify({ error: 'Categoria não encontrada ou sem dados' }), { status: 404, headers: { "Content-Type": "application/json" }});
        }
        const lastUpdated = await env.STOCK_KV.get('last_updated');
        return new Response(JSON.stringify({ [category]: data, last_updated: lastUpdated }), { headers: { "Content-Type": "application/json" }});
      } else {
        // Pega tudo junto
        const seeds = await env.STOCK_KV.get('seeds', { type: "json" }) || [];
        const gear = await env.STOCK_KV.get('gear', { type: "json" }) || [];
        const egg_shop = await env.STOCK_KV.get('egg_shop', { type: "json" }) || [];
        const honey = await env.STOCK_KV.get('honey', { type: "json" }) || [];
        const cosmetics = await env.STOCK_KV.get('cosmetics', { type: "json" }) || [];
        const lastUpdated = await env.STOCK_KV.get('last_updated');
        return new Response(JSON.stringify({ seeds, gear, egg_shop, honey, cosmetics, last_updated: lastUpdated }), { headers: { "Content-Type": "application/json" }});
      }
    }

    if (path === '/api/grow-a-garden/stock/refresh') {
      try {
        await scrapeStock(env);
        const lastUpdated = await env.STOCK_KV.get('last_updated');
        return new Response(JSON.stringify({ message: 'Dados atualizados', last_updated: lastUpdated }), { headers: { "Content-Type": "application/json" }});
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { "Content-Type": "application/json" }});
      }
    }

    if (path === '/') {
      return new Response(JSON.stringify({
        message: 'API de Estoque Grow a Garden',
        endpoints: {
          '/api/grow-a-garden/stock': 'GET - Obter dados de estoque',
          '/api/grow-a-garden/stock?category=CATEGORIA': 'GET - Obter dados de uma categoria específica',
          '/api/grow-a-garden/stock/refresh': 'GET - Forçar atualização dos dados',
        },
        categorias_disponíveis: ['seeds', 'gear', 'egg_shop', 'honey', 'cosmetics'],
      }), { headers: { "Content-Type": "application/json" }});
    }

    return new Response("Not Found", { status: 404 });
  }
}

// Função que converte "03m 56s" para segundos
function parseUpdateTime(timeText) {
  timeText = timeText.toLowerCase().trim();
  const regex = /(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?/;
  const match = regex.exec(timeText);
  if (!match) return 300; // padrão 5min

  const hours = parseInt(match[1]) || 0;
  const minutes = parseInt(match[2]) || 0;
  const seconds = parseInt(match[3]) || 0;
  const total = hours * 3600 + minutes * 60 + seconds;
  return total >= 30 ? total : 30;
}

// Função para raspar dados do site
async function scrapeStock(env) {
  const url = 'https://vulcanvalues.com/grow-a-garden/stock';
  const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Falha no scraping: ${res.status}`);

  const html = await res.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // Mapeamento categorias e seletor base
  const categoryKeys = ['seeds', 'gear', 'egg_shop', 'honey', 'cosmetics'];
  const newData = {
    seeds: [],
    gear: [],
    egg_shop: [],
    honey: [],
    cosmetics: [],
  };
  let nextUpdateTimes = {};

  // Encontrar container principal (tentativa adaptada)
  let stockGrid = doc.querySelector('div.grid.grid-cols-1.md\\:grid-cols-3.gap-6.px-6.text-left.max-w-screen-lg.mx-auto');
  if (!stockGrid) {
    stockGrid = doc.querySelector('div.grid') || doc.querySelector('main') || doc.querySelector('section');
  }
  if (!stockGrid) throw new Error("Estrutura principal não encontrada");

  // Itera por cada seção/categoria
  const sections = stockGrid.querySelectorAll('div');
  for (const section of sections) {
    const h2 = section.querySelector('h2');
    if (!h2) continue;

    const categoryRaw = h2.textContent.trim().toLowerCase();
    let categoryKey = null;

    if (categoryRaw.includes('gear')) categoryKey = 'gear';
    else if (categoryRaw.includes('egg')) categoryKey = 'egg_shop';
    else if (categoryRaw.includes('seeds')) categoryKey = 'seeds';
    else if (categoryRaw.includes('honey')) categoryKey = 'honey';
    else if (categoryRaw.includes('cosmetics')) categoryKey = 'cosmetics';
    else continue;

    // Tempo para próxima atualização
    let updateText = "";
    const pUpdates = Array.from(section.querySelectorAll('p, div, span')).find(el => el.textContent.toLowerCase().includes('updates in:'));
    if (pUpdates) {
      const match = pUpdates.textContent.toLowerCase().match(/updates in:\s*(.+)/);
      if (match) updateText = match[1].trim();
    }
    const updateSeconds = parseUpdateTime(updateText);
    nextUpdateTimes[categoryKey] = updateSeconds;

    // Lista de itens
    const ul = section.querySelector('ul');
    if (!ul) continue;

    for (const li of ul.querySelectorAll('li')) {
      const itemText = li.textContent.trim();
      if (!itemText) continue;

      let name = itemText;
      let stock = 1;

      if (itemText.includes(' x')) {
        const parts = itemText.split(' x');
        name = parts[0].trim();
        stock = parseInt(parts[1]) || 1;
      }

      newData[categoryKey].push({ name, stock, price: 0 });
    }
  }

  // Salvar no KV
  const nowIso = new Date().toISOString();
  for (const cat of categoryKeys) {
    await env.STOCK_KV.put(cat, JSON.stringify(newData[cat]));
  }
  await env.STOCK_KV.put('last_updated', nowIso);

  return { newData, nextUpdateTimes };
}
