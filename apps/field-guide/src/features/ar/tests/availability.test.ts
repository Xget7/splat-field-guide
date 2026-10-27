import { offersArCheck, offersAssembly } from '..';

test('a shared build keeps the physical alignment check hidden on every platform', () => {
  expect(offersArCheck('ios')).toBe(false);
  expect(offersArCheck('android')).toBe(false);
});

test('the assembly tour needs iOS', () => {
  expect(offersAssembly('ios')).toBe(true);
  expect(offersAssembly('android')).toBe(false);
});
