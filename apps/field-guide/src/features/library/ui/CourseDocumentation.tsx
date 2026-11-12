import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type {
  CourseDocument,
  CourseDocuments,
} from '../../../platform/documents';
import { Icon, IconName } from '../../../ui/Icon';
import {
  CourseColor as C,
  CourseType as T,
  Grid as G,
  CourseRadius as R,
} from '../../../ui/courseTokens';

export function CourseDocumentation({
  documents,
}: {
  documents?: CourseDocuments;
}) {
  const [entries, setEntries] = useState<readonly CourseDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    (documents?.list() ?? Promise.resolve([])).then(
      result => {
        if (active) {
          setEntries(result);
          setLoading(false);
        }
      },
      () => {
        if (active) {
          setError('Could not read the on-device documentation. Try again.');
          setLoading(false);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [documents, attempt]);
  const open = async (id: string) => {
    setOpening(id);
    setError('');
    try {
      await documents?.open(id);
    } catch {
      setError('Could not open this document. Try again.');
    } finally {
      setOpening(null);
    }
  };
  return (
    <View testID="course-documentation" style={styles.panel}>
      <Text accessibilityRole="header" style={styles.title}>
        Equipment documentation
      </Text>
      <Text style={styles.secondary}>
        Original KUKA manuals. Confirm the installed robot and accessories
        before using maintenance instructions.
      </Text>
      {loading && (
        <Text style={styles.secondary}>
          Checking on-device documentation...
        </Text>
      )}
      {entries.map(document => (
        <Pressable
          key={document.id}
          testID={`document-${document.id}`}
          accessibilityRole="button"
          accessibilityLabel={`Open ${document.edition}`}
          accessibilityState={{
            disabled: !document.available || opening !== null,
            busy: opening === document.id,
          }}
          disabled={!document.available || opening !== null}
          onPress={() => open(document.id)}
          style={({ pressed }) => [styles.document, pressed && styles.pressed]}
        >
          <Icon name={IconName.list} color={C.accent} />
          <View style={styles.description}>
            <Text style={styles.documentTitle}>{document.title}</Text>
            <Text style={styles.secondary}>{document.edition}</Text>
            <Text style={styles.caption}>
              {document.issued}, {document.pages} pages
            </Text>
            <Text style={styles.status}>
              {opening === document.id
                ? 'Opening...'
                : document.available
                ? 'On device, opens offline'
                : 'Not installed on this device'}
            </Text>
          </View>
          <Icon name={IconName.next} color={C.secondary} />
        </Pressable>
      ))}
      {!loading && entries.length === 0 && !error && (
        <Text style={styles.secondary}>
          No manufacturer documents are installed with this app.
        </Text>
      )}
      {error !== '' && (
        <>
          <Text accessibilityRole="alert" style={styles.secondary}>
            {error}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry documentation"
            onPress={() => setAttempt(value => value + 1)}
            style={styles.retry}
          >
            <Text style={styles.status}>Retry</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: G.medium, maxWidth: 800 },
  title: { ...T.heading, color: C.text },
  secondary: { ...T.body, color: C.secondary },
  caption: { ...T.caption, color: C.secondary },
  document: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: G.small,
    padding: G.medium,
    borderRadius: R.control,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.raised,
  },
  description: { flex: 1, gap: G.unit },
  documentTitle: { ...T.label, color: C.text },
  status: { ...T.label, color: C.accent },
  pressed: { opacity: 0.8 },
  retry: { minHeight: G.control, justifyContent: 'center' },
});
