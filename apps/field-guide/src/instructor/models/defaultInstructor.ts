import { createModelInstructor } from './modelInstructor';
import { cloudModel } from './cloudModel';
import { onDeviceModel } from './onDeviceModel';

// Best first: Claude online, Apple's model offline. The script answers when neither can.
export const defaultInstructor = createModelInstructor([
  cloudModel,
  onDeviceModel,
]);
