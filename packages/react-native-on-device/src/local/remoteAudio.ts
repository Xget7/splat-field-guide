import { fromByteArray, toByteArray } from 'base64-js';
import type { LocalAudio } from './audio';

const PCM_SCALE = 32768;
export function encodePCM(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((value, index) =>
    view.setInt16(
      index * 2,
      Math.max(
        -PCM_SCALE,
        Math.min(PCM_SCALE - 1, Math.round(value * PCM_SCALE)),
      ),
      true,
    ),
  );
  return fromByteArray(bytes);
}
export function decodePCM(chunk: string): Float32Array {
  const bytes = toByteArray(chunk);
  if (bytes.length % 2 !== 0) {
    throw new Error('Audio requires little-endian PCM16');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Float32Array.from(
    { length: bytes.length / 2 },
    (_, index) => view.getInt16(index * 2, true) / PCM_SCALE,
  );
}

export function createAudioLink(audio: LocalAudio, stopLocal: () => void) {
  let generation = 0;
  let running = false;
  let outputRate = 24000;
  let lost: ((reason: string) => void) | null = null;
  const stop = () => {
    generation++;
    running = false;
    lost = null;
    audio.stop('remote').catch(() => {});
  };
  return {
    requestPermission: audio.permission,
    async start(
      inputRate: number,
      rate: number,
      onInput: (chunk: string) => void,
      onLevel: (level: number) => void,
      onStopped: (reason: string) => void,
    ) {
      if (running) {
        throw new Error('Audio link already started');
      }
      if (
        inputRate !== 16000 ||
        !Number.isInteger(rate) ||
        rate < 8000 ||
        rate > 48000
      ) {
        throw new Error(
          'Audio link requires 16 kHz input and a supported output rate',
        );
      }
      const id = ++generation;
      running = true;
      outputRate = rate;
      lost = onStopped;
      try {
        stopLocal();
        await audio.stop('local');
        if (!running || id !== generation) {
          return;
        }
        await audio.record(
          'remote',
          samples => {
            if (running && id === generation) {
              onInput(encodePCM(samples));
            }
          },
          onLevel,
          reason => {
            if (running && id === generation) {
              stop();
              onStopped(reason);
            }
          },
        );
      } catch (error) {
        if (id === generation) {
          stop();
        }
        throw error;
      }
    },
    play(chunk: string) {
      if (!running) {
        return;
      }
      const id = generation;
      audio.play('remote', decodePCM(chunk), outputRate).catch(() => {
        if (running && id === generation) {
          const onStopped = lost;
          stop();
          onStopped?.('Audio playback failed');
        }
      });
    },
    clear: () => audio.stopOutput('remote'),
    playedMs: audio.playedMs,
    stop,
  };
}
