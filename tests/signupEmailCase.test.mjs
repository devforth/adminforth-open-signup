import test from 'node:test';
import assert from 'node:assert/strict';
import OpenSignupPlugin from '../dist/index.js';

function makePlugin({ usernameField = 'email', normalize } = {}) {
  const records = [];
  const cookies = [];
  const plugin = Object.create(OpenSignupPlugin.prototype);

  plugin.options = {
    emailField: 'email',
    passwordHashField: 'password_hash',
    expectedOrigin: 'https://app.example.com',
  };
  plugin.pluginInstanceId = 'open-signup-test';
  plugin.emailField = { name: 'email', ...(normalize ? { normalize } : {}) };
  plugin.passwordField = { minLength: 8, maxLength: 64 };
  plugin.authResource = {
    resourceId: 'users',
    columns: [{ name: 'id', primaryKey: true }, { name: 'email' }],
  };
  plugin.adminforth = {
    config: { auth: { usernameField }, customization: { brandName: 'Test' } },
    resource: () => ({
      get: async (filter) => records.find((record) => record.email === filter.value) ?? null,
      create: async (record) => {
        // core applies the column's normalize again on write, so the harness has to as well
        const email = normalize ? normalize(record.email) : record.email;
        const created = { id: `user-${records.length + 1}`, ...record, email };
        records.push(created);
        return created;
      },
    }),
    restApi: { processLoginCallbacks: async () => {} },
    auth: { setAuthCookie: (args) => cookies.push(args) },
  };

  let handler;
  plugin.setupEndpoints({
    endpoint: (options) => {
      if (options.path.endsWith('/signup')) {
        handler = options.handler;
      }
    },
  });

  const signup = (email) => handler({
    body: { email, url: 'https://app.example.com/signup', password: 'S3cret-pass' },
    response: {},
    headers: {},
    query: {},
    cookies: [],
    requestUrl: '/plugin/open-signup-test/signup',
    tr: async (message) => message,
  });

  return { plugin, records, cookies, signup };
}

test('a case-variant signup is rejected instead of creating a second account', async () => {
  const { records, signup, cookies } = makePlugin();

  // the first address is deliberately mixed-case: it is what pins the stored value to the folded one
  const first = await signup('Bob@Example.COM');
  assert.equal(first.allowedLogin, true);
  assert.equal(records.length, 1);
  assert.equal(records[0].email, 'bob@example.com');
  assert.equal(cookies.at(-1).username, 'bob@example.com');

  const second = await signup('bob@example.com');
  assert.match(second.error, /already exists/i);
  assert.equal(records.length, 1);
});

test('case folding does not depend on which column is the auth username field', async () => {
  const { records, signup } = makePlugin({ usernameField: 'login' });

  await signup('bob@example.com');
  const second = await signup('BOB@example.com');

  assert.match(second.error, /already exists/i);
  assert.equal(records.length, 1);
});

test('a configured column normalize runs on the folded value, and the stored value is the one probed', async () => {
  const { records, signup } = makePlugin({ normalize: (value) => value.trim() });

  await signup('  bob@example.com  ');
  const second = await signup('Bob@Example.com');

  assert.match(second.error, /already exists/i);
  assert.equal(records.length, 1);
  assert.equal(records[0].email, 'bob@example.com');
});

test('the probed value survives the column normalize core re-applies on write', async () => {
  const { records, signup } = makePlugin({ normalize: (value) => value.toUpperCase() });

  await signup('bob@example.com');
  const second = await signup('Bob@Example.com');

  assert.match(second.error, /already exists/i);
  assert.equal(records.length, 1);
});

test('a login whose account lookup finds nothing returns an error instead of crashing', async () => {
  const { plugin } = makePlugin();

  const result = await plugin.doLogin('nobody@example.com', {}, {});

  assert.equal(result.allowedLogin, false);
  assert.match(result.error, /not found/i);
});
