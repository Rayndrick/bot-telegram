const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

const token = process.env.TOKEN;
const app = express();

app.use(express.json());

const bot = new TelegramBot(token);

app.post('/webhook', (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (text && text.toLowerCase().includes("gastei")) {
        bot.sendMessage(chatId, "Despesa registrada ✅");
    } else {
        bot.sendMessage(chatId, "Envie algo como: Gastei 200 supermercado");
    }
});

app.get("/", (req, res) => {
    res.send("Bot rodando");
});

app.listen(process.env.PORT || 3000);
