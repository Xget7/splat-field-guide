import type { OfflineModelStatus, OfflineModels } from '../capabilities';
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
  paths(): ModelPaths;
}

/** A verified file is reusable after interruption; partial files never become model inputs. */
export function createModelStore(
  files: ModelFiles,
  release: () => void,
): ModelStore {
  const total = assets.reduce((sum, asset) => sum + asset.bytes, 0);
  const directory = `${files.directory}/miris-executorch-v1`;
  const listeners = new Set<() => void>();
  let status: OfflineModelStatus = {
    state: 'checking',
    progress: 0,
    bytes: total,
    error: null,
  };
  let pending: Promise<void> | null = null;
  let pendingDownload = false;
  let cancellation = 0;
  let controller: AbortController | null = null;
  const pathFor = (id: string) => `${directory}/${id}`;
  const publish = (
    state: OfflineModelStatus['state'],
    progress = 0,
    error: string | null = null,
  ) => {
    status = { state, progress, bytes: total, error };
    listeners.forEach(listener => listener());
  };
  async function valid(asset: (typeof assets)[number], path: string) {
    return (
      (await files.exists(path)) &&
      (await files.size(path)) === asset.bytes &&
      (await files.hash(path)) === asset.sha256
    );
  }
  function run(download: boolean): Promise<void> {
    if (pending) {
      return pending;
    }
    const abort = new AbortController();
    controller = abort;
    pendingDownload = download;
    pending = Promise.resolve()
      .then(async () => {
        publish(download ? 'downloading' : 'checking');
        if (download) {
          await files.mkdir(directory);
        }
        let completed = 0;
        for (const asset of assets) {
          if (abort.signal.aborted) {
            throw new Error('Preparation cancelled');
          }
          const destination = pathFor(asset.id);
          if (!(await valid(asset, destination))) {
            if (!download) {
              publish('missing');
              return;
            }
            const staging = `${destination}.partial`;
            try {
              await files.download(
                asset.url,
                staging,
                abort.signal,
                received => {
                  if (!abort.signal.aborted) {
                    publish(
                      'downloading',
                      Math.min(1, (completed + received) / total),
                    );
                  }
                },
              );
              if (abort.signal.aborted) {
                throw new Error('Preparation cancelled');
              }
              if (!(await valid(asset, staging))) {
                throw new Error(`Model verification failed: ${asset.id}`);
              }
              if (await files.exists(destination)) {
                await files.remove(destination);
              }
              await files.move(staging, destination);
            } finally {
              if (await files.exists(staging)) {
                await files.remove(staging);
              }
            }
          }
          completed += asset.bytes;
        }
        if (abort.signal.aborted) {
          throw new Error('Preparation cancelled');
        }
        publish('ready', 1);
      })
      .catch(error => {
        publish(
          abort.signal.aborted ? 'missing' : 'error',
          0,
          abort.signal.aborted
            ? null
            : error instanceof Error
            ? error.message
            : 'Offline preparation failed',
        );
        if (!abort.signal.aborted && download) {
          throw error;
        }
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
    restore: () => (status.state === 'ready' ? Promise.resolve() : run(false)),
    prepare: async () => {
      const requested = cancellation;
      // A retry must outlive a cancelled transfer, including its staging-file cleanup.
      // Restore can also publish 'missing' before its promise settles.
      if (pending && (!pendingDownload || controller?.signal.aborted)) {
        await pending;
      }
      if (requested === cancellation && status.state !== 'ready') {
        await run(true);
      }
    },
    cancel: () => {
      cancellation += 1;
      controller?.abort();
    },
    release,
    paths() {
      if (status.state !== 'ready') {
        throw new Error(
          'Prepare offline models while connected before using local inference',
        );
      }
      return Object.fromEntries(
        assets.map(asset => [asset.id, pathFor(asset.id)]),
      );
    },
  };
}
