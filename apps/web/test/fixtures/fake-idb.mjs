/**
 * An in-memory stand-in for the `idb` package, for running lib/offline in node.
 *
 * Only the calls lib/offline makes, with IndexedDB's semantics where they
 * matter to it: a database persists between opens, keeps a version, runs
 * `upgrade` with the version it had, and is not created by an open whose
 * upgrade aborts; values are copied in and out, as structured clones are.
 *
 * And the one piece of the browser's behaviour that lib/offline/db.ts is built
 * around: opens are served in line, one after another, so while an upgrade is
 * held up every open asked for after it waits too, at any version.
 * holdUpgrades() plays a tab of an older build that never lets go: the next
 * upgrade is told `blocked` and waits until the release it returns is called.
 *
 * The real thing is exercised in a browser by e2e/offline.spec.mjs.
 */
const databases = new Map();

const copy = (v) => structuredClone(v);

function connection(state) {
  const store = (name) => {
    const s = state.stores.get(name);
    if (!s) throw new DOMException(`no store ${name}`, "NotFoundError");
    return s;
  };
  return {
    version: state.version,
    objectStoreNames: { contains: (name) => state.stores.has(name) },
    async get(name, key) {
      const v = store(name).rows.get(key);
      return v === undefined ? undefined : copy(v);
    },
    async getAll(name) {
      return [...store(name).rows.values()].map(copy);
    },
    async put(name, value) {
      const s = store(name);
      s.rows.set(value[s.keyPath], copy(value));
    },
    async delete(name, key) {
      store(name).rows.delete(key);
    },
    async clear(name) {
      store(name).rows.clear();
    },
    async count(name) {
      return store(name).rows.size;
    },
    close() {},
  };
}

/** The line every open waits in, as the browser keeps one per database. */
let line = Promise.resolve();
/** Set by holdUpgrades(): what the next upgrade waits for. */
let holding = null;

/**
 * Hold the next upgrade of an existing database, as an open connection of an
 * older build would. Returns the release.
 */
export function holdUpgrades() {
  let release;
  holding = new Promise((resolve) => {
    release = resolve;
  });
  return () => {
    holding = null;
    release();
  };
}

/** Forget every database and anything held, between tests. */
export function resetDatabases() {
  databases.clear();
  holding = null;
  line = Promise.resolve();
}

export function openDB(name, version, callbacks = {}) {
  const turn = line.then(() => open(name, version, callbacks));
  line = turn.catch(() => {});
  return turn;
}

async function open(name, version, { upgrade, blocked } = {}) {
  const existing = databases.get(name);
  const oldVersion = existing?.version ?? 0;
  if (version !== undefined && version < oldVersion)
    throw new DOMException("requested version is older", "VersionError");
  const target = version ?? (oldVersion || 1);
  if (target === oldVersion) return connection(existing);

  if (existing && holding) {
    blocked?.(oldVersion, target);
    await holding;
  }

  // An upgrade works on a copy, so an aborted one leaves nothing behind.
  const state = {
    version: target,
    stores: new Map([...(existing?.stores ?? new Map())].map(([k, s]) => [k, { ...s, rows: new Map(s.rows) }])),
  };
  let aborted = false;
  const database = {
    objectStoreNames: { contains: (n) => state.stores.has(n) },
    createObjectStore(n, { keyPath }) {
      if (state.stores.has(n)) throw new DOMException(`store ${n} exists`, "ConstraintError");
      state.stores.set(n, { keyPath, rows: new Map() });
      return { createIndex() {} };
    },
  };
  const transaction = {
    done: Promise.resolve(),
    abort() {
      aborted = true;
    },
  };
  upgrade?.(database, oldVersion, target, transaction);
  if (aborted) throw new DOMException("upgrade aborted", "AbortError");
  databases.set(name, state);
  return connection(state);
}

/**
 * Make a database as an older build left it: at `version`, with `stores`
 * (name → keyPath) and the rows in them.
 */
export function seedDatabase(name, version, stores = {}, rows = {}) {
  databases.set(name, {
    version,
    stores: new Map(
      Object.entries(stores).map(([n, keyPath]) => [
        n,
        { keyPath, rows: new Map((rows[n] ?? []).map((r) => [r[keyPath], copy(r)])) },
      ]),
    ),
  });
}
