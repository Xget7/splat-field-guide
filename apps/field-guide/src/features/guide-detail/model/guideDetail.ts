import { LearnMode } from '../../../shared/navigation/routes';
import { IconName } from '../../../shared/ui/kit/Icon';

export const MODE_OPTIONS = [
  {
    mode: LearnMode.instructor,
    title: 'Instructor',
    icon: IconName.mic,
    testID: 'mode-instructor',
    description: 'Ask about a part. It shows you where.',
  },
  {
    mode: LearnMode.selfGuided,
    title: 'Self-guided',
    icon: IconName.list,
    testID: 'mode-self-guided',
    description: 'Read each step at your own pace.',
  },
] as const;
