import * as fs from 'fs/promises';
import * as path from 'path';
import { sha256Bytes } from './hashutil';

export class Storage {
  constructor(public root: string) {}

  private p(h: string) { return path.join(this.root, h); }
  private idxPath() { return path.join(this.root, 'index.json'); }

  async ensure() {
    await fs.mkdir(this.root, { recursive: true });
    try { await fs.access(this.idxPath()); }
    catch { await fs.writeFile(this.idxPath(), '{}', 'utf8'); }
  }

  async has(h: string): Promise<boolean> {
    try { await fs.access(this.p(h)); return true; }
    catch { return false; }
  }

  async put(h: string, data: Buffer, meta: any = {}) {
    await this.ensure();
    if (sha256Bytes(data) !== h) throw new Error('hash_mismatch');
    await fs.writeFile(this.p(h), data);
    await this.updateIndex(h, data.length, meta);
  }

  async get(h: string): Promise<Buffer | null> {
    try { return await fs.readFile(this.p(h)); }
    catch { return null; }
  }

  async updateIndex(h: string, size: number, meta: any) {
    let idx: any = {};
    try { idx = JSON.parse(await fs.readFile(this.idxPath(), 'utf8')); } catch {}
    idx[h] = { size, meta, ts: Date.now() / 1000 };
    await fs.writeFile(this.idxPath(), JSON.stringify(idx, null, 2), 'utf8');
  }

  async list(): Promise<Record<string, any>> {
    try { return JSON.parse(await fs.readFile(this.idxPath(), 'utf8')); } catch { return {}; }
  }
}
