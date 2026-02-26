const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));

const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { google } = require('googleapis');
const vision = require('@google-cloud/vision');

const token = process.env.TOKEN;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

const visionClient = new vision.ImageAnnotatorClient({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
});

const app = express();
app.use(express.json());

const bot = new TelegramBot(token);
bot.setWebHook(`${process.env.RENDER_EXTERNAL_URL}/webhook`);

app.post('/webhook', async (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

bot.on('message', async (msg) => {

  const chatId = msg.chat.id;
  const text = msg.text;

  // ==========================
  // AJUDA
  // ==========================
  if (text && (text.toLowerCase() === "/ajuda" || text.toLowerCase() === "ajuda")) {
    await bot.sendMessage(chatId,
`📌 Comandos disponíveis:

📸 Envie foto da nota → Registro automático
💰 Gastei 50 mercado → Registro manual

📊 /total → Total mês atual
📆 /mes 2 2026 → Total mês específico

📂 /categorias → Resumo categorias mês atual
📂 /cat restaurante → Categoria mês atual
📂 /cat restaurante 2 2026 → Categoria mês específico

📋 /listar → Lista mês atual`
    );
    return;
  }

  // ==========================
  // TOTAL MÊS ATUAL
  // ==========================
  if (text && text.toLowerCase() === "/total") {

    const hoje = new Date();
    const mes = hoje.getMonth() + 1;
    const ano = hoje.getFullYear();

    const { data } = await supabase
      .from('despesas')
      .select('valor')
      .eq('mes', mes)
      .eq('ano', ano);

    const total = (data || []).reduce((acc, item) => acc + Number(item.valor), 0);

    await bot.sendMessage(chatId, `📊 Total do mês: R$ ${total.toFixed(2)}`);
    return;
  }

  // ==========================
  // TOTAL POR MÊS ESPECÍFICO
  // ==========================
  if (text && text.toLowerCase().startsWith("/mes")) {

    const partes = text.split(" ");

    if (partes.length < 3) {
      await bot.sendMessage(chatId, "Use: /mes 2 2026");
      return;
    }

    const mesEscolhido = parseInt(partes[1]);
    const anoEscolhido = parseInt(partes[2]);

    const { data } = await supabase
      .from('despesas')
      .select('valor')
      .eq('mes', mesEscolhido)
      .eq('ano', anoEscolhido);

    const total = (data || []).reduce((acc, item) => acc + Number(item.valor), 0);

    await bot.sendMessage(chatId,
      `📆 Total ${mesEscolhido}/${anoEscolhido}: R$ ${total.toFixed(2)}`
    );

    return;
  }

  // ==========================
  // RESUMO CATEGORIAS MÊS ATUAL
  // ==========================
  if (text && text.toLowerCase() === "/categorias") {

    const hoje = new Date();
    const mes = hoje.getMonth() + 1;
    const ano = hoje.getFullYear();

    const { data } = await supabase
      .from('despesas')
      .select('valor, categoria')
      .eq('mes', mes)
      .eq('ano', ano);

    if (!data || data.length === 0) {
      await bot.sendMessage(chatId, "Nenhuma despesa encontrada.");
      return;
    }

    const resumo = {};

    data.forEach(item => {
      if (!resumo[item.categoria]) resumo[item.categoria] = 0;
      resumo[item.categoria] += Number(item.valor);
    });

    let mensagem = "📂 Gastos por categoria:\n\n";

    for (let cat in resumo) {
      mensagem += `• ${cat}: R$ ${resumo[cat].toFixed(2)}\n`;
    }

    await bot.sendMessage(chatId, mensagem);
    return;
  }

  // ==========================
  // CATEGORIA ESPECÍFICA
  // ==========================
  if (text && text.toLowerCase().startsWith("/cat")) {

    const partes = text.split(" ");

    if (partes.length < 2) {
      await bot.sendMessage(chatId, "Use: /cat restaurante OU /cat restaurante 2 2026");
      return;
    }

    const nomeCategoria = partes[1];

    let mesEscolhido;
    let anoEscolhido;

    if (partes.length >= 4) {
      mesEscolhido = parseInt(partes[2]);
      anoEscolhido = parseInt(partes[3]);
    } else {
      const hoje = new Date();
      mesEscolhido = hoje.getMonth() + 1;
      anoEscolhido = hoje.getFullYear();
    }

    const { data } = await supabase
      .from('despesas')
      .select('valor')
      .ilike('categoria', nomeCategoria)
      .eq('mes', mesEscolhido)
      .eq('ano', anoEscolhido);

    const total = (data || []).reduce((acc, item) => acc + Number(item.valor), 0);

    await bot.sendMessage(chatId,
      `📂 ${nomeCategoria} (${mesEscolhido}/${anoEscolhido}): R$ ${total.toFixed(2)}`
    );

    return;
  }

  await bot.sendMessage(chatId, "Digite /ajuda para ver os comandos disponíveis.");
});

app.get('/', (req, res) => {
  res.send("Bot rodando");
});

app.listen(process.env.PORT || 3000);
