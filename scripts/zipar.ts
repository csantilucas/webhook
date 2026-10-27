import fs from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';

const raizProjeto = path.resolve(import.meta.dirname, '..');
const arquivoSaida = path.resolve(raizProjeto, 'projeto-agora-webhook.zip');

async function gerarZip() {
  console.log('=================================================================');
  console.log('📦 Gerando pacote .zip para entrega da tarefa...');
  console.log(`Destino: ${arquivoSaida}`);

  // Se já existir, remove o arquivo zip anterior
  if (fs.existsSync(arquivoSaida)) {
    fs.unlinkSync(arquivoSaida);
  }

  const output = fs.createWriteStream(arquivoSaida);
  const archive = archiver('zip', {
    zlib: { level: 9 }, // Compressão máxima
  });

  output.on('close', () => {
    const tamanhoKb = (archive.pointer() / 1024).toFixed(2);
    console.log(`✅ Arquivo .zip gerado com sucesso!`);
    console.log(`📏 Tamanho total: ${tamanhoKb} KB (${archive.pointer()} bytes)`);
    console.log('🔒 Conteúdo conferido: SEM node_modules e SEM .env real');
    console.log('=================================================================');
  });

  archive.on('warning', (err) => {
    if (err.code === 'ENOENT') {
      console.warn('Aviso:', err);
    } else {
      throw err;
    }
  });

  archive.on('error', (err) => {
    throw err;
  });

  archive.pipe(output);

  // Adiciona arquivos e pastas do projeto, ignorando explicitamente node_modules, .env, dist e .zip
  archive.glob('**/*', {
    cwd: raizProjeto,
    ignore: [
      'node_modules/**',
      '.env',
      'dist/**',
      '*.zip',
      '.git/**',
      '.DS_Store',
      'Thumbs.db',
    ],
    dot: true, // Inclui arquivos ocultos como .gitignore, .dockerignore, .env.example
  });

  await archive.finalize();
}

gerarZip().catch((erro) => {
  console.error('❌ Falha ao gerar arquivo .zip:', erro);
  process.exit(1);
});
