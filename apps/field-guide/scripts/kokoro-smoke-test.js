/* global __r, globalThis */
// Evaluate this file in the app's Metro debugger console in a Debug build.
(async () => {
  const entry = Array.from(__r.getModules().entries()).find(([, module]) =>
    (module.verboseName || '').includes('react-native-on-device/src/index'),
  );
  if (!entry) {
    throw new Error('The on-device module is absent from this bundle');
  }
  const output = __r(entry[0]).speechOutput();
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const check = (condition, message) => {
    if (!condition) {
      throw new Error(message);
    }
  };
  const results = [];
  globalThis.__kokoroSmokeResults = { running: true };

  let words = [];
  const pending = output.speak('Check the coolant reservoir. '.repeat(20), 'en-US', (...range) => words.push(range));
  await pause(5);
  const stoppedAt = Date.now();
  output.stop();
  await pending;
  const stopMs = Date.now() - stoppedAt;
  const atStop = words.length;
  await pause(200);
  check(words.length === atStop, 'Word callback arrived after cancelling pending synthesis');
  check(stopMs < 250, 'stop() did not promptly resolve the utterance');
  results.push({ test: 'cancel pending synthesis', stopMs, passed: true });

  words = [];
  const playing = output.speak('Before checking the coolant level, let the engine cool completely and park on level ground.', 'en-US', (...range) => words.push(range));
  const waitingAt = Date.now();
  while (words.length === 0) {
    check(Date.now() - waitingAt < 30000, 'Playback never reported a word');
    await pause(25);
  }
  const playbackStoppedAt = Date.now();
  output.stop();
  await playing;
  const playbackStopMs = Date.now() - playbackStoppedAt;
  const playbackWords = words.length;
  await pause(200);
  check(words.length === playbackWords, 'Word callback arrived after stopping playback');
  check(playbackStopMs < 250, 'Playback stop did not promptly resolve');
  results.push({ test: 'stop during playback', stopMs: playbackStopMs, passed: true });

  const replaced = output.speak('Check the coolant reservoir. '.repeat(10), 'en-US', () => {});
  await pause(5);
  const replacementWords = [];
  const replacementText = 'The engine is cool.';
  const replacement = output.speak(replacementText, 'en-US', (location, length) => {
    replacementWords.push(replacementText.slice(location, location + length));
  });
  await replaced;
  await replacement;
  check(replacementWords.join(' ') === 'The engine is cool', 'Replacement speech did not finish with valid word ranges');
  results.push({ test: 'speak replaces previous utterance', passed: true });

  const unknownText = 'The turbosprocket sits beside the battery.';
  const unknownWords = [];
  await output.speak(unknownText, 'en-US', (location, length) => {
    unknownWords.push(unknownText.slice(location, location + length));
  });
  check(unknownWords.includes('turbosprocket'), 'Unknown word lost its original range');
  results.push({ test: 'bundled neural G2P', passed: true });

  // The oversized unknown word forces Apple fallback after sentence one, which must play once with original offsets.
  const first = 'Check the coolant reservoir. ';
  const fallbackText = first + 'Z' + 'x'.repeat(62) + '. Check the battery.';
  const fallbackWords = [];
  await output.speak(fallbackText, 'en-US', (location, length) => {
    fallbackWords.push({ location, word: fallbackText.slice(location, location + length) });
  });
  check(fallbackWords.filter(word => word.location < first.length).length === 4,
    'Fallback repeated or lost the already-spoken sentence');
  check(fallbackWords.some(word => word.word === 'reservoir'), 'The first sentence did not use Kokoro');
  check(fallbackWords.some(word => word.word.replace(/[.]/g, '') === 'battery'), 'Fallback did not finish the remaining text');
  results.push({ test: 'later failure falls back without repetition', passed: true });

  const multiText = 'Check the coolant reservoir. Let the engine cool completely. Keep the cap closed while it is hot.';
  const multiWords = [];
  await output.speak(multiText, 'en-US', (location, length) => {
    multiWords.push(multiText.slice(location, location + length));
  });
  check(multiWords.join(' ') === multiText.replace(/[.]/g, ''), 'Sentence queue omitted or duplicated words');
  results.push({ test: 'sentence pipeline', passed: true });
  globalThis.__kokoroSmokeResults = { running: false, results };
})().catch(error => {
  globalThis.__kokoroSmokeResults = { running: false, error: String(error) };
});
