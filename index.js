const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const token = process.env.TOKEN;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

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

  if (!text) return;
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

  if (error) {
    bot.sendMessage(chatId, "Erro ao listar despesas.");
    return;
  }

  if (data.length === 0) {
    bot.sendMessage(chatId, "Nenhuma despesa registrada neste mês.");
    return;
  }

  let mensagem = "📋 Despesas do mês:\n\n";

  data.forEach(item => {
    mensagem += `• ${item.data} - R$ ${item.valor} - ${item.descricao}\n`;
  });

  bot.sendMessage(chatId, mensagem);
  return;
}
if (text.toLowerCase() === "/total") {

  const hoje = new Date();
  const mes = hoje.getMonth() + 1;
  const ano = hoje.getFullYear();

  const { data, error } = await supabase
    .from('despesas')
    .select('valor')
    .eq('mes', mes)
    .eq('ano', ano);

  if (error) {
    bot.sendMessage(chatId, "Erro ao calcular total.");
    return;
  }

  const total = data.reduce((acc, item) => acc + Number(item.valor), 0);

  bot.sendMessage(chatId, `📊 Total do mês: R$ ${total.toFixed(2)}`);
  return;
}
  if (text.toLowerCase().startsWith("gastei")) {

    const partes = text.split(" ");
    const valor = parseFloat(partes[1]);
    const descricao = partes.slice(2).join(" ");

    if (isNaN(valor)) {
      bot.sendMessage(chatId, "Valor inválido. Ex: Gastei 50 supermercado");
      return;
    }

 const hoje = new Date();
const mes = hoje.getMonth() + 1;
const ano = hoje.getFullYear();
const data = hoje.toISOString().split('T')[0];

const { error } = await supabase
  .from('despesas')
  .insert([
    { 
      valor, 
      descricao,
      data,
      mes,
      ano
    }
  ]);

    if (error) {
      console.log(error);
      bot.sendMessage(chatId, "Erro ao salvar despesa.");
    } else {

  try {

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "A:E",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[
          data,
          valor,
          descricao,
          mes,
          ano
        ]]
      }
    });

    bot.sendMessage(chatId, `💰 Registrado: R$ ${valor} - ${descricao}`);

  } catch (sheetError) {
    console.log(sheetError);
    bot.sendMessage(chatId, "Salvou no banco, mas erro ao enviar para planilha.");
  }

}

  } else {
    bot.sendMessage(chatId, "Use: Gastei 50 supermercado");
  }
});

app.get('/', (req, res) => {
  res.send("Bot rodando");
});

app.listen(process.env.PORT || 3000);
