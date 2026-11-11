// Where uploaded images live. Local disk today; an S3/DigitalOcean Spaces implementation of the same
// interface can replace it later (keys are already flat, URL-safe object names).
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface AssetStore {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

const SAFE_KEY = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg|webp)$/;

function assertKey(key: string) {
  if (!SAFE_KEY.test(key)) throw new Error(`Unsafe asset key: ${key}`);
}

export class LocalDiskStore implements AssetStore {
  constructor(private root: string) {}

  private file(key: string) {
    assertKey(key);
    return path.join(this.root, key);
  }

  async put(key: string, data: Buffer) {
    const f = this.file(key);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, data, { mode: 0o640 });
  }

  async get(key: string) {
    try {
      return await readFile(this.file(key));
    } catch (err: any) {
      if (err?.code === "ENOENT") return null;
      throw err;
    }
  }

  async delete(key: string) {
    await rm(this.file(key), { force: true });
  }
}

let store: AssetStore | null = null;
export function assetStore(): AssetStore {
  // The directory is runtime data, not source: tell the bundler not to trace it into the build output.
  const dir = process.env.ASSET_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), "storage", "assets");
  store ??= new LocalDiskStore(path.resolve(/* turbopackIgnore: true */ dir));
  return store;
}
