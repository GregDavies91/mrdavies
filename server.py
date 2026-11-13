import json
import random
import string
from collections import defaultdict
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import uvicorn

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")

# ─── Game data ──────────────────────────────────────────────
QUESTIONS = [
    # Noun → Adjective
    {"q": "anger → ?", "opts": ["angry", "angerous", "angered", "angrily"], "ans": 0, "cat": "Noun → Adjective"},
    {"q": "anxiety → ?", "opts": ["anxious", "anxietious", "anxieted", "anxiously"], "ans": 0, "cat": "Noun → Adjective"},
    {"q": "depression → ?", "opts": ["depressed", "depressionary", "depressived", "depressingly"], "ans": 0, "cat": "Noun → Adjective"},
    {"q": "disgust → ?", "opts": ["disgusted", "disgustful", "disgustive", "disgustly"], "ans": 0, "cat": "Noun → Adjective"},
    {"q": "envy → ?", "opts": ["envious", "envyful", "envied", "envily"], "ans": 0, "cat": "Noun → Adjective"},
    {"q": "fear → ?", "opts": ["afraid", "fearful", "fearless", "fearsome"], "ans": 0, "cat": "Noun → Adjective"},
    {"q": "happiness → ?", "opts": ["happy", "happying", "happihood", "happiful"], "ans": 0, "cat": "Noun → Adjective"},
    {"q": "pride → ?", "opts": ["proud", "prideful", "priden", "pridely"], "ans": 0, "cat": "Noun → Adjective"},
    {"q": "sadness → ?", "opts": ["sad", "sadful", "sadness", "sadly"], "ans": 0, "cat": "Noun → Adjective"},
    {"q": "shame → ?", "opts": ["ashamed", "shameful", "shamed", "shamely"], "ans": 0, "cat": "Noun → Adjective"},
    {"q": "surprise → ?", "opts": ["surprised", "surprising", "surpriseful", "surprisive"], "ans": 0, "cat": "Noun → Adjective"},

    # Adverbs
    {"q": "sad → adverb", "opts": ["sadly", "sadfully", "sadness", "sadingly"], "ans": 0, "cat": "Adverbs"},
    {"q": "anxious → adverb", "opts": ["anxiously", "anxiousful", "anxiously", "anxietly"], "ans": 0, "cat": "Adverbs"},
    {"q": "surprising → adverb", "opts": ["surprisingly", "surprisedly", "surprisely", "surprisfully"], "ans": 0, "cat": "Adverbs"},
    {"q": "proud → adverb", "opts": ["proudly", "proudful", "proudness", "proudily"], "ans": 0, "cat": "Adverbs"},
    {"q": "hopeful → adverb", "opts": ["hopefully", "hopefuly", "hopefully", "hopely"], "ans": 0, "cat": "Adverbs"},
    {"q": "suspicious → adverb", "opts": ["suspiciously", "suspiciousful", "suspicious", "suspicily"], "ans": 0, "cat": "Adverbs"},
    {"q": "hungry → adverb", "opts": ["hungrily", "hungrilly", "hungerly", "hungfully"], "ans": 0, "cat": "Adverbs"},

    # -ed / -ing
    {"q": "The film was ___ (bore).", "opts": ["bored", "boring", "boreded", "boren"], "ans": 1, "cat": "-ed / -ing"},
    {"q": "I felt ___ by the smell. (disgust)", "opts": ["disgusted", "disgusting", "disgustful", "disgustly"], "ans": 0, "cat": "-ed / -ing"},
    {"q": "The roller coaster was ___! (excite)", "opts": ["excited", "exciting", "excitement", "excitely"], "ans": 1, "cat": "-ed / -ing"},
    {"q": "She was ___ after the run. (tire)", "opts": ["tired", "tiring", "tireful", "tirely"], "ans": 0, "cat": "-ed / -ing"},

    # -ful / -less
    {"q": "care → ?", "opts": ["careful", "careless", "both", "neither"], "ans": 2, "cat": "-ful / -less"},
    {"q": "hope → ?", "opts": ["hopeful", "hopeless", "both", "neither"], "ans": 2, "cat": "-ful / -less"},
    {"q": "pain → ?", "opts": ["painful", "painless", "both", "neither"], "ans": 2, "cat": "-ful / -less"},
    {"q": "power → ?", "opts": ["powerful", "powerless", "both", "neither"], "ans": 2, "cat": "-ful / -less"},
]

# ─── In-memory state ────────────────────────────────────────
rooms: dict[str, dict] = defaultdict(lambda: {
    "host": None,
    "players": {},      # ws -> {"name": str, "score": int, "ans": int|null}
    "state": "lobby",   # lobby | question | answer | leaderboard | ended
    "q_index": 0,
    "timer": None,
})

def gen_code() -> str:
    while True:
        code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=4))
        if code not in rooms:
            return code

async def broadcast(room: str, msg: dict, exclude=None):
    dead = []
    for ws, p in rooms[room]["players"].items():
        if ws != exclude:
            try:
                await ws.send_json(msg)
            except:
                dead.append(ws)
    for ws in dead:
        rooms[room]["players"].pop(ws, None)
    # also send to host
    host_ws = rooms[room]["host"]
    if host_ws and host_ws != exclude:
        try:
            await host_ws.send_json(msg)
        except:
            rooms[room]["host"] = None

async def send_state(room: str):
    r = rooms[room]
    players_list = [{"name": p["name"], "score": p["score"]} for p in r["players"].values()]
    msg = {
        "type": "state",
        "room": room,
        "phase": r["state"],
        "players": players_list,
        "q_index": r["q_index"],
        "total_q": len(QUESTIONS),
    }
    if r["state"] == "question" and r["q_index"] < len(QUESTIONS):
        q = QUESTIONS[r["q_index"]]
        msg["question"] = {"text": q["q"], "options": q["opts"], "cat": q["cat"]}
    elif r["state"] == "answer" and r["q_index"] < len(QUESTIONS):
        q = QUESTIONS[r["q_index"]]
        correct = q["opts"][q["ans"]]
        msg["answer"] = {"correct": correct, "correct_idx": q["ans"]}
        # include player answers
        msg["player_answers"] = {p["name"]: p.get("ans") for p in r["players"].values()}
    await broadcast(room, msg)

# ─── WebSocket endpoint ─────────────────────────────────────
@app.websocket("/ws/{room}/{role}")
async def ws_endpoint(ws: WebSocket, room: str, role: str):
    await ws.accept()
    r = rooms[room]

    if role == "host":
        if r["host"]:
            await ws.send_json({"type": "error", "msg": "Host already exists"})
            await ws.close()
            return
        r["host"] = ws
        await ws.send_json({"type": "host_ready", "room": room})
        await send_state(room)

    elif role == "player":
        # wait for name message
        try:
            msg = await ws.receive_json()
            name = msg.get("name", "Anon")[:20]
        except:
            await ws.close()
            return
        r["players"][ws] = {"name": name, "score": 0, "ans": None}
        await ws.send_json({"type": "joined", "room": room, "name": name})
        await send_state(room)

    try:
        while True:
            msg = await ws.receive_json()
            mtype = msg.get("type")

            if role == "host":
                if mtype == "start":
                    r["state"] = "question"
                    r["q_index"] = 0
                    for p in r["players"].values():
                        p["ans"] = None
                    await send_state(room)

                elif mtype == "next":
                    if r["state"] == "answer":
                        r["q_index"] += 1
                        if r["q_index"] >= len(QUESTIONS):
                            r["state"] = "leaderboard"
                        else:
                            r["state"] = "question"
                            for p in r["players"].values():
                                p["ans"] = None
                        await send_state(room)

                elif mtype == "reveal":
                    if r["state"] == "question":
                        r["state"] = "answer"
                        # score
                        q = QUESTIONS[r["q_index"]]
                        for p in r["players"].values():
                            if p.get("ans") == q["ans"]:
                                p["score"] += 10
                        await send_state(room)

                elif mtype == "kick":
                    target_name = msg.get("name")
                    for ws_p, p in list(r["players"].items()):
                        if p["name"] == target_name:
                            await ws_p.send_json({"type": "kicked"})
                            await ws_p.close()
                            r["players"].pop(ws_p, None)
                            break
                    await send_state(room)

                elif mtype == "end":
                    r["state"] = "ended"
                    await send_state(room)

            elif role == "player":
                if mtype == "answer" and r["state"] == "question":
                    ans_idx = msg.get("ans")
                    if ans_idx is not None and 0 <= ans_idx < 4:
                        r["players"][ws]["ans"] = ans_idx
                        # optional: send ack
                        await ws.send_json({"type": "answer_received"})

    except WebSocketDisconnect:
        pass
    finally:
        if role == "host":
            r["host"] = None
        else:
            r["players"].pop(ws, None)
        await send_state(room)

# ─── HTTP routes ────────────────────────────────────────────
@app.get("/")
async def index():
    return FileResponse("static/index.html")

@app.get("/host.html")
async def host_page():
    return FileResponse("static/host.html")

@app.post("/api/create_room")
async def create_room():
    code = gen_code()
    rooms[code] = {"host": None, "players": {}, "state": "lobby", "q_index": 0}
    return {"code": code, "host_url": f"/host.html?room={code}", "player_url": f"/?room={code}"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8080)