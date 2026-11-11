import { createAudio } from './audio';
import { createInference } from './inference';
import { createModelStore } from './modelStore';
import { modelFiles } from './files';
import { createLocalCapabilities } from './sessions';
import { createAudioLink } from './remoteAudio';

export function createLocalRuntime() {
  const audio = createAudio();
  const models = createModelStore(modelFiles(), () => {
    release().catch(() => {});
  });
  const inference = createInference(models.paths);
  const local = createLocalCapabilities(audio, inference, models);
  const remote = createAudioLink(audio, () => {
    local.input.cancel();
    local.output.stop();
  });
  async function release() {
    models.cancel();
    local.input.cancel();
    local.output.stop();
    local.model.cancel();
    try {
      await audio.stop();
    } finally {
      await local.settled();
      await inference.release();
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
