console.log("🚀 SISTEMA COMPLETO CARREGADO 🚀");

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

  if (desc.includes("burger") || desc.includes("armenio") || desc.includes("rest"))
    return "Restaurante";

  if (desc.includes("mercado"))
    return "Supermercado";

  if (desc.includes("posto"))
    return "Combustível";

  return "Outros";
}

bot.on('message', async (msg) => {

  const chatId = msg.chat.id;
  const text = msg.text;

  // ==========================
  // FOTO (OCR)
  // ==========================
  if (msg.photo) {

    try {

      const photo = msg.photo[msg.photo.length - 1];
      const file = await bot.getFile(photo.file_id);

      const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

      const response = await fetch(fileUrl);
      const buffer = await response.arrayBuffer();
      const base64Image = Buffer.from(buffer).toString("base64");

      const [result] = await visionClient.textDetection({
        image: { content: base64Image },
      });

      const texto = result.textAnnotations?.[0]?.description;

      if (!texto) {
        await bot.sendMessage(chatId, "❌ Não consegui ler a nota.");
        return;
      }

      const linhas = texto.split("\n");

      // DATA
      const dataMatch = texto.match(/\d{2}\/\d{2}\/\d{4}/);
      const dataFinal = dataMatch
        ? dataMatch[0]
        : new Date().toISOString().split("T")[0];

      // VALOR TOTAL
      const valores = texto.match(/\d+[.,]\d{2}/g);
      const valorFinal = valores
        ? parseFloat(valores[valores.length - 1].replace(",", "."))
        : null;

      if (!valorFinal) {
        await bot.sendMessage(chatId, "❌ Não identifiquei o valor.");
        return;
      }

      // DESCRIÇÃO
      let descricaoFinal = linhas[1] || "Compra";
      const categoria = classificarCategoria(descricaoFinal);

      const hoje = new Date();
      const mes = hoje.getMonth() + 1;
      const ano = hoje.getFullYear();

      // SALVAR NO SUPABASE
      const { error } = await supabase.from("despesas").insert([
        { valor: valorFinal, descricao: descricaoFinal, data: dataFinal, mes, ano, categoria }
      ]);

      if (error) {
        console.log("❌ Supabase:", error);
        await bot.sendMessage(chatId, "Erro ao salvar no banco.");
        return;
      }

      // SALVAR NA PLANILHA
      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: "Dados!A:F",
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [[dataFinal, valorFinal, descricaoFinal, mes, ano, categoria]]
        }
      });

      await bot.sendMessage(chatId,
        `✅ Registrado automaticamente:\n\n🏪 ${descricaoFinal}\n💰 R$ ${valorFinal.toFixed(2)}\n📅 ${dataFinal}`
      );

    } catch (error) {

      console.log("❌ OCR:", error);
      await bot.sendMessage(chatId, "Erro ao processar imagem.");
    }

    return;
  }

  // ==========================
  // REGISTRO MANUAL
  // ==========================
  if (text && text.toLowerCase().startsWith("gastei")) {

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
      `✅ Registrado:\n\n💰 R$ ${valor.toFixed(2)}\n🏪 ${descricao}`
    );

    return;
  }

  await bot.sendMessage(chatId, "Envie uma foto ou use: Gastei 50 mercado");
});

app.listen(process.env.PORT || 3000);
