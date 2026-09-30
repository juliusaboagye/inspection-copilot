import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ContainerClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';

/** Where inspection images live. Local disk in dev; implement with Azure Blob Storage in production. */
export interface ImageStore {
  put(key: string, data: Buffer): Promise<string>;
  get(pathOrKey: string): Promise<Buffer>;
}

export class LocalImageStore implements ImageStore {
  constructor(private dir: string) {}
  async put(key: string, data: Buffer) {
    const safe = key.replace(/[^a-zA-Z0-9._-]/g, '_');
    await mkdir(this.dir, { recursive: true });
    const p = path.join(this.dir, safe);
    await writeFile(p, data);
    return p;
  }
  get(p: string) {
    return readFile(p);
  }
}

export class MemoryImageStore implements ImageStore {
  files = new Map<string, Buffer>();
  async put(key: string, data: Buffer) { this.files.set(key, data); return key; }
  async get(key: string) {
    const f = this.files.get(key);
    if (!f) throw new Error(`no image ${key}`);
    return f;
  }
}

/** Azure Blob Storage, authenticated with the app's managed identity (no connection strings). */
export class BlobImageStore implements ImageStore {
  private container: ContainerClient;
  constructor(containerUrl: string) {
    this.container = new ContainerClient(containerUrl, new DefaultAzureCredential());
  }
  async put(key: string, data: Buffer) {
    await this.container.getBlockBlobClient(key).uploadData(data);
    return key;
  }
  async get(key: string) {
    return this.container.getBlobClient(key).downloadToBuffer();
  }
}

export const imageStoreFromEnv = (): ImageStore =>
  process.env.IMAGE_BLOB_URL ? new BlobImageStore(process.env.IMAGE_BLOB_URL) : new LocalImageStore(process.env.IMAGE_DIR ?? './data/uploads');
