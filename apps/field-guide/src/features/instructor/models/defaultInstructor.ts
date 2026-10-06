import { createModelInstructor } from './modelInstructor';
import { cloudModel } from './cloudModel';
import { onDeviceModel } from './onDeviceModel';

export const defaultInstructor = createModelInstructor([
  cloudModel,
  onDeviceModel,
]);
