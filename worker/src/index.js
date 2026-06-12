const DEFAULT_ROOM_ID = 'party';
const MAX_ROOM_ID_LENGTH = 48;
const MAX_NAME_LENGTH = 18;
const MAX_PEOPLE = 120;
const MAX_QUARTERS = 4000;
const STATE_MAX_AGE_SECONDS = 10 * 60;
const IDENTITY_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

const DEFAULT_QUICK_AMOUNTS = [
  { id: 'default_025', label: '0.25', quarters: 1 },
  { id: 'default_05', label: '0.5', quarters: 2 },
  { id: 'default_1', label: '1', quarters: 4 }
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return corsResponse(new Response(null, { status: 204 }), request, env);
    }

    if (url.pathname === '/api/health') {
      return corsResponse(json({ ok: true, service: 'drink-recorder-api' }), request, env);
    }

    if (url.pathname === '/api/auth/wechat/login') {
      return handleWechatLogin(request, env);
    }

    if (url.pathname === '/api/auth/wechat/callback') {
      return handleWechatCallback(request, env);
    }

    const roomMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/(state|operations|socket)$/);
    if (!roomMatch) {
      return corsResponse(json({ error: 'not_found' }, 404), request, env);
    }

    if (!isAllowedOrigin(request, env)) {
      return json({ error: 'origin_not_allowed' }, 403);
    }

    if (!env.ROOMS) {
      return corsResponse(json({ error: 'durable_object_not_configured' }, 500), request, env);
    }

    const roomId = normalizeRoomId(decodeURIComponent(roomMatch[1]));
    const durableId = env.ROOMS.idFromName(roomId);
    const room = env.ROOMS.get(durableId);
    const response = await room.fetch(request);

    if (roomMatch[2] === 'socket') {
      return response;
    }

    return corsResponse(response, request, env);
  }
};

export class DrinkRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();
  }

  async fetch(request) {
    const url = new URL(request.url);
    const roomMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/(state|operations|socket)$/);
    if (!roomMatch) {
      return json({ error: 'not_found' }, 404);
    }

    const action = roomMatch[2];
    if (action === 'state' && request.method === 'GET') {
      const room = await this.getRoom();
      return json({ room });
    }

    if (action === 'operations' && request.method === 'POST') {
      return this.handleOperation(request);
    }

    if (action === 'socket' && request.headers.get('Upgrade') === 'websocket') {
      return this.handleSocket(request);
    }

    return json({ error: 'method_not_allowed' }, 405);
  }

  async getRoom() {
    const stored = await this.state.storage.get('room');
    return normalizeRoom(stored);
  }

  async saveRoom(room) {
    await this.state.storage.put('room', normalizeRoom(room));
  }

  async handleOperation(request) {
    let payload;
    try {
      payload = await request.json();
    } catch (error) {
      return json({ error: 'invalid_json' }, 400);
    }

    const operation = await sanitizeOperation(payload.operation, payload.identityToken, this.env);
    if (!operation) {
      return json({ error: 'invalid_operation' }, 400);
    }

    const room = await this.getRoom();
    const nextRoom = applyOperation(room, operation);
    await this.saveRoom(nextRoom);
    this.broadcast({ type: 'snapshot', room: nextRoom, operation });
    return json({ room: nextRoom });
  }

  async handleSocket(request) {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const url = new URL(request.url);
    const clientId = sanitizeId(url.searchParams.get('clientId') || randomId('client'));

    server.accept();
    this.sessions.set(server, clientId);

    server.addEventListener('close', () => {
      this.sessions.delete(server);
    });

    server.addEventListener('error', () => {
      this.sessions.delete(server);
    });

    const room = await this.getRoom();
    server.send(JSON.stringify({ type: 'snapshot', room }));
    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(message) {
    const text = JSON.stringify(message);
    for (const socket of this.sessions.keys()) {
      try {
        socket.send(text);
      } catch (error) {
        this.sessions.delete(socket);
      }
    }
  }
}

async function handleWechatLogin(request, env) {
  const url = new URL(request.url);
  const appId = env.WECHAT_APP_ID;
  const stateSecret = env.STATE_SECRET;
  const requestedMode = (url.searchParams.get('mode') || env.WECHAT_MODE) === 'open' ? 'open' : 'mp';
  const returnTo = sanitizeReturnTo(url.searchParams.get('returnTo'), env);

  if (!appId || !stateSecret || !returnTo) {
    return corsResponse(json({ error: 'wechat_login_not_configured' }, 500), request, env);
  }

  const state = await signPayload({
    mode: requestedMode,
    returnTo,
    nonce: randomId('state'),
    iat: Math.floor(Date.now() / 1000)
  }, stateSecret);

  const callbackUrl = `${url.origin}/api/auth/wechat/callback`;
  const scope = requestedMode === 'open' ? 'snsapi_login' : 'snsapi_userinfo';
  const authBase = requestedMode === 'open'
    ? 'https://open.weixin.qq.com/connect/qrconnect'
    : 'https://open.weixin.qq.com/connect/oauth2/authorize';
  const target = new URL(authBase);
  target.searchParams.set('appid', appId);
  target.searchParams.set('redirect_uri', callbackUrl);
  target.searchParams.set('response_type', 'code');
  target.searchParams.set('scope', scope);
  target.searchParams.set('state', state);

  return Response.redirect(`${target.toString()}#wechat_redirect`, 302);
}

async function handleWechatCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const signedState = url.searchParams.get('state');

  let state;
  try {
    state = await verifySignedPayload(signedState, env.STATE_SECRET, STATE_MAX_AGE_SECONDS);
  } catch (error) {
    return json({ error: 'invalid_state' }, 400);
  }

  if (!code || !state || !state.returnTo) {
    return json({ error: 'invalid_callback' }, 400);
  }

  try {
    const wechatProfile = await fetchWechatProfile(code, state.mode, env);
    const identityToken = await signPayload({
      provider: 'wechat',
      sub: wechatProfile.openid,
      displayName: wechatProfile.displayName,
      avatarUrl: wechatProfile.avatarUrl,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + IDENTITY_MAX_AGE_SECONDS
    }, env.IDENTITY_TOKEN_SECRET || env.STATE_SECRET);

    const profile = {
      provider: 'wechat',
      displayName: wechatProfile.displayName,
      avatarUrl: wechatProfile.avatarUrl,
      identityToken
    };

    return Response.redirect(buildHashRedirect(state.returnTo, 'wechat_profile', base64UrlJson(profile)), 302);
  } catch (error) {
    return Response.redirect(buildHashRedirect(state.returnTo, 'wechat_error', 'login_failed'), 302);
  }
}

async function fetchWechatProfile(code, mode, env) {
  const appId = env.WECHAT_APP_ID;
  const appSecret = env.WECHAT_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error('missing_wechat_secret');
  }

  const tokenUrl = new URL('https://api.weixin.qq.com/sns/oauth2/access_token');
  tokenUrl.searchParams.set('appid', appId);
  tokenUrl.searchParams.set('secret', appSecret);
  tokenUrl.searchParams.set('code', code);
  tokenUrl.searchParams.set('grant_type', 'authorization_code');

  const tokenResponse = await fetch(tokenUrl.toString(), {
    headers: { Accept: 'application/json' }
  });
  const tokenPayload = await tokenResponse.json();
  if (!tokenResponse.ok || tokenPayload.errcode || !tokenPayload.access_token || !tokenPayload.openid) {
    throw new Error('wechat_token_failed');
  }

  const userInfoUrl = new URL('https://api.weixin.qq.com/sns/userinfo');
  userInfoUrl.searchParams.set('access_token', tokenPayload.access_token);
  userInfoUrl.searchParams.set('openid', tokenPayload.openid);
  userInfoUrl.searchParams.set('lang', 'zh_CN');

  const userInfoResponse = await fetch(userInfoUrl.toString(), {
    headers: { Accept: 'application/json' }
  });
  const userInfo = await userInfoResponse.json();
  if (!userInfoResponse.ok || userInfo.errcode) {
    throw new Error(`wechat_userinfo_failed_${mode || 'mp'}`);
  }

  return {
    openid: sanitizeText(tokenPayload.openid, 80),
    displayName: sanitizeText(userInfo.nickname || '微信用户', MAX_NAME_LENGTH),
    avatarUrl: sanitizeUrl(userInfo.headimgurl || '')
  };
}

async function sanitizeOperation(input, identityToken, env) {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const type = sanitizeText(input.type, 40);
  if (!type) {
    return null;
  }

  const verifiedActor = await actorFromIdentityToken(identityToken, env);
  const actor = verifiedActor || sanitizeActor(input.actor);
  const operation = {
    id: sanitizeId(input.id || randomId('op')),
    type,
    clientId: sanitizeId(input.clientId || actor.clientId || ''),
    actor,
    createdAt: Number.isFinite(Number(input.createdAt)) ? Number(input.createdAt) : Date.now()
  };

  if (input.person) {
    operation.person = normalizePerson(input.person, 0);
  }
  if (input.personId) {
    operation.personId = sanitizeId(input.personId);
  }
  if (input.personName) {
    operation.personName = sanitizeText(input.personName, MAX_NAME_LENGTH);
  }
  if (input.delta !== undefined) {
    operation.delta = clampInteger(input.delta, -MAX_QUARTERS, MAX_QUARTERS);
  }
  if (input.amount) {
    operation.amount = normalizeQuickAmount(input.amount, 0);
  }
  if (input.quickId) {
    operation.quickId = sanitizeId(input.quickId);
  }
  if (input.quarters !== undefined) {
    operation.quarters = clampInteger(input.quarters, 1, MAX_QUARTERS);
  }
  if (input.label) {
    operation.label = sanitizeText(input.label, 16);
  }
  if (Array.isArray(input.quickAmounts)) {
    operation.quickAmounts = input.quickAmounts
      .map((item, index) => normalizeQuickAmount(item, index))
      .filter(Boolean)
      .slice(0, 24);
  }

  return operation;
}

async function actorFromIdentityToken(identityToken, env) {
  if (!identityToken) {
    return null;
  }

  try {
    const payload = await verifySignedPayload(identityToken, env.IDENTITY_TOKEN_SECRET || env.STATE_SECRET, IDENTITY_MAX_AGE_SECONDS);
    if (!payload || payload.provider !== 'wechat' || !payload.displayName) {
      return null;
    }
    return {
      clientId: '',
      name: sanitizeText(payload.displayName, MAX_NAME_LENGTH),
      avatarUrl: sanitizeUrl(payload.avatarUrl || ''),
      identityProvider: 'wechat'
    };
  } catch (error) {
    return null;
  }
}

function sanitizeActor(input) {
  const actor = input && typeof input === 'object' ? input : {};
  return {
    clientId: sanitizeId(actor.clientId || ''),
    name: sanitizeText(actor.name || 'guest', MAX_NAME_LENGTH) || 'guest',
    avatarUrl: sanitizeUrl(actor.avatarUrl || ''),
    identityProvider: sanitizeText(actor.identityProvider || 'guest', 16) || 'guest'
  };
}

function applyOperation(room, operation) {
  const next = normalizeRoom(room);

  switch (operation.type) {
    case 'addPerson':
      if (operation.person && next.people.length < MAX_PEOPLE && !next.people.some((person) => person.id === operation.person.id)) {
        next.people.push(operation.person);
      }
      break;
    case 'updatePersonQuarters':
      updatePerson(next, operation.personId, (person) => {
        person.quarters = clampInteger(person.quarters + operation.delta, 0, MAX_QUARTERS);
      });
      break;
    case 'resetPerson':
      updatePerson(next, operation.personId, (person) => {
        person.quarters = 0;
      });
      break;
    case 'deletePerson':
      next.people = next.people.filter((person) => person.id !== operation.personId);
      break;
    case 'resetAllPeople':
      next.people = next.people.map((person) => ({ ...person, quarters: 0 }));
      break;
    case 'clearAllPeople':
      next.people = [];
      break;
    case 'addQuickAmount':
      if (operation.amount && !next.quickAmounts.some((amount) => amount.id === operation.amount.id)) {
        next.quickAmounts.push(operation.amount);
      }
      break;
    case 'editQuickAmount':
      next.quickAmounts = next.quickAmounts.map((amount) => (
        amount.id === operation.quickId
          ? { ...amount, quarters: operation.quarters, label: formatCupsByQuarters(operation.quarters) }
          : amount
      ));
      break;
    case 'deleteQuickAmount':
      if (next.quickAmounts.length > 1) {
        next.quickAmounts = next.quickAmounts.filter((amount) => amount.id !== operation.quickId);
      }
      break;
    case 'restoreDefaultQuickAmounts':
      next.quickAmounts = cloneDefaultQuickAmounts();
      break;
    default:
      break;
  }

  next.revision += 1;
  next.updatedAt = Date.now();
  next.lastActivity = compactOperation(operation);
  return next;
}

function updatePerson(room, personId, updater) {
  const person = room.people.find((item) => item.id === personId);
  if (person) {
    updater(person);
  }
}

function normalizeRoom(input) {
  const room = input && typeof input === 'object' ? input : {};
  const people = Array.isArray(room.people)
    ? room.people.map((item, index) => normalizePerson(item, index)).filter(Boolean).slice(0, MAX_PEOPLE)
    : [];
  const quickAmounts = Array.isArray(room.quickAmounts)
    ? room.quickAmounts.map((item, index) => normalizeQuickAmount(item, index)).filter(Boolean).slice(0, 24)
    : cloneDefaultQuickAmounts();

  return {
    people,
    quickAmounts: quickAmounts.length ? quickAmounts : cloneDefaultQuickAmounts(),
    revision: Number.isFinite(Number(room.revision)) ? Math.max(0, Number(room.revision)) : 0,
    updatedAt: Number.isFinite(Number(room.updatedAt)) ? Number(room.updatedAt) : Date.now(),
    lastActivity: compactOperation(room.lastActivity)
  };
}

function normalizePerson(item, index) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const name = sanitizeText(item.name || 'unnamed', MAX_NAME_LENGTH) || 'unnamed';
  return {
    id: sanitizeId(item.id || randomId(`person_${index}`)),
    name,
    quarters: clampInteger(item.quarters, 0, MAX_QUARTERS),
    createdAt: Number.isFinite(Number(item.createdAt)) ? Number(item.createdAt) : Date.now() + index
  };
}

function normalizeQuickAmount(item, index) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const quarters = clampInteger(item.quarters, 1, MAX_QUARTERS);
  return {
    id: sanitizeId(item.id || randomId(`quick_${index}`)),
    label: formatCupsByQuarters(quarters),
    quarters
  };
}

function compactOperation(operation) {
  if (!operation || typeof operation !== 'object') {
    return null;
  }

  return {
    id: sanitizeId(operation.id || ''),
    type: sanitizeText(operation.type || '', 40),
    actor: sanitizeActor(operation.actor),
    personId: sanitizeId(operation.personId || ''),
    personName: sanitizeText(operation.personName || (operation.person && operation.person.name) || '', MAX_NAME_LENGTH),
    delta: Number.isFinite(Number(operation.delta)) ? Number(operation.delta) : 0,
    label: sanitizeText(operation.label || (operation.amount && operation.amount.label) || '', 16),
    quarters: Number.isFinite(Number(operation.quarters)) ? Number(operation.quarters) : 0,
    createdAt: Number.isFinite(Number(operation.createdAt)) ? Number(operation.createdAt) : Date.now()
  };
}

function cloneDefaultQuickAmounts() {
  return DEFAULT_QUICK_AMOUNTS.map((item) => ({ ...item }));
}

function formatCupsByQuarters(quarters) {
  const safeQuarters = clampInteger(quarters, 0, MAX_QUARTERS);
  const cups = safeQuarters / 4;
  return Number.isInteger(cups) ? String(cups) : String(cups).replace(/0+$/, '').replace(/\.$/, '');
}

function normalizeRoomId(input) {
  const text = sanitizeText(input || DEFAULT_ROOM_ID, MAX_ROOM_ID_LENGTH);
  return text.replace(/[^\w\u4e00-\u9fa5-]/g, '-') || DEFAULT_ROOM_ID;
}

function sanitizeId(input) {
  return String(input || '').trim().replace(/[^\w:.-]/g, '-').slice(0, 96) || randomId('id');
}

function sanitizeText(input, maxLength) {
  return String(input || '').trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maxLength);
}

function sanitizeUrl(input) {
  try {
    const text = String(input || '').trim();
    if (!text) {
      return '';
    }
    const url = new URL(text);
    return url.protocol === 'https:' ? url.toString().slice(0, 512) : '';
  } catch (error) {
    return '';
  }
}

function sanitizeReturnTo(returnTo, env) {
  try {
    const target = new URL(returnTo || '');
    const origin = target.origin;
    if (!isOriginAllowed(origin, env)) {
      return '';
    }
    return target.toString();
  } catch (error) {
    return '';
  }
}

function isAllowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  return !origin || isOriginAllowed(origin, env);
}

function isOriginAllowed(origin, env) {
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean);
  return allowed.includes('*') || allowed.includes(origin);
}

function corsResponse(response, request, env) {
  const origin = request.headers.get('Origin');
  const headers = new Headers(response.headers);
  if (origin && isOriginAllowed(origin, env)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
    headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    headers.set('Access-Control-Max-Age', '86400');
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function buildHashRedirect(returnTo, key, value) {
  const target = new URL(returnTo);
  const params = new URLSearchParams(target.hash.replace(/^#/, ''));
  params.set(key, value);
  target.hash = params.toString();
  return target.toString();
}

async function signPayload(payload, secret) {
  const body = base64UrlJson(payload);
  const signature = await hmacSha256(body, secret);
  return `${body}.${signature}`;
}

async function verifySignedPayload(token, secret, maxAgeSeconds) {
  if (!token || !secret || !token.includes('.')) {
    throw new Error('invalid_token');
  }

  const [body, signature] = token.split('.');
  const expected = await hmacSha256(body, secret);
  if (!timingSafeEqual(signature, expected)) {
    throw new Error('invalid_signature');
  }

  const payload = JSON.parse(base64UrlDecodeToString(body));
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    throw new Error('expired_token');
  }
  if (payload.iat && now - payload.iat > maxAgeSeconds) {
    throw new Error('stale_token');
  }
  return payload;
}

async function hmacSha256(message, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return base64UrlEncode(new Uint8Array(signature));
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

function base64UrlJson(value) {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecodeToString(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function clampInteger(input, min, max) {
  const value = Math.round(Number(input));
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function randomId(prefix) {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
