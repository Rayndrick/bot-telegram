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

      // =====================
      // 🔎 DATA
      // =====================
      const dataRegex = /\b\d{2}\/\d{2}\/\d{4}\b/;
      const dataEncontrada = textoExtraido.match(dataRegex);
      const dataFinal = dataEncontrada
        ? dataEncontrada[0]
        : new Date().toISOString().split("T")[0];

      // =====================
      // 💰 TOTAL (melhorado)
      // =====================
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

      // =====================
      // 🏪 DESCRIÇÃO (inteligente)
      // =====================
      let descricaoFinal = "Compra";

      for (let linha of linhas.slice(0, 6)) {
        const linhaLimpa = linha.trim();

        const ehMaiuscula = linhaLimpa === linhaLimpa.toUpperCase();
        const tamanhoOk = linhaLimpa.length > 5;

        const contemPalavraInvalida =
          linhaLimpa.toLowerCase().includes("conferencia") ||
          linhaLimpa.toLowerCase().includes("data") ||
          linhaLimpa.toLowerCase().includes("hora") ||
          linhaLimpa.toLowerCase().includes("mesa");

        if (ehMaiuscula && tamanhoOk && !contemPalavraInvalida) {
          descricaoFinal = linhaLimpa;
          break;
        }
      }

      if (!valorFinal) {
        await bot.sendMessage(chatId, "❌ Não consegui identificar o valor total automaticamente.");
        return;
      }

      const hoje = new Date();
      const mes = hoje.getMonth() + 1;
      const ano = hoje.getFullYear();

      await supabase.from('despesas').insert([
        {
          valor: valorFinal,
          descricao: descricaoFinal,
          data: dataFinal,
          mes,
          ano
        }
      ]);

      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: "A:E",
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [[dataFinal, valorFinal, descricaoFinal, mes, ano]]
        }
      });

      await bot.sendMessage(
        chatId,
        `✅ Despesa registrada automaticamente:\n\n🏪 ${descricaoFinal}\n💰 R$ ${valorFinal.toFixed(2)}\n📅 ${dataFinal}`
      );

    } catch (error) {
      console.log("ERRO OCR:", error);
      await bot.sendMessage(chatId, "❌ Erro ao processar imagem.");
    }

    return;
  }

  if (!text) return;

  // ==========================
  // 📋 LISTAR
  // ==========================
  if (text.toLowerCase() === "/listar") {

    const hoje = new Date();
    const mes = hoje.getMonth() + 1;
    const ano = hoje.getFullYear();

    const { data, error } = await supabase
      .from('despesas')
      .select('*')
      .eq('mes', mes)
      .eq('ano', ano)
      .order('data', { ascending: true });

    if (error || !data) {
      await bot.sendMessage(chatId, "Erro ao listar despesas.");
      return;
    }

    if (data.length === 0) {
      await bot.sendMessage(chatId, "Nenhuma despesa registrada neste mês.");
      return;
    }

    let mensagem = "📋 Despesas do mês:\n\n";

    data.forEach(item => {
      mensagem += `• ${item.data} - R$ ${Number(item.valor).toFixed(2)} - ${item.descricao}\n`;
    });

    await bot.sendMessage(chatId, mensagem);
    return;
  }

  // ==========================
  // 📊 TOTAL
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
  // 💰 REGISTRO MANUAL
  // ==========================
  if (text.toLowerCase().startsWith("gastei")) {

    const partes = text.split(" ");
    const valor = parseFloat(partes[1]);
    const descricao = partes.slice(2).join(" ");

    if (isNaN(valor)) {
      await bot.sendMessage(chatId, "Valor inválido. Ex: Gastei 50 supermercado");
      return;
    }

    const hoje = new Date();
    const mes = hoje.getMonth() + 1;
    const ano = hoje.getFullYear();
    const data = hoje.toISOString().split('T')[0];

    await supabase.from('despesas').insert([
      { valor, descricao, data, mes, ano }
    ]);

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "A:E",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[data, valor, descricao, mes, ano]],
      },
    });

    await bot.sendMessage(chatId, `💰 Registrado: R$ ${valor} - ${descricao}`);
    return;
  }

  await bot.sendMessage(chatId, "Use: Gastei 50 supermercado");
});

app.get('/', (req, res) => {
  res.send("Bot rodando");
});

app.listen(process.env.PORT || 3000);
