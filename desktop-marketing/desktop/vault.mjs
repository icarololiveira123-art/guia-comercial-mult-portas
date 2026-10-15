import fs from 'node:fs';
import path from 'node:path';

// The Windows DPAPI key is tied to the signed-in Windows account. Session
// tokens and pending counts never go into renderer storage or plaintext files.
export function createVault(file, crypto) {
  const ensure = () => {
    if (!crypto.isEncryptionAvailable()) throw new Error('O Windows não disponibilizou a proteção dos dados. Reinicie o aplicativo.');
  };
  return {
    read() {
      if (!fs.existsSync(file)) return null;
      ensure();
      try {
        const result = JSON.parse(crypto.decryptString(fs.readFileSync(file)));
        if (result.version !== 1 || !result.accounts || typeof result.accounts !== 'object') throw new Error('invalid');
        return result;
      } catch { throw new Error('Não foi possível ler os dados protegidos deste computador. Abra o aplicativo na mesma conta do Windows que o utilizou antes.'); }
    },
    write(value) {
      ensure();
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      const bytes = crypto.encryptString(JSON.stringify(value));
      const temporary = `${file}.pending`;
      const descriptor = fs.openSync(temporary, 'w', 0o600);
      try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
      fs.renameSync(temporary, file);
    },
  };
}
