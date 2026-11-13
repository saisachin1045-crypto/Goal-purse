"""Read a fresh Sites get_site result as JSON on stdin. Never persist credentials."""
import json
import sys
import time
import urllib.parse
import urllib.request

site = json.loads(input())
origin = site["current_live_url"].rstrip("/")
token = site["siwc_bypass_bearer_token"]
cursor = ""
counts = {}
while True:
    url = origin + "/api/collect?after=" + urllib.parse.quote(cursor)
    request = urllib.request.Request(
        url, data=b"", method="POST",
        headers={"OAI-Sites-Authorization": "Bearer " + token})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                result = json.load(response)
            break
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2)
    for row in result["results"]:
        status = row["status"]
        counts[status] = counts.get(status, 0) + 1
    print(json.dumps({"processed": sum(counts.values()), "total": result["total"], "counts": counts}), flush=True)
    next_cursor = result["next"]
    if next_cursor is None:
        break
    if next_cursor <= cursor:
        raise RuntimeError("Collector cursor did not advance")
    cursor = next_cursor
