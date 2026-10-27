// This port lives apart from the native ports because the guide index exposes the progress
// storage, and Node programs such as the voice agent load that index; a file that type-imports
// react-native would bring its global declarations into those programs.
/** Keeps small strings across launches, shaped like AsyncStorage. */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
