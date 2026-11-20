const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname,"../../Project/server-configs/systemd");
const read = (name) => fs.readFileSync(path.join(root,name),"utf8");

test("PAJ-Push wird ausschliesslich durch separate Credential-/Netzwerk-Opt-ins aktivierbar", () => {
  const app = read("epiber-devel.service");
  const worker = read("epiber-devel-worker.service");
  assert.match(app,/IPAddressDeny=any\nIPAddressAllow=localhost/);
  assert.match(worker,/^RestrictAddressFamilies=AF_UNIX$/m);
  assert.doesNotMatch(`${app}\n${worker}`,/PUSH_PILOT_ENABLED=true/);
  for (const name of ["epiber-devel-push.conf","epiber-devel-worker-push.conf"]) {
    const dropin = read(name);
    assert.match(dropin,/EnvironmentFile=\/etc\/epiber-devel\/push\.env/);
    assert.match(dropin,/LoadCredential=push-vapid-private:\/etc\/epiber-devel\/credentials\/push-vapid-private/);
    assert.match(dropin,/Environment=PUSH_VAPID_PRIVATE_KEY_FILE=%d\/push-vapid-private/);
    assert.doesNotMatch(dropin,/IPAddressAllow=any|NoNewPrivileges=false|ProtectSystem=false/);
  }
  assert.match(read("epiber-devel-worker-push.conf"),/^RestrictAddressFamilies=\nRestrictAddressFamilies=AF_UNIX AF_INET AF_INET6$/m);
  const env = read("epiber-devel-push.env.example");
  assert.match(env,/^PUSH_PILOT_ENABLED=true$/m);
  assert.match(env,/^PUSH_VAPID_PUBLIC_KEY=CHANGE_ME_PUBLIC_VAPID_KEY$/m);
  assert.doesNotMatch(env,/^PUSH_VAPID_PRIVATE_KEY=/m);
});
