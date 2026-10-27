import 'dotenv/config';
import { createHmac } from 'node:crypto';

const PORT = process.env.PORT || '4100';
const URL_BASE = `http://localhost:${PORT}`;
const SECRET = process.env.AGORA_WEBHOOK_SECRET || 'whsec_teste_local_1234567890abcdef';

function assinar(corpo: string): string {
  return createHmac('sha256', SECRET).update(corpo).digest('hex');
}

async function disparar(descricao: string, payload: string, assinatura: string, esperado: number) {
  try {
    const res = await fetch(`${URL_BASE}/webhooks/agora`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Agora-Signature': assinatura,
      },
      body: payload,
    });

    const texto = await res.text();
    const ok = res.status === esperado;
    console.log(`${ok ? '✅' : '❌'} ${descricao.padEnd(45)} -> HTTP ${res.status} (esperado: ${esperado}) ${texto}`);
  } catch (err: unknown) {
    console.error(`❌ Erro em "${descricao}":`, (err as Error).message);
  }
}

async function run() {
  console.log('=================================================================');
  console.log(`🧪 Testando Webhook em ${URL_BASE}`);
  console.log('=================================================================\n');

  const payloadMsg = JSON.stringify({
    evento: 'message.created',
    conversationId: 'c1',
    dados: { id: `msg_${Date.now()}`, type: 'text', text: 'Oi!' },
  });

  const payloadTime = JSON.stringify({
    evento: 'message.created',
    conversationId: 'c1',
    dados: { id: `msg_time_${Date.now()}`, type: 'text', text: '!time' },
  });

  // 1. Mensagem válida (202)
  await disparar('1. Mensagem válida', payloadMsg, assinar(payloadMsg), 202);

  // 2. Duplicata (200)
  await disparar('2. Mensagem duplicada', payloadMsg, assinar(payloadMsg), 200);

  // 3. Assinatura errada (401)
  await disparar('3. Assinatura forjada', payloadMsg, 'assinatura_errada_000000000000000000000000000000000000000000000000', 401);

  // 4. JSON quebrado (400)
  const jsonRuim = '{ quebrado: true ';
  await disparar('4. JSON inválido', jsonRuim, assinar(jsonRuim), 400);

  // 5. Comando !time (202)
  await disparar('5. Comando !time', payloadTime, assinar(payloadTime), 202);

  console.log('\n--- Consulta /saude ---');
  const resSaude = await fetch(`${URL_BASE}/saude`);
  console.log(await resSaude.json());

  console.log('\n--- Consulta /eventos ---');
  const resEventos = await fetch(`${URL_BASE}/eventos`);
  console.log(await resEventos.json());
}

void run();
