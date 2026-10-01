import { LearnMode } from '../../../shared/navigation/routes';
import { IconName } from '../../../shared/ui/kit/Icon';

export const MODE_OPTIONS = [
  {
    mode: LearnMode.instructor,
    title: 'Instructor',
    icon: IconName.mic,
    testID: 'mode-instructor',
  },
  {
    mode: LearnMode.selfGuided,
    title: 'Self-guided',
    icon: IconName.list,
    testID: 'mode-self-guided',
  },
] as const;
