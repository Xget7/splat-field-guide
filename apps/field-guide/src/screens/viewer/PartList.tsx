import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon, IconName } from '../../ui/Icon';
import { Color, MIN_TOUCH, Radius, Space, Type } from '../../ui/theme';
import type { Part, PartId } from '../../features/pack/pack';

const ROW_HEIGHT = 48;
const GLYPH_SIZE = 16;
const CHEVRON_SIZE = 14;
const CHILD_INDENT = 20;
const EMPTY_LABEL = 'No parts match';
const SELECT_HINT = 'Inspect this part';
const EXPAND_LABEL = 'Expand';
const COLLAPSE_LABEL = 'Collapse';
const EXPAND_HINT = 'Show parts inside this part';
const COLLAPSE_HINT = 'Hide parts inside this part';

function ancestorsOf(
  selected: PartId | null,
  byId: ReadonlyMap<PartId, Part>,
): Set<PartId> {
  const ancestors = new Set<PartId>();
  let parent = selected === null ? null : byId.get(selected)?.parent;
  while (parent != null && !ancestors.has(parent)) {
    ancestors.add(parent);
    parent = byId.get(parent)?.parent;
  }
  return ancestors;
}

interface PartRow {
  part: Part;
  depth: number;
}

/** Names belong here; the floating part card owns the selected part's summary. */
export function PartList({
  parts,
  selected,
  onSelect,
  query = '',
}: {
  parts: readonly Part[];
  selected: PartId | null;
  onSelect: (id: PartId) => void;
  /** Search results are flat so a matching child never depends on an open branch. */
  query?: string;
}) {
  const { byId, children, roots } = useMemo(() => {
    const index = new Map(parts.map(part => [part.id, part]));
    const branches = new Map<PartId, Part[]>();
    const top: Part[] = [];
    for (const part of parts) {
      if (part.parent === null || !index.has(part.parent)) {
        top.push(part);
      } else {
        const siblings = branches.get(part.parent) ?? [];
        siblings.push(part);
        branches.set(part.parent, siblings);
      }
    }
    return { byId: index, children: branches, roots: top };
  }, [parts]);
  const [expanded, setExpanded] = useState(() => ancestorsOf(selected, byId));
  useEffect(() => {
    // A pick on the picture must reveal the same part in the tree.
    const ancestors = ancestorsOf(selected, byId);
    setExpanded(previous => {
      if ([...ancestors].every(id => previous.has(id))) {
        return previous;
      }
      return new Set([...previous, ...ancestors]);
    });
  }, [selected, byId]);

  const filter = query.trim().toLowerCase();
  const rows = useMemo(() => {
    if (filter !== '') {
      return parts
        .filter(
          part =>
            part.name.toLowerCase().includes(filter) ||
            part.aliases.some(alias => alias.toLowerCase().includes(filter)),
        )
        .map(part => ({ part, depth: 0 }));
    }
    const visible: PartRow[] = [];
    const seen = new Set<PartId>();
    function visit(part: Part, depth: number) {
      if (seen.has(part.id)) {
        return;
      }
      seen.add(part.id);
      visible.push({ part, depth });
      if (expanded.has(part.id)) {
        for (const child of children.get(part.id) ?? []) {
          visit(child, depth + 1);
        }
      }
    }
    for (const root of roots) {
      visit(root, 0);
    }
    return visible;
  }, [parts, roots, children, expanded, filter]);

  const toggle = (id: PartId) => {
    setExpanded(previous => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <View testID="part-list" style={styles.list}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.rows}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
      >
        {rows.length === 0 && filter !== '' && (
          <Text accessibilityLiveRegion="polite" style={styles.empty}>
            {EMPTY_LABEL}
          </Text>
        )}
        {rows.map(({ part, depth }) => {
          const current = part.id === selected;
          const branch = filter === '' && children.has(part.id);
          const open = expanded.has(part.id);
          return (
            <View
              key={part.id}
              style={[
                styles.row,
                { marginLeft: depth * CHILD_INDENT },
                current && styles.rowCurrent,
              ]}
            >
              <Pressable
                testID={`part-row-${part.id}`}
                accessibilityRole="button"
                accessibilityLabel={part.name}
                accessibilityHint={SELECT_HINT}
                accessibilityState={{ selected: current }}
                onPress={() => onSelect(part.id)}
                style={({ pressed }) => [
                  styles.select,
                  pressed && styles.pressed,
                ]}
              >
                <Icon
                  name={IconName.explore}
                  size={GLYPH_SIZE}
                  color={current ? Color.accentText : Color.accent}
                />
                <Text
                  numberOfLines={1}
                  style={[styles.name, current && styles.nameCurrent]}
                >
                  {part.name}
                </Text>
              </Pressable>
              {branch && (
                <Pressable
                  testID={`part-expand-${part.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${
                    open ? COLLAPSE_LABEL : EXPAND_LABEL
                  } ${part.name}`}
                  accessibilityHint={open ? COLLAPSE_HINT : EXPAND_HINT}
                  accessibilityState={{ expanded: open }}
                  onPress={() => toggle(part.id)}
                  style={({ pressed }) => [
                    styles.expand,
                    pressed && styles.pressed,
                  ]}
                >
                  <Icon
                    name={open ? IconName.down : IconName.next}
                    size={CHEVRON_SIZE}
                    color={current ? Color.accentText : Color.muted}
                  />
                </Pressable>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  scroll: { flex: 1 },
  rows: { gap: Space.xs, paddingHorizontal: Space.lg, paddingBottom: Space.lg },
  row: {
    minHeight: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.control,
    overflow: 'hidden',
  },
  rowCurrent: { backgroundColor: Color.accentFill },
  select: {
    flex: 1,
    minHeight: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingHorizontal: Space.md,
    paddingVertical: Space.xs,
    borderRadius: Radius.control,
  },
  expand: {
    width: MIN_TOUCH,
    height: ROW_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.control,
  },
  pressed: { backgroundColor: Color.pressed },
  name: { ...Type.callout, flex: 1, color: Color.text },
  nameCurrent: { color: Color.accentText },
  empty: {
    ...Type.callout,
    color: Color.secondaryText,
    paddingHorizontal: Space.md,
    paddingVertical: Space.lg,
  },
});
