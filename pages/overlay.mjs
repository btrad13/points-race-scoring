import {attachResults, raceField, scoreInstances, segmentInstances} from './model.mjs';

const $ = id => document.getElementById(id);
const demo = new URLSearchParams(location.search).get('demo') === '1';
let Common, athlete, stopped = false, updateBusy = false, updateTimer, retryTimer;
let sessionKey = null, frozenField = null, latest = {racers: [], scored: [], leaderboard: []};
let scoringInput = null;
const defaults = {scoreFts: true, scoreFal: true, scoreFin: true, scorePbp: true};

function subgroupId() {
    const value = athlete?.state?.eventSubgroupId;
    return value == null || value === 0 || value === '0' ? null : value;
}

function scoringSettings() {
    return Common ? {...defaults, ...Common.settingsStore.get()} : defaults;
}

function scoreAndRender(message) {
    if (!scoringInput) return render(message);
    const scored = scoreInstances(scoringInput.instances, scoringInput.racers, scoringInput.eligibleIds,
        scoringInput.official, scoringSettings());
    latest = {...scored, racers: scoringInput.racers}; render(message);
}

function render(message) {
    $('leaderboard').replaceChildren();
    const {racers, scored, leaderboard} = latest;
    $('race-meta').textContent = racers.length ? `${racers.length} racer${racers.length === 1 ? '' : 's'} · ${scored.length} segment crossing${scored.length === 1 ? '' : 's'} scored` : 'Waiting for a race…';
    $('status').textContent = message || (scored.length ? 'FTS = fastest through · FAL = first across the line' : 'Points appear when the first segment result arrives.');
    if (!leaderboard.length) {
        const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = message || 'Join a group race to load its field and segment results.'; $('leaderboard').append(empty); return;
    }
    leaderboard.forEach((racer, index) => {
        const row = document.createElement('article'); row.className = `row racer${racer.self ? ' self' : ''}`;
        for (const [className, value] of [['place', index + 1], ['name', racer.name], ['fastest', racer.fastest], ['first', racer.first], ['finish', racer.finish], ['podium', racer.podium], ['total', racer.total]]) {
            const cell = document.createElement('span'); cell.className = className; cell.textContent = String(value);
            if (className === 'name' && racer.team) {
                const team = document.createElement('span'); team.className = 'team'; team.textContent = ` · ${racer.team}`; cell.append(team);
            }
            row.append(cell);
        }
        $('leaderboard').append(row);
    });
}

async function update() {
    if (updateBusy || stopped || !Common) return;
    updateBusy = true;
    try {
        const id = subgroupId();
        if (!id) {
            // Keep the completed race table visible through the cooldown.  A new
            // subgroup replaces it automatically when the rider joins again.
            if (latest.scored.length) return render('Race complete — final points shown.');
            latest = {racers: [], scored: [], leaderboard: []}; scoringInput = null; frozenField = null; sessionKey = null;
            return render('Join a group race to begin scoring.');
        }
        const subgroup = await Common.getEventSubgroup(id);
        if (!subgroup?.routeId || !subgroup?.ts) return render('Waiting for race details from Sauce.');
        const key = `${id}:${subgroup.ts}`;
        if (key !== sessionKey) { sessionKey = key; frozenField = null; scoringInput = null; }
        const now = await Common.getRealTime();
        const entrants = await Common.rpc.getEventSubgroupEntrants(id, {joined: true});
        const liveField = raceField(entrants, athlete);
        // ZRL FAL is based on the riders who start, not the riders still active at
        // the first intermediate.  Snapshot the joined field as the event starts.
        if (!frozenField && now >= subgroup.ts && liveField.length) frozenField = liveField;
        const route = await Common.getRoute(subgroup.routeId);
        const infos = route ? await Common.getSegments(route.segments.map(x => x.id)) : [];
        const names = new Map(infos.filter(Boolean).map(info => [String(info.id), info.name]));
        const currentField = frozenField || liveField;
        const fieldIds = new Set(currentField.map(x => x.athleteId));
        const slicesByAthlete = await Promise.all(currentField.map(async racer => [racer.athleteId,
            await Common.rpc.getAthleteSegments(racer.athleteId, {active: true}).catch(() => [])]));
        const instances = segmentInstances(slicesByAthlete, id, names);
        const segmentIds = [...new Set(route?.segments?.map(x => String(x.id)) || [])];
        const resultsBySegment = new Map(await Promise.all(segmentIds.map(async segmentId => [segmentId,
            await Common.rpc.getSegmentResults(segmentId, {from: subgroup.ts, to: Math.min(now, subgroup.estimatedFinish || now)}).catch(() => [])])));
        const resolved = attachResults(instances, resultsBySegment, fieldIds);
        let eligibleIds = null, official = null;
        if (subgroup.estimatedFinish && now >= subgroup.estimatedFinish) {
            official = await Common.rpc.getEventSubgroupResults(id).catch(() => null);
            if (Array.isArray(official) && official.length) eligibleIds = new Set(official.filter(x => !x.dnf).map(x => String(x.profileId)));
        }
        scoringInput = {instances: resolved, racers: currentField, eligibleIds, official}; scoreAndRender();
    } catch (error) {
        render('Could not refresh race segment results; retrying.');
    } finally { updateBusy = false; }
}

const onAthlete = value => { athlete = value; update(); };

async function start() {
    try {
        Common = await import('/pages/src/common.mjs');
        Common.initInteractionListeners(); Common.settingsStore.setDefault(defaults);
        Common.settingsStore.addEventListener('changed', event => {
            const changed = event.data.changed;
            if (['scoreFts', 'scoreFal', 'scoreFin', 'scorePbp'].some(key => changed.has(key))) scoreAndRender();
        });
        await Common.subscribe('athlete/self', onAthlete, {persistent: true});
        athlete ||= await Common.rpc.getAthleteData('self').catch(() => null);
        update(); updateTimer = setInterval(update, 15_000);
    } catch { if (!stopped) retryTimer = setTimeout(start, 5000); }
}

window.addEventListener('beforeunload', () => { stopped = true; clearInterval(updateTimer); clearTimeout(retryTimer); Common?.unsubscribe('athlete/self', onAthlete).catch(() => {}); });

if (demo) {
    latest = {racers: [{athleteId: '1'}, {athleteId: '2'}, {athleteId: '3'}], scored: [{}, {}], leaderboard: [
        {name: 'Bailey Climber', team: 'Ridge Racing', fastest: 12, first: 6, finish: 4, podium: 10, total: 32}, {name: 'Alex Rider', team: 'Velocity', self: true, fastest: 15, first: 5, finish: 3, podium: 8, total: 31}, {name: 'Casey Watts', fastest: 1, first: 1, finish: 2, podium: 6, total: 10}
    ]}; render();
} else start();
