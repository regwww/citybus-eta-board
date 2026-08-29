#!/usr/bin/env python3
"""Build a complete Citybus (CTB) stops database from the official open-data API."""
import json, time, sys
from concurrent.futures import ThreadPoolExecutor, as_completed
import urllib.request

BASE = "https://rt.data.gov.hk/v2/transport/citybus"
UA = "Mozilla/5.0 (CitybusETABoard)"

def get(url, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.load(r).get("data")
        except Exception as e:
            if i == tries - 1:
                return None
            time.sleep(1 + i)
    return None

def fetch_route_stops(route):
    stops = set()
    for d in ("outbound", "inbound"):
        data = get(f"{BASE}/route-stop/ctb/{route}/{d}")
        if data:
            for s in data:
                stops.add(s["stop"])
    return route, stops

def fetch_stop(stop_id):
    data = get(f"{BASE}/stop/{stop_id}")
    if data:
        return stop_id, data
    return stop_id, None

def main():
    routes = json.load(open("routes.json"))["data"]
    route_nums = [r["route"] for r in routes]
    print(f"Routes: {len(route_nums)}", flush=True)

    all_stops = set()
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=24) as ex:
        futs = {ex.submit(fetch_route_stops, r): r for r in route_nums}
        for i, fut in enumerate(as_completed(futs), 1):
            r, stops = fut.result()
            all_stops.update(stops)
            if i % 50 == 0:
                print(f"  route-stops {i}/{len(route_nums)}  unique stops={len(all_stops)}  {time.time()-t0:.0f}s", flush=True)
    print(f"Total unique stops: {len(all_stops)}", flush=True)

    stops_db = {}
    with ThreadPoolExecutor(max_workers=24) as ex:
        futs = {ex.submit(fetch_stop, s): s for s in all_stops}
        for i, fut in enumerate(as_completed(futs), 1):
            sid, data = fut.result()
            if data:
                stops_db[sid] = {
                    "id": sid,
                    "name_tc": data.get("name_tc"),
                    "name_en": data.get("name_en"),
                    "name_sc": data.get("name_sc"),
                    "lat": float(data.get("lat", 0)),
                    "long": float(data.get("long", 0)),
                }
            if i % 200 == 0:
                print(f"  stops {i}/{len(all_stops)}  {time.time()-t0:.0f}s", flush=True)

    json.dump(stops_db, open("stops_db.json", "w"), ensure_ascii=False)
    print(f"Saved stops_db.json: {len(stops_db)} stops in {time.time()-t0:.0f}s", flush=True)

if __name__ == "__main__":
    main()
