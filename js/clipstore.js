const DB_NAME = 'kids-downstairs-audio';
const DB_STORE = 'clips';
const LS_PREFIX = 'kids-downstairs.clip.';

/**
 * 自訂錄音的本機儲存。錄音只存在這台裝置：
 * 1. 優先存 localStorage（Base64；每段最長 1.5 秒、約幾十 KB，三個槽位 × 兩種情境放得下）
 * 2. localStorage 滿了或不能用時，改存 IndexedDB（直接存 Blob）
 * 3. 兩者都不行就只放記憶體，重新整理後會消失
 * 兩邊都有同一個 id 時以 localStorage 為準（舊版本把錄音存在 IndexedDB）。
 */
export class ClipStore {
  constructor() {
    this.dbPromise = null;
    this.memory = new Map();
  }

  open() {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve) => {
        try {
          const req = indexedDB.open(DB_NAME, 1);
          req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE, { keyPath: 'id' });
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
          req.onblocked = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    }
    return this.dbPromise;
  }

  request(db, mode, run) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, mode);
      const req = run(tx.objectStore(DB_STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async getAll() {
    const rows = new Map();
    const db = await this.open();
    if (db) {
      try {
        const list = await this.request(db, 'readonly', (store) => store.getAll());
        for (const row of list || []) rows.set(row.id, row.blob);
      } catch {
        /* 讀不到就當作沒有 */
      }
    }
    for (const [id, blob] of readLocal()) rows.set(id, blob);
    for (const [id, blob] of this.memory) if (!rows.has(id)) rows.set(id, blob);
    return rows;
  }

  async put(id, blob) {
    try {
      localStorage.setItem(LS_PREFIX + id, await blobToJson(blob));
      this.memory.delete(id);
      this.dropFromDb(id); // 清掉舊版留在 IndexedDB 的同名錄音，免得下次讀回舊的
      return 'localstorage';
    } catch {
      /* 空間不夠或不能用，往下試 IndexedDB */
    }
    const db = await this.open();
    if (db) {
      try {
        await this.request(db, 'readwrite', (store) => store.put({ id, blob, savedAt: Date.now() }));
        return 'indexeddb';
      } catch {
        /* 往下放記憶體 */
      }
    }
    this.memory.set(id, blob);
    return 'memory';
  }

  async dropFromDb(id) {
    const db = await this.open();
    if (!db) return;
    try {
      await this.request(db, 'readwrite', (store) => store.delete(id));
    } catch {
      /* 略過 */
    }
  }

  async delete(id) {
    this.memory.delete(id);
    try {
      localStorage.removeItem(LS_PREFIX + id);
    } catch {
      /* 略過 */
    }
    const db = await this.open();
    if (!db) return;
    try {
      await this.request(db, 'readwrite', (store) => store.delete(id));
    } catch {
      /* 略過 */
    }
  }
}

function blobToJson(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(JSON.stringify({ type: blob.type, data: url.slice(url.indexOf(',') + 1) }));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function readLocal() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(LS_PREFIX)) continue;
      const { type, data } = JSON.parse(localStorage.getItem(key));
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      out.push([key.slice(LS_PREFIX.length), new Blob([bytes], { type })]);
    }
  } catch {
    /* 略過壞掉的資料 */
  }
  return out;
}
