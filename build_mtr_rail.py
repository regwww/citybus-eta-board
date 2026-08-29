#!/usr/bin/env python3
"""Build MTR heavy-rail + Light Rail station coordinates (Wikipedia, resumable)."""
import json, csv, time, urllib.parse, urllib.request

UA = "CitybusETABoard/1.0 (research)"

def http_get(url, tries=3):
    backoff = 0.8
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=25) as r:
                return json.load(r)
        except Exception:
            if i < tries - 1:
                time.sleep(backoff); backoff = min(backoff * 2, 10)
    return None

def search_coords(query):
    params = {"action": "query", "generator": "search", "gsrsearch": query,
              "gsrlimit": 1, "prop": "coordinates", "format": "json", "formatversion": "2"}
    d = http_get("https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode(params))
    if not d:
        return None, None
    pages = d.get("query", {}).get("pages", [])
    if pages:
        cs = pages[0].get("coordinates")
        if cs:
            return float(cs[0]["lat"]), float(cs[0]["lon"])
    return None, None

def resolve(name, suffix):
    queries = [f"{name} {suffix}", f"{name} {suffix} MTR", f"{name} {suffix} Hong Kong"]
    for q in queries:
        la, lo = search_coords(q)
        time.sleep(2.5)
        if la is not None:
            return la, lo
    return None, None

def process(catalog, suffix, out_path, key_field, extra_fn, log_prefix):
    # resume from existing
    try:
        out = json.load(open(out_path))
    except Exception:
        out = {}
    pending = [(k, v) for k, v in catalog.items() if k not in out]
    total = len(catalog)
    print(f"{log_prefix}: {len(out)}/{total} done, {len(pending)} pending", flush=True)
    for n, (k, v) in enumerate(pending):
        la, lo = resolve(v["name_en"], suffix)
        if la is not None:
            rec = {"name_tc": v["name_tc"], "name_en": v["name_en"], "lat": la, "long": lo}
            rec.update(extra_fn(k, v))
            out[k] = rec
        if (n + 1) % 10 == 0:
            json.dump(out, open(out_path, "w"), ensure_ascii=False, sort_keys=True)
            print(f"  {log_prefix} {n+1}/{len(pending)} pending done, total {len(out)}/{total}", flush=True)
    json.dump(out, open(out_path, "w"), ensure_ascii=False, sort_keys=True)
    missing = [v["name_en"] for k, v in catalog.items() if k not in out]
    print(f"Saved {out_path}: {len(out)}/{total} ({len(missing)} missing)", flush=True)
    if missing:
        print("  missing:", ", ".join(missing), flush=True)

def main():
    rows = list(csv.DictReader(open("mtr_lines_and_stations.csv", encoding="utf-8-sig")))
    stations = {}
    for r in rows:
        code = r.get("Station Code", "").strip()
        if code:
            stations.setdefault(code, {"name_tc": r.get("Chinese Name", "").strip(),
                                      "name_en": r.get("English Name", "").strip()})
    process(stations, "station", "mtr_stations.json", "code",
            lambda k, v: {"code": k}, "MTR")

    lrows = list(csv.DictReader(open("light_rail_routes_and_stops.csv", encoding="utf-8-sig")))
    lrt = {}
    for r in lrows:
        sid = r.get("Stop ID", "").strip()
        if sid:
            lrt.setdefault(sid, {"code": r.get("Stop Code", "").strip(),
                                 "name_tc": r.get("Chinese Name", "").strip(),
                                 "name_en": r.get("English Name", "").strip()})
    process(lrt, "stop", "lrt_stations.json", "id",
            lambda k, v: {"id": k, "code": v["code"]}, "LRT")

if __name__ == "__main__":
    main()
