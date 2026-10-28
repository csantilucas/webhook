import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

process.env.NODE_ENV = 'test';
process.env.AGORA_WEBHOOK_SECRET = 'whsec_teste_unitario_simples_123456';

const { app, SECRET } = await import('../src/server.js');

function assinar(corpo: string): string {
  return createHmac('sha256', SECRET).update(corpo).digest('hex');
}

function iniciarServidor(): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

test('1. Recusa webhook sem assinatura (401)', async () => {
  const { server, url } = await iniciarServidor();
  try {
    const res = await fetch(`${url}/webhooks/agora`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ evento: 'message.created' }),
    });
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});

test('2. Recusa webhook com assinatura inválida (401)', async () => {
  const { server, url } = await iniciarServidor();
  try {
    const corpo = JSON.stringify({ evento: 'message.created' });
    const res = await fetch(`${url}/webhooks/agora`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Agora-Signature': '0000000000000000000000000000000000000000000000000000000000000000',
      },
      body: corpo,
    });
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});

test('3. Recusa JSON malformado com 400', async () => {
  const { server, url } = await iniciarServidor();
  try {
    const jsonQuebrado = '{ quebrado: true ';
    const res = await fetch(`${url}/webhooks/agora`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Agora-Signature': assinar(jsonQuebrado),
      },
      body: jsonQuebrado,
    });
    assert.equal(res.status, 400);
  } finally {
    server.close();
  }
});

test('4. Aceita evento autêntico com 202', async () => {
  const { server, url } = await iniciarServidor();
  try {
    const payload = JSON.stringify({
      evento: 'message.created',
      conversationId: 'c1',
      dados: { id: `m_${Date.now()}_1`, text: 'olá' },
    });
    const res = await fetch(`${url}/webhooks/agora`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Agora-Signature': assinar(payload),
      },
      body: payload,
    });
    assert.equal(res.status, 202);
  } finally {
    server.close();
  }
});

test('5. Idempotência: duplicata responde 200 { duplicado: true }', async () => {
  const { server, url } = await iniciarServidor();
  try {
    const payload = JSON.stringify({
      evento: 'message.created',
      conversationId: 'c1',
      dados: { id: 'msg_repetida_teste', text: 'repete' },
    });
    const assinatura = assinar(payload);

    // Primeira chamada -> 202
    const res1 = await fetch(`${url}/webhooks/agora`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agora-Signature': assinatura },
      body: payload,
    });
    assert.equal(res1.status, 202);

    // Segunda chamada idêntica -> 200
    const res2 = await fetch(`${url}/webhooks/agora`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agora-Signature': assinatura },
      body: payload,
    });
    assert.equal(res2.status, 200);
    const corpo2 = (await res2.json()) as { duplicado: boolean };
    assert.equal(corpo2.duplicado, true);
  } finally {
    server.close();
  }
});

test('6. Comando !time é aceito e processado com 202', async () => {
  const { server, url } = await iniciarServidor();
  try {
    const payload = JSON.stringify({
      evento: 'message.created',
      conversationId: 'c1',
      dados: { id: `msg_time_${Date.now()}`, text: '!time' },
    });
    const res = await fetch(`${url}/webhooks/agora`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agora-Signature': assinar(payload), },
      body: payload,
    });
    assert.equal(res.status, 202);
  } finally {
    server.close();
  }
});

test('7. Consulta /saude e /health retornam 200 com ok: true', async () => {
  const { server, url } = await iniciarServidor();
  try {
    const resSaude = await fetch(`${url}/saude`);
    assert.equal(resSaude.status, 200);
    const dadosSaude = (await resSaude.json()) as { ok: boolean };
    assert.equal(dadosSaude.ok, true);

    const resHealth = await fetch(`${url}/health`);
    assert.equal(resHealth.status, 200);
    const dadosHealth = (await resHealth.json()) as { ok: boolean };
    assert.equal(dadosHealth.ok, true);
  } finally {
    server.close();
  }
});
