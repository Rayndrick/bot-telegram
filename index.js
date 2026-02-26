console.log("🚀 SISTEMA FINANCEIRO INTELIGENTE V4 🚀");

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


// ============================================
// CLASSIFICAÇÃO INTELIGENTE
// ============================================

function classificarCategoria(descricao) {

  const desc = descricao.toLowerCase();

  // 🍔 ALIMENTAÇÃO
  if (
    desc.includes("rest") ||
    desc.includes("burger") ||
    desc.includes("pizza") ||
    desc.includes("lanche") ||
    desc.includes("armenio") ||
    desc.includes("ifood") ||
    desc.includes("padaria") ||
    desc.includes("café")
  ) return "Alimentação";

  // 🛒 SUPERMERCADO
  if (
    desc.includes("mercado") ||
    desc.includes("super") ||
    desc.includes("carrefour") ||
    desc.includes("extra") ||
    desc.includes("assai")
  ) return "Supermercado";

  // ⛽ TRANSPORTE
  if (
    desc.includes("posto") ||
    desc.includes("ipiranga") ||
    desc.includes("uber") ||
    desc.includes("99") ||
    desc.includes("gasolina") ||
    desc.includes("combust")
  ) return "Transporte";

  // 💊 SAÚDE
  if (
    desc.includes("farm") ||
    desc.includes("droga") ||
    desc.includes("clinica") ||
    desc.includes("hospital")
  ) return "Saúde";

  // 🛍 LAZER / COMPRAS
  if (
    desc.includes("shopping") ||
    desc.includes("roupa") ||
    desc.includes("loja") ||
    desc.includes("amazon")
  ) return "Lazer/Compras";

  return "Outros";
}


// ============================================
// FUNÇÃO PARA SALVAR
// ============================================

async function salvarDespesa(chatId, valor, descricao, dataFinal) {

  const categoria = classificarCategoria(descricao);

  const hoje = new Date();
  const mes = hoje.getMonth() + 1;
  const ano = hoje.getFullYear();

  await supabase.from("despesas").insert([
    { valor, descricao, data: dataFinal, mes, ano, categoria }
  ]);

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "Dados!A:F",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[dataFinal, valor, descricao, mes, ano, categoria]]
    }
  });

  await bot.sendMessage(chatId,
`✅ Registrado:

💰 R$ ${valor.toFixed(2)}
🏪 ${descricao}
📂 ${categoria}
📅 ${dataFinal}`
  );
}


// ============================================
// BOT
// ============================================

bot.on('message', async (msg) => {

  const chatId = msg.chat.id;
  const textOriginal = msg.text?.trim();
  const text = textOriginal?.toLowerCase();

  // ==========================
  // AJUDA
  // ==========================
  if (text === "ajuda" || text === "/ajuda") {
    await bot.sendMessage(chatId,
`📌 COMANDOS:

📸 Envie foto da nota → Registro automático
💰 Gastei 50 mercado → Registro manual

📊 /total → Total mês atual
📆 /mes 2 2026 → Total mês específico
📂 /categorias → Resumo categorias mês atual
📂 /cat alimentação → Categoria mês atual
📂 /cat alimentação 2 2026 → Categoria mês específico
📋 /listar → Lista despesas mês atual`
    );
    return;
  }

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

      const dataMatch = texto.match(/\d{2}\/\d{2}\/\d{4}/);
      const dataFinal = dataMatch
        ? dataMatch[0]
        : new Date().toISOString().split("T")[0];

      const valores = texto.match(/\d+[.,]\d{2}/g);
      const valorFinal = valores
        ? parseFloat(valores[valores.length - 1].replace(",", "."))
        : null;

      if (!valorFinal) {
        await bot.sendMessage(chatId, "❌ Não identifiquei o valor total.");
        return;
      }

      let descricaoFinal = linhas[1] || "Compra";

      await salvarDespesa(chatId, valorFinal, descricaoFinal, dataFinal);

    } catch (error) {
      console.log("OCR ERRO:", error);
      await bot.sendMessage(chatId, "Erro ao processar imagem.");
    }

    return;
  }

  // ==========================
  // REGISTRO MANUAL
  // ==========================
  if (text && text.startsWith("gastei")) {

    const partes = textOriginal.split(" ");
    const valor = parseFloat(partes[1]);
    const descricao = partes.slice(2).join(" ");

    if (isNaN(valor)) {
      await bot.sendMessage(chatId, "Use: Gastei 50 mercado");
      return;
    }

    const data = new Date().toISOString().split("T")[0];

    await salvarDespesa(chatId, valor, descricao, data);
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
  // TOTAL MÊS ESPECÍFICO
  // ==========================
  if (text && text.startsWith("/mes")) {

    const partes = textOriginal.split(" ");

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
      `📆 ${mesEscolhido}/${anoEscolhido}: R$ ${total.toFixed(2)}`
    );
    return;
  }

  // ==========================
  // CATEGORIAS MÊS ATUAL
  // ==========================
  if (text === "/categorias") {

    const hoje = new Date();
    const mes = hoje.getMonth() + 1;
    const ano = hoje.getFullYear();

    const { data } = await supabase
      .from('despesas')
      .select('valor, categoria')
      .eq('mes', mes)
      .eq('ano', ano);

    const resumo = {};

    (data || []).forEach(item => {
      if (!resumo[item.categoria]) resumo[item.categoria] = 0;
      resumo[item.categoria] += Number(item.valor);
    });

    let mensagem = "📂 Categorias mês atual:\n\n";

    for (let cat in resumo) {
      mensagem += `• ${cat}: R$ ${resumo[cat].toFixed(2)}\n`;
    }

    await bot.sendMessage(chatId, mensagem);
    return;
  }

  await bot.sendMessage(chatId, "Digite /ajuda para ver os comandos.");
});

app.listen(process.env.PORT || 3000);
