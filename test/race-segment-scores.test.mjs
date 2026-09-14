import test from 'node:test';
import assert from 'node:assert/strict';
import {attachResults, raceField, scoreInstances, segmentInstances} from '../pages/model.mjs';

test('field uses joined entrants, including their team, and keeps the local rider', () => {
    const field = raceField([{id: 2, athlete: {fullname: 'B Rider', team: 'Fast Cats'}}, {id: 2, athlete: {fullname: 'B Rider'}}], {athleteId: 1, fullname: 'A Rider', team: 'Velocity'});
    assert.deepEqual(field.map(x => [x.athleteId, x.name, x.team, x.self]), [['1', 'A Rider', 'Velocity', true], ['2', 'B Rider', 'Fast Cats', false]]);
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
