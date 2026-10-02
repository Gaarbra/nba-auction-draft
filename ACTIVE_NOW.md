# Active Now

Choose **Active Now** in the waiting room. Classic still uses career stats.

Active Now uses one NBA regular season for the entire draft: season-to-date
per-game numbers plus the same season's measured usage rate. If the upcoming
season has no recorded games, it uses the preceding season. Once any regular
season games are recorded in a refresh, only that season is eligible. Active
players with no complete stats in the selected season are excluded; their older
seasons and career averages are never substituted. Timeouts do not trigger a
last-season fallback. A season snapshot older than eight days cannot start a
new draft.

The existing Saturday refresh downloads the league-wide Base and Advanced
tables through the configured NBA proxy, then atomically publishes
`stats-service/data/activeNowCache.json` in the Docker volume. These are weekly
snapshots, not live game updates. Each draft freezes its snapshot at start,
including rematches, so every player is judged using the same data.

Difficulty tiers and suggested values use the existing scoring formula applied
to those season stats. Suggested value is four coins times the player's score
relative to that season's pool average, bounded to 1–16 coins. Actual bids stay
under player control. Final team scores use the frozen seasonal box scores and
usage rates. Career honours, career similarity requests, career price models,
and historic auction prices are excluded. Active Now results remain available
in the room but are not written to the career-model training tables. The Market
page remains explicitly labelled as a career-stat market.

NBA endpoint reference: [LeagueDashPlayerStats](https://github.com/swar/nba_api/blob/master/docs/nba_api/stats/endpoints/leaguedashplayerstats.md).

## Existing Servercheap Docker deployment

Run when no draft needs to remain connected: restarting the game server ends
in-memory rooms. Keep the existing `.env`, proxy and Docker volumes.

```bash
cd /opt/hoop-bids
git pull --ff-only origin main
sudo bash deploy-active-now.sh
```

The script builds all three app images, downloads today's season snapshot,
updates the previously installed external refresh-script override, and starts
the app containers. The existing Saturday timer stays in place. If a refresh
is already running, the script stops and asks you to wait. If the season fetch
fails, it leaves the running app in place; fix the reported proxy/upstream
failure and rerun.

Confirm the snapshot without printing hundreds of player records:

```bash
sudo docker compose exec -T stats python -c 'import json; d=json.load(open("data/activeNowCache.json")); print({k:d[k] for k in ("season","usesPreviousSeason","fetchedAt")}); print("players:",len(d["players"]))'
sudo systemctl list-timers hoop-bids-refresh.timer --no-pager
```

## Checks

```bash
npm test --prefix server
npm run build --prefix client
cd stats-service
python -m unittest test_active_now.py test_refresh.py
```
