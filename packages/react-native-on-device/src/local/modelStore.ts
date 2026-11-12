import type {
  OfflineModelGroupId,
  OfflineModelGroupState,
  OfflineModelProgress,
  OfflineModelStatus,
  OfflineModels,
  SceneLease,
} from '../capabilities';
import assets from './modelAssets.json';

export interface ModelFiles {
  readonly directory: string;
  exists(path: string): Promise<boolean>;
  size(path: string): Promise<number>;
  hash(path: string): Promise<string>;
  mkdir(path: string): Promise<void>;
  remove(path: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  download(
    url: string,
    path: string,
    signal: AbortSignal,
    progress: (bytes: number) => void,
  ): Promise<void>;
}
export type ModelPaths = Readonly<Record<string, string>>;
export interface ModelStore extends OfflineModels {
  paths(group?: OfflineModelGroupId): ModelPaths;
  isReady(group: OfflineModelGroupId): boolean;
  /** Runtime capability changes do not change installed-file readiness. */
  availabilityChanged(): void;
}
const GROUP_FILES: Readonly<Record<OfflineModelGroupId, readonly string[]>> = {
  answers: ['llm', 'tokenizer', 'tokenizerConfig'],
  listening: ['whisper', 'whisperTokenizer', 'vad'],
  speaking: ['duration', 'synthesizer', 'lexicon', 'phonemizer', 'voice'],
};
const GROUP_ORDER: readonly OfflineModelGroupId[] = [
  'answers',
  'listening',
  'speaking',
];
const groups = GROUP_ORDER.map(id => ({
  id,
  assets: assets.filter(asset => GROUP_FILES[id].includes(asset.id)),
}));
if (
  groups.reduce((count, group) => count + group.assets.length, 0) !==
  assets.length
) {
  throw new Error(
    'Every pinned model file must belong to one preparation group',
  );
}

/** File transfers and verification are sequential; no inference factory is called by preparation. */
export function createModelStore(
  files: ModelFiles,
  release: () => Promise<void>,
  reserveScene: () => Promise<SceneLease>,
): ModelStore {
  const total = assets.reduce((sum, asset) => sum + asset.bytes, 0);
  const directory = `${files.directory}/miris-executorch-v1`;
  const listeners = new Set<() => void>();
  let models: readonly OfflineModelProgress[] = groups.map(group => ({
    id: group.id,
    state: 'queued',
    bytes: 0,
    total: group.assets.reduce((sum, asset) => sum + asset.bytes, 0),
    progress: 0,
    error: null,
  }));
  let status: OfflineModelStatus = {
    state: 'checking',
    progress: 0,
    bytes: total,
    error: null,
    models,
  };
  let pending: Promise<void> | null = null;
  let pendingDownload = false;
  let cancellation = 0;
  let controller: AbortController | null = null;
  const pathFor = (id: string) => `${directory}/${id}`;
  const isReady = (id: OfflineModelGroupId) =>
    models.some(group => group.id === id && group.state === 'ready');
  const publish = (
    state: OfflineModelStatus['state'],
    error: string | null = null,
  ) => {
    status = {
      state,
      progress: models.reduce((sum, group) => sum + group.bytes, 0) / total,
      bytes: total,
      error,
      models,
    };
    listeners.forEach(listener => listener());
  };
  function update(
    id: OfflineModelGroupId,
    state: OfflineModelGroupState,
    bytes: number,
    overall: OfflineModelStatus['state'],
    error: string | null = null,
  ) {
    models = models.map(group =>
      group.id === id
        ? {
            ...group,
            state,
            bytes: Math.max(0, Math.min(group.total, bytes)),
            progress: Math.max(0, Math.min(1, bytes / group.total)),
            error,
          }
        : group,
    );
    publish(overall);
  }
  async function valid(asset: (typeof assets)[number], path: string) {
    return (
      (await files.exists(path)) &&
      (await files.size(path)) === asset.bytes &&
      (await files.hash(path)) === asset.sha256
    );
  }
  function run(download: boolean): Promise<void> {
    if (pending) return pending;
    const abort = new AbortController();
    controller = abort;
    pendingDownload = download;
    const overall = download ? 'downloading' : 'checking';
    let current: OfflineModelGroupId | null = null;
    let verified = 0;
    const ensureCurrent = () => {
      if (abort.signal.aborted) throw new Error('Preparation cancelled');
    };
    pending = Promise.resolve()
      .then(async () => {
        models = models.map(group =>
          group.state === 'ready'
            ? group
            : { ...group, state: 'queued', bytes: 0, progress: 0, error: null },
        );
        publish(overall);
        if (download) await files.mkdir(directory);
        for (const group of groups) {
          ensureCurrent();
          current = group.id;
          verified = 0;
          let missing = false;
          update(group.id, 'checking', 0, overall);
          for (const asset of group.assets) {
            ensureCurrent();
            const destination = pathFor(asset.id);
            if (!(await valid(asset, destination))) {
              if (!download) {
                missing = true;
                continue;
              }
              const staging = `${destination}.partial`;
              let receiving = true;
              update(group.id, 'downloading', verified, overall);
              try {
                await files.download(
                  asset.url,
                  staging,
                  abort.signal,
                  received => {
                    if (
                      receiving &&
                      !abort.signal.aborted &&
                      Number.isFinite(received)
                    ) {
                      update(
                        group.id,
                        'downloading',
                        verified + Math.max(0, Math.min(asset.bytes, received)),
                        overall,
                      );
                    }
                  },
                );
                receiving = false;
                ensureCurrent();
                update(group.id, 'checking', verified + asset.bytes, overall);
                if (!(await valid(asset, staging)))
                  throw new Error(
                    `Downloaded ${group.id} files failed verification`,
                  );
                if (await files.exists(destination))
                  await files.remove(destination);
                await files.move(staging, destination);
              } finally {
                receiving = false;
                if (await files.exists(staging)) await files.remove(staging);
              }
            }
            verified += asset.bytes;
            update(group.id, 'checking', verified, overall);
          }
          ensureCurrent();
          update(group.id, missing ? 'missing' : 'ready', verified, overall);
        }
        ensureCurrent();
        publish(
          models.every(group => group.state === 'ready') ? 'ready' : 'missing',
        );
      })
      .catch(error => {
        const message =
          error instanceof Error ? error.message : 'Offline preparation failed';
        if (current)
          update(
            current,
            abort.signal.aborted ? 'missing' : 'error',
            verified,
            overall,
            abort.signal.aborted ? null : message,
          );
        publish(
          abort.signal.aborted ? 'missing' : 'error',
          abort.signal.aborted ? null : message,
        );
        if (!abort.signal.aborted && download) throw error;
      })
      .finally(() => {
        pending = null;
        controller = null;
      });
    return pending;
  }
  return {
    getSnapshot: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    restore: group => {
      if (group && (isReady(group) || pending)) return Promise.resolve();
      return status.state === 'ready' ? Promise.resolve() : run(false);
    },
    prepare: async () => {
      const requested = cancellation;
      if (pending && (!pendingDownload || controller?.signal.aborted))
        await pending;
      if (requested === cancellation && status.state !== 'ready')
        await run(true);
    },
    cancel: () => {
      cancellation += 1;
      controller?.abort();
    },
    release,
    reserveScene,
    availabilityChanged: () => listeners.forEach(listener => listener()),
    isReady,
    paths(group) {
      if (group ? !isReady(group) : status.state !== 'ready') {
        throw new Error(
          'Prepare offline files for this function before using local inference',
        );
      }
      const required = group
        ? assets.filter(asset => GROUP_FILES[group].includes(asset.id))
        : assets;
      return Object.fromEntries(
        required.map(asset => [asset.id, pathFor(asset.id)]),
      );
    },
  };
}
