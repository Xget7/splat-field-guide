import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { DocumentReference, PartId, ProcedureId } from '../../pack/pack';
import type {
  CourseDocument,
  CourseDocuments,
} from '../../../platform/documents';
import { Icon, IconName } from '../../../ui/Icon';
import { SectionHeader } from '../../../ui/SectionHeader';
import { Color, HAIRLINE, Radius, Space, Type } from '../../../ui/theme';
import {
  referenceMeta,
  type MachineSection,
  type ModuleRow,
} from '../domain/courseOutline';

const TRAILING_ICON = 20;
const OPEN_FAILED = 'Could not open this document. Try again.';
const UNAVAILABLE = 'Not on this device';

export function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <SectionHeader title={title} />
      {children}
    </View>
  );
}

/** Reads the row as sentences; an objective that already ends in a period keeps just the one. */
function spokenLabel(...parts: readonly (string | undefined)[]): string {
  const spoken = parts.filter((part): part is string => !!part);
  return spoken
    .map((part, index) =>
      index === spoken.length - 1 || part.endsWith('.') ? part : `${part}.`,
    )
    .join(' ');
}

interface RowProps {
  readonly testID: string;
  readonly title: string;
  readonly body?: string;
  readonly meta?: string;
  readonly trailing: IconName | null;
  readonly selected?: boolean;
  readonly disabled?: boolean;
  readonly divided: boolean;
  /** Indents a machine's procedure under the machine row. */
  readonly nested?: boolean;
  readonly onPress: () => void;
}

function Row({
  testID,
  title,
  body,
  meta,
  trailing,
  selected,
  disabled = false,
  divided,
  nested = false,
  onPress,
}: RowProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={spokenLabel(title, body, meta)}
      accessibilityState={
        selected === undefined ? { disabled } : { disabled, selected }
      }
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        divided && styles.divided,
        nested && styles.nested,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.body}>
        <Text
          style={[
            styles.title,
            selected && styles.selected,
            disabled && styles.disabledText,
          ]}
        >
          {title}
        </Text>
        {!!body && <Text style={styles.text}>{body}</Text>}
        {!!meta && <Text style={styles.meta}>{meta}</Text>}
      </View>
      {trailing !== null && (
        <Icon
          name={trailing}
          size={TRAILING_ICON}
          color={selected ? Color.accent : Color.faint}
        />
      )}
    </Pressable>
  );
}

export function ModuleList({
  rows,
  onChoose,
}: {
  rows: readonly ModuleRow[];
  onChoose: (id: ProcedureId) => void;
}) {
  return (
    <View style={styles.list}>
      {rows.map((row, index) => (
        <Row
          key={row.id}
          testID={`procedure-row-${row.id}`}
          title={row.title}
          body={row.objective}
          meta={row.meta}
          trailing={IconName.next}
          divided={index > 0}
          onPress={() => onChoose(row.id)}
        />
      ))}
    </View>
  );
}

/** One list where each machine leads its own procedures; tapping a machine frames it in the preview. */
export function MachineList({
  machines,
  focus,
  onFocus,
  onChoose,
}: {
  machines: readonly MachineSection[];
  focus: PartId | null;
  onFocus: (id: PartId | null) => void;
  onChoose: (id: ProcedureId) => void;
}) {
  return (
    <View style={styles.list}>
      {machines.flatMap((machine, index) => {
        const selected = machine.id === focus;
        return [
          <Row
            key={machine.id}
            testID={`machine-row-${machine.id}`}
            title={machine.name}
            body={machine.task}
            trailing={IconName.frame}
            selected={selected}
            divided={index > 0}
            onPress={() => onFocus(selected ? null : machine.id)}
          />,
          ...machine.modules.map(row => (
            <Row
              key={row.id}
              testID={`procedure-row-${row.id}`}
              title={row.title}
              body={row.objective}
              meta={row.meta}
              trailing={IconName.next}
              nested
              divided
              onPress={() => onChoose(row.id)}
            />
          )),
        ];
      })}
    </View>
  );
}

/** Cited manual pages open in the verified local PDF; documents not on the device stay visible but disabled. */
export function ReferenceSection({
  title,
  references,
  documents,
}: {
  title: string;
  references: readonly DocumentReference[];
  documents?: CourseDocuments;
}) {
  const [entries, setEntries] = useState<readonly CourseDocument[]>([]);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    // An unreadable catalog leaves every reference disabled rather than hiding the citations.
    if (references.length > 0) {
      documents?.list().then(
        result => current && setEntries(result),
        () => current && setEntries([]),
      );
    }
    return () => {
      current = false;
    };
  }, [documents, references.length]);
  if (references.length === 0) return null;
  const open = async (reference: DocumentReference) => {
    setOpening(true);
    setError('');
    try {
      await documents?.open(reference.document, reference.page);
    } catch {
      setError(OPEN_FAILED);
    } finally {
      setOpening(false);
    }
  };
  return (
    <Section title={title}>
      <View style={styles.list}>
        {references.map((reference, index) => {
          const document = entries.find(
            entry => entry.id === reference.document,
          );
          const available = !!documents && !!document?.available;
          const meta = referenceMeta(reference, document);
          return (
            <Row
              key={`${reference.document}:${reference.page}:${index}`}
              testID={`reference-row-${index}`}
              title={reference.title}
              meta={available ? meta : `${meta}. ${UNAVAILABLE}`}
              trailing={available ? IconName.document : null}
              disabled={!available || opening}
              divided={index > 0}
              onPress={() => open(reference)}
            />
          );
        })}
      </View>
      {error !== '' && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  section: { gap: Space.sm },
  list: {
    borderRadius: Radius.card,
    borderWidth: HAIRLINE,
    borderColor: Color.line,
    backgroundColor: Color.raised,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.md,
    paddingHorizontal: Space.lg,
  },
  divided: { borderTopWidth: HAIRLINE, borderTopColor: Color.line },
  // Indented so a machine's procedures read as part of that machine.
  nested: { paddingLeft: Space.lg + Space.xl },
  pressed: { backgroundColor: Color.pressed },
  body: { flex: 1, gap: Space.xs },
  title: { ...Type.calloutStrong, color: Color.text },
  selected: { color: Color.accent },
  disabledText: { color: Color.muted },
  text: { ...Type.callout, color: Color.secondaryText },
  meta: { ...Type.footnote, color: Color.muted },
  error: { ...Type.footnote, color: Color.caution },
});
