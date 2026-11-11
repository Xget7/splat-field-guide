import RNBlobUtil from 'react-native-blob-util';
import type { ModelFiles } from './modelStore';

export function modelFiles(): ModelFiles {
  const fs = RNBlobUtil.fs;
  return {
    // Documents persists across restarts and is not an OS-purgeable download cache.
    directory: fs.dirs.DocumentDir,
    exists: fs.exists,
    size: async path => Number((await fs.stat(path)).size),
    hash: path => fs.hash(path, 'sha256'),
    mkdir: async path => {
      if (!(await fs.exists(path))) {
        await fs.mkdir(path);
      }
    },
    remove: fs.unlink,
    move: async (from, to) => {
      const moved = await fs.mv(from, to);
      if (moved === false) {
        throw new Error('Could not activate a verified model file');
      }
    },
    async download(url, path, signal, progress) {
      const task = RNBlobUtil.config({ path }).fetch('GET', url);
      const cancel = () => task.cancel();
      signal.addEventListener('abort', cancel);
      if (signal.aborted) {
        cancel();
      }
      task.progress({ interval: 200 }, received => progress(Number(received)));
      try {
        const result = await task;
        if (result.info().status !== 200) {
          throw new Error(`Model download failed (${result.info().status})`);
        }
      } finally {
        signal.removeEventListener('abort', cancel);
      }
    },
  };
}
