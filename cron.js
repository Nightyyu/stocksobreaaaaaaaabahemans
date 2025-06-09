const cron = require('node-cron');
const { initDb, scrapeAndSave } = require('./scraping');

initDb();
scrapeAndSave();

// Agendamento: a cada 5 minutos
cron.schedule('*/5 * * * *', () => {
  console.log('Agendador ativo:', new Date());
  scrapeAndSave().catch(console.error);
});
