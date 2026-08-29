#!/usr/bin/env python3
"""Build KMB + Long Win Bus stops database and routes map from official open-data API.
Outputs kmb_stops.json ({stop_id:{id,name_tc,name_en,lat,long}}) and kmb_routes.json
({route:{outbound:{orig_tc,dest_tc,orig_en,dest_en,service_type}, inbound:{...}}}).
"""
import json, time
from concurrent.futures import ThreadPoolExecutor, as_completed
import urllib.request

BASE = "https://data.etabus.gov.hk/v1/transport/kmb"
UA = "Mozilla/5.0 (CitybusETABoard)"

def get(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.load(r).get("data")
        except Exception:
            if i == tries - 1:
                return None
            time.sleep(1 + i)
    return None

def fetch_stop(stop_id):
    data = get(f"{BASE}/stop/{stop_id}")
    if data:
        return stop_id, data
    return stop_id, None

def main():
    print("Fetching route list...", flush=True)
    routes = get(f"{BASE}/route/") or []
    print(f"Routes: {len(routes)}", flush=True)

    # group by route -> {bound: routeInfo}
    route_map = {}
    for r in routes:
        route_map.setdefault(r["route"], {})[r["bound"]] = r

    # collect all stop ids via route-stop
    all_stops = set()
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=24) as ex:
        futs = []
        for rt, dirs in route_map.items():
            for b in dirs:
                futs.append(ex.submit(get, f"{BASE}/route-stop/{rt}/{('outbound' if b=='O' else 'inbound')}/{dirs[b].get('service_type','1')}"))
        for i, fut in enumerate(as_completed(futs), 1):
            data = fut.result()
            if data:
                for s in data:
                    all_stops.add(s["stop"])
            if i % 200 == 0:
                print(f"  route-stops {i}/{len(futs)}  unique stops={len(all_stops)}  {time.time()-t0:.0f}s", flush=True)
    print(f"Total unique stops: {len(all_stops)}", flush=True)

    # fetch stop info (name + coords)
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
                    "lat": float(data.get("lat", 0)),
                    "long": float(data.get("long", 0)),
                }
            if i % 500 == 0:
                print(f"  stops {i}/{len(all_stops)}  {time.time()-t0:.0f}s", flush=True)
    json.dump(stops_db, open("kmb_stops.json", "w"), ensure_ascii=False, sort_keys=True)
    print(f"Saved kmb_stops.json: {len(stops_db)} stops in {time.time()-t0:.0f}s", flush=True)

    # routes map (direction -> dest/orig)
    routes_out = {}
    for rt, dirs in route_map.items():
        entry = {}
        for b, r in dirs.items():
            key = "outbound" if b == "O" else "inbound"
            entry[key] = {
                "orig_tc": r.get("orig_tc"), "dest_tc": r.get("dest_tc"),
                "orig_en": r.get("orig_en"), "dest_en": r.get("dest_en"),
                "service_type": r.get("service_type"),
            }
        routes_out[rt] = entry
    json.dump(routes_out, open("kmb_routes.json", "w"), ensure_ascii=False, sort_keys=True)
    print(f"Saved kmb_routes.json: {len(routes_out)} routes", flush=True)

if __name__ == "__main__":
    main()
