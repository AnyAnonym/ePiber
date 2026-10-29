const test = require("node:test");
const assert = require("node:assert/strict");
const { setTestEnvironment } = require("./helpers");
setTestEnvironment();
const { createApplicationFixture } = require("./applicationFixture");
const { AppError } = require("../errors");

test("Push-HTTP ist authentifiziert, origin- und methodengeschuetzt und im Read-only-Modus schreibgesperrt", async (t) => {
  let authenticated = false;
  const writes = [];
  for (const writeMode of ["read_write","read_only"]) {
    const app = createApplicationFixture({
      writeMode,playService:{ status:() => ({}),stop:async () => {} },
      authService:{ requireUser:async () => {
        if (!authenticated) throw new AppError("AUTH_REQUIRED","Anmeldung erforderlich",401);
        return { principal:{ id:"1",role:"player" } };
      } },
      pushService:{ status:async () => ({ enabled:false,devices:[],tests:[] }),execute:async (principal,body) => { writes.push({ principal,body }); return { success:true }; } },
    });
    await new Promise((resolve) => app.server.listen(0,"127.0.0.1",resolve));
    t.after(() => app.shutdown("test"));
    const url = `http://127.0.0.1:${app.server.address().port}/api/push-pilot`;
    authenticated = false;
    assert.equal((await fetch(url)).status,401);
    authenticated = true;
    const status = await fetch(url);
    assert.equal(status.status,200);
    assert.equal(status.headers.get("cache-control"),"no-store");
    assert.deepEqual(await status.json(),{ enabled:false,devices:[],tests:[] });
    assert.equal((await fetch(url,{ method:"PUT" })).status,405);
    const post = (origin) => fetch(url,{ method:"POST",headers:{ Origin:origin,"Content-Type":"application/json" },body:JSON.stringify({ action:"test" }) });
    assert.equal((await post("https://evil.test")).status,writeMode === "read_only" ? 503 : 403);
    assert.equal((await post("http://test.local")).status,writeMode === "read_only" ? 503 : 200);
  }
  assert.equal(writes.length,1);
  assert.equal(writes[0].principal.id,"1");
});
