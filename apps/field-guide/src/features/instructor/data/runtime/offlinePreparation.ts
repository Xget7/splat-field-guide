import type { OfflineModels } from 'react-native-on-device';

/** App-lifetime preparation follows the device route, independently of proxy health or navigation. */
export function createOfflinePreparation(models: OfflineModels) {
  let started = false;
  let online = false;
  let restored = false;
  let running = false;
  let revision = 0;
  let attempted = -1;

  async function prepare() {
    if (!started || !restored || !online || running || attempted === revision) {
      return;
    }
    attempted = revision;
    if (models.getSnapshot().state === 'ready') {
      return;
    }
    running = true;
    try {
      await models.prepare();
    } catch {
      // The shared model snapshot owns the error and the explicit retry control.
    } finally {
      running = false;
      // A route can recover while an aborted transfer is still settling.
      if (started && online && attempted !== revision) {
        prepare().catch(() => {});
      }
    }
  }
  return {
    start() {
      if (started) {
        return;
      }
      started = true;
      models
        .restore()
        .catch(() => {})
        .then(() => {
          restored = true;
          prepare().catch(() => {});
        });
    },
    path(available: boolean) {
      if (available === online) {
        return;
      }
      online = available;
      if (online) {
        revision += 1;
        prepare().catch(() => {});
      } else if (running || models.getSnapshot().state === 'downloading') {
        models.cancel();
      }
    },
    stop() {
      started = false;
      if (running) {
        models.cancel();
      }
    },
  };
}
