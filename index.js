console.log("🔥 TESTE SUPABASE CARREGADO 🔥");

const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const token = process.env.TOKEN;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

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

  if (text.toLowerCase() === "teste") {

    console.log("📩 Recebeu TESTE");

    const hoje = new Date();
    const mes = hoje.getMonth() + 1;
    const ano = hoje.getFullYear();
    const data = hoje.toISOString().split("T")[0];

    const { data: resultado, error } = await supabase
      .from('despesas')
      .insert([
        {
          valor: 123.45,
          descricao: "TESTE REAL",
          data,
          mes,
          ano,
          categoria: "Teste"
        }
      ])
      .select();

    console.log("📦 Resultado:", resultado);
    console.log("❌ Erro:", error);

    if (error) {
      await bot.sendMessage(chatId, "❌ ERRO SUPABASE");
      return;
    }

    await bot.sendMessage(chatId, "✅ Salvou no Supabase!");

    return;
  }

  await bot.sendMessage(chatId, "Digite: teste");
});

app.listen(process.env.PORT || 3000);
