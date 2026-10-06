import test from 'node:test';
import assert from 'node:assert/strict';
import {attachResults, filterLeaderboard, finishPoints, officialEligibleIds, raceField, scoreInstances, segmentInstances, shouldPollOfficialResults, teamLeaderboard, usableOfficialResults} from '../pages/model.mjs';

test('field uses joined entrants, including their team, and keeps the local rider', () => {
    const field = raceField([{id: 2, athlete: {fullname: 'B Rider', team: 'Fast Cats'}}, {id: 2, athlete: {fullname: 'B Rider'}}], {athleteId: 1, fullname: 'A Rider', team: 'Velocity'});
    assert.deepEqual(field.map(x => [x.athleteId, x.name, x.team, x.self]), [['1', 'A Rider', 'Velocity', true], ['2', 'B Rider', 'Fast Cats', false]]);
});

test('leaderboard filtering matches rider or team and retains the overall place', () => {
    const riders = [{name: 'Alex Rider', team: 'Velocity'}, {name: 'Bailey Climber', team: 'Ridge Racing'}, {name: 'Casey Watts', team: ''}];
    assert.deepEqual(filterLeaderboard(riders, 'Ridge').map(x => [x.name, x.place]), [['Bailey Climber', 2]]);
    assert.deepEqual(filterLeaderboard(riders, 'alex').map(x => [x.name, x.place]), [['Alex Rider', 1]]);
});

test('team leaderboard combines all rider categories and can filter by a member', () => {
    const riders = [
        {name: 'Alex Rider', team: 'Velocity', self: true, fastest: 15, first: 4, finish: 3, podium: 8, total: 30},
        {name: 'Blake Rider', team: 'Velocity', fastest: 12, first: 3, finish: 2, podium: 6, total: 23},
        {name: 'Casey Watts', team: '', fastest: 10, first: 2, finish: 1, podium: 0, total: 13},
    ];
    const teams = teamLeaderboard(riders);
    assert.deepEqual(teams.map(x => [x.name, x.fastest, x.first, x.finish, x.podium, x.total, x.self]), [
        ['Velocity', 27, 7, 5, 14, 53, true], ['Unattached', 10, 2, 1, 0, 13, false],
    ]);
    assert.deepEqual(filterLeaderboard(teams, 'blake').map(x => [x.name, x.place]), [['Velocity', 1]]);
});

test('uses field-size points for FAL and ZRL fixed top-ten FTS points', () => {
    const racers = raceField([{id: 1, athlete: {fullname: 'A'}}, {id: 2, athlete: {fullname: 'B'}}, {id: 3, athlete: {fullname: 'C'}}]);
    const instance = {results: new Map([
        ['1', {athleteId: '1', elapsed: 100, ts: 3000}], ['2', {athleteId: '2', elapsed: 90, ts: 1000}], ['3', {athleteId: '3', elapsed: 90, ts: 2000}],
    ])};
    const {leaderboard} = scoreInstances([instance], racers);
    assert.deepEqual(leaderboard.map(x => [x.athleteId, x.fastest, x.first, x.total]), [['2', 15, 3, 18], ['3', 12, 2, 14], ['1', 10, 1, 11]]);
});

test('FTS is a top-ten leaderboard across all laps of the same segment', () => {
    const racers = raceField([{id: 1, athlete: {fullname: 'A'}}, {id: 2, athlete: {fullname: 'B'}}]);
    const instances = [
        {key: '9:1', segmentId: '9', results: new Map([['1', {athleteId: '1', elapsed: 100, ts: 1000}], ['2', {athleteId: '2', elapsed: 105, ts: 1001}]])},
        {key: '9:2', segmentId: '9', results: new Map([['1', {athleteId: '1', elapsed: 95, ts: 2000}], ['2', {athleteId: '2', elapsed: 110, ts: 2001}]])},
    ];
    const {leaderboard} = scoreInstances(instances, racers);
    assert.deepEqual(leaderboard.map(x => [x.athleteId, x.fastest, x.first, x.total]), [['1', 27, 4, 31], ['2', 18, 2, 20]]);
});

test('non-finishers retain their position but their points do not cascade', () => {
    const racers = raceField([{id: 1, athlete: {fullname: 'A'}}, {id: 2, athlete: {fullname: 'B'}}, {id: 3, athlete: {fullname: 'C'}}]);
    const instance = {key: '9:1', segmentId: '9', results: new Map([
        ['1', {athleteId: '1', elapsed: 100, ts: 1000}], ['2', {athleteId: '2', elapsed: 101, ts: 1001}], ['3', {athleteId: '3', elapsed: 102, ts: 1002}],
    ])};
    const {leaderboard} = scoreInstances([instance], racers, new Set(['1', '3']));
    assert.deepEqual(leaderboard.map(x => [x.athleteId, x.fastest, x.first, x.total]), [['1', 15, 3, 18], ['3', 10, 1, 11]]);
});

test('FIN uses the starter field while PBP awards the top five finishers', () => {
    const racers = raceField([{id: 1, athlete: {fullname: 'A'}}, {id: 2, athlete: {fullname: 'B'}}, {id: 3, athlete: {fullname: 'C'}}, {id: 4, athlete: {fullname: 'D'}}]);
    const results = [
        {profileId: 2, rank: 1, activityData: {endDate: '2026-09-15T10:01:00Z'}},
        {profileId: 1, rank: 2, activityData: {endDate: '2026-09-15T10:01:01Z'}},
        {profileId: 4, rank: 3, activityData: {endDate: '2026-09-15T10:01:02Z'}},
        {profileId: 3, dnf: true},
    ];
    assert.deepEqual([...finishPoints(results, racers)], [['2', {finish: 4, podium: 10}], ['1', {finish: 3, podium: 8}], ['4', {finish: 2, podium: 6}]]);
    const {leaderboard} = scoreInstances([], racers, new Set(['1', '2', '4']), results);
    assert.deepEqual(leaderboard.map(x => [x.athleteId, x.finish, x.podium, x.total]), [['2', 4, 10, 14], ['1', 3, 8, 11], ['4', 2, 6, 8]]);
});

test('official finish results are used before the estimated finish but pending riders stay visible', () => {
    const racers = raceField([{id: 1, athlete: {fullname: 'A'}}, {id: 2, athlete: {fullname: 'B'}}, {id: 3, athlete: {fullname: 'C'}}]);
    const subgroup = {id: 4, ts: 1_000_000, estimatedFinish: 2_000_000};
    const partial = [{profileId: 2, rank: 1}, {profileId: 1, dnf: true, pending: true}, {profileId: 3, dnf: true, pending: true}];
    assert.equal(shouldPollOfficialResults(subgroup, subgroup.ts + 299_999), false);
    assert.equal(shouldPollOfficialResults(subgroup, subgroup.ts + 300_000), true);
    assert.deepEqual(usableOfficialResults(partial, racers).map(x => x.profileId), [2, 1, 3]);
    assert.equal(officialEligibleIds(partial, racers, subgroup, subgroup.ts + 300_000), null);
    assert.deepEqual([...officialEligibleIds(partial, racers, subgroup, subgroup.estimatedFinish)], ['2']);
    assert.deepEqual([...officialEligibleIds([{profileId: 2, rank: 1}, {profileId: 1, dnf: true}, {profileId: 3, dnf: true}], racers, subgroup, subgroup.ts + 300_000)], ['2']);
});

test('disabled scoring categories are excluded from the total without changing the race results', () => {
    const racers = raceField([{id: 1, athlete: {fullname: 'A'}}, {id: 2, athlete: {fullname: 'B'}}]);
    const instance = {key: '9:1', segmentId: '9', results: new Map([
        ['1', {athleteId: '1', elapsed: 100, ts: 1000}], ['2', {athleteId: '2', elapsed: 101, ts: 1001}],
    ])};
    const official = [{profileId: 1, rank: 1}, {profileId: 2, rank: 2}];
    const {leaderboard} = scoreInstances([instance], racers, null, official, {scoreFts: false, scoreFal: true, scoreFin: false, scorePbp: false});
    assert.deepEqual(leaderboard.map(x => [x.athleteId, x.fastest, x.first, x.finish, x.podium, x.total]), [['1', 0, 2, 0, 0, 2], ['2', 0, 1, 0, 0, 1]]);
});

test('separates repeated segment crossings by event distance and matches their official results', () => {
    const slices = new Map([['1', [
        {segmentId: '9', eventSubgroupId: 4, endEventDistance: 500, startServerTime: 1000, stats: {elapsedTime: 100}},
        {segmentId: '9', eventSubgroupId: 4, endEventDistance: 4500, startServerTime: 10000, stats: {elapsedTime: 100}},
    ]], ['2', [{segmentId: '9', eventSubgroupId: 4, endEventDistance: 520, startServerTime: 1020, stats: {elapsedTime: 100}}]]]);
    const instances = segmentInstances(slices, 4, new Map([['9', 'Test Sprint']]));
    assert.equal(instances.length, 2);
    const resolved = attachResults(instances, new Map([['9', [
        {id: 'a', athleteId: '1', segmentId: '9', elapsed: 100, ts: 101000},
        {id: 'b', athleteId: '2', segmentId: '9', elapsed: 99, ts: 101020},
        {id: 'c', athleteId: '1', segmentId: '9', elapsed: 98, ts: 110000},
    ]]]), new Set(['1', '2']));
    assert.deepEqual(resolved.map(x => [...x.results.keys()]), [['1', '2'], ['1']]);
});
