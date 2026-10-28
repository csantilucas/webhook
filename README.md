# Integração com o Ágora: Webhook + Bot (TypeScript)

**Disciplina:** Web Services (CST em ADS · IFRO · 2026/2)  
**Tópico:** 5 · Webhooks  
**URL Pública do Serviço:** `https://lucas-bot.app.fslab.dev`  
**Integrantes:** Lucas  

---

## 📌 Visão Geral
Serviço simples e direto em **TypeScript** que se integra ao **Ágora** (`agora.fslab.dev`):
1. **Recebe Webhooks com Segurança (`POST /webhooks/agora`)**:
   - Lê o corpo bruto da requisição (`express.raw`).
   - Valida a assinatura HMAC-SHA256 (`X-Agora-Signature`) com o segredo usando comparação em tempo constante (`timingSafeEqual`).
   - Deduplica mensagens repetidas (retorna `200 { duplicado: true }`).
   - Retorna `202 { recebido: true }` imediatamente para o Ágora.
2. **Responde na Conversa com o Bot**:
   - **`!time`** (ou **`!timew`**): Informa a data e horário atual (fuso local de Rondônia e UTC).
   - **`!ajuda`**: Lista os comandos disponíveis.
   - **`!eventos`**: Mostra os últimos eventos recebidos.
   - Responde com chamada `POST /bot/messages` enviando o token no cabeçalho `x-bot-token`.
3. **Prevenção de Laço (R6)**:
   - Nenhuma resposta do bot começa com `!`. Toda mensagem enviada inicia com `🤖 `.
   - Mensagens normais da conversa que não começam com `!` são ignoradas.

---

## 📂 Estrutura Simplificada

```
webhook/
├── src/
│   └── server.ts         # Arquivo único com todo o servidor, rotas e bot
├── scripts/
│   ├── simular.ts        # Script para simular envios de webhook localmente
│   └── zipar.ts          # Script para gerar o zip final da entrega
├── test/
│   └── receptor.test.ts  # Testes automatizados (7 testes)
├── Dockerfile            # Configuração Docker para rodar na VM
├── docker-compose.yml    # Compose com restart unless-stopped
├── .env.example          # Exemplo das variáveis de ambiente
├── README.md             # Esta documentação
└── evidencias/           # Pasta para salvar os prints pedidos
```

---

## 💻 Como Rodar Localmente

1. Instale as dependências:
   ```bash
   npm install
   ```
2. Crie o arquivo `.env`:
   ```bash
   cp .env.example .env
   ```
3. Compile e rode:
   ```bash
   npm run build
   npm run dev
   ```
4. Em outro terminal, teste com o simulador:
   ```bash
   npm run simular
   ```
5. Rode os testes automatizados:
   ```bash
   npm test
   ```

---

## 🐳 Como Rodar na VM do FSLab via Docker

1. Envie a pasta do projeto para a sua VM:
   ```bash
   scp -r . usuario@IP_DA_VM:~/webhook
   ```
2. Na VM, crie o `.env` com as credenciais do Ágora:
   ```bash
   nano .env
   ```
   Preencha:
   ```env
   PORT=4000
   AGORA_WEBHOOK_SECRET=whsec_copiado_do_agora
   AGORA_BOT_TOKEN=bot_copiado_do_agora
   AGORA_URL=https://api.agora.fslab.dev
   ```
3. Suba o container:
   ```bash
   docker compose up -d --build
   ```

---

## 🌐 Configuração na Cloud FSLab e no Ágora

1. **Na Cloud FSLab (`cloud.fslab.dev`)**:
   - Endereço criado: `lucas-bot.app.fslab.dev` apontando para a sua VM na porta `4000`.
   - Teste no seu computador: `curl https://lucas-bot.app.fslab.dev/saude`.
2. **No Ágora (`agora.fslab.dev`)**:
   - Vá em **Integrações** -> **Novo bot**.
   - Nome: `bot-lucas`.
   - Conversa: selecione uma conversa de teste (sem cifragem).
   - Endereço do serviço: `https://lucas-bot.app.fslab.dev/webhooks/agora`.
   - Copie o **Token do bot** e o **Secret do webhook** exibidos e salve no `.env` da VM.

---

## 🧪 Testes com curl

```bash
# 1. Conferir saúde
curl -i https://lucas-bot.app.fslab.dev/saude

# 2. Testar assinatura inválida (deve retornar 401)
curl -i -X POST https://lucas-bot.app.fslab.dev/webhooks/agora \
  -H "Content-Type: application/json" \
  -H "X-Agora-Signature: 0000000000000000000000000000000000000000000000000000000000000000" \
  -d '{"evento":"message.created","dados":{"id":"t1","text":"teste"}}'

# 3. Ver histórico de eventos
curl https://lucas-bot.app.fslab.dev/eventos
```

---

## 📸 Pasta de Evidências

Salve na pasta `evidencias/` os 5 prints:
1. `evidencia_1_integracoes_agora.png`: Bot criado e webhook ativo no Ágora.
2. `evidencia_2_curl_saude.png`: `curl /saude` respondendo 200 do seu computador.
3. `evidencia_3_conversa_bot.png`: Conversa no Ágora com o comando `!time` respondido pelo bot.
4. `evidencia_4_curl_assinatura_e_duplicata.png`: `curl` recebendo 401 para assinatura forjada e duplicata recebendo 200.
5. `evidencia_5_eventos_e_falhas.png`: Endpoints `/eventos` e `/falhas` no ar.

---

## 📦 Gerar o arquivo .zip para o AVA

```bash
npm run zip
```
Gera `projeto-agora-webhook.zip` na raiz, sem a pasta `node_modules` e sem senhas no `.env`.
