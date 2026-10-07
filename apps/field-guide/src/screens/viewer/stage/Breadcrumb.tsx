import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Part, PartId } from '../../../features/pack/pack';
import { Glass, GlassTone } from '../../../ui/Glass';
import { Icon, IconName } from '../../../ui/Icon';
import { Color, MIN_TOUCH, Radius, Space, Type } from '../../../ui/theme';

const HEIGHT = 40;
const ICON_SIZE = 16;
const AREA_WIDTH = 180;
const MIDDLE_WIDTH = 120;
const LAST_WIDTH = 240;
const PATH_SEPARATOR = ', ';
const CrumbHint = {
  area: 'Show the whole area',
  part: 'Select this part',
} as const;

interface Props {
  area: string;
  trail: readonly Part[];
  onArea: () => void;
  onPart: (id: PartId) => void;
}

export function Breadcrumb({ area, trail, onArea, onPart }: Props) {
  const segments = [
    { id: null, name: area, icon: IconName.layers },
    ...trail.map(part => ({
      id: part.id,
      name: part.name,
      icon: IconName.explore,
    })),
  ];
  const path = segments.map(segment => segment.name).join(PATH_SEPARATOR);

  return (
    <Glass tone={GlassTone.clear} radius={Radius.round} style={styles.capsule}>
      {/* A separate heading preserves access to the individual crumb buttons on iOS. */}
      <Text
        accessibilityRole="header"
        accessibilityLabel={path}
        style={styles.pathLabel}
      >
        {path}
      </Text>
      {segments.map((segment, index) => {
        const last = index === segments.length - 1;
        const ink = last ? Color.text : Color.secondaryText;
        const style = [
          styles.segment,
          index === 0 ? styles.area : styles.middle,
          last && styles.last,
        ];
        const content = (
          <>
            <Icon name={segment.icon} size={ICON_SIZE} color={ink} />
            <Text
              accessible={false}
              numberOfLines={1}
              ellipsizeMode="middle"
              style={[styles.name, last && styles.currentName]}
            >
              {segment.name}
            </Text>
          </>
        );
        return last ? (
          <View
            key={segment.id === null ? 'area' : `part:${segment.id}`}
            style={style}
          >
            {content}
          </View>
        ) : (
          <Pressable
            key={segment.id === null ? 'area' : `part:${segment.id}`}
            accessibilityRole="button"
            accessibilityLabel={segment.name}
            accessibilityHint={
              segment.id === null ? CrumbHint.area : CrumbHint.part
            }
            accessibilityState={{ disabled: false }}
            hitSlop={(MIN_TOUCH - HEIGHT) / 2}
            onPress={() =>
              segment.id === null ? onArea() : onPart(segment.id)
            }
            style={style}
          >
            {content}
          </Pressable>
        );
      })}
    </Glass>
  );
}

const styles = StyleSheet.create({
  capsule: {
    height: HEIGHT,
    maxWidth: '100%',
    paddingHorizontal: Space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.lg,
  },
  pathLabel: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    color: 'transparent',
  },
  segment: {
    minWidth: ICON_SIZE + Space.sm,
    height: HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  area: { maxWidth: AREA_WIDTH, flexShrink: 1 },
  middle: { maxWidth: MIDDLE_WIDTH, flexShrink: 2 },
  last: { maxWidth: LAST_WIDTH, flexShrink: 1 },
  name: { ...Type.callout, color: Color.secondaryText, flexShrink: 1 },
  currentName: { ...Type.calloutStrong, color: Color.text },
});
