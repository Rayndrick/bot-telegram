const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));

const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { google } = require('googleapis');
const vision = require('@google-cloud/vision');

const token = process.env.TOKEN;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

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
  // 📖 AJUDA
  // ==========================
  if (text && (text.toLowerCase() === "/ajuda" || text.toLowerCase() === "ajuda")) {
    await bot.sendMessage(
      chatId,
`📌 *Comandos disponíveis:*

📸 Envie uma *foto da nota* → registra automaticamente

💰 Gastei 50 mercado  
→ Registro manual

📋 /listar  
→ Lista despesas do mês atual

📊 /total  
→ Total do mês atual

📊 /total 2 2026  
→ Total de um mês específico

📂 /categorias  
→ Total por categoria no mês atual

📂 /categoria restaurante  
→ Total da categoria no mês atual

📂 /categoria restaurante 2 2026  
→ Total da categoria em mês específico

📖 /ajuda  
→ Mostra esta mensagem`
      , { parse_mode: "Markdown" });

    return;
  }

  // ==========================
  // 📸 FOTO (OCR)
  // ==========================
  if (msg.photo) {
    try {

      const photo = msg.photo[msg.photo.length - 1];
      const fileId = photo.file_id;

      const file = await bot.getFile(fileId);
      const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

      const response = await fetch(fileUrl);
      const buffer = await response.arrayBuffer();
      const base64Image = Buffer.from(buffer).toString("base64");

      const [result] = await visionClient.textDetection({
        image: { content: base64Image },
      });

      const detections = result.textAnnotations;

      if (!detections || detections.length === 0) {
        await bot.sendMessage(chatId, "❌ Não consegui identificar texto na imagem.");
        return;
      }

      const textoExtraido = detections[0].description;
      const linhas = textoExtraido.split("\n");

      const dataRegex = /\b\d{2}\/\d{2}\/\d{4}\b/;
      const dataEncontrada = textoExtraido.match(dataRegex);
      const dataFinal = dataEncontrada
        ? dataEncontrada[0]
        : new Date().toISOString().split("T")[0];

      const totalLinhaRegex = /Total\s*[:\-]?\s*(\d+[.,]\d{2})/i;
      let valorMatch = textoExtraido.match(totalLinhaRegex);

      if (!valorMatch) {
        const todosValores = textoExtraido.match(/\d+[.,]\d{2}/g);
        if (todosValores && todosValores.length > 0) {
          const ultimoValor = todosValores[todosValores.length - 1];
          valorMatch = [null, ultimoValor];
        }
      }

      const valorFinal = valorMatch
        ? parseFloat(valorMatch[1].replace(",", "."))
        : null;

      let descricaoFinal = "Compra";

      for (let linha of linhas.slice(0, 6)) {
        const linhaLimpa = linha.trim();

        const ehMaiuscula = linhaLimpa === linhaLimpa.toUpperCase();
        const tamanhoOk = linhaLimpa.length > 5;

        const contemInvalido =
          linhaLimpa.toLowerCase().includes("conferencia") ||
          linhaLimpa.toLowerCase().includes("data") ||
          linhaLimpa.toLowerCase().includes("hora") ||
          linhaLimpa.toLowerCase().includes("mesa");

        if (ehMaiuscula && tamanhoOk && !contemInvalido) {
          descricaoFinal = linhaLimpa;
          break;
        }
      }

      descricaoFinal = descricaoFinal.replace(/^110\s+/i, "TIO ");
      descricaoFinal = descricaoFinal.replace(/^\d+\s+/, "");
      descricaoFinal = descricaoFinal.replace(/\s{2,}/g, " ").trim();

      if (!valorFinal) {
        await bot.sendMessage(chatId, "❌ Não consegui identificar o valor total automaticamente.");
        return;
      }

      const hoje = new Date();
      const mes = hoje.getMonth() + 1;
      const ano = hoje.getFullYear();

      let categoria = "Outros";
      const descLower = descricaoFinal.toLowerCase();

      if (descLower.includes("armenio") || descLower.includes("pizza") || descLower.includes("burger")) {
        categoria = "Restaurante";
      } else if (descLower.includes("mercado") || descLower.includes("super")) {
        categoria = "Supermercado";
      } else if (descLower.includes("posto") || descLower.includes("ipiranga")) {
        categoria = "Combustível";
      } else if (descLower.includes("farmacia") || descLower.includes("drog")) {
        categoria = "Farmácia";
      }

      await supabase.from('despesas').insert([
        { valor: valorFinal, descricao: descricaoFinal, data: dataFinal, mes, ano, categoria }
      ]);

      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: "A:F",
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [[dataFinal, valorFinal, descricaoFinal, mes, ano, categoria]]
        }
      });

      await bot.sendMessage(
        chatId,
        `✅ Despesa registrada:\n\n🏪 ${descricaoFinal}\n💰 R$ ${valorFinal.toFixed(2)}\n📅 ${dataFinal}\n📂 ${categoria}`
      );

    } catch (error) {
      console.log("ERRO OCR:", error);
      await bot.sendMessage(chatId, "❌ Erro ao processar imagem.");
    }

    return;
  }

  if (!text) return;

  // ==========================
  // TOTAL MÊS ATUAL
  // ==========================
  if (text.toLowerCase() === "/total") {

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
  // TOTAL MÊS ESPECÍFICO
  // ==========================
  if (text.toLowerCase().startsWith("/total ")) {

    const partes = text.split(" ");

    if (partes.length < 3) {
      await bot.sendMessage(chatId, "Use: /total 2 2026");
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

    await bot.sendMessage(
      chatId,
      `📊 Total em ${mesEscolhido}/${anoEscolhido}: R$ ${total.toFixed(2)}`
    );

    return;
  }

  await bot.sendMessage(chatId, "Digite /ajuda para ver os comandos disponíveis.");
});

app.get('/', (req, res) => {
  res.send("Bot rodando");
});

app.listen(process.env.PORT || 3000);
