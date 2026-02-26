console.log("📊 TESTE PLANILHA CARREGADO 📊");

const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const { google } = require('googleapis');

const token = process.env.TOKEN;

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

  if (text.toLowerCase() === "planilha") {

    console.log("📩 Recebeu PLANILHA");

    try {

      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: "Dados!A:F",
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [[
            "2026-02-26",
            777,
            "TESTE PLANILHA",
            2,
            2026,
            "Teste"
          ]]
        }
      });

      console.log("✅ Salvou na planilha");
      await bot.sendMessage(chatId, "✅ Salvou na planilha!");

    } catch (error) {

      console.log("❌ ERRO PLANILHA:", error);
      await bot.sendMessage(chatId, "❌ Erro na planilha.");
    }

    return;
  }

  await bot.sendMessage(chatId, "Digite: planilha");
});

app.listen(process.env.PORT || 3000);
