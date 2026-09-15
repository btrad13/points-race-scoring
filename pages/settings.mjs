import * as Common from '/pages/src/common.mjs';

Common.initInteractionListeners();
Common.settingsStore.setDefault({scoreFts: true, scoreFal: true, scoreFin: true, scorePbp: true});
await Common.initSettingsForm('form#options')();
