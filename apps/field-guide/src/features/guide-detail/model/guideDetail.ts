import { LearnMode } from '../../../shared/navigation/routes';
import { IconName } from '../../../shared/ui/kit/Icon';

export const MODE_OPTIONS = [
  {
    mode: LearnMode.instructor,
    title: 'Instructor',
    caption: 'Steps on screen, and answers about any part you ask.',
    icon: IconName.chat,
    testID: 'mode-instructor',
  },
  {
    mode: LearnMode.selfGuided,
    title: 'Self-guided',
    caption: 'Just the steps, read at your own pace.',
    icon: IconName.list,
    testID: 'mode-self-guided',
  },
] as const;
