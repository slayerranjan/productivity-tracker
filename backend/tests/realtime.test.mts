// Real-time transport + authorization test. Needs NO database: a real Socket.IO server and real socket.io-client
// connections over real network sockets, with the two server rules (who is this token / which people may they see)
// replaced by fakes. It proves the transport, the rooms, the payload shape, reconnection and revocation.
//
//   cd backend && DATABASE_URL=postgresql://u:p@127.0.0.1:1/x npx tsx tests/realtime.test.mts
//
// (The DATABASE_URL is a dummy: nothing here ever connects to a database.)
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { startRealtime, stopRealtime, emitTaskChange, emitNotificationChange, type SocketUser } from "../src/lib/realtime.js";

const requireFromFrontend = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { io: connect } = requireFromFrontend("socket.io-client") as { io: (url: string, opts: object) => any };

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => { cond ? pass++ : fail++; console.log((cond ? "PASS " : "FAIL ") + name + (cond ? "" : "  -> " + JSON.stringify(extra)?.slice(0, 200))); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- the fake world -------------------------------------------------------------------------
const USERS: Record<string, SocketUser> = {
  mgrA: { userId: "mgrA", role: "MANAGER", platformId: "p1" },
  mgrB: { userId: "mgrB", role: "MANAGER", platformId: "p1" },
  hr: { userId: "hr", role: "HR", platformId: "p1" },
  e1: { userId: "e1", role: "EMPLOYEE", platformId: "p1" },
  e2: { userId: "e2", role: "EMPLOYEE", platformId: "p1" },
  e3: { userId: "e3", role: "EMPLOYEE", platformId: "p1" },
  e4: { userId: "e4", role: "EMPLOYEE", platformId: "p1" }, // the attacker
};
let revoked = new Set<string>();
const teams: Record<string, string[]> = { mgrA: ["e1", "e2"], mgrB: ["e3"], hr: ["e1", "e2", "e3", "e4"] };

const httpServer = createServer();
startRealtime(httpServer, {
  origins: ["http://localhost:3000"],
  recheckEveryMs: 1500,
  authenticate: async (t) => (revoked.has(t) ? null : USERS[t] ?? null),
  personsFor: async (u) => (u.role === "EMPLOYEE" ? [] : teams[u.userId] ?? []),
});
await new Promise<void>((r) => httpServer.listen(0, r));
const URL_ = `http://localhost:${(httpServer.address() as { port: number }).port}`;

type Client = { sock: any; events: any[]; inbox: any[]; ready: number; connectError: string | null };
function client(token: string | null, opts: object = {}): Promise<Client> {
  return new Promise((resolve) => {
    const c: Client = { sock: null, events: [], inbox: [], ready: 0, connectError: null };
    c.sock = connect(URL_, { auth: token === null ? {} : { token }, transports: ["websocket"], reconnectionDelay: 100, reconnectionDelayMax: 300, ...opts });
    c.sock.on("tasks:changed", (e: unknown) => c.events.push(e));
    c.sock.on("notifications:changed", (e: unknown) => c.inbox.push(e));
    c.sock.on("ready", () => { c.ready += 1; if (c.ready === 1) resolve(c); });
    c.sock.on("connect_error", (e: Error) => { c.connectError = e.message; if (!opts || !(opts as { keepTrying?: boolean }).keepTrying) resolve(c); });
  });
}
const idsOf = (c: Client) => c.events.map((e) => e.ownerId);
const emit = (ownerId: string, taskId = "t-" + ownerId) => emitTaskChange({ taskId, ownerId, action: "status" });

// 1. authentication ------------------------------------------------------------------------
const none = await client(null);
ok("no token is refused", none.connectError === "NOT_AUTHENTICATED", none.connectError);
const bad = await client("not-a-real-token");
ok("an unknown token is refused", bad.connectError === "NOT_AUTHENTICATED", bad.connectError);
const urlToken = await new Promise<Client>((resolve) => { const c: Client = { sock: null, events: [], inbox: [], ready: 0, connectError: null }; c.sock = connect(URL_ + "?token=mgrA", { transports: ["websocket"], reconnection: false }); c.sock.on("connect_error", (e: Error) => { c.connectError = e.message; resolve(c); }); c.sock.on("ready", () => resolve(c)); });
ok("a token in the URL (not the handshake auth) is not accepted", urlToken.connectError === "NOT_AUTHENTICATED", urlToken.connectError);

// 2. who hears what ---------------------------------------------------------------------------
const mgrA = await client("mgrA"), mgrB = await client("mgrB"), hr = await client("hr");
const e1 = await client("e1"), e2 = await client("e2"), e3 = await client("e3"), e4 = await client("e4");
ok("manager A is put in her 2 people + herself (3 rooms)", mgrA.ready === 1, mgrA.ready);
for (const who of ["e1", "e2", "e3", "e4"]) emit(who);
await sleep(300);
ok("manager A hears only her own team (e1, e2)", JSON.stringify(idsOf(mgrA).sort()) === JSON.stringify(["e1", "e2"]), idsOf(mgrA));
ok("manager B (a different team) hears only e3", JSON.stringify(idsOf(mgrB)) === JSON.stringify(["e3"]), idsOf(mgrB));
ok("HR hears the whole company", JSON.stringify(idsOf(hr).sort()) === JSON.stringify(["e1", "e2", "e3", "e4"]), idsOf(hr));
ok("an employee hears only their own tasks (e1)", JSON.stringify(idsOf(e1)) === JSON.stringify(["e1"]), idsOf(e1));
ok("employees e2 and e3 hear only their own", JSON.stringify(idsOf(e2)) === JSON.stringify(["e2"]) && JSON.stringify(idsOf(e3)) === JSON.stringify(["e3"]));

// 3. a client cannot subscribe to someone else ------------------------------------------------------
e4.events.length = 0;
for (const msg of ["join", "subscribe", "room", "joinRoom", "watch"]) { e4.sock.emit(msg, "person:e1"); e4.sock.emit(msg, { room: "person:e1", userId: "e1" }); }
e4.sock.emit("resync", { room: "person:e1", userId: "e1", ids: ["e1", "e2", "e3"] }); // arguments are never read
await sleep(500);
emit("e1"); emit("e2"); emit("e3");
await sleep(300);
ok("an employee who tries to join other people's rooms (several ways) receives nothing", e4.events.length === 0, idsOf(e4));
emit("e4");
await sleep(200);
ok("...but still receives their own", JSON.stringify(idsOf(e4)) === JSON.stringify(["e4"]), idsOf(e4));
mgrB.events.length = 0;
mgrB.sock.emit("join", "person:e1"); mgrB.sock.emit("resync", { ids: ["e1"] });
await sleep(400);
emit("e1");
await sleep(200);
ok("a manager cannot add another team's person either", mgrB.events.length === 0, idsOf(mgrB));

// 4. payload contract ------------------------------------------------------------------------------
for (let i = 0; i < 30; i++) emit("e1", "task-" + i);
await sleep(400);
const keys = Object.keys(e1.events.at(-1)).sort().join(",");
ok("the payload is exactly { action, at, eventId, ownerId, taskId } (no titles, names or counts)", keys === "action,at,eventId,ownerId,taskId", keys);
ok("every eventId is unique (duplicates can be ignored by the client)", new Set(e1.events.map((e) => e.eventId)).size === e1.events.length);

// 5. rights change while connected (team membership changes) ---------------------------------------------------
teams.mgrA = ["e1", "e3"]; // e2 moved away, e3 joined
await sleep(5200); // the server limits resync to once per 5 s
mgrA.events.length = 0;
mgrA.sock.emit("resync");
await sleep(500);
emit("e1"); emit("e2"); emit("e3");
await sleep(300);
ok("after a resync the manager's rooms follow the database (e1, e3 yes; e2 no)", JSON.stringify(idsOf(mgrA).sort()) === JSON.stringify(["e1", "e3"]), idsOf(mgrA));
teams.mgrA = ["e1", "e2"];

// 6. reconnection ---------------------------------------------------------------------------------------
const readyBefore = e1.ready;
e1.events.length = 0;
e1.sock.io.engine.close(); // simulate the network dropping
await sleep(1200);
ok("the client reconnects by itself and is re-subscribed (a new 'ready')", e1.ready === readyBefore + 1 && e1.sock.connected, { ready: e1.ready, connected: e1.sock.connected });
emit("e1");
await sleep(300);
ok("events flow again after the reconnect", idsOf(e1).length === 1, idsOf(e1));

// 7. revocation ------------------------------------------------------------------------------------------
const gone = new Promise<string>((r) => e2.sock.on("disconnect", (reason: string) => r(reason)));
revoked.add("e2"); // e2 is suspended
const reason = await Promise.race([gone, sleep(4000).then(() => "STILL CONNECTED")]);
ok("a suspended user is cut off by the periodic re-check", reason === "io server disconnect", reason);
e2.sock.close();

// 7b. notification signals go ONLY to the recipient's private inbox -----------------------------------------------
for (const c of [mgrA, mgrB, hr, e1, e3, e4]) c.inbox.length = 0;
emitNotificationChange(["e1"]);
await sleep(300);
ok("a notification signal reaches only its recipient (e1)", e1.inbox.length === 1 && e3.inbox.length === 0 && e4.inbox.length === 0, { e1: e1.inbox.length, e3: e3.inbox.length });
ok("...and NOT the manager or HR who can see e1's tasks (they learn nothing about e1's inbox)", mgrA.inbox.length === 0 && hr.inbox.length === 0 && mgrB.inbox.length === 0, { mgrA: mgrA.inbox.length, hr: hr.inbox.length });
ok("the signal carries no content (only eventId and time)", Object.keys(e1.inbox[0] ?? {}).sort().join() === "at,eventId", Object.keys(e1.inbox[0] ?? {}));
emitNotificationChange(["e1", "e3", "e1"]);
await sleep(300);
ok("several recipients each get exactly one signal (a repeated id does not double it)", e1.inbox.length === 2 && e3.inbox.length === 1 && e4.inbox.length === 0, { e1: e1.inbox.length, e3: e3.inbox.length });
emitNotificationChange([]);
await sleep(100);
ok("signalling nobody is a harmless no-op", e1.inbox.length === 2);
e4.sock.emit("join", "inbox:e1"); e4.sock.emit("subscribe", "inbox:e1"); e4.sock.emit("resync", { room: "inbox:e1" });
await sleep(500);
emitNotificationChange(["e1"]);
await sleep(300);
ok("an employee cannot join another person's inbox", e4.inbox.length === 0, e4.inbox);
e1.sock.io.engine.close();
await sleep(1200);
emitNotificationChange(["e1"]);
await sleep(300);
ok("after a network drop and reconnect the private inbox works again", e1.inbox.length === 4, e1.inbox.length);

// 8. emitting never breaks a save --------------------------------------------------------------------------
let threw = false;
await stopRealtime();
try { emitTaskChange({ taskId: "x", ownerId: "e1", action: "created" }); } catch { threw = true; }
ok("emitting with real-time stopped is a harmless no-op (a task save can never fail because of it)", !threw);

for (const c of [mgrA, mgrB, hr, e1, e3, e4]) c.sock.close();
httpServer.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
