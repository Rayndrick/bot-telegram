console.log("🚀 SISTEMA FINANCEIRO DEFINITIVO V2 🚀");

const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));

const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { google } = require('googleapis');
const vision = require('@google-cloud/vision');

const token = process.env.TOKEN;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

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

app.post('/webhook', (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

function classificarCategoria(descricao) {
  const desc = descricao.toLowerCase();

  if (desc.includes("armenio") || desc.includes("burger") || desc.includes("pizza"))
    return "Restaurante";

  if (desc.includes("mercado"))
    return "Supermercado";

  if (desc.includes("posto"))
    return "Combustível";

  return "Outros";
}

bot.on('message', async (msg) => {

  const chatId = msg.chat.id;
  const text = msg.text?.trim().toLowerCase();

  // ==========================
  // AJUDA
  // ==========================
  if (text === "ajuda" || text === "/ajuda") {
    await bot.sendMessage(chatId,
`📌 COMANDOS DISPONÍVEIS:

📸 Envie foto da nota → Registro automático
💰 Gastei 50 mercado → Registro manual

📊 /total → Total mês atual
📆 /mes 2 2026 → Total mês específico
📂 /categorias → Resumo categorias
📂 /cat restaurante → Categoria mês atual
📂 /cat restaurante 2 2026 → Categoria mês específico
📋 /listar → Lista despesas mês atual`
    );
    return;
  }

  // ==========================
  // TOTAL MÊS ATUAL
  // ==========================
  if (text === "/total") {

    const hoje = new Date();
    const mes = hoje.getMonth() + 1;
    const ano = hoje.getFullYear();

    const { data } = await supabase
      .from('despesas')
      .select('valor')
      .eq('mes', mes)
      .eq('ano', ano);

    const total = (data || []).reduce((acc, item) => acc + Number(item.valor), 0);

    await bot.sendMessage(chatId,
      `📊 Total mês atual: R$ ${total.toFixed(2)}`
    );
    return;
  }

  // ==========================
  // LISTAR
  // ==========================
  if (text === "/listar") {

    const hoje = new Date();
    const mes = hoje.getMonth() + 1;
    const ano = hoje.getFullYear();

    const { data } = await supabase
      .from('despesas')
      .select('*')
      .eq('mes', mes)
      .eq('ano', ano)
      .order('data', { ascending: true });

    if (!data || data.length === 0) {
      await bot.sendMessage(chatId, "Nenhuma despesa neste mês.");
      return;
    }

    let mensagem = "📋 Despesas do mês:\n\n";

    data.forEach(item => {
      mensagem += `${item.data} - R$ ${Number(item.valor).toFixed(2)} - ${item.descricao} (${item.categoria})\n`;
    });

    await bot.sendMessage(chatId, mensagem);
    return;
  }

  // ==========================
  // REGISTRO MANUAL
  // ==========================
  if (text && text.startsWith("gastei")) {

    const partes = text.split(" ");
    const valor = parseFloat(partes[1]);
    const descricao = partes.slice(2).join(" ");

    if (isNaN(valor)) {
      await bot.sendMessage(chatId, "Use: Gastei 50 mercado");
      return;
    }

    const categoria = classificarCategoria(descricao);

    const hoje = new Date();
    const mes = hoje.getMonth() + 1;
    const ano = hoje.getFullYear();
    const data = hoje.toISOString().split("T")[0];

    await supabase.from("despesas").insert([
      { valor, descricao, data, mes, ano, categoria }
    ]);

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "Dados!A:F",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[data, valor, descricao, mes, ano, categoria]]
      }
    });

    await bot.sendMessage(chatId,
      `✅ Registrado:

💰 R$ ${valor.toFixed(2)}
🏪 ${descricao}
📂 ${categoria}`
    );

    return;
  }

  await bot.sendMessage(chatId, "Digite /ajuda para ver os comandos.");
});

app.listen(process.env.PORT || 3000);
