import * as Common from '/pages/src/common.mjs';

Common.initInteractionListeners();
Common.settingsStore.setDefault({scoreFts: true, scoreFal: true, scoreFin: true, scorePbp: true, leaderboardView: 'riders'});
await Common.initSettingsForm('form#options')();
