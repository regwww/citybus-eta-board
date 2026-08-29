#!/usr/bin/env python3
"""Build MTR Bus route-direction destination map from the bundled CSV.

Reads mtr_bus_stops.csv (ROUTE_ID, DIRECTION, STATION_SEQNO, STATION_NAME_CHI/ENG)
and writes mtr_bus_dest.json mapping "ROUTE_ID-DIRECTION" -> {dest_tc, dest_en},
where the destination is the last stop (max STATION_SEQNO) of that route+direction.

Run:  python3 build_mtr_bus_dest.py
"""
import json, csv
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE / "mtr_bus_stops.csv"
OUT = HERE / "mtr_bus_dest.json"

def main():
    by_route_dir = defaultdict(list)
    with open(SRC, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            rid = (r.get("ROUTE_ID") or "").strip()
            d = (r.get("DIRECTION") or "").strip()
            if not rid or not d:
                continue
            try:
                seq = int(r.get("STATION_SEQNO") or "0")
            except ValueError:
                seq = 0
            by_route_dir[(rid, d)].append((
                seq,
                (r.get("STATION_NAME_CHI") or "").strip(),
                (r.get("STATION_NAME_ENG") or "").strip(),
            ))
    dest = {}
    for (rid, d), stops in by_route_dir.items():
        stops.sort()
        dest[f"{rid}-{d}"] = {"dest_tc": stops[-1][1], "dest_en": stops[-1][2]}
    OUT.write_text(json.dumps(dest, ensure_ascii=False, sort_keys=True), encoding="utf-8")
    print(f"Wrote {OUT.name}: {len(dest)} route-directions")

if __name__ == "__main__":
    main()
