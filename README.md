# Race Segment Scores

`Race Segment Scores` is a live Sauce for Zwift overlay that follows the current ZRL points-race model for every completed segment crossing in your current group race:

- **FTS** — the 10 fastest attempts on each individual segment across the entire race. The fixed points are `15, 12, 10, 8, 6, 5, 4, 3, 2, 1`. A rider can hold more than one top-10 time on a multi-lap route.
- **FIN** — finish-line points from the starter-field size down to one point for the final finisher.
- **PBP** — podium bonus points of `10, 8, 6, 4, 2` for first through fifth at the finish.
- **FAL** — first across the line, ranked by the time each rider completed the segment.

FAL is awarded on every pass: first earns the number of riders who started, second earns one fewer point, through to one point for the last starter. With 10 racers, first earns 10 FAL points and tenth earns 1. The overlay totals FTS, FAL, FIN, and PBP points and ranks riders by the combined score.

## Install and use

1. Copy this repository's folder to `Documents/SauceMods/race-segment-scores`.
2. Restart or reload Sauce, add **Race Segment Scores**, and join a group race.
3. Keep the overlay open through the race. It refreshes every 15 seconds as Zwift publishes segment results.

The field is taken from racers registered as joined in the active event subgroup and is frozen at the start, so the value of a FAL point cannot change mid-race. Final event results remove a rider who did not finish without promoting another rider’s FAL or FTS points, matching ZRL’s non-cascade rule. Manual post-race disqualifications are not exposed by Sauce’s live event API and therefore require the official result to supersede the overlay.

Use the **⚙** button to choose which of FTS, FAL, FIN, and PBP is included in the leaderboard total. All four categories are enabled by default for ZRL scoring.

## Segment and lap handling

Sauce records each observed segment crossing with its event distance. The mod uses that distance to keep the same segment on a later lap separate, then matches Zwift’s official segment results to that occurrence. The final table only counts results from the active event field and current event time range.

As with Sauce’s own event segment view, Zwift’s results feed can take a short time to publish and Sauce only records crossings for riders it receives telemetry for. The overlay waits rather than inventing a segment time or a crossing order.

## Development

```sh
npm test
```

For a synthetic preview, run `node scripts/preview-race-segment-scores.mjs` and open the displayed local URL.
