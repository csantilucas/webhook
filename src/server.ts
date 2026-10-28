import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';

// ==========================================
// Configurações e Variáveis de Ambiente
// ==========================================
export const PORT = Number(process.env.PORT) || 4000;
export const SECRET = process.env.AGORA_WEBHOOK_SECRET || '';
export const BOT_TOKEN = process.env.AGORA_BOT_TOKEN || '';
export const AGORA_URL = (process.env.AGORA_URL || 'https://api.agora.fslab.dev').replace(/\/+$/, '');

// Requisito R7: O serviço recusa subir se faltar o secret
if (!SECRET && process.env.NODE_ENV !== 'test') {
  console.error('ERRO: Defina AGORA_WEBHOOK_SECRET no arquivo .env antes de iniciar.');
  process.exit(1);
}

// ==========================================
// Estado em Memória (Idempotência e Histórico)
// ==========================================
export const vistos = new Set<string>();
export const eventos: Array<{ id: string; evento: string; texto?: string; recebidoEm: string }> = [];
export const falhas: Array<{ conversationId: string; texto: string; erro: string; registradoEm: string }> = [];

// ==========================================
// Funções Auxiliares (Segurança e Envio)
// ==========================================

/**
 * Valida a assinatura HMAC-SHA256 do Ágora em tempo constante.
 */
export function validarAssinatura(assinatura: string | undefined | null, corpoBruto: Buffer | string): boolean {
  if (!assinatura || !SECRET) return false;
  const esperada = createHmac('sha256', SECRET).update(corpoBruto).digest('hex');
  const bufRecebido = Buffer.from(assinatura.toLowerCase(), 'utf8');
  const bufEsperado = Buffer.from(esperada.toLowerCase(), 'utf8');
  if (bufRecebido.length !== bufEsperado.length) return false;
  return timingSafeEqual(bufRecebido, bufEsperado);
}

/**
 * Envia mensagem para o Ágora com retentativas simples.
 * Se BOT_TOKEN não estiver configurado, opera em modo seco.
 */
export async function enviarMensagem(conversationId: string, texto: string, tentativa = 1): Promise<void> {
  if (!BOT_TOKEN) {
    console.log(`[modo seco] Enviaria para a conversa ${conversationId}: "${texto}"`);
    return;
  }

  console.log(`[Bot] Enviando resposta para conversa ${conversationId}: "${texto.replace(/\n/g, ' ')}"`);

  try {
    const res = await fetch(`${AGORA_URL}/bot/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-bot-token': BOT_TOKEN,
      },
      body: JSON.stringify({ conversationId, text: texto }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      const msgErro = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${msgErro}`);
    }

    console.log(`[Bot] ✅ Resposta publicada com sucesso na conversa ${conversationId}!`);
  } catch (erro) {
    console.warn(`[Bot] ⚠️ Falha no envio (tentativa ${tentativa}/3): ${(erro as Error).message}`);
    if (tentativa < 3) {
      await new Promise((r) => setTimeout(r, tentativa * 1000));
      return enviarMensagem(conversationId, texto, tentativa + 1);
    } else {
      falhas.unshift({
        conversationId,
        texto,
        erro: (erro as Error).message,
        registradoEm: new Date().toISOString(),
      });
    }
  }
}

// ==========================================
// Aplicação Express
// ==========================================
export const app = express();

// Rotas de saúde (/saude e /health)
const responderSaude = (_req: Request, res: Response) => {
  res.status(200).json({
    ok: true,
    status: 'healthy',
    uptimeSegundos: Math.floor(process.uptime()),
    totalEventos: eventos.length,
    totalFalhas: falhas.length,
  });
};

app.get('/saude', responderSaude);
app.get('/health', responderSaude);

// Lista os últimos eventos autênticos recebidos
app.get('/eventos', (_req: Request, res: Response) => {
  res.status(200).json({ eventos: eventos.slice(0, 50) });
});

// Lista entregas que falharam após retentativas
app.get('/falhas', (_req: Request, res: Response) => {
  res.status(200).json({ falhas });
});

// Rota do Webhook do Ágora (corpo bruto obrigatório)
app.post('/webhooks/agora', express.raw({ type: '*/*', limit: '1mb' }), (req: Request, res: Response) => {
  const corpoBruto = req.body as Buffer;

  // 1. Validação de autenticidade (HMAC)
  if (!validarAssinatura(req.get('x-agora-signature'), corpoBruto)) {
    console.warn(`[Webhook] ❌ Assinatura inválida recebida!`);
    return res.status(401).json({ erro: 'assinatura inválida' });
  }

  // 2. Validação do JSON
  let payload: any;
  try {
    payload = JSON.parse(corpoBruto.toString('utf8'));
  } catch {
    console.warn('[Webhook] ❌ JSON malformado recebido!');
    return res.status(400).json({ erro: 'JSON inválido' });
  }

  // Log completo do payload recebido
  console.log('----------------------------------------------------');
  console.log(`[Webhook Recebido: ${payload.evento}]`);
  console.log(JSON.stringify(payload, null, 2));
  console.log('----------------------------------------------------');

  // 3. Idempotência: chave composta por evento + id da mensagem
  const chaveDeduplicacao = `${payload.evento}:${payload.dados?.id || ''}`;
  if (vistos.has(chaveDeduplicacao)) {
    console.log(`[Webhook] ℹ️ Evento duplicado descartado: ${chaveDeduplicacao}`);
    return res.status(200).json({ duplicado: true });
  }
  vistos.add(chaveDeduplicacao);

  // 4. Grava o evento na memória
  const textoExtraido = payload.dados?.text || payload.dados?.content || payload.dados?.body || null;
  eventos.unshift({
    id: payload.dados?.id || `evt_${Date.now()}`,
    evento: payload.evento,
    texto: textoExtraido,
    recebidoEm: new Date().toISOString(),
  });
  if (eventos.length > 50) eventos.pop();

  // 5. Processa comando do bot em segundo plano (sem travar a resposta)
  if (payload.evento === 'message.created' && typeof textoExtraido === 'string') {
    const textoMensagem = textoExtraido.trim();

    // Regra anti-laço: só responde se começar com '!' e não for mensagem do próprio bot
    if (textoMensagem.startsWith('!') && !textoMensagem.startsWith('🤖')) {
      const convId = payload.conversationId;
      const partes = textoMensagem.split(/\s+/);
      const cmd = partes[0].toLowerCase();

      let respostaBot = '';

      if (cmd === '!time' || cmd === '!timew') {
        const agora = new Date();
        const dataFormatada = agora.toLocaleString('pt-BR', {
          timeZone: 'America/Porto_Velho',
          dateStyle: 'full',
          timeStyle: 'medium',
        });
        respostaBot = `🤖 Horário e Data Atual:\n📅 ${dataFormatada} (Fuso Rondônia/BR)\n⏱️ UTC: ${agora.toISOString()}`;
      } else if (cmd === '!ajuda') {
        respostaBot = `🤖 Comandos disponíveis:\n• !time (ou !timew): mostra a data e horário atual\n• !eventos: mostra os últimos eventos recebidos\n• !ajuda: exibe esta mensagem de ajuda`;
      } else if (cmd === '!eventos') {
        const ultimos = eventos.slice(0, 5);
        const lista = ultimos.map((e, i) => `${i + 1}. [${new Date(e.recebidoEm).toLocaleTimeString('pt-BR')}] ${e.evento} - "${e.texto || ''}"`).join('\n');
        respostaBot = `🤖 Últimos ${ultimos.length} eventos:\n${lista || 'Nenhum evento registrado ainda.'}`;
      } else {
        respostaBot = `🤖 Comando desconhecido. Digite !time ou !ajuda.`;
      }

      // Dispara envio sem aguardar (fire-and-forget com retry)
      void enviarMensagem(convId, respostaBot);
    }
  }

  // 6. Resposta rápida: 202 significa "recebi"
  return res.status(202).json({ recebido: true });
});

// ==========================================
// Inicialização do Servidor
// ==========================================
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, '0.0.0.0', () => {
    console.log('=================================================================');
    console.log(`🚀 Webhook + Bot Ágora rodando em http://0.0.0.0:${PORT}`);
    console.log(`📡 Endpoints: /saude | /webhooks/agora | /eventos | /falhas`);
    console.log(`🤖 Comando ativo: !time (ou !timew)`);
    console.log(BOT_TOKEN ? `🔑 Bot Token ativo` : `⚠️ Modo seco (sem BOT_TOKEN)`);
    console.log('=================================================================');
  });
}
