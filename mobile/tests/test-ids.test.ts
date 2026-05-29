import { expect, test } from 'bun:test';

import { TEST_IDS } from '../src/constants/testIds';

test('navigation test IDs cover tab and details flows', () => {
  expect(TEST_IDS.tabs.componentsTab).toBe('tabs.components');
  expect(TEST_IDS.tabs.profileTab).toBe('tabs.profile');
  expect(TEST_IDS.details.openButton).toBe('details.open-button');
  expect(TEST_IDS.details.backButton).toBe('details.back-button');
  expect(TEST_IDS.details.screen).toBe('details.screen');
  expect(TEST_IDS.screen.backButton).toBe('screen.back-button');
});

test('phase 11 mobile surfaces expose stable test IDs', () => {
  expect(TEST_IDS.hrDashboard.screen).toBe('hr-dashboard.screen');
  expect(TEST_IDS.hrDashboard.approveOfferButton).toBe('hr-dashboard.approve-offer');
  expect(TEST_IDS.portal.screen).toBe('portal.screen');
  expect(TEST_IDS.portal.onboardingChecklist).toBe('portal.onboarding-checklist');
  expect(TEST_IDS.devices.registerButton).toBe('devices.register-button');
});
