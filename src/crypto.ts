import { createCipheriv, createDecipheriv } from 'crypto';
import { randomBytes } from './hashutil';

export function encryptAESGCM(plaintext: Buffer): { ct: Buffer, key: Buffer, iv: Buffer } {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ct: Buffer.concat([ct, tag]), key, iv };
}

export function decryptAESGCM(cipherAndTag: Buffer, key: Buffer, iv: Buffer): Buffer {
  const ct = cipherAndTag.slice(0, cipherAndTag.length - 16);
  const tag = cipherAndTag.slice(cipherAndTag.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}
