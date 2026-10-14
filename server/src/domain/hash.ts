// sha256 das fontes do seed sobre os bytes com \r\n trocado por \n (docs/specs/README.md, "Ciclo de vida das fontes").
// Mesma regra do extrator Python (bytes.replace(b"\r\n", b"\n")), para o hash valer igual em Windows, Linux e Mac.
import { createHash } from 'node:crypto';

export function sha256Normalized(data: Buffer | string): string {
  const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  const out = Buffer.allocUnsafe(bytes.length);
  let j = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0d && bytes[i + 1] === 0x0a) continue;
    out[j++] = bytes[i];
  }
  return createHash('sha256').update(out.subarray(0, j)).digest('hex');
}
