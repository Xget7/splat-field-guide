import { createAudio } from './audio';
import { createInference } from './inference';
import { createModelStore } from './modelStore';
import { modelFiles } from './files';
import { createLocalCapabilities } from './sessions';
import { createAudioLink } from './remoteAudio';
import type { SceneLease } from '../capabilities';

export function createLocalRuntime() {
  const audio = createAudio();
  const models = createModelStore(
    modelFiles(),
    () => release(),
    () => reserveScene(),
  );
  const inference = createInference(models.paths);
  const local = createLocalCapabilities(audio, inference, models);
  const remote = createAudioLink(audio, () => {
    local.input.cancel();
    local.output.stop();
  });
  function release(): Promise<void> {
    const operations = local.quiesce();
    // Native factories are invalidated immediately; disposal waits for active work to settle.
    const stopped = Promise.allSettled([operations, audio.stop()]).then(
      results => {
        const failure = results.find(result => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
      },
    );
    return inference.release(stopped);
  }
  function reserveScene(): Promise<SceneLease> {
    // The ban begins synchronously, before waiting for any asynchronous model retirement.
    const lease = inference.reserveScene();
    let held = true;
    const releaseLease = () => {
      if (!held) return;
      held = false;
      lease.release();
      models.availabilityChanged();
    };
    try {
      models.availabilityChanged();
      return Promise.resolve()
        .then(release)
        .then(
          () => ({ release: releaseLease }),
          error => {
            releaseLease();
            throw error;
          },
        );
    } catch (error) {
      releaseLease();
      return Promise.reject(error);
    }
  }
  return {
    input: local.input,
    output: local.output,
    model: local.model,
    models,
    audioLink: remote,
  };
}
