console.log("🚀 SISTEMA BASE CARREGADO 🚀");

const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { google } = require('googleapis');

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

const app = express();
app.use(express.json());

const bot = new TelegramBot(token);
bot.setWebHook(`${process.env.RENDER_EXTERNAL_URL}/webhook`);

app.post('/webhook', (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

bot.on('message', async (msg) => {

  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;

  if (text.toLowerCase().startsWith("gastei")) {

    const partes = text.split(" ");
    const valor = parseFloat(partes[1]);
    const descricao = partes.slice(2).join(" ");

    if (isNaN(valor)) {
      await bot.sendMessage(chatId, "Use: Gastei 50 mercado");
      return;
    }

    const hoje = new Date();
    const mes = hoje.getMonth() + 1;
    const ano = hoje.getFullYear();
    const data = hoje.toISOString().split("T")[0];

    // ========================
    // SALVAR NO SUPABASE
    // ========================
    const { error } = await supabase.from("despesas").insert([
      { valor, descricao, data, mes, ano, categoria: "Manual" }
    ]);

    if (error) {
      console.log("❌ Supabase:", error);
      await bot.sendMessage(chatId, "Erro ao salvar no banco.");
      return;
    }

    console.log("✅ Salvou no Supabase");

    // ========================
    // SALVAR NA PLANILHA
    // ========================
    try {

      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: "Dados!A:F",
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [[data, valor, descricao, mes, ano, "Manual"]]
        }
      });

      console.log("✅ Salvou na planilha");

    } catch (sheetError) {

      console.log("❌ Planilha:", sheetError);
      await bot.sendMessage(chatId, "Salvou no banco, mas erro na planilha.");
      return;
    }

    await bot.sendMessage(chatId,
      `✅ Registrado:\n\n💰 R$ ${valor.toFixed(2)}\n🏪 ${descricao}`
    );

    return;
  }

  await bot.sendMessage(chatId, "Digite: Gastei 50 mercado");
});

app.listen(process.env.PORT || 3000);
