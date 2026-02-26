console.log("🚨 NOVO CODIGO CARREGADO 🚨");

const express = require("express");
const app = express();

app.get("/", (req, res) => {
  res.send("NOVO CODIGO RODANDO");
});

app.listen(process.env.PORT || 3000);
