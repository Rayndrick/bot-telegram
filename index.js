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

bot.on('message', async (msg) => {

  const chatId = msg.chat.id;
  const text = msg.text;

  // ==========================
  // FOTO (OCR)
  // ==========================
  if (msg.photo) {
    try {

      console.log("📸 Foto recebida");

      const photo = msg.photo[msg.photo.length - 1];
      const file = await bot.getFile(photo.file_id);

      const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

      const response = await fetch(fileUrl);
      const buffer = await response.arrayBuffer();
      const base64Image = Buffer.from(buffer).toString("base64");

      const [result] = await visionClient.textDetection({
        image: { content: base64Image },
      });

      const textoExtraido = result.textAnnotations?.[0]?.description;

      if (!textoExtraido) {
        await bot.sendMessage(chatId, "❌ Não consegui ler a nota.");
        return;
      }

      console.log("🧠 Texto extraído:", textoExtraido);

      const linhas = textoExtraido.split("\n");

      // DATA
      const dataMatch = textoExtraido.match(/\d{2}\/\d{2}\/\d{4}/);
      const dataFinal = dataMatch
        ? dataMatch[0]
        : new Date().toISOString().split("T")[0];

      // TOTAL
      const valores = textoExtraido.match(/\d+[.,]\d{2}/g);
      const valorFinal = valores
        ? parseFloat(valores[valores.length - 1].replace(",", "."))
        : null;

      if (!valorFinal) {
        await bot.sendMessage(chatId, "❌ Não identifiquei o valor.");
        return;
      }

      // DESCRIÇÃO
      let descricaoFinal = linhas[1] || "Compra";
      descricaoFinal = descricaoFinal.replace(/^110\s+/i, "TIO ");

      const hoje = new Date();
      const mes = hoje.getMonth() + 1;
      const ano = hoje.getFullYear();

      const { error } = await supabase.from("despesas").insert([
        {
          valor: valorFinal,
          descricao: descricaoFinal,
          data: dataFinal,
          mes,
          ano,
          categoria: "Restaurante"
        }
      ]);

      if (error) {
        console.log("❌ Erro Supabase:", error);
        await bot.sendMessage(chatId, "Erro ao salvar no banco.");
        return;
      }

      await bot.sendMessage(chatId,
        `✅ Registrado:\n\n🏪 ${descricaoFinal}\n💰 R$ ${valorFinal.toFixed(2)}\n📅 ${dataFinal}`
      );

    } catch (error) {
      console.log("❌ ERRO OCR:", error);
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

    const hoje = new Date();
    const mes = hoje.getMonth() + 1;
    const ano = hoje.getFullYear();
    const data = hoje.toISOString().split("T")[0];

    const { error } = await supabase.from("despesas").insert([
      { valor, descricao, data, mes, ano, categoria: "Outros" }
    ]);

    if (error) {
      console.log("❌ Erro Supabase:", error);
      await bot.sendMessage(chatId, "Erro ao salvar no banco.");
      return;
    }

    await bot.sendMessage(chatId,
      `✅ Registrado: R$ ${valor.toFixed(2)} - ${descricao}`
    );

    return;
  }

  await bot.sendMessage(chatId, "Envie uma foto ou digite Gastei 50 mercado");
});

app.get("/", (req, res) => {
  res.send("Bot rodando");
});

app.listen(process.env.PORT || 3000);
