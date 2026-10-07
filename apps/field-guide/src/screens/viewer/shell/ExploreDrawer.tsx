import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import type { Part, PartId } from '../../../features/pack/pack';
import { Icon, IconName } from '../../../ui/Icon';
import { Color, MIN_TOUCH, Radius, Space, Type } from '../../../ui/theme';
import { PartList } from '../PartList';
import { Drawer } from './Drawer';

const TITLE = 'Explore';
const SEARCH_LABEL = 'Search parts';
const SEARCH_HINT = 'Filter parts by name or another name for the part';
const SEARCH_ICON_SIZE = 16;

interface Props {
  topInset: number;
  bottomInset: number;
  parts: readonly Part[];
  selected: PartId | null;
  onSelect: (id: PartId) => void;
  onClose: () => void;
}

export function ExploreDrawer({
  topInset,
  bottomInset,
  parts,
  selected,
  onSelect,
  onClose,
}: Props) {
  const [query, setQuery] = useState('');
  return (
    <Drawer
      title={TITLE}
      icon={IconName.explore}
      topInset={topInset}
      bottomInset={bottomInset}
      onClose={onClose}
    >
      <View style={styles.search}>
        <Icon
          name={IconName.search}
          size={SEARCH_ICON_SIZE}
          color={Color.muted}
        />
        <TextInput
          testID="part-search"
          accessibilityRole="search"
          accessibilityLabel={SEARCH_LABEL}
          accessibilityHint={SEARCH_HINT}
          accessibilityState={{ disabled: false }}
          placeholder={SEARCH_LABEL}
          placeholderTextColor={Color.muted}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
          selectionColor={Color.accent}
          keyboardAppearance="dark"
          style={styles.input}
        />
      </View>
      <PartList
        parts={parts}
        selected={selected}
        onSelect={onSelect}
        query={query}
      />
    </Drawer>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    marginHorizontal: Space.lg,
    marginBottom: Space.lg,
    paddingHorizontal: Space.md,
    borderRadius: Radius.field,
    backgroundColor: Color.field,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Color.line,
  },
  input: {
    ...Type.callout,
    flex: 1,
    minHeight: MIN_TOUCH,
    paddingVertical: Space.sm,
    color: Color.text,
  },
});
