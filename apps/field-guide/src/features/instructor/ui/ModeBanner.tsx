import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { Space } from '../../../ui/theme';
import { ContentFade } from './InstructorMotion';

export const MODE_RULE_WIDTH = 2;

export function ModeBanner({
  ruleColor,
  contentKey,
  children,
}: {
  ruleColor: string;
  contentKey: string | null;
  children: ReactNode;
}) {
  return (
    <ContentFade
      contentKey={contentKey}
      style={[styles.banner, { borderLeftColor: ruleColor }]}
    >
      {children}
    </ContentFade>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderLeftWidth: MODE_RULE_WIDTH,
    paddingLeft: Space.md,
    paddingVertical: Space.sm,
    gap: Space.xs,
  },
});
