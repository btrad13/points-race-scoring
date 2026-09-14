// Segment IDs can be signed 64-bit values, so retain them as strings.
export function racerName(value, fallback = 'Unknown rider') {
    const athlete = value?.athlete || value?.profileData || value || {};
    return athlete.sanitizedFullname || athlete.fullname || athlete.displayName ||
        [athlete.firstName, athlete.lastName].filter(Boolean).join(' ') || fallback;
}

export function racerTeam(value) {
    const athlete = value?.athlete || value?.profileData || value || {};
    return typeof athlete.team === 'string' ? athlete.team.trim() : '';
}

export function raceField(entrants, self) {
    const racers = new Map();
    for (const entrant of Array.isArray(entrants) ? entrants : []) {
        const id = entrant?.id ?? entrant?.athleteId ?? entrant?.profileId;
        if (id != null) {
            const athleteId = String(id), previous = racers.get(athleteId);
            racers.set(athleteId, {athleteId, name: racerName(entrant, previous?.name || `Rider ${id}`),
                team: racerTeam(entrant) || previous?.team || '', self: false});
        }
    }
    if (self?.athleteId != null) {
        const id = String(self.athleteId);
        racers.set(id, {...racers.get(id), athleteId: id, name: racerName(self, racers.get(id)?.name || 'You'),
            team: racerTeam(self) || racers.get(id)?.team || '', self: true});
    }
    return [...racers.values()].sort((a, b) => Number(b.self) - Number(a.self) || a.name.localeCompare(b.name));
}

function sliceEndTime(slice) {
    const started = Number(slice?.startServerTime);
    const elapsed = Number(slice?.stats?.elapsedTime ?? slice?.elapsedTime);
    return Number.isFinite(started) && Number.isFinite(elapsed) && elapsed > 0 ? started + elapsed * 1000 : null;
}

// Sauce records the event distance at a segment finish.  It is the reliable way to
// distinguish a repeated segment from the same segment on a later route lap.
export function segmentInstances(slicesByAthlete, subgroupId, segmentNames = new Map(), tolerance = 120) {
    const candidates = [];
    for (const [athleteId, slices] of slicesByAthlete || []) {
        for (const slice of Array.isArray(slices) ? slices : []) {
            const endDistance = Number(slice?.endEventDistance);
            if (String(slice?.eventSubgroupId) !== String(subgroupId) || slice?.incomplete ||
                !Number.isFinite(endDistance) || !Number.isFinite(sliceEndTime(slice))) continue;
            candidates.push({athleteId: String(athleteId), segmentId: String(slice.segmentId), endDistance,
                endTime: sliceEndTime(slice), name: segmentNames.get(String(slice.segmentId)) || `Segment ${slice.segmentId}`});
        }
    }
    candidates.sort((a, b) => a.segmentId.localeCompare(b.segmentId) || a.endDistance - b.endDistance);
    const instances = [];
    for (const candidate of candidates) {
        const previous = instances.at(-1);
        if (!previous || previous.segmentId !== candidate.segmentId || Math.abs(previous.endDistance - candidate.endDistance) > tolerance) {
            instances.push({key: `${candidate.segmentId}:${Math.round(candidate.endDistance / tolerance)}`,
                segmentId: candidate.segmentId, name: candidate.name, endDistance: candidate.endDistance, observations: [candidate]});
        } else {
            previous.observations.push(candidate);
            previous.endDistance = previous.observations.reduce((sum, x) => sum + x.endDistance, 0) / previous.observations.length;
        }
    }
    return instances.sort((a, b) => a.endDistance - b.endDistance);
}

function validResult(result, fieldIds, segmentId) {
    return result && fieldIds.has(String(result.athleteId)) && String(result.segmentId) === String(segmentId) &&
        Number.isFinite(Number(result.elapsed)) && Number(result.elapsed) > 0 && Number.isFinite(Number(result.ts));
}

// Match API results to an observed event-distance occurrence.  Exact telemetry
// matches are used first; the time-anchor fallback fills riders Sauce did not see
// locally, without using a result more than once for that rider and segment.
export function attachResults(instances, resultsBySegment, fieldIds) {
    const allowed = new Set([...fieldIds].map(String));
    const bySegment = new Map();
    for (const instance of instances) {
        if (!bySegment.has(instance.segmentId)) bySegment.set(instance.segmentId, []);
        bySegment.get(instance.segmentId).push({...instance, results: new Map()});
    }
    for (const [segmentId, segmentInstances] of bySegment) {
        const results = (resultsBySegment.get(segmentId) || []).filter(x => validResult(x, allowed, segmentId));
        const used = new Set();
        for (const instance of segmentInstances) {
            for (const observation of instance.observations) {
                const candidates = results.filter(result => String(result.athleteId) === observation.athleteId && !used.has(String(result.id)));
                candidates.sort((a, b) => Math.abs(Number(a.ts) - observation.endTime) - Math.abs(Number(b.ts) - observation.endTime));
                const match = candidates[0];
                if (match && Math.abs(Number(match.ts) - observation.endTime) <= 20_000) {
                    instance.results.set(observation.athleteId, match); used.add(String(match.id));
                }
            }
            const directTimes = [...instance.results.values()].map(x => Number(x.ts));
            instance.anchor = directTimes.length ? directTimes.reduce((sum, x) => sum + x, 0) / directTimes.length :
                instance.observations.reduce((sum, x) => sum + x.endTime, 0) / instance.observations.length;
        }
        for (const result of results) {
            const id = String(result.id);
            const athleteId = String(result.athleteId);
            if (used.has(id) || segmentInstances.some(x => x.results.has(athleteId))) continue;
            const nearest = segmentInstances.toSorted((a, b) => Math.abs(a.anchor - Number(result.ts)) - Math.abs(b.anchor - Number(result.ts)))[0];
            // One occurrence needs no disambiguation; repeated occurrences get a
            // conservative 20-minute matching window to avoid borrowing another lap.
            if (nearest && (segmentInstances.length === 1 || Math.abs(nearest.anchor - Number(result.ts)) <= 1_200_000)) {
                nearest.results.set(athleteId, result); used.add(id);
            }
        }
    }
    return [...bySegment.values()].flat();
}

export const FTS_POINTS = [15, 12, 10, 8, 6, 5, 4, 3, 2, 1];

function falPoints(results, fieldSize) {
    const ordered = [...results.values()].sort((a, b) => Number(a.ts) - Number(b.ts) ||
        String(a.athleteId).localeCompare(String(b.athleteId)));
    return new Map(ordered.map((result, index) => [String(result.athleteId), Math.max(0, fieldSize - index)]));
}

// FTS is not awarded per lap.  Each segment has one race-long leaderboard: every
// recorded attempt competes for one of its fixed top-ten point slots.
function ftsPoints(instances) {
    const attemptsBySegment = new Map();
    for (const instance of instances) {
        if (!attemptsBySegment.has(instance.segmentId)) attemptsBySegment.set(instance.segmentId, []);
        for (const result of instance.results.values()) attemptsBySegment.get(instance.segmentId).push({...result, instanceKey: instance.key});
    }
    const points = new Map();
    for (const attempts of attemptsBySegment.values()) {
        attempts.sort((a, b) => Number(a.elapsed) - Number(b.elapsed) || Number(a.ts) - Number(b.ts) ||
            String(a.athleteId).localeCompare(String(b.athleteId)) || String(a.instanceKey).localeCompare(String(b.instanceKey)));
        attempts.slice(0, FTS_POINTS.length).forEach((attempt, index) => {
            const athleteId = String(attempt.athleteId);
            points.set(athleteId, (points.get(athleteId) || 0) + FTS_POINTS[index]);
        });
    }
    return points;
}

export function scoreInstances(instances, racers, eligibleIds = null) {
    const fieldSize = racers.length;
    const eligible = eligibleIds && new Set([...eligibleIds].map(String));
    const totals = new Map(racers.map(racer => [racer.athleteId, {...racer, eligible: !eligible || eligible.has(racer.athleteId), fastest: 0, first: 0, total: 0}]));
    const scored = [];
    for (const instance of instances) {
        const first = falPoints(instance.results, fieldSize);
        if (!first.size) continue;
        scored.push(instance);
        for (const racer of totals.values()) {
            if (racer.eligible) racer.first += first.get(racer.athleteId) || 0;
        }
    }
    const fastest = ftsPoints(scored);
    for (const racer of totals.values()) {
        if (racer.eligible) racer.fastest += fastest.get(racer.athleteId) || 0;
        racer.total = racer.fastest + racer.first;
    }
    return {scored, leaderboard: [...totals.values()].filter(racer => racer.eligible).sort((a, b) =>
        b.total - a.total || b.first - a.first || b.fastest - a.fastest || a.name.localeCompare(b.name))};
}
